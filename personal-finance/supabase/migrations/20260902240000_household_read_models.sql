-- P1.4 phase 5: exact-money Household read models and interpersonal balance.

begin;

create function public.get_current_household()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', household.id,
    'name', household.name,
    'currency', household.currency,
    'status', household.status,
    'created_by_user_id', household.created_by_user_id,
    'created_at', household.created_at,
    'activated_at', household.activated_at,
    'closed_at', household.closed_at,
    'member_count', (
      select count(*) from public.household_members member_count
       where member_count.household_id = household.id and member_count.status = 'current'
    ),
    'pending_invitation', (
      select jsonb_build_object(
        'id', invitation.id,
        'invited_email', invitation.invited_email,
        'status', invitation.status,
        'expires_at', invitation.expires_at
      )
      from public.household_invitations invitation
      where invitation.household_id = household.id and invitation.status = 'pending'
    )
  )
  from public.households household
  join public.household_members member_row on member_row.household_id = household.id
   and member_row.user_id = auth.uid()
   and member_row.status = 'current'
  where household.status in ('forming', 'active')
$$;

create function public.get_household_members(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not coalesce(
    private.household_access_level(p_household_id) in ('forming', 'active', 'archived'), false
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', member_row.user_id,
    'display_name', profile.display_name,
    'avatar_url', profile.avatar_url,
    'status', member_row.status,
    'joined_at', member_row.joined_at,
    'ended_at', member_row.ended_at
  ) order by member_row.joined_at, member_row.user_id), '[]'::jsonb)
  into result
  from public.household_members member_row
  join public.profiles profile on profile.id = member_row.user_id
  where member_row.household_id = p_household_id;
  return result;
end
$$;

create function public.get_household_accounts(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(private.household_account_payload(account.id)
           order by account.created_at, account.id), '[]'::jsonb)
    into result
    from public.household_accounts account
   where account.household_id = p_household_id;
  return result;
end
$$;

