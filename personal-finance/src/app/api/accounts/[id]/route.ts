import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  accountUpdateSchema,
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
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', parsedId.data)
    .eq('user_id', user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
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
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getUserAndSupabase();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(zodErrorResponse(parsedId.error), { status: 400 });
  }
  const { error } = await supabase
    .from('accounts')
    .delete()
    .eq('id', parsedId.data)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
