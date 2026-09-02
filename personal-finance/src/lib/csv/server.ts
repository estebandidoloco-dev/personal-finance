import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import {
  normalizeCsvRows,
  type InvalidCsvRow,
  type NormalizedCsvRow,
} from '@/lib/csv/normalization';
import type { CsvImportRequest } from '@/lib/validation/imports';

export type CsvPreviewStatus = 'valid' | 'invalid' | 'duplicate' | 'possible_duplicate';

export type CsvPreviewRow =
  | (NormalizedCsvRow & {
      status: Exclude<CsvPreviewStatus, 'invalid'>;
      message: string | null;
    })
  | (InvalidCsvRow & { status: 'invalid'; message: string });

export interface PreparedCsvImport {
  accountCurrency: string;
  duplicateFile: boolean;
  existingImportId: string | null;
  rows: CsvPreviewRow[];
}

export async function prepareCsvImport(
  supabase: SupabaseClient<Database>,
  input: CsvImportRequest
): Promise<PreparedCsvImport> {
  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id, currency')
    .eq('id', input.account_id)
    .maybeSingle();

  if (accountError || !account) throw new Error('La cuenta no existe o no te pertenece.');

  if (input.category_id) {
    const { data: category, error: categoryError } = await supabase
      .from('categories')
      .select('id')
      .eq('id', input.category_id)
      .maybeSingle();
    if (categoryError || !category) throw new Error('La categoría no existe o no está disponible.');
  }

  const normalized = normalizeCsvRows(input.rows, input.options);
  const { data: existingImport, error: existingImportError } = await supabase
    .from('csv_imports')
    .select('id')
    .eq('account_id', input.account_id)
    .eq('file_hash', input.file_hash)
    .in('status', ['processing', 'completed', 'partial'])
    .maybeSingle();

  if (existingImportError) throw new Error(existingImportError.message);

  const duplicateFile = Boolean(existingImport);
  const classification = new Map<
    number,
    { strong_duplicate: boolean; possible_duplicate: boolean }
  >();

  if (!duplicateFile && normalized.valid.length > 0) {
    const rpcRows = normalized.valid.map(({ row_number, date, description, amount, kind, external_id }) => ({
      row_number,
      date,
      description,
      amount,
      kind,
      external_id,
    })) as unknown as Json;
    const { data, error } = await supabase.rpc('preview_csv_import_rows', {
      p_account_id: input.account_id,
      p_rows: rpcRows,
      p_source_provider: input.source_provider,
    });
    if (error) throw new Error(error.message);
    for (const row of data ?? []) classification.set(row.row_number, row);
  }

  const rows: CsvPreviewRow[] = [
    ...normalized.invalid.map((row) => ({
      ...row,
      status: 'invalid' as const,
      message: row.error,
    })),
    ...normalized.valid.map((row) => {
      if (duplicateFile) {
        return {
          ...row,
          status: 'duplicate' as const,
          message: 'Este mismo archivo ya fue procesado para la cuenta.',
        };
      }
      const result = classification.get(row.row_number);
      if (result?.strong_duplicate) {
        return {
          ...row,
          status: 'duplicate' as const,
          message: 'Ya existe un movimiento importado con este identificador bancario.',
        };
      }
      if (result?.possible_duplicate) {
        return {
          ...row,
          status: 'possible_duplicate' as const,
          message: 'Coincide con otro movimiento, pero no existe una identidad bancaria fuerte.',
        };
      }
      return { ...row, status: 'valid' as const, message: null };
    }),
  ].sort((left, right) => left.row_number - right.row_number);

  return {
    accountCurrency: account.currency,
    duplicateFile,
    existingImportId: existingImport?.id ?? null,
    rows,
  };
}

