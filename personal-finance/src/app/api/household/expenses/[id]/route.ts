import { NextResponse } from 'next/server';
import { getHouseholdContext, mapHouseholdError, parseHouseholdBody, unauthorizedHousehold } from '@/lib/api/household';
import { invalidRequest } from '@/lib/api/errors';
import { householdIdSchema, sharedExpenseUpdateSchema } from '@/lib/validation/household';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await context.params).id);
  if (!id.success) return invalidRequest(id.error);
  const parsed = await parseHouseholdBody(request, sharedExpenseUpdateSchema);
  if ('response' in parsed) return parsed.response;
  const input = parsed.data;
  const { data, error } = await supabase.rpc('update_shared_expense', {
    p_expense_id: id.data, p_source_account_id: input.source_account_id,
    p_amount: input.amount, p_date: input.date, p_description: input.description,
    p_split_mode: input.split_mode, p_splits: input.splits, p_category_id: input.category_id,
    p_notes: input.notes, p_status: input.status,
  });
  if (error) return mapHouseholdError(error);
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, context: Context) {
  const { supabase, user } = await getHouseholdContext();
  if (!user) return unauthorizedHousehold();
  const id = householdIdSchema.safeParse((await context.params).id);
  if (!id.success) return invalidRequest(id.error);
  const { error } = await supabase.rpc('delete_shared_expense', { p_expense_id: id.data });
  if (error) return mapHouseholdError(error);
  return NextResponse.json({ success: true });
}
