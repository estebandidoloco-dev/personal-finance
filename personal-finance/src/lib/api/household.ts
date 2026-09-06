import { z } from 'zod';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { createClient } from '@/lib/supabase/server';
import { householdCursorPayloadSchema } from '@/lib/validation/household';

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

export function decodeHouseholdCursor(cursor?: string) {
  if (!cursor) return { data: null } as const;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) {
      return { error: true } as const;
    }
    const parsed = householdCursorPayloadSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? { data: parsed.data } as const : { error: true } as const;
  } catch {
    return { error: true } as const;
  }
}

export function buildHouseholdPage(data: unknown, limit: number) {
  if (!Array.isArray(data)) return null;
  const items = data.slice(0, limit);
  if (data.length <= limit) return { items, next_cursor: null };
  const last = items.at(-1);
  if (typeof last !== 'object' || last === null) return null;
  const cursor = householdCursorPayloadSchema.safeParse({
    version: 1,
    date: 'date' in last ? last.date : undefined,
    created_at: 'created_at' in last ? last.created_at : undefined,
    id: 'id' in last ? last.id : undefined,
  });
  if (!cursor.success) return null;
  return {
    items,
    next_cursor: Buffer.from(JSON.stringify(cursor.data), 'utf8').toString('base64url'),
  };
}
