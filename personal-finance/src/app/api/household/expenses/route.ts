import { NextRequest, NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { invalidRequest } from '@/lib/api/errors';
import { householdListQuerySchema, sharedExpenseCreateSchema } from '@/lib/validation/household';

export async function GET(request: NextRequest) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = householdListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return invalidRequest(parsed.error);
  const { data, error } = await supabase.rpc('get_household_expenses', {
    p_household_id: parsed.data.household_id, p_limit: parsed.data.limit,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const parsed = await parseHouseholdBody(request, sharedExpenseCreateSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const { data, error } = await supabase.rpc('create_shared_expense', {
    p_household_id: input.household_id, p_funding_source: input.funding_source,
    p_source_account_id: input.source_account_id, p_amount: input.amount, p_date: input.date,
    p_description: input.description, p_split_mode: input.split_mode, p_splits: input.splits,
    p_category_id: input.category_id, p_notes: input.notes, p_status: input.status,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data, { status: 201 });
}
