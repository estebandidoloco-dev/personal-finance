import { z } from 'zod';
import { CSV_LIMITS } from '@/lib/csv/normalization';

const optionalCell = z.string().max(CSV_LIMITS.notes).optional();

export const rawCsvRowSchema = z.object({
  row_number: z.number().int().positive().max(1_000_000),
  date: z.string().max(50),
  description: z.string().max(CSV_LIMITS.description * 2),
  amount: z.string().max(100).optional(),
  debit: z.string().max(100).optional(),
  credit: z.string().max(100).optional(),
  type: z.string().max(100).optional(),
  notes: optionalCell,
  external_id: z.string().max(CSV_LIMITS.externalId * 2).optional(),
});

export const csvImportRequestSchema = z
  .object({
    account_id: z.string().uuid(),
    category_id: z.string().uuid().nullable().default(null),
    file_name: z.string().trim().min(1).max(CSV_LIMITS.fileName),
    file_hash: z.string().regex(/^[0-9a-f]{64}$/),
    source_provider: z.string().trim().min(1).max(100).default('generic'),
    options: z.object({
      amount_mode: z.enum(['signed', 'debit_credit', 'amount_type']),
      date_format: z.enum(['iso', 'dmy', 'mdy']),
      number_format: z.enum(['auto', 'decimal_dot', 'decimal_comma']),
    }),
    rows: z.array(rawCsvRowSchema).min(1).max(CSV_LIMITS.rows),
    import_possible_duplicate_rows: z.array(z.number().int().positive()).max(CSV_LIMITS.rows).default([]),
  })
  .strict();

export type CsvImportRequest = z.infer<typeof csvImportRequestSchema>;

export function importZodError(error: z.ZodError) {
  return {
    error: 'Datos de importación inválidos.',
    details: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}
