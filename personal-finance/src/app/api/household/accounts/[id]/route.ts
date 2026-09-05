import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { invalidRequest } from '@/lib/api/errors';
import { householdAccountUpdateSchema, householdIdSchema } from '@/lib/validation/household';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await context.params).id);
  if (!id.success) return invalidRequest(id.error);
  const parsed = await parseHouseholdBody(request, householdAccountUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const { data, error } = await supabase.rpc('update_household_account', {
    p_account_id: id.data, p_name: parsed.data.name, p_type: parsed.data.type,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, context: Context) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await context.params).id);
  if (!id.success) return invalidRequest(id.error);
  const { data, error } = await supabase.rpc('close_household_account', { p_account_id: id.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}
