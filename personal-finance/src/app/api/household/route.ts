import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdCreateSchema } from '@/lib/validation/household';

export async function GET() {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const { data, error } = await supabase.rpc('get_current_household');
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdCreateSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await supabase.rpc('create_household', { p_name: parsed.data.name });
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ id: data }, { status: 201 });
}
