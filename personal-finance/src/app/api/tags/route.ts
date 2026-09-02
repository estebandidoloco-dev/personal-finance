import { NextRequest, NextResponse } from 'next/server';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { tagCreateSchema } from '@/lib/validation/financial';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);

  const { data, error } = await supabase
    .from('tags')
    .select('*')
    .eq('user_id', user.id)
    .order('name');

  if (error) return apiError('invalid_request', 'No se pudieron cargar las etiquetas.', 500);
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
  const parsed = tagCreateSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);

  const { data, error } = await supabase
    .from('tags').insert({ ...parsed.data, user_id: user.id })
    .select('id, name, color')
    .single();

  if (error) {
    if (error.code === '23505')
      return apiError('tag_already_exists', 'Ya existe una etiqueta con ese nombre.', 409);
    return apiError('invalid_request', 'No se pudo crear la etiqueta.', 400);
  }
  return NextResponse.json(data, { status: 201 });
}