create function public.get_household_transactions(
  p_household_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Transaction limit must be between 1 and 100' using errcode = '22023';
  end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  with activity as (
    select transaction_row.id,
           transaction_row.date,
           transaction_row.created_at,
           jsonb_build_object(
             'id', transaction_row.id,
             'entry_type', case when expense.id is null then 'household_transaction' else 'shared_expense' end,
             'household_expense_id', expense.id,
             'funding_source', case when expense.id is null then null else 'household_account' end,
             'personal_payer_user_id', null,
             'recorded_by_user_id', transaction_row.recorded_by_user_id,
             'account_id', transaction_row.account_id,
             'kind', transaction_row.kind,
             'amount', private.format_exact_money(transaction_row.amount),
             'currency', transaction_row.currency,
             'date', transaction_row.date,
             'description', transaction_row.description,
             'notes', transaction_row.notes,
             'status', transaction_row.status,
             'split_mode', expense.split_mode,
             'category_id', expense.category_id,
             'splits', case when expense.id is null then null else (
               select jsonb_agg(jsonb_build_object(
                 'user_id', split.user_id,
                 'amount', private.format_exact_money(split.amount)
               ) order by split.user_id)
               from public.household_expense_splits split
               where split.household_expense_id = expense.id
             ) end,
             'created_at', transaction_row.created_at,
             'updated_at', transaction_row.updated_at
           ) as payload
      from public.household_account_transactions transaction_row
      left join public.household_expenses expense
        on expense.household_account_transaction_id = transaction_row.id
      where transaction_row.household_id = p_household_id
    union all
    select expense.id,
           personal_transaction.date,
           expense.created_at,
           jsonb_build_object(
             'id', expense.id,
             'entry_type', 'shared_expense',
             'household_expense_id', expense.id,
             'funding_source', 'personal_account',
             'personal_payer_user_id', expense.personal_payer_user_id,
             'recorded_by_user_id', expense.recorded_by_user_id,
             'account_id', null,
             'kind', personal_transaction.kind,
             'amount', private.format_exact_money(personal_transaction.amount),
             'currency', personal_transaction.currency,
             'date', personal_transaction.date,
             'description', personal_transaction.description,
             'notes', null,
             'status', personal_transaction.status,
             'split_mode', expense.split_mode,
             'category_id', expense.category_id,
             'splits', (
               select jsonb_agg(jsonb_build_object(
                 'user_id', split.user_id,
                 'amount', private.format_exact_money(split.amount)
               ) order by split.user_id)
               from public.household_expense_splits split
               where split.household_expense_id = expense.id
             ),
             'created_at', expense.created_at,
             'updated_at', expense.updated_at
           )
      from public.household_expenses expense
      join public.transactions personal_transaction
        on personal_transaction.id = expense.personal_transaction_id
       and personal_transaction.user_id = expense.personal_payer_user_id
      where expense.household_id = p_household_id
        and expense.funding_source = 'personal_account'
  ), limited as (
    select activity.payload, activity.date, activity.created_at, activity.id
      from activity
     order by activity.date desc, activity.created_at desc, activity.id desc
     limit p_limit
  )
  select coalesce(jsonb_agg(limited.payload
           order by limited.date desc, limited.created_at desc, limited.id desc), '[]'::jsonb)
    into result from limited;
  return result;
end
$$;

create function public.get_household_expenses(
  p_household_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Expense limit must be between 1 and 100' using errcode = '22023';
  end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;

  with expenses as (
    select expense.id,
           household_transaction.date,
           expense.created_at,
           jsonb_build_object(
             'id', expense.id,
             'entry_type', 'shared_expense',
             'household_expense_id', expense.id,
             'funding_source', 'household_account',
             'personal_payer_user_id', null,
             'recorded_by_user_id', expense.recorded_by_user_id,
             'account_id', household_transaction.account_id,
             'kind', household_transaction.kind,
             'amount', private.format_exact_money(household_transaction.amount),
             'currency', household_transaction.currency,
             'date', household_transaction.date,
             'description', household_transaction.description,
             'notes', household_transaction.notes,
             'status', household_transaction.status,
             'split_mode', expense.split_mode,
             'category_id', expense.category_id,
             'splits', (
               select jsonb_agg(jsonb_build_object(
                 'user_id', split.user_id,
                 'amount', private.format_exact_money(split.amount)
               ) order by split.user_id)
               from public.household_expense_splits split
               where split.household_expense_id = expense.id
             ),
             'created_at', expense.created_at,
             'updated_at', expense.updated_at
           ) as payload
      from public.household_expenses expense
      join public.household_account_transactions household_transaction
        on household_transaction.id = expense.household_account_transaction_id
       and household_transaction.household_id = expense.household_id
     where expense.household_id = p_household_id
       and expense.funding_source = 'household_account'
    union all
    select expense.id,
           personal_transaction.date,
           expense.created_at,
           jsonb_build_object(
             'id', expense.id,
             'entry_type', 'shared_expense',
             'household_expense_id', expense.id,
             'funding_source', 'personal_account',
             'personal_payer_user_id', expense.personal_payer_user_id,
             'recorded_by_user_id', expense.recorded_by_user_id,
             'account_id', null,
             'kind', personal_transaction.kind,
             'amount', private.format_exact_money(personal_transaction.amount),
             'currency', personal_transaction.currency,
             'date', personal_transaction.date,
             'description', personal_transaction.description,
             'notes', null,
             'status', personal_transaction.status,
             'split_mode', expense.split_mode,
             'category_id', expense.category_id,
             'splits', (
               select jsonb_agg(jsonb_build_object(
                 'user_id', split.user_id,
                 'amount', private.format_exact_money(split.amount)
               ) order by split.user_id)
               from public.household_expense_splits split
               where split.household_expense_id = expense.id
             ),
             'created_at', expense.created_at,
             'updated_at', expense.updated_at
           ) as payload
      from public.household_expenses expense
      join public.transactions personal_transaction
        on personal_transaction.id = expense.personal_transaction_id
       and personal_transaction.user_id = expense.personal_payer_user_id
     where expense.household_id = p_household_id
       and expense.funding_source = 'personal_account'
  ), limited as (
    select expenses.payload, expenses.date, expenses.created_at, expenses.id
      from expenses
     order by expenses.date desc, expenses.created_at desc, expenses.id desc
     limit p_limit
  )
  select coalesce(jsonb_agg(limited.payload
           order by limited.date desc, limited.created_at desc, limited.id desc), '[]'::jsonb)
    into result from limited;
  return result;
end
$$;

create function public.get_household_balance_between_members(p_household_id uuid)
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
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  select count(*) into member_count from public.household_members
   where household_id = p_household_id;
  if member_count <> 2 then
    raise exception 'Household balance requires exactly two historical members'
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
      left join public.household_expense_splits split on split.user_id = member_row.user_id
      left join public.household_expenses expense
        on expense.id = split.household_expense_id
       and expense.household_id = member_row.household_id
       and expense.funding_source = 'personal_account'
      left join public.transactions personal_transaction
        on personal_transaction.id = expense.personal_transaction_id
       and personal_transaction.user_id = expense.personal_payer_user_id
      where member_row.household_id = p_household_id
      group by member_row.user_id
  ), ordered as (
    select *, row_number() over (order by user_id) as ordinal from positions
  ), pair as (
    select (max(user_id::text) filter (where ordinal = 1))::uuid as user_a,
           max(position) filter (where ordinal = 1) as position_a,
           (max(user_id::text) filter (where ordinal = 2))::uuid as user_b,
           max(position) filter (where ordinal = 2) as position_b
      from ordered
  )
  select jsonb_build_object(
    'household_id', p_household_id,
    'currency', 'MXN',
    'positions', jsonb_build_array(
      jsonb_build_object('user_id', pair.user_a, 'amount', private.format_exact_money(pair.position_a)),
      jsonb_build_object('user_id', pair.user_b, 'amount', private.format_exact_money(pair.position_b))
    ),
    'owed_by_user_id', case when pair.position_a < 0 then pair.user_a
                            when pair.position_b < 0 then pair.user_b else null end,
    'owed_to_user_id', case when pair.position_a > 0 then pair.user_a
                            when pair.position_b > 0 then pair.user_b else null end,
    'amount', private.format_exact_money(greatest(abs(pair.position_a), abs(pair.position_b)))
  ) into result from pair;
  return result;
end
$$;

alter function public.get_current_household() owner to postgres;
alter function public.get_household_members(uuid) owner to postgres;
alter function public.get_household_accounts(uuid) owner to postgres;
alter function public.get_household_transactions(uuid, integer) owner to postgres;
alter function public.get_household_expenses(uuid, integer) owner to postgres;
alter function public.get_household_balance_between_members(uuid) owner to postgres;

revoke all on function public.get_current_household() from public, anon, authenticated, service_role;
revoke all on function public.get_household_members(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_accounts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_transactions(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_household_expenses(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_household_balance_between_members(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_current_household() to authenticated;
grant execute on function public.get_household_members(uuid) to authenticated;
grant execute on function public.get_household_accounts(uuid) to authenticated;
grant execute on function public.get_household_transactions(uuid, integer) to authenticated;
grant execute on function public.get_household_expenses(uuid, integer) to authenticated;
grant execute on function public.get_household_balance_between_members(uuid) to authenticated;

commit;
