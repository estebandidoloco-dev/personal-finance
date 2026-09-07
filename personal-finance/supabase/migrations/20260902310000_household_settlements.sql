-- P1.5.2: household settlements for interpersonal debt settlement.

begin;

create table public.household_settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  from_user_id uuid not null references public.profiles(id) on delete restrict,
  to_user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999999.99),
  currency text not null check (currency = 'MXN'),
  date date not null,
  note text check (note is null or char_length(note) <= 2000),
  recorded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null check (status in ('posted', 'cancelled')),
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.profiles(id) on delete restrict,
  constraint household_settlements_actor_check check (
    recorded_by_user_id = from_user_id
  ),
  constraint household_settlements_no_self_pay check (
    from_user_id <> to_user_id
  ),
  constraint household_settlements_cancellation_check check (
    (status = 'posted' and cancelled_at is null and cancelled_by_user_id is null)
    or (status = 'cancelled' and cancelled_at is not null and cancelled_by_user_id is not null)
  ),
  constraint household_settlements_from_membership_fkey
    foreign key (household_id, from_user_id)
    references public.household_members(household_id, user_id) on delete restrict,
  constraint household_settlements_to_membership_fkey
    foreign key (household_id, to_user_id)
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

create index household_settlements_household_date_idx
  on public.household_settlements(household_id, date desc);

create trigger household_settlements_require_active_household
  before insert or update or delete on public.household_settlements
  for each row execute function private.enforce_active_household_financial_write();

