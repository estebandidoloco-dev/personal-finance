-- P1.5.1: atomic transfers from a member's personal account into a Household account.

begin;

create table public.household_contributions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  contributed_by_user_id uuid not null references public.profiles(id) on delete restrict,
  recorded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  personal_transaction_id uuid not null,
  household_account_transaction_id uuid not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.profiles(id) on delete restrict,
  constraint household_contributions_actor_check check (
    recorded_by_user_id = contributed_by_user_id
  ),
  constraint household_contributions_cancellation_check check (
    (cancelled_at is null and cancelled_by_user_id is null)
    or (cancelled_at is not null and cancelled_by_user_id is not null
        and cancelled_by_user_id = contributed_by_user_id)
  ),
  constraint household_contributions_contributor_membership_fkey
    foreign key (household_id, contributed_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_contributions_recorder_membership_fkey
    foreign key (household_id, recorded_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_contributions_canceller_membership_fkey
    foreign key (household_id, cancelled_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_contributions_personal_transaction_fkey
    foreign key (personal_transaction_id, contributed_by_user_id)
    references public.transactions(id, user_id) on delete restrict,
  constraint household_contributions_household_transaction_fkey
    foreign key (household_account_transaction_id, household_id)
    references public.household_account_transactions(id, household_id) on delete restrict,
  constraint household_contributions_personal_transaction_unique
    unique (personal_transaction_id),
  constraint household_contributions_household_transaction_unique
    unique (household_account_transaction_id),
  constraint household_contributions_idempotency_unique
    unique (recorded_by_user_id, idempotency_key)
);

create index household_contributions_household_created_idx
  on public.household_contributions(household_id, created_at desc, id desc);

create function private.validate_household_contribution(p_contribution_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  contribution public.household_contributions%rowtype;
  personal_leg public.transactions%rowtype;
  household_leg public.household_account_transactions%rowtype;
begin
  select contribution_row.* into contribution
    from public.household_contributions contribution_row
   where contribution_row.id = p_contribution_id;
  if not found then return; end if;

  select transaction_row.* into personal_leg
    from public.transactions transaction_row
   where transaction_row.id = contribution.personal_transaction_id
     and transaction_row.user_id = contribution.contributed_by_user_id;
  if not found then
    raise exception 'Contribution has an incoherent personal leg' using errcode = '23514';
  end if;

  select transaction_row.* into household_leg
    from public.household_account_transactions transaction_row
   where transaction_row.id = contribution.household_account_transaction_id
     and transaction_row.household_id = contribution.household_id;
  if not found then
    raise exception 'Contribution has an incoherent Household leg' using errcode = '23514';
  end if;

  if personal_leg.kind is distinct from 'expense'::public.transaction_kind
     or household_leg.kind is distinct from 'income'::public.transaction_kind
     or personal_leg.amount is distinct from household_leg.amount
     or personal_leg.currency is distinct from 'MXN'
     or household_leg.currency is distinct from 'MXN'
     or personal_leg.date is distinct from household_leg.date
     or personal_leg.description is distinct from household_leg.description
     or personal_leg.notes is distinct from household_leg.notes
     or personal_leg.status is distinct from household_leg.status
     or personal_leg.status not in ('posted', 'cancelled')
     or household_leg.recorded_by_user_id is distinct from contribution.recorded_by_user_id
     or personal_leg.category_id is not null
     or personal_leg.external_id is not null then
    raise exception 'Contribution legs are incoherent' using errcode = '23514';
  end if;

  if (contribution.cancelled_at is null and personal_leg.status <> 'posted')
     or (contribution.cancelled_at is not null and personal_leg.status <> 'cancelled') then
    raise exception 'Contribution cancellation state is incoherent' using errcode = '23514';
  end if;
end
$$;

-- Contributions keep affecting account balances but are not ordinary Household income.
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
     and not exists (
       select 1 from public.household_contributions contribution
        where contribution.household_account_transaction_id = transaction_row.id
     )
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
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Transaction limit must be between 1 and 100' using errcode = '22023';
  end if;
  if not coalesce(private.household_access_level(p_household_id) in ('active', 'archived'), false) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
  select coalesce(jsonb_agg(activity.payload
           order by activity.date desc, activity.created_at desc, activity.id desc), '[]'::jsonb)
    into result
    from (
      select rows.* from private.household_activity_rows(p_household_id) rows
       order by rows.date desc, rows.created_at desc, rows.id desc
       limit p_limit
    ) activity;
  return result;
end
$$;


create function private.validate_household_contribution_row_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_household_contribution(new.id);
  return null;
end
$$;

create constraint trigger household_contributions_validate_row
  after insert or update on public.household_contributions
  deferrable initially deferred
  for each row execute function private.validate_household_contribution_row_trigger();

create function private.validate_personal_contribution_leg_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare contribution_id uuid;
begin
  for contribution_id in
    select contribution.id from public.household_contributions contribution
     where contribution.personal_transaction_id = new.id
  loop
    perform private.validate_household_contribution(contribution_id);
  end loop;
  return null;
end
$$;

create constraint trigger transactions_validate_linked_contribution
  after update on public.transactions
  deferrable initially deferred
  for each row execute function private.validate_personal_contribution_leg_trigger();

create function private.validate_household_contribution_leg_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare contribution_id uuid;
begin
  for contribution_id in
    select contribution.id from public.household_contributions contribution
     where contribution.household_account_transaction_id = new.id
  loop
    perform private.validate_household_contribution(contribution_id);
  end loop;
  return null;
end
$$;

create constraint trigger household_transactions_validate_linked_contribution
  after update on public.household_account_transactions
  deferrable initially deferred
  for each row execute function private.validate_household_contribution_leg_trigger();

create trigger household_contributions_require_active_household
  before insert or update or delete on public.household_contributions
  for each row execute function private.enforce_active_household_financial_write();

create function private.household_contribution_payload(p_contribution_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', contribution.id,
    'household_id', contribution.household_id,
    'contributed_by_user_id', contribution.contributed_by_user_id,
    'recorded_by_user_id', contribution.recorded_by_user_id,
    'destination_household_account_id', household_leg.account_id,
    'amount', private.format_exact_money(household_leg.amount),
    'currency', household_leg.currency,
    'date', household_leg.date,
    'note', household_leg.notes,
    'status', household_leg.status,
    'created_at', contribution.created_at,
    'cancelled_at', contribution.cancelled_at
  )
  from public.household_contributions contribution
  join public.household_account_transactions household_leg
    on household_leg.id = contribution.household_account_transaction_id
   and household_leg.household_id = contribution.household_id
  where contribution.id = p_contribution_id
$$;

-- Guard contribution legs at the shared cores used by every ordinary personal mutation RPC.
create or replace function private.update_financial_transaction_core(
  p_user_id uuid, p_id uuid, p_account_id uuid,
  p_kind public.transaction_kind, p_amount numeric, p_currency text,
  p_date date, p_description text, p_category_id uuid, p_notes text,
  p_is_shared boolean, p_split_ratio jsonb, p_status text, p_tag_ids uuid[]
)
returns public.transactions
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.transactions transaction_row
   where transaction_row.id = p_id and transaction_row.user_id = p_user_id
   for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.household_expenses expense
     where expense.personal_transaction_id = p_id
  ) or exists (
    select 1 from public.household_contributions contribution
     where contribution.personal_transaction_id = p_id
  ) then
    raise exception 'Linked Household transaction must be mutated through its owning RPC'
      using errcode = '23514';
  end if;
  return private.update_financial_transaction_unchecked_core(
    p_user_id, p_id, p_account_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, p_tag_ids
  );
end
$$;

create or replace function private.delete_financial_transaction_core(p_user_id uuid, p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.transactions transaction_row
   where transaction_row.id = p_id and transaction_row.user_id = p_user_id
   for update;
  if not found then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  if exists (
    select 1 from public.household_expenses expense
     where expense.personal_transaction_id = p_id
  ) or exists (
    select 1 from public.household_contributions contribution
     where contribution.personal_transaction_id = p_id
  ) then
    raise exception 'Linked Household transaction must be mutated through its owning RPC'
      using errcode = '23514';
  end if;
  return private.delete_financial_transaction_unchecked_core(p_user_id, p_id);
end
$$;

create or replace function private.update_household_transaction_core(
  p_transaction_id uuid, p_household_id uuid, p_account_id uuid,
  p_kind public.transaction_kind, p_amount numeric, p_date date,
  p_description text, p_notes text, p_status text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id
     and transaction_row.household_id = p_household_id
   for update;
  if not found or exists (
    select 1 from public.household_contributions contribution
     where contribution.household_account_transaction_id = p_transaction_id
  ) or not exists (
    select 1 from public.household_accounts account
     where account.id = p_account_id
       and account.household_id = p_household_id
       and account.status = 'active'
       and account.currency = 'MXN'
  ) then
    raise exception 'Household transaction not found' using errcode = 'P0002';
  end if;
  update public.household_account_transactions
     set account_id = p_account_id, kind = p_kind, amount = p_amount,
         currency = 'MXN', date = p_date, description = p_description,
         notes = p_notes, status = p_status
   where id = p_transaction_id;
  return p_transaction_id;
end
$$;

create or replace function private.delete_household_transaction_core(
  p_transaction_id uuid,
  p_household_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.household_contributions contribution
     where contribution.household_account_transaction_id = p_transaction_id
  ) then
    raise exception 'Household transaction not found' using errcode = 'P0002';
  end if;
  delete from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id
     and transaction_row.household_id = p_household_id;
  if not found then raise exception 'Household transaction not found' using errcode = 'P0002'; end if;
  return p_transaction_id;
end
$$;

create function public.create_household_contribution(
  p_household_id uuid,
  p_source_personal_account_id uuid,
  p_destination_household_account_id uuid,
  p_amount text,
  p_date date,
  p_note text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  amount_value numeric;
  existing_contribution record;
  personal_transaction_id uuid;
  household_transaction_id uuid;
  contribution_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform private.require_active_household_actor(p_household_id, actor_id);

  select contribution.id, contribution.household_id,
         personal_leg.account_id as source_account_id,
         household_leg.account_id as destination_account_id,
         personal_leg.amount, personal_leg.date, personal_leg.notes
    into existing_contribution
    from public.household_contributions contribution
    join public.transactions personal_leg
      on personal_leg.id = contribution.personal_transaction_id
     and personal_leg.user_id = contribution.contributed_by_user_id
    join public.household_account_transactions household_leg
      on household_leg.id = contribution.household_account_transaction_id
     and household_leg.household_id = contribution.household_id
   where contribution.recorded_by_user_id = actor_id
     and contribution.idempotency_key = p_idempotency_key
   for update of contribution;
  if found then
    amount_value := private.parse_exact_money(p_amount, false, false);
    if existing_contribution.household_id is distinct from p_household_id
       or existing_contribution.source_account_id is distinct from p_source_personal_account_id
       or existing_contribution.destination_account_id is distinct from p_destination_household_account_id
       or existing_contribution.amount is distinct from amount_value
       or existing_contribution.date is distinct from p_date
       or existing_contribution.notes is distinct from p_note then
      raise exception 'Idempotency key was already used with a different contribution'
        using errcode = '23505';
    end if;
    return private.household_contribution_payload(existing_contribution.id);
  end if;

  amount_value := private.parse_exact_money(p_amount, false, false);
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Contribution note is too long' using errcode = '22023';
  end if;

  perform private.lock_accounts(array[p_source_personal_account_id]);
  if not exists (
    select 1 from public.accounts account
     where account.id = p_source_personal_account_id
       and account.user_id = actor_id
       and account.currency = 'MXN'
  ) then
    raise exception 'Personal account not found' using errcode = 'P0002';
  end if;

  perform private.lock_household_accounts(array[p_destination_household_account_id]);
  if not exists (
    select 1 from public.household_accounts account
     where account.id = p_destination_household_account_id
       and account.household_id = p_household_id
       and account.status = 'active'
       and account.currency = 'MXN'
  ) then
    raise exception 'Household account not found' using errcode = 'P0002';
  end if;

  personal_transaction_id := (private.create_financial_transaction_core(
    actor_id, p_source_personal_account_id, 'expense', amount_value, 'MXN', p_date,
    'Abono al fondo común', null, p_note, false, null, 'posted',
    'manual', null, '{}'::uuid[]
  )).id;
  household_transaction_id := private.create_household_transaction_core(
    p_household_id, p_destination_household_account_id, 'income', amount_value,
    p_date, 'Abono al fondo común', p_note, 'posted', actor_id
  );
  insert into public.household_contributions(
    household_id, contributed_by_user_id, recorded_by_user_id,
    personal_transaction_id, household_account_transaction_id, idempotency_key
  ) values (
    p_household_id, actor_id, actor_id,
    personal_transaction_id, household_transaction_id, p_idempotency_key
  ) returning id into contribution_id;

  perform private.validate_household_contribution(contribution_id);
  return private.household_contribution_payload(contribution_id);
end
$$;

create function public.cancel_household_contribution(p_contribution_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  contribution public.household_contributions%rowtype;
  personal_account_id uuid;
  household_account_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select contribution_row.household_id into contribution.household_id
    from public.household_contributions contribution_row
   where contribution_row.id = p_contribution_id;
  if not found then raise exception 'Contribution not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(contribution.household_id, actor_id);

  select contribution_row.* into contribution
    from public.household_contributions contribution_row
   where contribution_row.id = p_contribution_id
     and contribution_row.contributed_by_user_id = actor_id
   for update;
  if not found then raise exception 'Contribution not found' using errcode = 'P0002'; end if;
  if contribution.cancelled_at is not null then
    return private.household_contribution_payload(contribution.id);
  end if;

  select transaction_row.account_id into personal_account_id
    from public.transactions transaction_row
   where transaction_row.id = contribution.personal_transaction_id
     and transaction_row.user_id = actor_id;
  select transaction_row.account_id into household_account_id
    from public.household_account_transactions transaction_row
   where transaction_row.id = contribution.household_account_transaction_id
     and transaction_row.household_id = contribution.household_id;
  if personal_account_id is null or household_account_id is null then
    raise exception 'Contribution legs are unavailable' using errcode = '23514';
  end if;

  perform private.lock_accounts(array[personal_account_id]);
  perform private.lock_household_accounts(array[household_account_id]);
  update public.transactions set status = 'cancelled'
   where id = contribution.personal_transaction_id
     and user_id = actor_id and status = 'posted';
  if not found then raise exception 'Contribution is not posted' using errcode = '23514'; end if;
  update public.household_account_transactions set status = 'cancelled'
   where id = contribution.household_account_transaction_id
     and household_id = contribution.household_id and status = 'posted';
  if not found then raise exception 'Contribution is not posted' using errcode = '23514'; end if;
  update public.household_contributions
     set cancelled_at = now(), cancelled_by_user_id = actor_id
   where id = contribution.id;

  perform private.validate_household_contribution(contribution.id);
  return private.household_contribution_payload(contribution.id);
end
$$;

-- Personal contribution legs remain in the ledger for reconciliation but are not economic activity.
create or replace function public.get_dashboard_summary(p_period text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  today_local date := (pg_catalog.now() at time zone 'America/Mexico_City')::date;
  start_date date;
  end_date_exclusive date;
  account_snapshot jsonb;
  total_balance numeric;
  period_income numeric;
  period_expense numeric;
  expense_categories_snapshot jsonb;
  time_series_snapshot jsonb;
  recent_snapshot jsonb;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_period = 'this_month' then
    start_date := pg_catalog.date_trunc('month', today_local)::date;
    end_date_exclusive := (start_date + interval '1 month')::date;
  elsif p_period = 'previous_month' then
    end_date_exclusive := pg_catalog.date_trunc('month', today_local)::date;
    start_date := (end_date_exclusive - interval '1 month')::date;
  elsif p_period = 'last_30_days' then
    start_date := today_local - 29;
    end_date_exclusive := today_local + 1;
  else
    raise exception 'Invalid dashboard period' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.accounts account
     where account.user_id = authenticated_user_id
       and account.currency is distinct from 'MXN'
  ) or exists (
    select 1 from public.transactions transaction_row
     where transaction_row.user_id = authenticated_user_id
       and transaction_row.currency is distinct from 'MXN'
  ) then
    raise exception using errcode = 'P0001',
      message = 'Dashboard unavailable: user data violates the MXN-only boundary.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', account.id, 'name', account.name, 'type', account.type,
           'balance', case when account.balance = 0 then '0.00' else
             pg_catalog.split_part(pg_catalog.round(account.balance, 2)::text, '.', 1)
             || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(account.balance, 2)::text, '.', 2), 2, '0') end
         ) order by account.created_at, account.id), '[]'::jsonb),
         coalesce(sum(account.balance), 0)
    into account_snapshot, total_balance
    from public.accounts account
   where account.user_id = authenticated_user_id;

  select coalesce(sum(transaction_row.amount)
           filter (where transaction_row.kind = 'income'), 0),
         coalesce(sum(transaction_row.amount)
           filter (where transaction_row.kind = 'expense'), 0)
    into period_income, period_expense
    from public.transactions transaction_row
   where transaction_row.user_id = authenticated_user_id
     and transaction_row.status = 'posted'
     and transaction_row.date >= start_date
     and transaction_row.date < end_date_exclusive
     and not exists (
       select 1 from public.household_contributions contribution
        where contribution.personal_transaction_id = transaction_row.id
     );

  select coalesce(jsonb_agg(jsonb_build_object(
           'category_id', category_total.category_id,
           'name', category_total.name,
           'color', category_total.color,
           'is_uncategorized', category_total.is_uncategorized,
           'amount', case when category_total.amount = 0 then '0.00' else
             pg_catalog.split_part(pg_catalog.round(category_total.amount, 2)::text, '.', 1)
             || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(category_total.amount, 2)::text, '.', 2), 2, '0') end
         ) order by category_total.amount desc, category_total.name, category_total.category_id), '[]'::jsonb)
    into expense_categories_snapshot
    from (
      select transaction_row.category_id,
             coalesce(category.name, 'Sin categoría') as name,
             category.color,
             category.id is null as is_uncategorized,
             sum(transaction_row.amount) as amount
        from public.transactions transaction_row
        left join public.categories category on category.id = transaction_row.category_id
       where transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
         and transaction_row.kind = 'expense'
         and transaction_row.date >= start_date
         and transaction_row.date < end_date_exclusive
         and not exists (
           select 1 from public.household_contributions contribution
            where contribution.personal_transaction_id = transaction_row.id
         )
       group by transaction_row.category_id, category.id, category.name, category.color
    ) category_total;

  select jsonb_build_object(
           'points', coalesce(jsonb_agg(jsonb_build_object(
             'date', daily.date::text,
             'income', case when daily.income = 0 then '0.00' else
               pg_catalog.split_part(pg_catalog.round(daily.income, 2)::text, '.', 1)
               || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.income, 2)::text, '.', 2), 2, '0') end,
             'expense', case when daily.expense = 0 then '0.00' else
               pg_catalog.split_part(pg_catalog.round(daily.expense, 2)::text, '.', 1)
               || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.expense, 2)::text, '.', 2), 2, '0') end,
             'net', case when daily.income - daily.expense = 0 then '0.00' else
               pg_catalog.split_part(pg_catalog.round(daily.income - daily.expense, 2)::text, '.', 1)
               || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.income - daily.expense, 2)::text, '.', 2), 2, '0') end
           ) order by daily.date), '[]'::jsonb)
         )
    into time_series_snapshot
    from (
      select calendar.date::date as date,
             coalesce(sum(transaction_row.amount)
               filter (where transaction_row.kind = 'income'), 0) as income,
             coalesce(sum(transaction_row.amount)
               filter (where transaction_row.kind = 'expense'), 0) as expense
        from generate_series(
               start_date::timestamp,
               (end_date_exclusive - 1)::timestamp,
               interval '1 day'
             ) calendar(date)
        left join public.transactions transaction_row
          on transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
         and transaction_row.date = calendar.date::date
         and not exists (
           select 1 from public.household_contributions contribution
            where contribution.personal_transaction_id = transaction_row.id
         )
       group by calendar.date
    ) daily;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', recent.id,
           'date', recent.date::text,
           'description', recent.description,
           'amount', case when recent.amount = 0 then '0.00' else
             pg_catalog.split_part(pg_catalog.round(recent.amount, 2)::text, '.', 1)
             || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(recent.amount, 2)::text, '.', 2), 2, '0') end,
           'kind', recent.kind,
           'category', recent.category,
           'account', recent.account
         ) order by recent.date desc, recent.created_at desc, recent.id desc), '[]'::jsonb)
    into recent_snapshot
    from (
      select transaction_row.id, transaction_row.date, transaction_row.description,
             transaction_row.amount, transaction_row.kind, transaction_row.created_at,
             case when category.id is null then null else jsonb_build_object(
               'id', category.id, 'name', category.name, 'color', category.color
             ) end as category,
             jsonb_build_object('id', account.id, 'name', account.name) as account
        from public.transactions transaction_row
        join public.accounts account on account.id = transaction_row.account_id
        left join public.categories category on category.id = transaction_row.category_id
       where transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
         and not exists (
           select 1 from public.household_contributions contribution
            where contribution.personal_transaction_id = transaction_row.id
         )
       order by transaction_row.date desc, transaction_row.created_at desc, transaction_row.id desc
       limit 10
    ) recent;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'key', p_period,
      'start_date', start_date::text,
      'end_date_exclusive', end_date_exclusive::text,
      'timezone', 'America/Mexico_City'
    ),
    'currency', 'MXN',
    'accounts', account_snapshot,
    'totals', jsonb_build_object(
      'total_balance', case when total_balance = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(total_balance, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(total_balance, 2)::text, '.', 2), 2, '0') end,
      'income', case when period_income = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_income, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_income, 2)::text, '.', 2), 2, '0') end,
      'expense', case when period_expense = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_expense, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_expense, 2)::text, '.', 2), 2, '0') end,
      'net', case when period_income - period_expense = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_income - period_expense, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_income - period_expense, 2)::text, '.', 2), 2, '0') end
    ),
    'expenses_by_category', expense_categories_snapshot,
    'time_series', time_series_snapshot,
    'recent_transactions', recent_snapshot
  );
