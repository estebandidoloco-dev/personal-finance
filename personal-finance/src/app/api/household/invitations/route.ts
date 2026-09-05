import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdInvitationCreateSchema } from '@/lib/validation/household';

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdInvitationCreateSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await supabase.rpc('create_household_invitation', {
    p_household_id: parsed.data.household_id,
    p_invited_email: parsed.data.invited_email,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data?.[0] ?? null, { status: 201 });
}
