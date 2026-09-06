import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, unauthorizedHousehold } from '@/lib/api/household';

export async function GET() {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const { data, error } = await supabase.rpc('get_archived_households');
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ households: data });
}
