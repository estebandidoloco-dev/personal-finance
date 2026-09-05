import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdIdSchema } from '@/lib/validation/household';
import { z } from 'zod';

const schema = z.object({ household_id: householdIdSchema }).strict();

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, schema);
  if ('response' in parsed) return parsed.response;
  const { error } = await supabase.rpc('leave_household', { p_household_id: parsed.data.household_id });
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ success: true });
}
