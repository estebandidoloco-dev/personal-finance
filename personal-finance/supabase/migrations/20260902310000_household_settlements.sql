-- P1.4 / P1.5: Household Settlements between members

begin;

-- 1. Household settlements table
create table public.household_settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  payer_user_id uuid not null references public.profiles(id) on delete restrict,
  payee_user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  date date not null,
  notes text,
  recorded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.profiles(id) on delete restrict,
  constraint household_settlements_distinct_members check (payer_user_id <> payee_user_id),
  constraint household_settlements_cancellation_check check (
    (cancelled_at is null and cancelled_by_user_id is null)
    or (cancelled_at is not null and cancelled_by_user_id is not null)
  ),
  constraint household_settlements_payer_membership_fkey
    foreign key (household_id, payer_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_settlements_payee_membership_fkey
    foreign key (household_id, payee_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_settlements_recorder_membership_fkey
    foreign key (household_id, recorded_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_settlements_canceller_membership_fkey
    foreign key (household_id, cancelled_by_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_settlements_idempotency_unique
    unique (recorded_by_user_id, idempotency_key)
);

create index household_settlements_household_created_idx
  on public.household_settlements(household_id, created_at desc, id desc);

alter table public.household_settlements enable row level security;

create policy household_settlements_select_member_history
  on public.household_settlements
  for select to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

-- 2. Settlement payload helper
create function private.household_settlement_payload(p_settlement_id uuid)
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
    'is_cancelled', (settlement.cancelled_at is not null),
    'created_at', settlement.created_at
  )
  into result
  from public.household_settlements settlement
  where settlement.id = p_settlement_id;

  return result;
end;
$$;

-- 3. Update get_household_balance_between_members to incorporate active settlements
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

    -- Active settlements: payer adds amount to position
    select settlement.payer_user_id as user_id,
           settlement.amount as delta
      from public.household_settlements settlement
     where settlement.household_id = p_household_id
       and settlement.cancelled_at is null

    union all

    -- Active settlements: payee subtracts amount from position
    select settlement.payee_user_id as user_id,
           -settlement.amount as delta
      from public.household_settlements settlement
     where settlement.household_id = p_household_id
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

-- 4. Update household_activity_rows to include settlements
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
           'is_cancelled', (settlement.cancelled_at is not null),
           'created_at', settlement.created_at
         )
    from public.household_settlements settlement
   where settlement.household_id = p_household_id
$$;

-- 5. RPC create_household_settlement
create function public.create_household_settlement(
  p_household_id uuid,
  p_amount text,
  p_date date,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
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
       or existing_settlement.notes is distinct from p_notes then
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

  insert into public.household_settlements (
    household_id,
    payer_user_id,
    payee_user_id,
    amount,
    date,
    notes,
    recorded_by_user_id,
    idempotency_key
  ) values (
    p_household_id,
    owed_by,
    owed_to,
    amount_value,
    p_date,
    p_notes,
    actor_id,
    p_idempotency_key
  ) returning id into settlement_id;

  return private.household_settlement_payload(settlement_id);
end;
$$;

-- 6. RPC cancel_household_settlement
create function public.cancel_household_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settlement_row public.household_settlements%rowtype;
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

  if settlement_row.cancelled_at is not null then
    return private.household_settlement_payload(settlement_row.id);
  end if;

  update public.household_settlements
     set cancelled_at = now(),
         cancelled_by_user_id = actor_id
   where id = p_settlement_id
     and cancelled_at is null;

  return private.household_settlement_payload(p_settlement_id);
end;
$$;

-- 7. Privileges and ownership
alter table public.household_settlements owner to postgres;
alter function private.household_settlement_payload(uuid) owner to postgres;
alter function public.get_household_balance_between_members(uuid) owner to postgres;
alter function private.household_activity_rows(uuid) owner to postgres;
alter function public.create_household_settlement(uuid, text, date, text, uuid) owner to postgres;
alter function public.cancel_household_settlement(uuid) owner to postgres;

revoke all on table public.household_settlements
  from public, anon, authenticated, service_role;
grant select on public.household_settlements to authenticated;

revoke all on function private.household_settlement_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_balance_between_members(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_activity_rows(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_household_settlement(uuid, text, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_household_settlement(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_household_balance_between_members(uuid) to authenticated;
grant execute on function public.create_household_settlement(uuid, text, date, text, uuid) to authenticated;
grant execute on function public.cancel_household_settlement(uuid) to authenticated;

commit;
