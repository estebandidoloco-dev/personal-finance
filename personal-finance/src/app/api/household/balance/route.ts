import { NextRequest, NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { apiError, invalidRequest } from '@/lib/api/errors';
import { householdBalanceResponseSchema, householdIdSchema } from '@/lib/validation/household';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdIdSchema.safeParse(request.nextUrl.searchParams.get('household_id'));
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await supabase.rpc('get_household_balance_between_members', {
    p_household_id: parsed.data,
  });
  if (error) return mapHouseholdError(error);
  const response = householdBalanceResponseSchema.safeParse(data);
  if (!response.success) {
    return apiError('invalid_household_response', 'La respuesta Household no cumple el contrato esperado.', 500);
  }
  return NextResponse.json(response.data);
}
