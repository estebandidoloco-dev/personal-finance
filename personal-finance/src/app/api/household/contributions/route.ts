import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdContributionCreateSchema, householdContributionResponseSchema } from '@/lib/validation/household';

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdContributionCreateSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const { data, error } = await supabase.rpc('create_household_contribution', {
    p_household_id: input.household_id,
    p_source_personal_account_id: input.source_personal_account_id,
    p_destination_household_account_id: input.destination_household_account_id,
    p_amount: input.amount,
    p_date: input.date,
    p_note: input.note,
    p_idempotency_key: input.idempotency_key,
  });
  if (error) return mapHouseholdError(error);
  const response = householdContributionResponseSchema.safeParse(data);
  if (!response.success) return NextResponse.json({ code: 'invalid_household_response', message: 'La respuesta Household no cumple el contrato esperado.' }, { status: 500 });
  return NextResponse.json(response.data, { status: 201 });
}
