import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { householdInvitationTokenBodySchema } from '@/lib/validation/household';

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, householdInvitationTokenBodySchema);
  if ('response' in parsed) return parsed.response;
  const { error } = await supabase.rpc('reject_household_invitation', {
    p_invitation_token: parsed.data.token,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ success: true });
}
