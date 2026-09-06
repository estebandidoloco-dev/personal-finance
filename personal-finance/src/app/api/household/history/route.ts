import { NextRequest, NextResponse } from 'next/server';
import { buildHouseholdPage, decodeHouseholdCursor, getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { householdPageQuerySchema } from '@/lib/validation/household';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdPageQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return invalidRequest(parsed.error);
  const cursor = decodeHouseholdCursor(parsed.data.cursor);
  if ('error' in cursor) return apiError('invalid_cursor', 'El cursor no es válido.', 400);
  const { data, error } = await supabase.rpc('get_household_activity_page', {
    p_household_id: parsed.data.household_id,
    p_limit: parsed.data.limit,
    p_before_date: cursor.data?.date ?? null,
    p_before_created_at: cursor.data?.created_at ?? null,
    p_before_id: cursor.data?.id ?? null,
  });
  if (error) return mapHouseholdError(error);
  const page = buildHouseholdPage(data, parsed.data.limit);
  if (!page) return apiError('invalid_household_response', 'La respuesta Household no cumple el contrato esperado.', 500);
  return NextResponse.json(page);
}
