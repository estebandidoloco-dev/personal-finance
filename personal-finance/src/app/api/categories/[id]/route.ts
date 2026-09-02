import { NextRequest, NextResponse } from 'next/server';
import { apiError, invalidRequest, mapCategoryMutationError } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { categoryUpdateSchema, transactionIdSchema } from '@/lib/validation/financial';

const categoryFields = 'id, parent_id, name, type, budget_type, icon, color, is_system, sort_order, created_at, user_id';

async function getContext(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, category: null };
  const { data: category, error } = await supabase.from('categories')
    .select('id, user_id, is_system').eq('id', id).maybeSingle();
  return { supabase, user, category, lookupError: Boolean(error) };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) return invalidRequest(parsedId.error);
  const context = await getContext(parsedId.data);
  if (!context.user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);
  if (context.lookupError || !context.category) return apiError('category_not_found', 'Categoría no encontrada.', 404);
  if (context.category.is_system || context.category.user_id === null) {
    return apiError('category_read_only', 'Las categorías globales son de solo lectura.', 403);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return apiError('invalid_request', 'El JSON no es válido.', 400); }
  const parsed = categoryUpdateSchema.safeParse(body);
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await context.supabase.from('categories').update(parsed.data)
    .eq('id', parsedId.data).eq('user_id', context.user.id).select(categoryFields).single();
  if (error?.code === 'PGRST116') return apiError('category_not_found', 'Categoría no encontrada.', 404);
  if (error) return mapCategoryMutationError(error);
  return NextResponse.json(data);
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const parsedId = transactionIdSchema.safeParse((await params).id);
  if (!parsedId.success) return invalidRequest(parsedId.error);
  const context = await getContext(parsedId.data);
  if (!context.user) return apiError('unauthorized', 'Debes iniciar sesión.', 401);
  if (context.lookupError || !context.category) return apiError('category_not_found', 'Categoría no encontrada.', 404);
  if (context.category.is_system || context.category.user_id === null) {
    return apiError('category_read_only', 'Las categorías globales son de solo lectura.', 403);
  }
  const { data, error } = await context.supabase.from('categories').delete()
    .eq('id', parsedId.data).eq('user_id', context.user.id).select('id').maybeSingle();
  if (error?.code === '23503') return apiError('category_in_use', 'No puedes eliminar esta categoría porque está siendo usada por un presupuesto.', 409);
  if (error) return apiError('invalid_request', 'No se pudo eliminar la categoría.', 500);
  if (!data) return apiError('category_not_found', 'Categoría no encontrada.', 404);
  return new NextResponse(null, { status: 204 });
}