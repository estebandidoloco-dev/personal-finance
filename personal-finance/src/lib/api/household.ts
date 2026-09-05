import { z } from 'zod';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';

export async function getHouseholdContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function parseHouseholdBody<T>(request: Request, schema: z.ZodType<T>) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return { response: apiError('invalid_request', 'El JSON no es válido.', 400) } as const; }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { response: invalidRequest(parsed.error) } as const;
  return { data: parsed.data } as const;
}

export function mapHouseholdError(error: { code?: string; message?: string }) {
  if (error.code === 'P0002') return apiError('not_found', 'El recurso no existe o no está disponible.', 404);
  if (error.code === '23505') return apiError('conflict', 'La operación entra en conflicto con el estado actual.', 409);
  if (error.code === '28000') return apiError('unauthorized', 'Debes iniciar sesión.', 401);
  if (['22003', '22023', '22P02', '23503', '23514'].includes(error.code ?? '')) {
    return apiError('invalid_request', 'La operación no es válida para el estado actual.', 400);
  }
  return apiError('internal_error', 'No se pudo completar la operación.', 500);
}

export function unauthorizedHousehold() {
  return apiError('unauthorized', 'Debes iniciar sesión.', 401);
}
