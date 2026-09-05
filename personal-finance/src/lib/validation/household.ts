import { z } from 'zod';

export const householdIdSchema = z.string().uuid();
export const householdTokenSchema = z.string().regex(/^[0-9a-fA-F]{64}$/).transform((value) => value.toLowerCase());

const exactUnsignedMoney = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
export const exactPositiveMoneySchema = exactUnsignedMoney.refine((value) => value !== '0.00', 'El importe debe ser mayor que 0.00');
export const exactNonNegativeMoneySchema = exactUnsignedMoney;
export const exactSignedMoneySchema = z
  .string()
  .regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/)
  .refine((value) => value !== '-0.00', '-0.00 no es canónico');
const exactAggregateUnsignedMoneySchema = z.string().regex(/^(0|[1-9]\d*)\.\d{2}$/);
export const exactAggregateSignedMoneySchema = z
  .string()
  .regex(/^-?(0|[1-9]\d*)\.\d{2}$/)
  .refine((value) => value !== '-0.00', '-0.00 no es canónico');

function exactMoneyToCents(value: string) {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction] = unsigned.split('.');
  const cents = BigInt(integer) * BigInt('100') + BigInt(fraction);
  return negative ? -cents : cents;
}

export const householdBalanceResponseSchema = z.object({
  household_id: z.string().uuid(),
  currency: z.literal('MXN'),
  positions: z.array(z.object({
    user_id: z.string().uuid(),
    amount: exactAggregateSignedMoneySchema,
  }).strict()).length(2),
  owed_by_user_id: z.string().uuid().nullable(),
  owed_to_user_id: z.string().uuid().nullable(),
  amount: exactAggregateUnsignedMoneySchema,
}).strict().superRefine((value, context) => {
  const positions = value.positions.map((position) => exactMoneyToCents(position.amount));
  if (positions[0] + positions[1] !== BigInt('0')) {
    context.addIssue({ code: 'custom', message: 'Las posiciones deben sumar exactamente 0.00', path: ['positions'] });
  }
  const expectedAmount = positions.reduce((maximum, position) => {
    const absolute = position < BigInt('0') ? -position : position;
    return absolute > maximum ? absolute : maximum;
  }, BigInt('0'));
  if (exactMoneyToCents(value.amount) !== expectedAmount) {
    context.addIssue({ code: 'custom', message: 'El importe no coincide con las posiciones', path: ['amount'] });
  }
});

function isCalendarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export const financialDateSchema = z.string().refine(isCalendarDate, 'La fecha debe ser un DATE válido YYYY-MM-DD');
const accountTypeSchema = z.enum(['checking', 'savings', 'credit', 'cash', 'investment', 'other']);
const statusSchema = z.enum(['pending', 'posted', 'cancelled', 'duplicate']);
const splitSchema = z.object({
  user_id: householdIdSchema,
  amount: exactNonNegativeMoneySchema,
}).strict();

export const householdCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
}).strict();

export const householdInvitationCreateSchema = z.object({
  household_id: householdIdSchema,
  invited_email: z.string().trim().toLowerCase().email().max(320),
}).strict();
export const householdInvitationTokenBodySchema = z.object({ token: householdTokenSchema }).strict();

export const householdAccountCreateSchema = z.object({
  household_id: householdIdSchema,
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
  initial_balance: exactSignedMoneySchema.default('0.00'),
}).strict();
export const householdAccountUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: accountTypeSchema,
}).strict();

export const householdIncomeCreateSchema = z.object({
  account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  description: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullable().default(null),
  status: statusSchema.default('posted'),
}).strict();
export const householdIncomeUpdateSchema = householdIncomeCreateSchema.strict();

const sharedExpenseFields = {
  source_account_id: householdIdSchema,
  amount: exactPositiveMoneySchema,
  date: financialDateSchema,
  description: z.string().trim().min(1).max(200),
  split_mode: z.enum(['equal', 'custom']),
  splits: z.array(splitSchema).length(2).nullable().default(null),
  category_id: householdIdSchema.nullable().default(null),
  notes: z.string().trim().max(2000).nullable().default(null),
  status: statusSchema.default('posted'),
};

function validSplits(value: { split_mode: 'equal' | 'custom'; splits: z.infer<typeof splitSchema>[] | null }) {
  if (value.split_mode === 'equal') return value.splits === null;
  return value.splits !== null
    && new Set(value.splits.map((split) => split.user_id)).size === 2
    && value.splits.some((split) => split.amount !== '0.00');
}

export const sharedExpenseCreateSchema = z.object({
  household_id: householdIdSchema,
  funding_source: z.enum(['personal_account', 'household_account']),
  ...sharedExpenseFields,
}).strict().refine(validSplits, { message: 'Los splits no corresponden al modo seleccionado', path: ['splits'] });

export const sharedExpenseUpdateSchema = z.object(sharedExpenseFields).strict()
  .refine(validSplits, { message: 'Los splits no corresponden al modo seleccionado', path: ['splits'] });

export const householdListQuerySchema = z.object({
  household_id: householdIdSchema,
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).strict();
