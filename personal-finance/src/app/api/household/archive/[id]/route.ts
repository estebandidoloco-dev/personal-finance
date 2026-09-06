import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';
import { invalidRequest } from '@/lib/api/errors';
import { householdIdSchema } from '@/lib/validation/household';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await params).id);
  if (!id.success) return invalidRequest(id.error);
  const { data, error } = await supabase.rpc('get_archived_household', { p_household_id: id.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}
