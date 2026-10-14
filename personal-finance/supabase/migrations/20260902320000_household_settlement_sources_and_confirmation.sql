-- Migration: 20260902320000_household_settlement_sources_and_confirmation.sql
-- Household Settlements: Funding Sources and Recipient Confirmation Workflow

begin;

-- 1. Add new columns to public.household_settlements
alter table public.household_settlements
  add column funding_source text not null default 'cash',
  add column status text not null default 'pending',
  add column personal_transaction_id uuid,
  add column household_account_transaction_id uuid,
  add column confirmed_at timestamptz,
  add column confirmed_by_user_id uuid references public.profiles(id) on delete restrict,
  add column rejected_at timestamptz,
  add column rejected_by_user_id uuid references public.profiles(id) on delete restrict;

-- Backfill any existing historical rows if present
update public.household_settlements
   set status = case when cancelled_at is not null then 'cancelled' else 'confirmed' end,
       confirmed_at = case when cancelled_at is null then created_at else null end,
       confirmed_by_user_id = case when cancelled_at is null then payee_user_id else null end
 where status = 'pending';

-- Add check constraints
alter table public.household_settlements
  add constraint household_settlements_funding_source_check
    check (funding_source in ('personal_account', 'household_account', 'cash', 'in_kind')),
  add constraint household_settlements_status_check
    check (status in ('pending', 'confirmed', 'rejected', 'cancelled')),
  add constraint household_settlements_source_check
    check (
      (
        funding_source = 'personal_account'
        and personal_transaction_id is not null
        and household_account_transaction_id is null
      )
      or
      (
        funding_source = 'household_account'
        and personal_transaction_id is null
        and household_account_transaction_id is not null
      )
      or
      (
        funding_source in ('cash', 'in_kind')
        and personal_transaction_id is null
        and household_account_transaction_id is null
      )
    ),
  add constraint household_settlements_workflow_check
    check (
      (
        status = 'pending'
        and confirmed_at is null and confirmed_by_user_id is null
        and rejected_at is null and rejected_by_user_id is null
        and cancelled_at is null and cancelled_by_user_id is null
      )
      or
      (
        status = 'confirmed'
        and confirmed_at is not null and confirmed_by_user_id is not null
        and rejected_at is null and rejected_by_user_id is null
        and cancelled_at is null and cancelled_by_user_id is null
      )
      or
      (
        status = 'rejected'
        and rejected_at is not null and rejected_by_user_id is not null
        and confirmed_at is null and confirmed_by_user_id is null
        and cancelled_at is null and cancelled_by_user_id is null
      )
      or
      (
        status = 'cancelled'
        and cancelled_at is not null and cancelled_by_user_id is not null
        and rejected_at is null and rejected_by_user_id is null
      )
    );

