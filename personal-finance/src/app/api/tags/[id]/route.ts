import { NextRequest, NextResponse } from 'next/server';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { tagUpdateSchema, transactionIdSchema } from '@/lib/validation/financial';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) return invalidRequest(parsedId.error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);
  let body: unknown;
  try { body = await request.json(); } catch { return apiError('invalid_request', 'El JSON no es válido.', 400); }
  const parsed = tagUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await supabase.from('tags').update(parsed.data).eq('id', parsedId.data)
    .eq('user_id', user.id).select('id, name, color').maybeSingle();
  if (error?.code === '23505') return apiError('tag_already_exists', 'Ya existe una etiqueta con ese nombre.', 409);
  if (error) return apiError('invalid_request', 'No se pudo actualizar la etiqueta.', 500);
  if (!data) return apiError('tag_not_found', 'Etiqueta no encontrada.', 404);
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) return invalidRequest(parsedId.error);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);
  const { data, error } = await supabase.from('tags').delete().eq('id', parsedId.data)
    .eq('user_id', user.id).select('id').maybeSingle();
  if (error) return apiError('invalid_request', 'No se pudo eliminar la etiqueta.', 500);
  if (!data) return apiError('tag_not_found', 'Etiqueta no encontrada.', 404);
  return new NextResponse(null, { status: 204 });
}