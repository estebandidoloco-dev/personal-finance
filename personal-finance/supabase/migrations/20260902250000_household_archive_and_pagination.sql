-- P1.4 micro-handoff: archived Household discovery and stable cursor pagination.

begin;

create function private.household_archive_payload(p_household_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', household.id,
    'name', household.name,
    'status', household.status,
    'currency', household.currency,
    'created_at', household.created_at,
    'activated_at', household.activated_at,
    'closed_at', household.closed_at,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', member_row.user_id,
        'display_name', profile.display_name
      ) order by member_row.joined_at, member_row.user_id), '[]'::jsonb)
      from public.household_members member_row
      join public.profiles profile on profile.id = member_row.user_id
      where member_row.household_id = household.id
        and member_row.status = 'archived'
    )
  )
  from public.households household
  where household.id = p_household_id
    and household.status = 'closed'
$$;

create function public.get_archived_households()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(private.household_archive_payload(household.id)
           order by household.closed_at desc, household.id desc), '[]'::jsonb)
    into result
    from public.households household
    join public.household_members actor_membership
      on actor_membership.household_id = household.id
     and actor_membership.user_id = auth.uid()
     and actor_membership.status = 'archived'
   where household.status = 'closed';
  return result;
end
$$;

create function public.get_archived_household(p_household_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if not exists (
    select 1 from public.households household
    join public.household_members actor_membership on actor_membership.household_id = household.id
     where household.id = p_household_id
       and household.status = 'closed'
       and actor_membership.user_id = auth.uid()
       and actor_membership.status = 'archived'
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  result := private.household_archive_payload(p_household_id);
  return result;
end
$$;

create function private.household_activity_rows(p_household_id uuid)
returns table(id uuid, date date, created_at timestamptz, entry_type text, payload jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select case when expense.id is null then transaction_row.id else expense.id end,
         transaction_row.date,
         coalesce(expense.created_at, transaction_row.created_at),
         case when expense.id is null then 'household_transaction' else 'shared_expense' end,
         jsonb_build_object(
           'id', case when expense.id is null then transaction_row.id else expense.id end,
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
               'user_id', split.user_id, 'amount', private.format_exact_money(split.amount)
             ) order by split.user_id)
             from public.household_expense_splits split
             where split.household_expense_id = expense.id
           ) end,
           'created_at', coalesce(expense.created_at, transaction_row.created_at),
           'updated_at', transaction_row.updated_at
         )
    from public.household_account_transactions transaction_row
    left join public.household_expenses expense
      on expense.household_account_transaction_id = transaction_row.id
   where transaction_row.household_id = p_household_id
  union all
  select expense.id,
         personal_transaction.date,
         expense.created_at,
         'shared_expense',
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
               'user_id', split.user_id, 'amount', private.format_exact_money(split.amount)
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
$$;

create function private.validate_household_page_request(
  p_household_id uuid, p_limit integer, p_before_date date,
  p_before_created_at timestamptz, p_before_id uuid
)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Page limit must be between 1 and 100' using errcode = '22023';
  end if;
  if (p_before_date is null)::integer
     + (p_before_created_at is null)::integer
     + (p_before_id is null)::integer not in (0, 3) then
    raise exception 'Cursor fields must be provided together' using errcode = '22023';
  end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
end
$$;

create function public.get_household_activity_page(
  p_household_id uuid, p_limit integer default 25,
  p_before_date date default null, p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform private.validate_household_page_request(
    p_household_id, p_limit, p_before_date, p_before_created_at, p_before_id
  );
  select coalesce(jsonb_agg(page.payload order by page.date desc, page.created_at desc, page.id desc), '[]'::jsonb)
    into result
    from (
      select activity.* from private.household_activity_rows(p_household_id) activity
       where p_before_date is null
          or (activity.date, activity.created_at, activity.id)
             < (p_before_date, p_before_created_at, p_before_id)
       order by activity.date desc, activity.created_at desc, activity.id desc
       limit p_limit + 1
    ) page;
  return result;
end
$$;

create function public.get_household_expenses_page(
  p_household_id uuid, p_limit integer default 25,
  p_before_date date default null, p_before_created_at timestamptz default null,
  p_before_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform private.validate_household_page_request(
    p_household_id, p_limit, p_before_date, p_before_created_at, p_before_id
  );
  select coalesce(jsonb_agg(page.payload order by page.date desc, page.created_at desc, page.id desc), '[]'::jsonb)
    into result
    from (
      select activity.* from private.household_activity_rows(p_household_id) activity
       where activity.entry_type = 'shared_expense'
         and (p_before_date is null
          or (activity.date, activity.created_at, activity.id)
             < (p_before_date, p_before_created_at, p_before_id))
       order by activity.date desc, activity.created_at desc, activity.id desc
       limit p_limit + 1
    ) page;
  return result;
end
$$;

alter function public.get_archived_households() owner to postgres;
alter function public.get_archived_household(uuid) owner to postgres;
alter function public.get_household_activity_page(uuid, integer, date, timestamptz, uuid) owner to postgres;
alter function public.get_household_expenses_page(uuid, integer, date, timestamptz, uuid) owner to postgres;

revoke all on function private.household_archive_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_activity_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function private.validate_household_page_request(uuid, integer, date, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_archived_households() from public, anon, authenticated, service_role;
revoke all on function public.get_archived_household(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_activity_page(uuid, integer, date, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_expenses_page(uuid, integer, date, timestamptz, uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_archived_households() to authenticated;
grant execute on function public.get_archived_household(uuid) to authenticated;
grant execute on function public.get_household_activity_page(uuid, integer, date, timestamptz, uuid) to authenticated;
grant execute on function public.get_household_expenses_page(uuid, integer, date, timestamptz, uuid) to authenticated;

commit;
