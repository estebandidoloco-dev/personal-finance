import { NextRequest, NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { householdIdSchema } from '@/lib/validation/household';
import { invalidRequest } from '@/lib/api/errors';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdIdSchema.safeParse(request.nextUrl.searchParams.get('household_id'));
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await supabase.rpc('get_household_members', { p_household_id: parsed.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}
