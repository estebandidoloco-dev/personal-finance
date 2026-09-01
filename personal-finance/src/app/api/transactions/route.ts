import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { transactionMutationSchema, zodErrorResponse } from '@/lib/validation/financial';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get('account_id');
  const categoryId = searchParams.get('category_id');
  const startDate = searchParams.get('start_date');
  const endDate = searchParams.get('end_date');
  const limit = parseInt(searchParams.get('limit') || '50');
  const offset = parseInt(searchParams.get('offset') || '0');

  let query = supabase
    .from('transactions')
    .select(
      `
      *,
      category:categories(id, name, icon, color, type),
      tags:transaction_tags(tag:tags(id, name, color))
    `
    )
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (accountId) query = query.eq('account_id', accountId);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (startDate) query = query.gte('date', startDate);
  if (endDate) query = query.lte('date', endDate);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
  const { data: transaction, error } = await supabase.rpc('create_financial_transaction', {
    p_account_id: input.account_id,
    p_amount: input.amount,
    p_category_id: input.category_id,
    p_currency: input.currency,
    p_date: input.date,
    p_description: input.description,
    p_external_id: null,
    p_is_shared: input.is_shared,
    p_kind: input.kind,
    p_notes: input.notes,
    p_source: 'manual',
    p_split_ratio: input.split_ratio,
    p_status: input.status,
    p_tag_ids: input.tag_ids,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(transaction, { status: 201 });
}
