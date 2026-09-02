import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CSV_LIMITS } from '@/lib/csv/normalization';
import { prepareCsvImport } from '@/lib/csv/server';
import { csvImportRequestSchema, importZodError } from '@/lib/validation/imports';

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

  try {
    const preview = await prepareCsvImport(supabase, parsed.data);
    return NextResponse.json({
      duplicate_file: preview.duplicateFile,
      existing_import_id: preview.existingImportId,
      currency: preview.accountCurrency,
      rows: preview.rows,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo preparar la importación.' },
      { status: 400 }
    );
  }
}

