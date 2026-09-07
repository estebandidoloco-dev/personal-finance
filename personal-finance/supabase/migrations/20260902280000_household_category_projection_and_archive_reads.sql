begin;

create function private.household_global_category_payload(p_category_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_category_id is null then return null; end if;
  select jsonb_build_object(
    'id', category.id,
    'name', category.name,
    'color', category.color
  )
    into result
    from public.categories category
   where category.id = p_category_id
     and category.user_id is null
     and btrim(category.name) <> '';
  if not found then
    raise exception 'Household expense category is not a valid global category'
      using errcode = 'P0001';
  end if;
  return result;
end
$$;

create or replace function private.household_activity_rows(p_household_id uuid)
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
           'category', private.household_global_category_payload(expense.category_id),
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
           'category', private.household_global_category_payload(expense.category_id),
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

create or replace function public.get_household_transactions(
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
             'category', private.household_global_category_payload(expense.category_id),
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
             'category', private.household_global_category_payload(expense.category_id),
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

create or replace function public.get_household_expenses(
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
             'category', private.household_global_category_payload(expense.category_id),
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
             'category', private.household_global_category_payload(expense.category_id),
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

create or replace function public.get_household_expense_detail(p_expense_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  expense_row public.household_expenses%rowtype;
  source_account_id uuid;
  source_amount numeric;
  source_currency text;
  source_date date;
  source_description text;
  source_notes text;
  source_status text;
  split_payload jsonb;
  split_count integer;
  split_total numeric;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select expense.*
    into expense_row
    from public.household_expenses expense
    join public.households household on household.id = expense.household_id
    join public.household_members member_row
      on member_row.household_id = household.id
     and member_row.user_id = actor_id
   where expense.id = p_expense_id
     and ((household.status = 'active' and member_row.status = 'current')
       or (household.status = 'closed' and member_row.status = 'archived'));
  if not found then
    raise exception 'Household expense does not exist or is unavailable' using errcode = 'P0002';
  end if;

  if expense_row.funding_source = 'personal_account' then
    select transaction_row.account_id, transaction_row.amount, transaction_row.currency,
           transaction_row.date, transaction_row.description,
           case when actor_id = expense_row.personal_payer_user_id then transaction_row.notes else null end,
           transaction_row.status
      into source_account_id, source_amount, source_currency, source_date,
           source_description, source_notes, source_status
      from public.transactions transaction_row
     where transaction_row.id = expense_row.personal_transaction_id
       and transaction_row.user_id = expense_row.personal_payer_user_id
       and transaction_row.kind = 'expense'::public.transaction_kind
       and transaction_row.currency = 'MXN';
  else
    select transaction_row.account_id, transaction_row.amount, transaction_row.currency,
           transaction_row.date, transaction_row.description, transaction_row.notes,
           transaction_row.status
      into source_account_id, source_amount, source_currency, source_date,
           source_description, source_notes, source_status
      from public.household_account_transactions transaction_row
      join public.household_accounts account
        on account.id = transaction_row.account_id
       and account.household_id = transaction_row.household_id
     where transaction_row.id = expense_row.household_account_transaction_id
       and transaction_row.household_id = expense_row.household_id
       and transaction_row.kind = 'expense'::public.transaction_kind
       and transaction_row.currency = 'MXN'
       and account.currency = 'MXN';
  end if;
  if not found then
    raise exception 'Household expense has an incoherent source' using errcode = 'P0001';
  end if;

  select jsonb_agg(jsonb_build_object(
           'user_id', split.user_id, 'amount', private.format_exact_money(split.amount)
         ) order by split.user_id), count(*), coalesce(sum(split.amount), 0)
    into split_payload, split_count, split_total
    from public.household_expense_splits split
   where split.household_expense_id = expense_row.id;
  if split_count <> 2 or split_total is distinct from source_amount then
    raise exception 'Household expense has incoherent splits' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'id', expense_row.id,
    'household_id', expense_row.household_id,
    'funding_source', expense_row.funding_source,
    'source_account_id', case
      when expense_row.funding_source = 'personal_account'
       and actor_id <> expense_row.personal_payer_user_id then null
      else source_account_id end,
    'personal_payer_user_id', expense_row.personal_payer_user_id,
    'recorded_by_user_id', expense_row.recorded_by_user_id,
    'split_mode', expense_row.split_mode,
    'category_id', expense_row.category_id,
    'category', private.household_global_category_payload(expense_row.category_id),
    'amount', private.format_exact_money(source_amount),
    'currency', source_currency,
    'date', source_date,
    'description', source_description,
    'notes', source_notes,
    'status', source_status,
    'splits', split_payload,
    'created_at', expense_row.created_at,
    'updated_at', expense_row.updated_at
  );
end
$$;

alter function private.household_global_category_payload(uuid) owner to postgres;
alter function private.household_activity_rows(uuid) owner to postgres;
alter function public.get_household_transactions(uuid, integer) owner to postgres;
alter function public.get_household_expenses(uuid, integer) owner to postgres;
alter function public.get_household_expense_detail(uuid) owner to postgres;

revoke all on function private.household_global_category_payload(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.household_activity_rows(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_household_transactions(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_household_expenses(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_household_expense_detail(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_household_transactions(uuid, integer) to authenticated;
grant execute on function public.get_household_expenses(uuid, integer) to authenticated;
grant execute on function public.get_household_expense_detail(uuid) to authenticated;

commit;
