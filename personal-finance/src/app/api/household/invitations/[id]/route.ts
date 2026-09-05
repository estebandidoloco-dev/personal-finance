import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { householdIdSchema } from '@/lib/validation/household';
import { invalidRequest } from '@/lib/api/errors';

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdIdSchema.safeParse((await context.params).id);
  if (!parsed.success) return invalidRequest(parsed.error);
  const { error } = await supabase.rpc('revoke_household_invitation', { p_invitation_id: parsed.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ success: true });
}
