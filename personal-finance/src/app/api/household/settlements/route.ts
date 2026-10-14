import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdSettlementCreateSchema, householdSettlementResponseSchema } from '@/lib/validation/household';

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdSettlementCreateSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const { data, error } = await supabase.rpc('create_household_settlement', {
    p_household_id: input.household_id,
    p_amount: input.amount,
    p_date: input.date,
    p_notes: input.notes ?? null,
    p_idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
    p_funding_source: input.funding_source,
    p_source_personal_account_id: input.source_personal_account_id ?? null,
    p_source_household_account_id: input.source_household_account_id ?? null,
  });
  if (error) return mapHouseholdError(error);
  const response = householdSettlementResponseSchema.safeParse(data);
  if (!response.success) {
    return NextResponse.json({ code: 'invalid_household_response', message: 'La respuesta Household no cumple el contrato esperado.' }, { status: 500 });
  }
  return NextResponse.json(response.data, { status: 201 });
}
