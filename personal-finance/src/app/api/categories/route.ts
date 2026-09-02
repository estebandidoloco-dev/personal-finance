import { NextRequest, NextResponse } from 'next/server';
import { apiError, invalidRequest, mapCategoryMutationError } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { categoryCreateSchema } from '@/lib/validation/financial';

const categoryFields = 'id, parent_id, name, type, budget_type, icon, color, is_system, sort_order, created_at, user_id';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);

  const { data, error } = await supabase
    .from('categories')
    .select(categoryFields)
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order('type', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) return apiError('invalid_request', 'No se pudieron cargar las categorías.', 500);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);

  let body: unknown;
  try { body = await req.json(); } catch { return apiError('invalid_request', 'El JSON no es válido.', 400); }
  const parsed = categoryCreateSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  const { data, error } = await supabase
    .from('categories').insert({ ...parsed.data, user_id: user.id, is_system: false })
    .select(categoryFields)
    .single();

  if (error) return mapCategoryMutationError(error);
  return NextResponse.json(data, { status: 201 });
}
