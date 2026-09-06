import { z } from 'zod';

const uuidSchema = z.string().uuid();
const unsignedMoneySchema = z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/);
const positiveMoneySchema = unsignedMoneySchema.refine((value) => value !== '0.00');
const signedMoneySchema = z.string().regex(/^-?(0|[1-9]\d{0,11})\.\d{2}$/)
  .refine((value) => value !== '-0.00');
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
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe usar YYYY-MM-DD')
  .refine(isCalendarDate, 'Fecha inválida');
const tagIdsSchema = z
  .array(uuidSchema)
  .max(50, 'Una transacción puede tener como máximo 50 etiquetas')
  .refine((ids) => new Set(ids).size === ids.length, 'Las etiquetas no pueden repetirse');

export const transactionMutationSchema = z
  .object({
    account_id: uuidSchema,
    category_id: uuidSchema.nullable().default(null),
    kind: z.enum(['income', 'expense']),
    amount: positiveMoneySchema,
    date: dateSchema,
    description: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(2000).nullable().default(null),
    is_shared: z.boolean().default(false),
    split_ratio: z.json().nullable().default(null),
    status: z.enum(['pending', 'posted', 'cancelled', 'duplicate']).default('posted'),
    tag_ids: tagIdsSchema.default([]),
  })
  .strict();

export const transactionIdSchema = z.string().uuid();

const accountTypeSchema = z.enum(['checking', 'savings', 'credit', 'cash', 'investment', 'other']);

const categoryTypeSchema = z.enum(['expense', 'income', 'transfer', 'savings']);
const budgetTypeSchema = z.enum(['need', 'want', 'savings']);
const colorSchema = z.string().trim().regex(/^#[0-9a-f]{6}$/i, 'El color debe usar formato hexadecimal de seis dígitos');

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  parent_id: uuidSchema.nullable().default(null),
  type: categoryTypeSchema,
  budget_type: budgetTypeSchema.nullable().default(null),
  icon: z.string().trim().min(1).max(50).nullable().default(null),
  color: colorSchema.nullable().default(null),
  sort_order: z.number().int().min(-10_000).max(10_000).default(0),
}).strict();

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  parent_id: uuidSchema.nullable().optional(),
  type: categoryTypeSchema.optional(),
  budget_type: budgetTypeSchema.nullable().optional(),
  icon: z.string().trim().min(1).max(50).nullable().optional(),
  color: colorSchema.nullable().optional(),
  sort_order: z.number().int().min(-10_000).max(10_000).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe indicar al menos un campo editable');

export const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: colorSchema.nullable().default(null),
}).strict();

export const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  color: colorSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Debe indicar al menos un campo editable');

export const accountCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: accountTypeSchema,
    initial_balance: signedMoneySchema,
    is_shared: z.boolean().default(false),
    institution: z.string().trim().max(100).nullable().default(null),
  })
  .strict();

export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: accountTypeSchema.optional(),
    is_shared: z.boolean().optional(),
    institution: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No hay campos editables');

const nullableTimestampSchema = z.string().datetime({ offset: true }).nullable();
export const personalAccountResponseSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  name: z.string(),
  type: accountTypeSchema,
  initial_balance: signedMoneySchema,
  balance: signedMoneySchema,
  currency: z.literal('MXN'),
  is_shared: z.boolean().nullable(),
  institution: z.string().nullable(),
  created_at: nullableTimestampSchema,
  last_synced_at: nullableTimestampSchema,
}).strict();
export const personalTransactionResponseSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  account_id: uuidSchema,
  category_id: uuidSchema.nullable(),
  kind: z.enum(['income', 'expense']),
  amount: positiveMoneySchema,
  currency: z.literal('MXN'),
  date: dateSchema,
  description: z.string(),
  notes: z.string().nullable(),
  is_shared: z.boolean().nullable(),
  split_ratio: z.json().nullable(),
  status: z.enum(['pending', 'posted', 'cancelled', 'duplicate']),
  source: z.string().nullable(),
  source_provider: z.string().nullable(),
  external_id: z.string().nullable(),
  import_match_hash: z.string().nullable(),
  csv_import_id: uuidSchema.nullable(),
  created_at: nullableTimestampSchema,
  updated_at: nullableTimestampSchema,
  category: z.object({
    id: uuidSchema,
    name: z.string(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    type: categoryTypeSchema,
  }).strict().nullable(),
  tags: z.array(z.object({
    tag: z.object({ id: uuidSchema, name: z.string(), color: z.string().nullable() }).strict(),
  }).strict()),
}).strict();
export const transactionListQuerySchema = z.object({
  account_id: uuidSchema.optional(),
  category_id: uuidSchema.optional(),
  start_date: dateSchema.optional(),
  end_date: dateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export function zodErrorResponse(error: z.ZodError) {
  return {
    error: 'Datos inválidos',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