-- Add foreign keys and unique constraints
alter table public.household_settlements
  add constraint household_settlements_personal_transaction_fkey
    foreign key (personal_transaction_id, payer_user_id)
    references public.transactions(id, user_id) on delete restrict,
  add constraint household_settlements_personal_transaction_unique
    unique (personal_transaction_id),
  add constraint household_settlements_household_transaction_fkey
    foreign key (household_account_transaction_id, household_id)
    references public.household_account_transactions(id, household_id) on delete restrict,
  add constraint household_settlements_household_transaction_unique
    unique (household_account_transaction_id),
  add constraint household_settlements_confirmer_membership_fkey
    foreign key (household_id, confirmed_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  add constraint household_settlements_rejecter_membership_fkey
    foreign key (household_id, rejected_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict;

-- Active household write trigger
drop trigger if exists household_settlements_require_active_household on public.household_settlements;
create trigger household_settlements_require_active_household
  before insert or update or delete on public.household_settlements
  for each row execute function private.enforce_active_household_financial_write();

-- 2. Settlement payload helper
create or replace function private.household_settlement_payload(p_settlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'id', settlement.id,
    'entry_type', 'settlement',
    'household_id', settlement.household_id,
    'payer_user_id', settlement.payer_user_id,
    'payee_user_id', settlement.payee_user_id,
    'recorded_by_user_id', settlement.recorded_by_user_id,
    'amount', private.format_exact_money(settlement.amount),
    'date', settlement.date,
    'notes', settlement.notes,
    'status', settlement.status,
    'funding_source', settlement.funding_source,
    'is_cancelled', (settlement.status = 'cancelled' or settlement.cancelled_at is not null),
    'created_at', settlement.created_at
  )
  into result
  from public.household_settlements settlement
  where settlement.id = p_settlement_id;

  return result;
end;
$$;

-- 3. Interpersonal balance function
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
  pending_settlement_json jsonb;
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

  -- Pending settlement lookup (active pending settlement awaiting confirmation)
  select jsonb_build_object(
           'id', pending.id,
           'payer_user_id', pending.payer_user_id,
           'payee_user_id', pending.payee_user_id,
           'amount', private.format_exact_money(pending.amount),
           'funding_source', pending.funding_source,
           'date', pending.date,
           'notes', pending.notes,
           'created_at', pending.created_at
         )
    into pending_settlement_json
    from public.household_settlements pending
   where pending.household_id = p_household_id
     and pending.status = 'pending'
     and pending.cancelled_at is null
   order by pending.created_at desc
   limit 1;

  with member_deltas as (
    -- Personal-funded shared expenses
    select split.user_id,
           (case when expense.personal_payer_user_id = split.user_id
                 then personal_transaction.amount else 0 end) - split.amount as delta
      from public.household_expenses expense
      join public.transactions personal_transaction
        on personal_transaction.id = expense.personal_transaction_id
       and personal_transaction.user_id = expense.personal_payer_user_id
      join public.household_expense_splits split
        on split.household_expense_id = expense.id
     where expense.household_id = p_household_id
       and expense.funding_source = 'personal_account'
       and personal_transaction.status = 'posted'

    union all

    -- ONLY confirmed settlements: payer adds amount to position
    select settlement.payer_user_id as user_id,
           settlement.amount as delta
      from public.household_settlements settlement
     where settlement.household_id = p_household_id
       and settlement.status = 'confirmed'
       and settlement.cancelled_at is null

    union all

    -- ONLY confirmed settlements: payee subtracts amount from position
    select settlement.payee_user_id as user_id,
           -settlement.amount as delta
      from public.household_settlements settlement
     where settlement.household_id = p_household_id
       and settlement.status = 'confirmed'
       and settlement.cancelled_at is null
  ), positions as (
    select member_row.user_id,
           coalesce(sum(deltas.delta), 0) as position
      from public.household_members member_row
      left join member_deltas deltas
        on deltas.user_id = member_row.user_id
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
    'amount', private.format_exact_money(summary.amount),
    'pending_settlement', pending_settlement_json
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

-- 4. Activity rows helper
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
     and not exists (
       select 1 from public.household_settlements settlement
        where settlement.household_account_transaction_id = transaction_row.id
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
  union all
  select settlement.id,
         settlement.date,
         settlement.created_at,
         'settlement',
         jsonb_build_object(
           'id', settlement.id,
           'entry_type', 'settlement',
           'household_id', settlement.household_id,
           'payer_user_id', settlement.payer_user_id,
           'payee_user_id', settlement.payee_user_id,
           'recorded_by_user_id', settlement.recorded_by_user_id,
           'amount', private.format_exact_money(settlement.amount),
           'date', settlement.date,
           'notes', settlement.notes,
           'status', settlement.status,
           'funding_source', settlement.funding_source,
           'is_cancelled', (settlement.status = 'cancelled' or settlement.cancelled_at is not null),
           'created_at', settlement.created_at
         )
    from public.household_settlements settlement
   where settlement.household_id = p_household_id
$$;

-- Guard settlement transaction legs from generic mutation RPCs
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
  ) or exists (
    select 1 from public.household_settlements settlement
     where settlement.personal_transaction_id = p_id
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
  ) or exists (
    select 1 from public.household_settlements settlement
     where settlement.personal_transaction_id = p_id
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
  ) or exists (
    select 1 from public.household_settlements settlement
     where settlement.household_account_transaction_id = p_transaction_id
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
  ) or exists (
    select 1 from public.household_settlements settlement
     where settlement.household_account_transaction_id = p_transaction_id
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

-- 5. RPC create_household_settlement
drop function if exists public.create_household_settlement(uuid, text, date, text, uuid);

create or replace function public.create_household_settlement(
  p_household_id uuid,
  p_amount text,
  p_date date,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_funding_source text default 'cash',
  p_source_personal_account_id uuid default null,
  p_source_household_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  amount_value numeric;
  existing_settlement public.household_settlements%rowtype;
  balance_data jsonb;
  owed_by uuid;
  owed_to uuid;
  current_debt_numeric numeric;
  settlement_id uuid;
  personal_tx_id uuid := null;
  household_tx_id uuid := null;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_date is null then
    raise exception 'Settlement date is required' using errcode = '22023';
  end if;
  if p_notes is not null and char_length(p_notes) > 500 then
    raise exception 'Settlement notes are too long' using errcode = '22023';
  end if;
  if p_funding_source not in ('personal_account', 'household_account', 'cash', 'in_kind') then
    raise exception 'Invalid funding source' using errcode = '22023';
  end if;

  perform private.require_active_household_actor(p_household_id, actor_id);

  -- Check idempotency
  select settlement.*
    into existing_settlement
    from public.household_settlements settlement
   where settlement.recorded_by_user_id = actor_id
     and settlement.idempotency_key = p_idempotency_key
   for update;
  if found then
    amount_value := private.parse_exact_money(p_amount, false, false);
    if existing_settlement.household_id is distinct from p_household_id
       or existing_settlement.amount is distinct from amount_value
       or existing_settlement.date is distinct from p_date
       or existing_settlement.notes is distinct from p_notes
       or existing_settlement.funding_source is distinct from p_funding_source then
      raise exception 'Idempotency key was already used with a different settlement'
        using errcode = '23505';
    end if;
    return private.household_settlement_payload(existing_settlement.id);
  end if;

  amount_value := private.parse_exact_money(p_amount, false, false);

  balance_data := public.get_household_balance_between_members(p_household_id);
  owed_by := (balance_data->>'owed_by_user_id')::uuid;
  owed_to := (balance_data->>'owed_to_user_id')::uuid;
  current_debt_numeric := (balance_data->>'amount')::numeric;

  if owed_by is null or owed_to is null or current_debt_numeric <= 0 then
    raise exception 'There is no active debt to settle' using errcode = '23514';
  end if;

  if amount_value > current_debt_numeric then
    raise exception 'Settlement amount cannot exceed current debt' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.household_settlements
     where household_id = p_household_id
       and status = 'pending'
       and cancelled_at is null
  ) then
    raise exception 'There is already a pending settlement awaiting confirmation'
      using errcode = '23514';
  end if;

  if p_funding_source = 'personal_account' then
    if p_source_personal_account_id is null or p_source_household_account_id is not null then
      raise exception 'Personal account funding requires source personal account' using errcode = '23514';
    end if;
    if actor_id <> owed_by then
      raise exception 'Only the payer can settle from a personal account' using errcode = '23514';
    end if;

    perform private.lock_accounts(array[p_source_personal_account_id]);
    if not exists (
      select 1 from public.accounts account
       where account.id = p_source_personal_account_id
         and account.user_id = owed_by
         and account.currency = 'MXN'
    ) then
      raise exception 'Personal account not found' using errcode = 'P0002';
    end if;

    personal_tx_id := (private.create_financial_transaction_core(
      owed_by,
      p_source_personal_account_id,
      'expense',
      amount_value,
      'MXN',
      p_date,
      'Liquidación En pareja',
      null,
      p_notes,
      false,
      null,
      'pending',
      'manual',
      null,
      '{}'::uuid[]
    )).id;

  elsif p_funding_source = 'household_account' then
    if p_source_household_account_id is null or p_source_personal_account_id is not null then
      raise exception 'Household account funding requires source household account' using errcode = '23514';
    end if;

    perform private.lock_household_accounts(array[p_source_household_account_id]);
    if not exists (
      select 1 from public.household_accounts account
       where account.id = p_source_household_account_id
         and account.household_id = p_household_id
         and account.status = 'active'
         and account.currency = 'MXN'
    ) then
      raise exception 'Household account not found' using errcode = 'P0002';
    end if;

    household_tx_id := private.create_household_transaction_core(
      p_household_id,
      p_source_household_account_id,
      'expense',
      amount_value,
      p_date,
      'Liquidación En pareja',
      p_notes,
      'pending',
      actor_id
    );

  else
    if p_source_personal_account_id is not null or p_source_household_account_id is not null then
      raise exception 'Accounts cannot be linked for cash or in-kind settlements' using errcode = '23514';
    end if;
  end if;

  insert into public.household_settlements (
    household_id,
    payer_user_id,
    payee_user_id,
    amount,
    date,
    notes,
    recorded_by_user_id,
    idempotency_key,
    funding_source,
    status,
    personal_transaction_id,
    household_account_transaction_id
  ) values (
    p_household_id,
    owed_by,
    owed_to,
    amount_value,
    p_date,
    p_notes,
    actor_id,
    p_idempotency_key,
    p_funding_source,
    'pending',
    personal_tx_id,
    household_tx_id
  ) returning id into settlement_id;

  return private.household_settlement_payload(settlement_id);
end;
$$;

-- 6. RPC confirm_household_settlement
create or replace function public.confirm_household_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settlement_row public.household_settlements%rowtype;
  v_account_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;

  perform private.require_active_household_actor(settlement_row.household_id, actor_id);

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id
   for update;

  if actor_id <> settlement_row.payee_user_id then
    raise exception 'Only the recipient can confirm this settlement' using errcode = '23514';
  end if;

  if settlement_row.status = 'confirmed' then
    return private.household_settlement_payload(settlement_row.id);
  end if;

  if settlement_row.status <> 'pending' then
    raise exception 'Settlement cannot be confirmed in current status' using errcode = '23514';
  end if;

  if settlement_row.funding_source = 'personal_account' then
    select transaction_row.account_id into v_account_id
      from public.transactions transaction_row
     where transaction_row.id = settlement_row.personal_transaction_id;
    perform private.lock_accounts(array[v_account_id]);

    update public.transactions
       set status = 'posted'
     where id = settlement_row.personal_transaction_id
       and status = 'pending';
    if not found then
      raise exception 'Linked personal transaction is not in pending status' using errcode = '23514';
    end if;

  elsif settlement_row.funding_source = 'household_account' then
    select transaction_row.account_id into v_account_id
      from public.household_account_transactions transaction_row
     where transaction_row.id = settlement_row.household_account_transaction_id;
    perform private.lock_household_accounts(array[v_account_id]);

    update public.household_account_transactions
       set status = 'posted'
     where id = settlement_row.household_account_transaction_id
       and status = 'pending';
    if not found then
      raise exception 'Linked household transaction is not in pending status' using errcode = '23514';
    end if;
  end if;

  update public.household_settlements
     set status = 'confirmed',
         confirmed_at = now(),
         confirmed_by_user_id = actor_id
   where id = p_settlement_id;

  return private.household_settlement_payload(p_settlement_id);
end;
$$;

-- 7. RPC reject_household_settlement
create or replace function public.reject_household_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settlement_row public.household_settlements%rowtype;
  v_account_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;

  perform private.require_active_household_actor(settlement_row.household_id, actor_id);

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id
   for update;

  if actor_id <> settlement_row.payee_user_id then
    raise exception 'Only the recipient can reject this settlement' using errcode = '23514';
  end if;

  if settlement_row.status = 'rejected' then
    return private.household_settlement_payload(settlement_row.id);
  end if;

  if settlement_row.status <> 'pending' then
    raise exception 'Settlement cannot be rejected in current status' using errcode = '23514';
  end if;

  if settlement_row.funding_source = 'personal_account' then
    select transaction_row.account_id into v_account_id
      from public.transactions transaction_row
     where transaction_row.id = settlement_row.personal_transaction_id;
    perform private.lock_accounts(array[v_account_id]);

    update public.transactions
       set status = 'cancelled'
     where id = settlement_row.personal_transaction_id
       and status = 'pending';
    if not found then
      raise exception 'Linked personal transaction is not in pending status' using errcode = '23514';
    end if;

  elsif settlement_row.funding_source = 'household_account' then
    select transaction_row.account_id into v_account_id
      from public.household_account_transactions transaction_row
     where transaction_row.id = settlement_row.household_account_transaction_id;
    perform private.lock_household_accounts(array[v_account_id]);

    update public.household_account_transactions
       set status = 'cancelled'
     where id = settlement_row.household_account_transaction_id
       and status = 'pending';
    if not found then
      raise exception 'Linked household transaction is not in pending status' using errcode = '23514';
    end if;
  end if;

  update public.household_settlements
     set status = 'rejected',
         rejected_at = now(),
         rejected_by_user_id = actor_id
   where id = p_settlement_id;

  return private.household_settlement_payload(p_settlement_id);
end;
$$;

-- 8. RPC cancel_household_settlement
create or replace function public.cancel_household_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settlement_row public.household_settlements%rowtype;
  v_account_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;

  perform private.require_active_household_actor(settlement_row.household_id, actor_id);

  select settlement.*
    into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id
   for update;

  if actor_id <> settlement_row.payer_user_id and actor_id <> settlement_row.recorded_by_user_id then
    raise exception 'Only the payer or recorder can cancel this settlement' using errcode = '23514';
  end if;

  if settlement_row.status = 'cancelled' or settlement_row.cancelled_at is not null then
    return private.household_settlement_payload(settlement_row.id);
  end if;

  if settlement_row.status = 'rejected' then
    raise exception 'Rejected settlement cannot be cancelled' using errcode = '23514';
  end if;

  if settlement_row.funding_source = 'personal_account' then
    select transaction_row.account_id into v_account_id
      from public.transactions transaction_row
     where transaction_row.id = settlement_row.personal_transaction_id;
    perform private.lock_accounts(array[v_account_id]);

    update public.transactions
       set status = 'cancelled'
     where id = settlement_row.personal_transaction_id
       and status in ('pending', 'posted');

  elsif settlement_row.funding_source = 'household_account' then
    select transaction_row.account_id into v_account_id
      from public.household_account_transactions transaction_row
     where transaction_row.id = settlement_row.household_account_transaction_id;
    perform private.lock_household_accounts(array[v_account_id]);

    update public.household_account_transactions
       set status = 'cancelled'
     where id = settlement_row.household_account_transaction_id
       and status in ('pending', 'posted');
  end if;

  update public.household_settlements
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = actor_id
   where id = p_settlement_id;

  return private.household_settlement_payload(p_settlement_id);
end;
$$;

-- 9. Privileges and ownership
alter function private.household_settlement_payload(uuid) owner to postgres;
alter function public.get_household_balance_between_members(uuid) owner to postgres;
alter function private.household_activity_rows(uuid) owner to postgres;
alter function private.update_financial_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) owner to postgres;
alter function private.delete_financial_transaction_core(uuid, uuid) owner to postgres;
alter function private.update_household_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, date, text, text, text) owner to postgres;
alter function private.delete_household_transaction_core(uuid, uuid) owner to postgres;
alter function public.create_household_settlement(uuid, text, date, text, uuid, text, uuid, uuid) owner to postgres;
alter function public.confirm_household_settlement(uuid) owner to postgres;
alter function public.reject_household_settlement(uuid) owner to postgres;
alter function public.cancel_household_settlement(uuid) owner to postgres;

revoke all on function private.household_settlement_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_balance_between_members(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_activity_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_financial_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.delete_financial_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_household_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.delete_household_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_household_settlement(uuid, text, date, text, uuid, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_household_settlement(uuid) from public, anon, authenticated, service_role;
revoke all on function public.reject_household_settlement(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_household_settlement(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_household_balance_between_members(uuid) to authenticated;
grant execute on function public.create_household_settlement(uuid, text, date, text, uuid, text, uuid, uuid) to authenticated;
grant execute on function public.confirm_household_settlement(uuid) to authenticated;
grant execute on function public.reject_household_settlement(uuid) to authenticated;
grant execute on function public.cancel_household_settlement(uuid) to authenticated;

commit;