end
$$;

alter table public.household_contributions enable row level security;
create policy household_contributions_select_member_history
  on public.household_contributions
  for select to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

alter function private.validate_household_contribution(uuid) owner to postgres;
alter function private.validate_household_contribution_row_trigger() owner to postgres;
alter function private.validate_personal_contribution_leg_trigger() owner to postgres;
alter function private.validate_household_contribution_leg_trigger() owner to postgres;
alter function private.household_contribution_payload(uuid) owner to postgres;
alter function private.update_financial_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) owner to postgres;
alter function private.delete_financial_transaction_core(uuid, uuid) owner to postgres;
alter function private.update_household_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, date, text, text, text) owner to postgres;
alter function private.delete_household_transaction_core(uuid, uuid) owner to postgres;
alter function private.household_activity_rows(uuid) owner to postgres;
alter function public.get_household_transactions(uuid, integer) owner to postgres;
alter function public.get_dashboard_summary(text) owner to postgres;
alter function public.create_household_contribution(uuid, uuid, uuid, text, date, text, uuid) owner to postgres;
alter function public.cancel_household_contribution(uuid) owner to postgres;

revoke all on table public.household_contributions
  from public, anon, authenticated, service_role;
grant select (
  id, household_id, contributed_by_user_id, recorded_by_user_id,
  created_at, cancelled_at, cancelled_by_user_id
) on public.household_contributions to authenticated;

revoke all on function private.validate_household_contribution(uuid) from public, anon, authenticated, service_role;
revoke all on function private.validate_household_contribution_row_trigger() from public, anon, authenticated, service_role;
revoke all on function private.validate_personal_contribution_leg_trigger() from public, anon, authenticated, service_role;
revoke all on function private.validate_household_contribution_leg_trigger() from public, anon, authenticated, service_role;
revoke all on function private.household_contribution_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_financial_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.delete_financial_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_household_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.delete_household_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_activity_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_transactions(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_dashboard_summary(text) from public, anon, authenticated, service_role;
revoke all on function public.create_household_contribution(uuid, uuid, uuid, text, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_household_contribution(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_household_transactions(uuid, integer) to authenticated;
grant execute on function public.get_dashboard_summary(text) to authenticated;
grant execute on function public.create_household_contribution(uuid, uuid, uuid, text, date, text, uuid) to authenticated;
grant execute on function public.cancel_household_contribution(uuid) to authenticated;

commit;
