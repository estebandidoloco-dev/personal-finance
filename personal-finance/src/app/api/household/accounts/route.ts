import { NextRequest, NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { invalidRequest } from '@/lib/api/errors';
import { householdAccountCreateSchema, householdIdSchema } from '@/lib/validation/household';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdIdSchema.safeParse(request.nextUrl.searchParams.get('household_id'));
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await supabase.rpc('get_household_accounts', { p_household_id: parsed.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdAccountCreateSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await supabase.rpc('create_household_account', {
    p_household_id: parsed.data.household_id,
    p_name: parsed.data.name,
    p_type: parsed.data.type,
    p_initial_balance: parsed.data.initial_balance,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data, { status: 201 });
}
