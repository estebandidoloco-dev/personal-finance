import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  transactionIdSchema,
  transactionMutationSchema,
  personalTransactionResponseSchema,
  zodErrorResponse,
} from '@/lib/validation/financial';

async function getUserAndSupabase() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUserAndSupabase();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(zodErrorResponse(parsedId.error), { status: 400 });
  }
  const id = parsedId.data;
  const { data, error } = await supabase.rpc('get_personal_transaction', { p_transaction_id: id });

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const response = personalTransactionResponseSchema.safeParse(data);
  if (!response.success) return NextResponse.json({ error: 'Invalid transaction response' }, { status: 500 });
  return NextResponse.json(response.data);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUserAndSupabase();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(zodErrorResponse(parsedId.error), { status: 400 });
  }

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
  const { data: transaction, error } = await supabase.rpc('update_personal_transaction_exact', {
    p_account_id: input.account_id,
    p_amount: input.amount,
    p_category_id: input.category_id,
    p_date: input.date,
    p_description: input.description,
    p_transaction_id: parsedId.data,
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
  return NextResponse.json(response.data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUserAndSupabase();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(zodErrorResponse(parsedId.error), { status: 400 });
  }

  const { error } = await supabase.rpc('delete_personal_transaction', {
    p_transaction_id: parsedId.data,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ success: true });
}
