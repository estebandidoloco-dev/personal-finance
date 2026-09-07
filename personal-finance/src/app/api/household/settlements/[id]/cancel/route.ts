import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { householdIdSchema, householdSettlementResponseSchema } from '@/lib/validation/household';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ code: 'invalid_request', message: 'La solicitud no es válida.' }, { status: 400 });
  const { data, error } = await supabase.rpc('cancel_household_settlement', {
    p_settlement_id: id.data,
  });
  if (error) return mapHouseholdError(error);
  const response = householdSettlementResponseSchema.safeParse(data);
  if (!response.success) return NextResponse.json({ code: 'invalid_household_response', message: 'La respuesta Household no cumple el contrato esperado.' }, { status: 500 });
  return NextResponse.json(response.data);
}

