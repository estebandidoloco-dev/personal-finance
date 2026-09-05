-- P1.4 phase 4: Household ledger, accounts, shared expenses, and exact splits.

begin;

create function private.parse_exact_money(
  p_value text,
  p_allow_negative boolean,
  p_allow_zero boolean
)
returns numeric
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  parsed numeric;
begin
  if p_value is null
     or p_value !~ '^-?(0|[1-9][0-9]{0,11})\.[0-9]{2}$'
     or p_value = '-0.00' then
    raise exception 'Money must be a canonical decimal string with exactly two decimals'
      using errcode = '22023';
  end if;
  parsed := p_value::numeric;
  if not p_allow_negative and parsed < 0 then
    raise exception 'Money cannot be negative' using errcode = '22023';
  end if;
  if not p_allow_zero and parsed = 0 then
    raise exception 'Money must be greater than zero' using errcode = '22023';
  end if;
  return parsed::numeric(14,2);
exception when numeric_value_out_of_range then
  raise exception 'Money is outside the supported range' using errcode = '22003';
end
$$;

create function private.format_exact_money(p_value numeric)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  with rounded as (
    select round(p_value, 2) as value
  ), parts as (
    select value,
           abs(value)::text as absolute_text
      from rounded
  )
  select case
    when value is null then null
    when value = 0 then '0.00'
    else case when value < 0 then '-' else '' end
      || split_part(absolute_text, '.', 1)
      || '.'
      || rpad(split_part(absolute_text, '.', 2), 2, '0')
  end
  from parts
$$;

