import { NextResponse, type NextRequest } from 'next/server';
import type { Json } from '@/lib/database.types';
import { CSV_LIMITS } from '@/lib/csv/normalization';
import { prepareCsvImport } from '@/lib/csv/server';
import { createClient } from '@/lib/supabase/server';
import { csvImportRequestSchema, importZodError } from '@/lib/validation/imports';

interface BatchResult {
  row_number: number;
  result_status: 'imported' | 'duplicate' | 'invalid' | 'failed';
  transaction_id: string | null;
  error_code: string | null;
  error_message: string | null;
}

export async function POST(request: NextRequest) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > CSV_LIMITS.fileBytes) {
    return NextResponse.json({ error: 'La solicitud excede 5 MiB.' }, { status: 413 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 });
  }

  const parsed = csvImportRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(importZodError(parsed.error), { status: 400 });
  }

  const input = parsed.data;
  let prepared;
  try {
    prepared = await prepareCsvImport(supabase, input);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo validar la importación.' },
      { status: 400 }
    );
  }

  if (prepared.duplicateFile) {
    return NextResponse.json({
      duplicate_file: true,
      import_id: prepared.existingImportId,
      summary: {
        total: input.rows.length,
        imported: 0,
        duplicate: input.rows.length,
        invalid: 0,
        failed: 0,
      },
      rows: prepared.rows,
    });
  }

  const importPossible = new Set(input.import_possible_duplicate_rows);
  const invalidRows = prepared.rows.filter((row) => row.status === 'invalid');
  const strongDuplicates = prepared.rows.filter((row) => row.status === 'duplicate');
  const omittedPossible = prepared.rows.filter(
    (row) => row.status === 'possible_duplicate' && !importPossible.has(row.row_number)
  );
  const rowsToImport = prepared.rows.filter(
    (row) =>
      row.status === 'valid' ||
      (row.status === 'possible_duplicate' && importPossible.has(row.row_number))
  );
  const initialDuplicateCount = strongDuplicates.length + omittedPossible.length;

  const { data: importRecord, error: importError } = await supabase
    .from('csv_imports')
    .insert({
      account_id: input.account_id,
      file_hash: input.file_hash,
      file_name: input.file_name,
      metadata: {
        source_provider: input.source_provider,
        normalization: input.options,
      },
      rows_duplicate: initialDuplicateCount,
      rows_failed: 0,
      rows_imported: 0,
      rows_invalid: invalidRows.length,
      rows_skipped: initialDuplicateCount + invalidRows.length,
      rows_total: input.rows.length,
      status: 'processing',
      user_id: user.id,
    })
    .select('id')
    .single();

  if (importError || !importRecord) {
    if (importError?.code === '23505') {
      return NextResponse.json({
        duplicate_file: true,
        summary: { total: input.rows.length, imported: 0, duplicate: input.rows.length, invalid: 0, failed: 0 },
        rows: prepared.rows,
      });
    }
    return NextResponse.json({ error: importError?.message ?? 'No se pudo crear el historial.' }, { status: 400 });
  }

  const batchResults: BatchResult[] = [];
  let nextBatchStart = 0;
  try {
    for (nextBatchStart = 0; nextBatchStart < rowsToImport.length; nextBatchStart += CSV_LIMITS.batch) {
      const batch = rowsToImport.slice(nextBatchStart, nextBatchStart + CSV_LIMITS.batch).map((row) => {
        if (row.status === 'invalid') throw new Error('Invariant: invalid row reached batch.');
        return {
          row_number: row.row_number,
          date: row.date,
          description: row.description,
          amount: row.amount,
          kind: row.kind,
          notes: row.notes,
          external_id: row.external_id,
        };
      });
      const { data, error } = await supabase.rpc('import_csv_transactions_batch', {
        p_category_id: input.category_id,
        p_import_id: importRecord.id,
        p_rows: batch as unknown as Json,
      });
      if (error) throw new Error(error.message);
      batchResults.push(...((data ?? []) as BatchResult[]));
    }
  } catch (error) {
    const unprocessed = rowsToImport.length - nextBatchStart;
    const { data: current } = await supabase
      .from('csv_imports')
      .select('rows_failed, rows_imported, rows_skipped')
      .eq('id', importRecord.id)
      .single();
    await supabase
      .from('csv_imports')
      .update({
        completed_at: new Date().toISOString(),
        rows_failed: (current?.rows_failed ?? 0) + unprocessed,
        rows_skipped: (current?.rows_skipped ?? 0) + unprocessed,
        status: (current?.rows_imported ?? 0) > 0 ? 'partial' : 'failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', importRecord.id);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Un error estructural abortó el batch.',
        import_id: importRecord.id,
      },
      { status: 500 }
    );
  }

  const { data: counters, error: counterError } = await supabase
    .from('csv_imports')
    .select('rows_imported, rows_duplicate, rows_invalid, rows_failed')
    .eq('id', importRecord.id)
    .single();
  if (counterError || !counters) {
    return NextResponse.json({ error: 'La importación terminó, pero no se pudo leer su resumen.' }, { status: 500 });
  }

  const skipped = counters.rows_duplicate + counters.rows_invalid + counters.rows_failed;
  const finalStatus =
    skipped === 0
      ? 'completed'
      : counters.rows_imported > 0
        ? 'partial'
        : counters.rows_failed > 0
          ? 'failed'
          : 'completed';
  const now = new Date().toISOString();
  const { error: finalizeError } = await supabase
    .from('csv_imports')
    .update({ completed_at: now, status: finalStatus, updated_at: now })
    .eq('id', importRecord.id);
  if (finalizeError) {
    return NextResponse.json({ error: 'Los movimientos se guardaron, pero el historial quedó pendiente.' }, { status: 500 });
  }

  const nonBatchRows = [...invalidRows, ...strongDuplicates, ...omittedPossible];
  return NextResponse.json({
    duplicate_file: false,
    import_id: importRecord.id,
    summary: {
      total: input.rows.length,
      imported: counters.rows_imported,
      duplicate: counters.rows_duplicate,
      invalid: counters.rows_invalid,
      failed: counters.rows_failed,
    },
    rows: [...nonBatchRows, ...batchResults].sort((left, right) => left.row_number - right.row_number),
  });
}
