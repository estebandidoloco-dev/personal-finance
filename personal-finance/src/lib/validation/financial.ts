import { z } from 'zod';

const uuidSchema = z.string().uuid();
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'La moneda debe tener tres letras mayúsculas');
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe usar YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Fecha inválida');
const tagIdsSchema = z
  .array(uuidSchema)
  .max(50, 'Una transacción puede tener como máximo 50 etiquetas')
  .refine((ids) => new Set(ids).size === ids.length, 'Las etiquetas no pueden repetirse');

export const transactionMutationSchema = z
  .object({
    account_id: uuidSchema,
    category_id: uuidSchema.nullable().default(null),
    kind: z.enum(['income', 'expense']),
    amount: z.number().finite().positive().max(999_999_999_999.99),
    currency: currencySchema,
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

export const accountCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    type: accountTypeSchema,
    initial_balance: z.number().finite().min(-999_999_999_999.99).max(999_999_999_999.99),
    currency: currencySchema.default('MXN'),
    is_shared: z.boolean().default(false),
    institution: z.string().trim().max(100).nullable().default(null),
  })
  .strict();

export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    type: accountTypeSchema.optional(),
    currency: currencySchema.optional(),
    is_shared: z.boolean().optional(),
    institution: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'No hay campos editables');

export function zodErrorResponse(error: z.ZodError) {
  return {
    error: 'Datos inválidos',
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
