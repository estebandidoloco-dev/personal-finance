import { z } from 'zod';

const MONEY_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;
const SIGNED_MONEY_PATTERN = /^-?(?:0|[1-9]\d*)\.\d{2}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDateString(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function formatDate(year: number, month: number, day: number) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function nextDate(value: string) {
  const parsed = parseDateString(value);
  if (!parsed) return null;
  let { year, month, day } = parsed;
  day += 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return formatDate(year, month, day);
}

export const moneySchema = z.string().regex(MONEY_PATTERN);
export const signedMoneySchema = z
  .string()
  .regex(SIGNED_MONEY_PATTERN)
  .refine((value) => value !== '-0.00', 'Negative zero is not canonical');
export const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => parseDateString(value) !== null, 'Invalid calendar date');
export const dashboardPeriodSchema = z.enum(['this_month', 'previous_month', 'last_30_days']);

const accountSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: z.enum(['checking', 'savings', 'credit', 'cash', 'investment', 'other']),
    balance: signedMoneySchema,
  })
  .strict();

const periodSchema = z
  .object({
    key: dashboardPeriodSchema,
    start_date: dateStringSchema,
    end_date_exclusive: dateStringSchema,
    timezone: z.literal('America/Mexico_City'),
  })
  .strict();

const timeSeriesPointSchema = z
  .object({
    date: dateStringSchema,
    income: moneySchema,
    expense: moneySchema,
    net: signedMoneySchema,
  })
  .strict();

export const dashboardResponseSchema = z
  .object({
    period: periodSchema,
    currency: z.literal('MXN'),
    accounts: z.array(accountSchema),
    totals: z
      .object({
        total_balance: signedMoneySchema,
        income: moneySchema,
        expense: moneySchema,
        net: signedMoneySchema,
      })
      .strict(),
    expenses_by_category: z.array(
      z
        .object({
          category_id: z.string().uuid().nullable(),
          name: z.string(),
          color: z.string().nullable(),
          is_uncategorized: z.boolean(),
          amount: moneySchema,
        })
        .strict()
    ),
    time_series: z
      .object({
        points: z.array(timeSeriesPointSchema),
      })
      .strict(),
    recent_transactions: z.array(
      z
        .object({
          id: z.string().uuid(),
          date: dateStringSchema,
          description: z.string(),
          amount: moneySchema,
          kind: z.enum(['income', 'expense']),
          category: z
            .object({
              id: z.string().uuid(),
              name: z.string(),
              color: z.string().nullable(),
            })
            .strict()
            .nullable(),
          account: z
            .object({
              id: z.string().uuid(),
              name: z.string(),
            })
            .strict(),
        })
        .strict()
    ),
  })
  .strict()
  .superRefine((response, context) => {
    const start = parseDateString(response.period.start_date);
    const end = parseDateString(response.period.end_date_exclusive);
    if (!start || !end) return;

    if (response.period.key === 'last_30_days' && response.time_series.points.length !== 30) {
      context.addIssue({
        code: 'custom',
        path: ['time_series', 'points'],
        message: 'last_30_days must contain exactly 30 points',
      });
    }

    if (response.period.key !== 'last_30_days') {
      const nextMonth = start.month === 12
        ? { year: start.year + 1, month: 1 }
        : { year: start.year, month: start.month + 1 };
      if (start.day !== 1 || end.day !== 1 || end.year !== nextMonth.year || end.month !== nextMonth.month) {
        context.addIssue({
          code: 'custom',
          path: ['period'],
          message: 'Monthly periods must cover one complete calendar month',
        });
      }
    }

    let expectedDate = response.period.start_date;

    for (const [index, point] of response.time_series.points.entries()) {
      if (point.date !== expectedDate) {
        context.addIssue({
          code: 'custom',
          path: ['time_series', 'points', index, 'date'],
          message: `Expected consecutive date ${expectedDate}`,
        });
        return;
      }
      expectedDate = nextDate(expectedDate) ?? '';
    }

    if (expectedDate !== response.period.end_date_exclusive) {
      context.addIssue({
        code: 'custom',
        path: ['time_series', 'points'],
        message: 'Time series must cover the complete period calendar',
      });
    }
  });

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;
