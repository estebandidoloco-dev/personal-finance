import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { accountCreateSchema, personalAccountResponseSchema, zodErrorResponse } from '@/lib/validation/financial';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase.rpc('get_personal_accounts');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const parsed = personalAccountResponseSchema.array().safeParse(data);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid account response' }, { status: 500 });
  return NextResponse.json(parsed.data);
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

  const parsed = accountCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(zodErrorResponse(parsed.error), { status: 400 });
  }

  const input = parsed.data;

  const { data, error } = await supabase.rpc('create_personal_account', {
    p_name: input.name,
    p_type: input.type,
    p_initial_balance: input.initial_balance,
    p_is_shared: input.is_shared,
    p_institution: input.institution,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const response = personalAccountResponseSchema.safeParse(data);
  if (!response.success) return NextResponse.json({ error: 'Invalid account response' }, { status: 500 });
  return NextResponse.json(response.data, { status: 201 });
}
