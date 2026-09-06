import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { personalTransactionResponseSchema, transactionListQuerySchema, transactionMutationSchema, zodErrorResponse } from '@/lib/validation/financial';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const query = transactionListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!query.success) return NextResponse.json(zodErrorResponse(query.error), { status: 400 });
  const { data, error } = await supabase.rpc('get_personal_transactions', {
    p_account_id: query.data.account_id ?? null,
    p_category_id: query.data.category_id ?? null,
    p_start_date: query.data.start_date ?? null,
    p_end_date: query.data.end_date ?? null,
    p_limit: query.data.limit,
    p_offset: query.data.offset,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const response = personalTransactionResponseSchema.array().safeParse(data);
  if (!response.success) return NextResponse.json({ error: 'Invalid transaction response' }, { status: 500 });
  return NextResponse.json(response.data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const parsed = transactionMutationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 });
  }

  const input = parsed.data;
  const { data: transaction, error } = await supabase.rpc('create_personal_transaction_exact', {
    p_account_id: input.account_id,
    p_amount: input.amount,
    p_category_id: input.category_id,
    p_date: input.date,
    p_description: input.description,
    p_is_shared: input.is_shared,
    p_kind: input.kind,
    p_notes: input.notes,
    p_split_ratio: input.split_ratio,
    p_status: input.status,
    p_tag_ids: input.tag_ids,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const response = personalTransactionResponseSchema.safeParse(transaction);
  if (!response.success) return NextResponse.json({ error: 'Invalid transaction response' }, { status: 500 });
  return NextResponse.json(response.data, { status: 201 });
}
