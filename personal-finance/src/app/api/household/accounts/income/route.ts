import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdIncomeCreateSchema } from '@/lib/validation/household';

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdIncomeCreateSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const { data, error } = await supabase.rpc('create_household_account_income', {
    p_account_id: input.account_id, p_amount: input.amount, p_date: input.date,
    p_description: input.description, p_notes: input.notes, p_status: input.status,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data, { status: 201 });
}