create function private.require_active_household_actor(
  p_household_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.households household
   where household.id = p_household_id for update;
  if not found or not exists (
    select 1 from public.households household
    join public.household_members member_row on member_row.household_id = household.id
     where household.id = p_household_id
       and household.status = 'active'
       and member_row.user_id = p_actor_id
       and member_row.status = 'current'
  ) then
    raise exception 'Household not found' using errcode = 'P0002';
  end if;
end
$$;

create function private.initialize_household_account_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.balance := new.initial_balance;
  return new;
end
$$;

create trigger household_accounts_initialize_balance
  before insert on public.household_accounts
  for each row execute function private.initialize_household_account_balance();

create function private.enforce_household_account_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'Closed Household account is terminal' using errcode = '23514';
  end if;
  if new.currency is distinct from old.currency and exists (
    select 1 from public.household_account_transactions transaction_row
     where transaction_row.account_id = old.id
  ) then
    raise exception 'Household account currency cannot change after ledger entries exist'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger household_accounts_enforce_transition
  before update of status, currency on public.household_accounts
  for each row execute function private.enforce_household_account_transition();

create function private.lock_household_accounts(p_account_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_count integer;
  locked_count integer := 0;
  locked_id uuid;
begin
  select count(distinct account_id) into expected_count
    from unnest(p_account_ids) account_id where account_id is not null;
  for locked_id in
    select account.id from public.household_accounts account
     where account.id = any(p_account_ids)
     order by account.id
     for no key update
  loop
    if locked_id is not null then
      locked_count := locked_count + 1;
    end if;
  end loop;
  if locked_count <> expected_count then
    raise exception 'Household account not found' using errcode = 'P0002';
  end if;
end
$$;

create function private.maintain_household_account_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_impact numeric := 0;
  new_impact numeric := 0;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_impact := private.transaction_impact(old.kind, old.amount, old.status);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_impact := private.transaction_impact(new.kind, new.amount, new.status);
  end if;
  if tg_op = 'INSERT' then
    perform private.lock_household_accounts(array[new.account_id]);
  elsif tg_op = 'DELETE' then
    perform private.lock_household_accounts(array[old.account_id]);
  else
    perform private.lock_household_accounts(array[old.account_id, new.account_id]);
  end if;

  if tg_op = 'INSERT' then
    update public.household_accounts set balance = balance + new_impact where id = new.account_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.household_accounts set balance = balance - old_impact where id = old.account_id;
    return old;
  elsif old.account_id = new.account_id then
    update public.household_accounts
       set balance = balance + (new_impact - old_impact) where id = new.account_id;
  else
    update public.household_accounts set balance = balance - old_impact where id = old.account_id;
    update public.household_accounts set balance = balance + new_impact where id = new.account_id;
  end if;
  return new;
end
$$;

create trigger household_transactions_maintain_balance
  after insert or delete or update of account_id, amount, kind, status
  on public.household_account_transactions
  for each row execute function private.maintain_household_account_balance();

create function private.touch_household_financial_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger household_transactions_touch_updated_at
  before update on public.household_account_transactions
  for each row execute function private.touch_household_financial_updated_at();
create trigger household_expenses_touch_updated_at
  before update on public.household_expenses
  for each row execute function private.touch_household_financial_updated_at();

create function private.household_account_payload(p_account_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', account.id,
    'household_id', account.household_id,
    'name', account.name,
    'type', account.type,
    'initial_balance', private.format_exact_money(account.initial_balance),
    'balance', private.format_exact_money(account.balance),
    'currency', account.currency,
    'status', account.status,
    'created_by_user_id', account.created_by_user_id,
    'created_at', account.created_at,
    'closed_at', account.closed_at
  ) from public.household_accounts account where account.id = p_account_id
$$;

create function private.household_transaction_payload(p_transaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', transaction_row.id,
    'household_id', transaction_row.household_id,
    'account_id', transaction_row.account_id,
    'kind', transaction_row.kind,
    'amount', private.format_exact_money(transaction_row.amount),
    'currency', transaction_row.currency,
    'date', transaction_row.date,
    'description', transaction_row.description,
    'notes', transaction_row.notes,
    'status', transaction_row.status,
    'recorded_by_user_id', transaction_row.recorded_by_user_id,
    'created_at', transaction_row.created_at,
    'updated_at', transaction_row.updated_at
  ) from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id
$$;

create function private.household_expense_payload(p_expense_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', expense.id,
    'household_id', expense.household_id,
    'funding_source', expense.funding_source,
    'personal_payer_user_id', expense.personal_payer_user_id,
    'recorded_by_user_id', expense.recorded_by_user_id,
    'personal_transaction_id', expense.personal_transaction_id,
    'household_account_transaction_id', expense.household_account_transaction_id,
    'split_mode', expense.split_mode,
    'category_id', expense.category_id,
    'amount', private.format_exact_money(coalesce(personal_transaction.amount, household_transaction.amount)),
    'currency', coalesce(personal_transaction.currency, household_transaction.currency),
    'date', coalesce(personal_transaction.date, household_transaction.date),
    'description', coalesce(personal_transaction.description, household_transaction.description),
    'notes', coalesce(personal_transaction.notes, household_transaction.notes),
    'status', coalesce(personal_transaction.status, household_transaction.status),
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
  left join public.transactions personal_transaction
    on personal_transaction.id = expense.personal_transaction_id
   and personal_transaction.user_id = expense.personal_payer_user_id
  left join public.household_account_transactions household_transaction
    on household_transaction.id = expense.household_account_transaction_id
   and household_transaction.household_id = expense.household_id
  where expense.id = p_expense_id
$$;

create function private.create_household_transaction_core(
  p_household_id uuid,
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_date date,
  p_description text,
  p_notes text,
  p_status text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  if not exists (
    select 1 from public.household_accounts account
     where account.id = p_account_id
       and account.household_id = p_household_id
       and account.status = 'active'
       and account.currency = 'MXN'
  ) then
    raise exception 'Household account not found' using errcode = 'P0002';
  end if;
  insert into public.household_account_transactions(
    household_id, account_id, kind, amount, currency, date,
    description, notes, status, recorded_by_user_id
  ) values (
    p_household_id, p_account_id, p_kind, p_amount, 'MXN', p_date,
    p_description, p_notes, p_status, p_actor_id
  ) returning id into created_id;
  return created_id;
end
$$;

create function private.update_household_transaction_core(
  p_transaction_id uuid,
  p_household_id uuid,
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_date date,
  p_description text,
  p_notes text,
  p_status text
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
  if not found or not exists (
    select 1 from public.household_accounts account
     where account.id = p_account_id
       and account.household_id = p_household_id
       and account.status = 'active'
       and account.currency = 'MXN'
  ) then
    raise exception 'Household transaction not found' using errcode = 'P0002';
  end if;
  update public.household_account_transactions
     set account_id = p_account_id,
         kind = p_kind,
         amount = p_amount,
         currency = 'MXN',
         date = p_date,
         description = p_description,
         notes = p_notes,
         status = p_status
   where id = p_transaction_id;
  return p_transaction_id;
end
$$;

create function private.delete_household_transaction_core(
  p_transaction_id uuid,
  p_household_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id
     and transaction_row.household_id = p_household_id;
  if not found then
    raise exception 'Household transaction not found' using errcode = 'P0002';
  end if;
  return p_transaction_id;
end
$$;

create function private.replace_household_expense_splits(
  p_expense_id uuid,
  p_household_id uuid,
  p_split_mode text,
  p_amount numeric,
  p_remainder_user_id uuid,
  p_splits jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  member_ids uuid[];
  split_item jsonb;
  split_user_id uuid;
  split_amount numeric;
  split_total numeric := 0;
  amount_cents bigint;
  base_cents bigint;
begin
  select array_agg(member_row.user_id order by member_row.user_id)
    into member_ids
    from public.household_members member_row
   where member_row.household_id = p_household_id
     and member_row.status = 'current';
  if cardinality(member_ids) <> 2 or not (p_remainder_user_id = any(member_ids)) then
    raise exception 'Household must have exactly two current members' using errcode = '23514';
  end if;
  if p_split_mode not in ('equal', 'custom') then
    raise exception 'Invalid split mode' using errcode = '22023';
  end if;

  delete from public.household_expense_splits where household_expense_id = p_expense_id;
  if p_split_mode = 'equal' then
    amount_cents := (p_amount * 100)::bigint;
    base_cents := amount_cents / 2;
    insert into public.household_expense_splits(household_expense_id, user_id, amount)
    select p_expense_id, member_id,
           ((base_cents + case
             when member_id = p_remainder_user_id then amount_cents - (base_cents * 2)
             else 0 end)::numeric / 100)::numeric(14,2)
      from unnest(member_ids) member_id;
  else
    if p_splits is null or jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) <> 2 then
      raise exception 'Custom split must contain exactly two entries' using errcode = '22023';
    end if;
    for split_item in select value from jsonb_array_elements(p_splits)
    loop
      if jsonb_typeof(split_item) <> 'object'
         or not (split_item ? 'user_id')
         or not (split_item ? 'amount') then
        raise exception 'Invalid custom split entry' using errcode = '22023';
      end if;
      split_user_id := (split_item->>'user_id')::uuid;
      split_amount := private.parse_exact_money(split_item->>'amount', false, true);
      if not (split_user_id = any(member_ids)) then
        raise exception 'Custom split user is not a current member' using errcode = '22023';
      end if;
      begin
        insert into public.household_expense_splits(household_expense_id, user_id, amount)
        values (p_expense_id, split_user_id, split_amount);
      exception when unique_violation then
        raise exception 'Custom split users must be unique' using errcode = '22023';
      end;
      split_total := split_total + split_amount;
    end loop;
    if split_total <> p_amount or split_total = 0 then
      raise exception 'Custom splits must sum exactly to the expense amount'
        using errcode = '22023';
    end if;
  end if;
  perform private.validate_household_expense_splits(p_expense_id);
end
$$;

create function public.create_household_account(
  p_household_id uuid,
  p_name text,
  p_type text,
  p_initial_balance text default '0.00'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  account_id uuid;
  initial_amount numeric;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform private.require_active_household_actor(p_household_id, actor_id);
  initial_amount := private.parse_exact_money(p_initial_balance, true, true);
  insert into public.household_accounts(
    household_id, name, type, initial_balance, currency, created_by_user_id
  ) values (p_household_id, p_name, p_type, initial_amount, 'MXN', actor_id)
  returning id into account_id;
  return private.household_account_payload(account_id);
end
$$;

create function public.update_household_account(p_account_id uuid, p_name text, p_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select account.household_id into household_id from public.household_accounts account
   where account.id = p_account_id;
  if not found then raise exception 'Household account not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(household_id, actor_id);
  update public.household_accounts set name = p_name, type = p_type
   where id = p_account_id and status = 'active';
  if not found then raise exception 'Household account not found' using errcode = 'P0002'; end if;
  return private.household_account_payload(p_account_id);
end
$$;

create function public.close_household_account(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select account.household_id into household_id from public.household_accounts account
   where account.id = p_account_id;
  if not found then raise exception 'Household account not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(household_id, actor_id);
  update public.household_accounts set status = 'closed', closed_at = now()
   where id = p_account_id and status = 'active';
  if not found then raise exception 'Household account not found' using errcode = 'P0002'; end if;
  return private.household_account_payload(p_account_id);
end
$$;

create function public.create_household_account_income(
  p_account_id uuid,
  p_amount text,
  p_date date,
  p_description text,
  p_notes text default null,
  p_status text default 'posted'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
  transaction_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select account.household_id into household_id from public.household_accounts account
   where account.id = p_account_id;
  if not found then raise exception 'Household account not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(household_id, actor_id);
  transaction_id := private.create_household_transaction_core(
    household_id, p_account_id, 'income', private.parse_exact_money(p_amount, false, false),
    p_date, p_description, p_notes, p_status, actor_id
  );
  return private.household_transaction_payload(transaction_id);
end
$$;

create function public.update_household_account_income(
  p_transaction_id uuid,
  p_account_id uuid,
  p_amount text,
  p_date date,
  p_description text,
  p_notes text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select transaction_row.household_id into household_id
    from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id and transaction_row.kind = 'income';
  if not found then raise exception 'Household transaction not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(household_id, actor_id);
  perform private.update_household_transaction_core(
    p_transaction_id, household_id, p_account_id, 'income',
    private.parse_exact_money(p_amount, false, false), p_date, p_description, p_notes, p_status
  );
  return private.household_transaction_payload(p_transaction_id);
end
$$;

create function public.delete_household_account_income(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  household_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select transaction_row.household_id into household_id
    from public.household_account_transactions transaction_row
   where transaction_row.id = p_transaction_id and transaction_row.kind = 'income';
  if not found then raise exception 'Household transaction not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(household_id, actor_id);
  return private.delete_household_transaction_core(p_transaction_id, household_id);
end
$$;

create function public.create_shared_expense(
  p_household_id uuid,
  p_funding_source text,
  p_source_account_id uuid,
  p_amount text,
  p_date date,
  p_description text,
  p_split_mode text,
  p_splits jsonb default null,
  p_category_id uuid default null,
  p_notes text default null,
  p_status text default 'posted'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  amount_value numeric;
  source_id uuid;
  expense_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  perform private.require_active_household_actor(p_household_id, actor_id);
  amount_value := private.parse_exact_money(p_amount, false, false);
  if p_funding_source = 'personal_account' then
    source_id := (private.create_financial_transaction_core(
      actor_id, p_source_account_id, 'expense', amount_value, 'MXN', p_date,
      p_description, p_category_id, p_notes, true, null, p_status,
      'manual', null, '{}'::uuid[]
    )).id;
    insert into public.household_expenses(
      household_id, funding_source, personal_payer_user_id, recorded_by_user_id,
      personal_transaction_id, split_mode, category_id
    ) values (
      p_household_id, 'personal_account', actor_id, actor_id,
      source_id, p_split_mode, p_category_id
    ) returning id into expense_id;
  elsif p_funding_source = 'household_account' then
    source_id := private.create_household_transaction_core(
      p_household_id, p_source_account_id, 'expense', amount_value, p_date,
      p_description, p_notes, p_status, actor_id
    );
    insert into public.household_expenses(
      household_id, funding_source, personal_payer_user_id, recorded_by_user_id,
      household_account_transaction_id, split_mode, category_id
    ) values (
      p_household_id, 'household_account', null, actor_id,
      source_id, p_split_mode, p_category_id
    ) returning id into expense_id;
  else
    raise exception 'Invalid funding source' using errcode = '22023';
  end if;
  perform private.replace_household_expense_splits(
    expense_id, p_household_id, p_split_mode, amount_value, actor_id, p_splits
  );
  return private.household_expense_payload(expense_id);
end
$$;

create function public.update_shared_expense(
  p_expense_id uuid,
  p_source_account_id uuid,
  p_amount text,
  p_date date,
  p_description text,
  p_split_mode text,
  p_splits jsonb,
  p_category_id uuid,
  p_notes text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  expense_row public.household_expenses;
  amount_value numeric;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select expense.* into expense_row from public.household_expenses expense
   where expense.id = p_expense_id;
  if not found then raise exception 'Household expense not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(expense_row.household_id, actor_id);
  select expense.* into expense_row from public.household_expenses expense
   where expense.id = p_expense_id for update;
  if expense_row.funding_source = 'personal_account'
     and expense_row.personal_payer_user_id <> actor_id then
    raise exception 'Household expense not found' using errcode = 'P0002';
  end if;
  amount_value := private.parse_exact_money(p_amount, false, false);
  if expense_row.funding_source = 'personal_account' then
    perform private.update_financial_transaction_core(
      actor_id, expense_row.personal_transaction_id, p_source_account_id, 'expense',
      amount_value, 'MXN', p_date, p_description, p_category_id, p_notes,
      true, null, p_status, '{}'::uuid[]
    );
  else
    perform private.update_household_transaction_core(
      expense_row.household_account_transaction_id, expense_row.household_id,
      p_source_account_id, 'expense', amount_value, p_date, p_description, p_notes, p_status
    );
  end if;
  update public.household_expenses
     set split_mode = p_split_mode, category_id = p_category_id
   where id = p_expense_id;
  perform private.replace_household_expense_splits(
    p_expense_id, expense_row.household_id, p_split_mode, amount_value,
    coalesce(expense_row.personal_payer_user_id, actor_id), p_splits
  );
  return private.household_expense_payload(p_expense_id);
end
$$;

create function public.delete_shared_expense(p_expense_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  expense_row public.household_expenses;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select expense.* into expense_row from public.household_expenses expense
   where expense.id = p_expense_id;
  if not found then raise exception 'Household expense not found' using errcode = 'P0002'; end if;
  perform private.require_active_household_actor(expense_row.household_id, actor_id);
  select expense.* into expense_row from public.household_expenses expense
   where expense.id = p_expense_id for update;
  if expense_row.funding_source = 'personal_account'
     and expense_row.personal_payer_user_id <> actor_id then
    raise exception 'Household expense not found' using errcode = 'P0002';
  end if;
  delete from public.household_expenses where id = p_expense_id;
  if expense_row.funding_source = 'personal_account' then
    perform private.delete_financial_transaction_core(actor_id, expense_row.personal_transaction_id);
  else
    perform private.delete_household_transaction_core(
      expense_row.household_account_transaction_id, expense_row.household_id
    );
  end if;
  return p_expense_id;
end
$$;

-- Personal RPCs may not mutate a ledger row linked to a shared expense.
create or replace function public.update_financial_transaction(
  p_id uuid,
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_description text,
  p_category_id uuid,
  p_notes text,
  p_is_shared boolean,
  p_split_ratio jsonb,
  p_status text,
  p_tag_ids uuid[]
)
returns public.transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if exists (
    select 1 from public.household_expenses expense
     where expense.personal_transaction_id = p_id
       and expense.personal_payer_user_id = authenticated_user_id
  ) then
    raise exception 'Linked shared expense must be updated through its Household RPC'
      using errcode = '23514';
  end if;
  return private.update_financial_transaction_core(
    authenticated_user_id, p_id, p_account_id, p_kind, p_amount, p_currency,
    p_date, p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, p_tag_ids
  );
end
$$;

create or replace function public.delete_financial_transaction(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if exists (
    select 1 from public.household_expenses expense
     where expense.personal_transaction_id = p_id
       and expense.personal_payer_user_id = authenticated_user_id
  ) then
    raise exception 'Linked shared expense must be deleted through its Household RPC'
      using errcode = '23514';
  end if;
  return private.delete_financial_transaction_core(authenticated_user_id, p_id);
end
$$;

create view public.household_account_balance_reconciliation
with (security_invoker = true)
as
select account.id as account_id,
       account.household_id,
       account.initial_balance,
       coalesce(sum(case
         when transaction_row.status <> 'posted' then 0
         when transaction_row.kind = 'income' then transaction_row.amount
         else -transaction_row.amount
       end), 0)::numeric(14,2) as ledger_impact,
       (account.initial_balance + coalesce(sum(case
         when transaction_row.status <> 'posted' then 0
         when transaction_row.kind = 'income' then transaction_row.amount
         else -transaction_row.amount
       end), 0))::numeric(14,2) as expected_balance,
       account.balance as stored_balance,
       (account.balance - account.initial_balance - coalesce(sum(case
         when transaction_row.status <> 'posted' then 0
         when transaction_row.kind = 'income' then transaction_row.amount
         else -transaction_row.amount
       end), 0))::numeric(14,2) as drift
  from public.household_accounts account
  left join public.household_account_transactions transaction_row
    on transaction_row.account_id = account.id
 group by account.id, account.household_id, account.initial_balance, account.balance;

alter function public.create_household_account(uuid, text, text, text) owner to postgres;
alter function public.update_household_account(uuid, text, text) owner to postgres;
alter function public.close_household_account(uuid) owner to postgres;
alter function public.create_household_account_income(uuid, text, date, text, text, text) owner to postgres;
alter function public.update_household_account_income(uuid, uuid, text, date, text, text, text) owner to postgres;
alter function public.delete_household_account_income(uuid) owner to postgres;
alter function public.create_shared_expense(uuid, text, uuid, text, date, text, text, jsonb, uuid, text, text) owner to postgres;
alter function public.update_shared_expense(uuid, uuid, text, date, text, text, jsonb, uuid, text, text) owner to postgres;
alter function public.delete_shared_expense(uuid) owner to postgres;
alter function public.update_financial_transaction(uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) owner to postgres;
alter function public.delete_financial_transaction(uuid) owner to postgres;

revoke all on table public.household_account_balance_reconciliation
  from public, anon, authenticated, service_role;

revoke all on function private.parse_exact_money(text, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function private.format_exact_money(numeric) from public, anon, authenticated, service_role;
revoke all on function private.require_active_household_actor(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.initialize_household_account_balance() from public, anon, authenticated, service_role;
revoke all on function private.enforce_household_account_transition() from public, anon, authenticated, service_role;
revoke all on function private.lock_household_accounts(uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.maintain_household_account_balance() from public, anon, authenticated, service_role;
revoke all on function private.touch_household_financial_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.household_account_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_transaction_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.household_expense_payload(uuid) from public, anon, authenticated, service_role;
revoke all on function private.create_household_transaction_core(uuid, uuid, public.transaction_kind, numeric, date, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_household_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.delete_household_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.replace_household_expense_splits(uuid, uuid, text, numeric, uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.create_household_account(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_household_account(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.close_household_account(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_household_account_income(uuid, text, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_household_account_income(uuid, uuid, text, date, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_household_account_income(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_shared_expense(uuid, text, uuid, text, date, text, text, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.update_shared_expense(uuid, uuid, text, date, text, text, jsonb, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.delete_shared_expense(uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_household_account(uuid, text, text, text) to authenticated;
grant execute on function public.update_household_account(uuid, text, text) to authenticated;
grant execute on function public.close_household_account(uuid) to authenticated;
grant execute on function public.create_household_account_income(uuid, text, date, text, text, text) to authenticated;
grant execute on function public.update_household_account_income(uuid, uuid, text, date, text, text, text) to authenticated;
grant execute on function public.delete_household_account_income(uuid) to authenticated;
grant execute on function public.create_shared_expense(uuid, text, uuid, text, date, text, text, jsonb, uuid, text, text) to authenticated;
grant execute on function public.update_shared_expense(uuid, uuid, text, date, text, text, jsonb, uuid, text, text) to authenticated;
grant execute on function public.delete_shared_expense(uuid) to authenticated;

commit;
