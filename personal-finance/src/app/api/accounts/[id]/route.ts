import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  accountUpdateSchema,
  personalAccountResponseSchema,
  transactionIdSchema,
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
  const { data, error } = await supabase.rpc('get_personal_account', { p_account_id: parsedId.data });

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  const response = personalAccountResponseSchema.safeParse(data);
  if (!response.success) return NextResponse.json({ error: 'Invalid account response' }, { status: 500 });
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

  const parsed = accountUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 });
  }

  const { data, error } = await supabase
    .from('accounts')
    .update(parsed.data)
    .eq('id', parsedId.data)
    .eq('user_id', user.id)
    .select('id')
    .single();

  if (error?.code === 'PGRST116') {
    return NextResponse.json({ error: 'Cuenta no encontrada.' }, { status: 404 });
  }
  if (error)
    return NextResponse.json({ error: 'No se pudo actualizar la cuenta.' }, { status: 500 });
  const { data: account, error: readError } = await supabase.rpc('get_personal_account', {
    p_account_id: data.id,
  });
  if (readError) return NextResponse.json({ error: 'No se pudo leer la cuenta.' }, { status: 500 });
  const response = personalAccountResponseSchema.safeParse(account);
  if (!response.success) return NextResponse.json({ error: 'Invalid account response' }, { status: 500 });
  return NextResponse.json(response.data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUserAndSupabase();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(zodErrorResponse(parsedId.error), { status: 400 });
  }
  const { data, error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', parsedId.data)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle();

  if (error?.code === '23503') {
    return NextResponse.json(
      { error: 'No puedes eliminar una cuenta que todavía tiene transacciones.' },
      { status: 409 }
    );
  }
  if (error) return NextResponse.json({ error: 'No se pudo eliminar la cuenta.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Cuenta no encontrada.' }, { status: 404 });
  return NextResponse.json({ success: true });
}
