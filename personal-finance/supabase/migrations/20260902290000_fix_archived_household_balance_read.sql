begin;

create or replace function public.get_household_balance_between_members(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  member_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not coalesce(
    private.household_access_level(p_household_id) in ('active', 'archived'), false
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  select count(*)
    into member_count
    from public.household_members member_row
   where member_row.household_id = p_household_id;
  if member_count not in (1, 2) then
    raise exception 'Household balance requires one or two historical members'
      using errcode = '23514';
  end if;

  with positions as (
    select member_row.user_id,
           coalesce(sum(case
             when expense.id is null or personal_transaction.status <> 'posted' then 0
             else (case when expense.personal_payer_user_id = member_row.user_id
                        then personal_transaction.amount else 0 end) - split.amount
           end), 0) as position
      from public.household_members member_row
      left join public.household_expense_splits split
        on split.user_id = member_row.user_id
      left join public.household_expenses expense
        on expense.id = split.household_expense_id
       and expense.household_id = member_row.household_id
       and expense.funding_source = 'personal_account'
      left join public.transactions personal_transaction
        on personal_transaction.id = expense.personal_transaction_id
       and personal_transaction.user_id = expense.personal_payer_user_id
     where member_row.household_id = p_household_id
     group by member_row.user_id
  ), summary as (
    select jsonb_agg(jsonb_build_object(
             'user_id', position_row.user_id,
             'amount', private.format_exact_money(position_row.position)
           ) order by position_row.user_id) as positions,
           (max(position_row.user_id::text)
             filter (where position_row.position < 0))::uuid as owed_by_user_id,
           (max(position_row.user_id::text)
             filter (where position_row.position > 0))::uuid as owed_to_user_id,
           greatest(coalesce(max(abs(position_row.position)), 0), 0) as amount,
           coalesce(sum(position_row.position), 0) as net_position
      from positions position_row
  )
  select jsonb_build_object(
    'household_id', p_household_id,
    'currency', 'MXN',
    'positions', summary.positions,
    'owed_by_user_id', summary.owed_by_user_id,
    'owed_to_user_id', summary.owed_to_user_id,
    'amount', private.format_exact_money(summary.amount)
  )
    into result
    from summary
   where summary.net_position = 0;

  if result is null then
    raise exception 'Household balance positions are inconsistent' using errcode = 'P0001';
  end if;
  return result;
end
$$;

alter function public.get_household_balance_between_members(uuid) owner to postgres;
revoke all on function public.get_household_balance_between_members(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_household_balance_between_members(uuid) to authenticated;

commit;