create function private.household_member_positions(p_household_id uuid)
returns table(user_id uuid, net_position numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with expense_positions as (
    select member_row.user_id,
           coalesce(sum(case
             when expense.id is null or personal_transaction.status <> 'posted' then 0
             else (case when expense.personal_payer_user_id = member_row.user_id
                        then personal_transaction.amount else 0 end) - split.amount
           end), 0) as expense_position
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
  ),
  settlement_positions as (
    select member_row.user_id,
           coalesce((
             select sum(settlement.amount)
               from public.household_settlements settlement
              where settlement.household_id = p_household_id
                and settlement.from_user_id = member_row.user_id
                and settlement.status = 'posted'
           ), 0) - coalesce((
             select sum(settlement.amount)
               from public.household_settlements settlement
              where settlement.household_id = p_household_id
                and settlement.to_user_id = member_row.user_id
                and settlement.status = 'posted'
           ), 0) as settlement_delta
      from public.household_members member_row
     where member_row.household_id = p_household_id
  )
  select ep.user_id,
         ep.expense_position + sp.settlement_delta as net_position
    from expense_positions ep
    join settlement_positions sp on sp.user_id = ep.user_id;
$$;

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
    select * from private.household_member_positions(p_household_id)
  ), summary as (
    select jsonb_agg(jsonb_build_object(
             'user_id', position_row.user_id,
             'amount', private.format_exact_money(position_row.net_position)
           ) order by position_row.user_id) as positions,
           (max(position_row.user_id::text)
             filter (where position_row.net_position < 0))::uuid as owed_by_user_id,
           (max(position_row.user_id::text)
             filter (where position_row.net_position > 0))::uuid as owed_to_user_id,
           greatest(coalesce(max(abs(position_row.net_position)), 0), 0) as amount,
           coalesce(sum(position_row.net_position), 0) as total_net_position
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
   where summary.total_net_position = 0;

  if result is null then
    raise exception 'Household balance positions are inconsistent' using errcode = 'P0001';
  end if;
  return result;
end;
$$;

create function private.household_settlement_payload(p_settlement_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', settlement.id,
    'household_id', settlement.household_id,
    'from_user_id', settlement.from_user_id,
    'to_user_id', settlement.to_user_id,
    'recorded_by_user_id', settlement.recorded_by_user_id,
    'amount', private.format_exact_money(settlement.amount),
    'currency', settlement.currency,
    'date', settlement.date,
    'note', settlement.note,
    'status', settlement.status,
    'created_at', settlement.created_at,
    'cancelled_at', settlement.cancelled_at
  )
  from public.household_settlements settlement
  where settlement.id = p_settlement_id;
$$;

create function public.create_household_settlement(
  p_household_id uuid,
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
  existing_settlement public.household_settlements%rowtype;
  settlement_id uuid;
  debt_owed_by uuid;
  debt_owed_to uuid;
  current_debt numeric;
  total_net_position numeric;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform private.require_active_household_actor(p_household_id, actor_id);

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
       or existing_settlement.note is distinct from p_note then
      raise exception 'Idempotency key was already used with a different settlement'
        using errcode = '23505';
    end if;
    return private.household_settlement_payload(existing_settlement.id);
  end if;

  amount_value := private.parse_exact_money(p_amount, false, false);
  if p_note is not null and char_length(p_note) > 2000 then
    raise exception 'Settlement note is too long' using errcode = '22023';
  end if;

  select (max(user_id::text) filter (where net_position < 0))::uuid,
         (max(user_id::text) filter (where net_position > 0))::uuid,
         greatest(coalesce(max(abs(net_position)), 0), 0),
         coalesce(sum(net_position), 0)
    into debt_owed_by, debt_owed_to, current_debt, total_net_position
    from private.household_member_positions(p_household_id);

  if total_net_position is distinct from 0 then
    raise exception 'Household balance positions are inconsistent' using errcode = 'P0001';
  end if;

  if current_debt <= 0 or debt_owed_by is null or debt_owed_to is null then
    raise exception 'There is no outstanding debt to settle' using errcode = '22023';
  end if;

  if actor_id is distinct from debt_owed_by then
    raise exception 'Only the current debtor can settle the debt' using errcode = '22023';
  end if;

  if amount_value > current_debt then
    raise exception 'Settlement amount exceeds current outstanding debt' using errcode = '22023';
  end if;

  insert into public.household_settlements(
    household_id, from_user_id, to_user_id, amount,
    currency, date, note, recorded_by_user_id, status, idempotency_key
  ) values (
    p_household_id, actor_id, debt_owed_to, amount_value,
    'MXN', p_date, p_note, actor_id, 'posted', p_idempotency_key
  ) returning id into settlement_id;

  return private.household_settlement_payload(settlement_id);
end;
$$;

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

  select settlement.* into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;

  perform private.require_active_household_actor(settlement_row.household_id, actor_id);

  select settlement.* into settlement_row
    from public.household_settlements settlement
   where settlement.id = p_settlement_id
   for update;
  if not found then
    raise exception 'Settlement not found' using errcode = 'P0002';
  end if;

  if settlement_row.recorded_by_user_id is distinct from actor_id then
    raise exception 'Only the recorder can cancel the settlement' using errcode = '22023';
  end if;

  if settlement_row.status = 'cancelled' or settlement_row.cancelled_at is not null then
    return private.household_settlement_payload(settlement_row.id);
  end if;

  update public.household_settlements
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by_user_id = actor_id
   where id = settlement_row.id
     and status = 'posted';

  return private.household_settlement_payload(settlement_row.id);
end;
$$;

alter table public.household_settlements enable row level security;
create policy household_settlements_select_member_history
  on public.household_settlements
  for select to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

alter function private.household_member_positions(uuid) owner to postgres;
alter function private.household_settlement_payload(uuid) owner to postgres;
alter function public.get_household_balance_between_members(uuid) owner to postgres;
alter function public.create_household_settlement(uuid, text, date, text, uuid) owner to postgres;
alter function public.cancel_household_settlement(uuid) owner to postgres;

revoke all on table public.household_settlements
  from public, anon, authenticated, service_role;
grant select (
  id, household_id, from_user_id, to_user_id, amount, currency, date,
  note, recorded_by_user_id, status, created_at, cancelled_at, cancelled_by_user_id
) on public.household_settlements to authenticated;

revoke all on function private.household_member_positions(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_settlement_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_household_balance_between_members(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_household_settlement(uuid, text, date, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.cancel_household_settlement(uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_household_balance_between_members(uuid) to authenticated;
grant execute on function public.create_household_settlement(uuid, text, date, text, uuid) to authenticated;
grant execute on function public.cancel_household_settlement(uuid) to authenticated;

commit;

