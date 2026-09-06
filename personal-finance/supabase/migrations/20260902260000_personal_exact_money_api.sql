-- Exact-money server contracts for personal accounts and transactions.

begin;

create function private.personal_account_payload(p_account_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select (to_jsonb(account) - 'initial_balance' - 'balance') || jsonb_build_object(
    'initial_balance', private.format_exact_money(account.initial_balance),
    'balance', private.format_exact_money(account.balance)
  )
  from public.accounts account
  where account.id = p_account_id and account.user_id = p_user_id
$$;

create function private.personal_transaction_payload(p_transaction_id uuid, p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select (to_jsonb(transaction_row) - 'amount') || jsonb_build_object(
    'amount', private.format_exact_money(transaction_row.amount),
    'category', case when category.id is null then null else jsonb_build_object(
      'id', category.id, 'name', category.name, 'icon', category.icon,
      'color', category.color, 'type', category.type
    ) end,
    'tags', (
      select coalesce(jsonb_agg(jsonb_build_object('tag', jsonb_build_object(
        'id', tag.id, 'name', tag.name, 'color', tag.color
      )) order by tag.name, tag.id), '[]'::jsonb)
      from public.transaction_tags link
      join public.tags tag on tag.id = link.tag_id and tag.user_id = p_user_id
      where link.transaction_id = transaction_row.id
    )
  )
  from public.transactions transaction_row
  left join public.categories category on category.id = transaction_row.category_id
  where transaction_row.id = p_transaction_id and transaction_row.user_id = p_user_id
$$;

create function public.get_personal_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(private.personal_account_payload(account.id, actor_id)
           order by account.created_at, account.id), '[]'::jsonb)
    into result from public.accounts account where account.user_id = actor_id;
  return result;
end
$$;

create function public.get_personal_account(p_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  result := private.personal_account_payload(p_account_id, actor_id);
  if result is null then raise exception 'Account not found' using errcode = 'P0002'; end if;
  return result;
end
$$;

create function public.create_personal_account(
  p_name text, p_type text, p_initial_balance text,
  p_is_shared boolean default false, p_institution text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); account_id uuid; initial_value numeric;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  initial_value := private.parse_exact_money(p_initial_balance, true, true);
  insert into public.accounts(user_id, name, type, initial_balance, currency, is_shared, institution)
  values (actor_id, p_name, p_type, initial_value, 'MXN', p_is_shared, p_institution)
  returning id into account_id;
  return private.personal_account_payload(account_id, actor_id);
end
$$;

create function public.get_personal_transactions(
  p_account_id uuid default null, p_category_id uuid default null,
  p_start_date date default null, p_end_date date default null,
  p_limit integer default 50, p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception 'Invalid transaction page' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(page.payload order by page.date desc, page.created_at desc, page.id desc), '[]'::jsonb)
    into result from (
      select transaction_row.id, transaction_row.date, transaction_row.created_at,
             private.personal_transaction_payload(transaction_row.id, actor_id) as payload
        from public.transactions transaction_row
       where transaction_row.user_id = actor_id
         and (p_account_id is null or transaction_row.account_id = p_account_id)
         and (p_category_id is null or transaction_row.category_id = p_category_id)
         and (p_start_date is null or transaction_row.date >= p_start_date)
         and (p_end_date is null or transaction_row.date <= p_end_date)
       order by transaction_row.date desc, transaction_row.created_at desc, transaction_row.id desc
       limit p_limit offset p_offset
    ) page;
  return result;
end
$$;

create function public.get_personal_transaction(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); result jsonb;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  result := private.personal_transaction_payload(p_transaction_id, actor_id);
  if result is null then raise exception 'Transaction not found' using errcode = 'P0002'; end if;
  return result;
end
$$;

create function public.create_personal_transaction_exact(
  p_account_id uuid, p_kind public.transaction_kind, p_amount text,
  p_date date, p_description text, p_category_id uuid default null,
  p_notes text default null, p_is_shared boolean default false,
  p_split_ratio jsonb default null, p_status text default 'posted',
  p_tag_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); amount_value numeric; transaction_id uuid;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  amount_value := private.parse_exact_money(p_amount, false, false);
  transaction_id := (private.create_financial_transaction_core(
    actor_id, p_account_id, p_kind, amount_value, 'MXN', p_date,
    p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, 'manual', null, p_tag_ids
  )).id;
  return private.personal_transaction_payload(transaction_id, actor_id);
end
$$;

create function public.update_personal_transaction_exact(
  p_transaction_id uuid, p_account_id uuid, p_kind public.transaction_kind,
  p_amount text, p_date date, p_description text, p_category_id uuid,
  p_notes text, p_is_shared boolean, p_split_ratio jsonb,
  p_status text, p_tag_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid(); amount_value numeric;
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  amount_value := private.parse_exact_money(p_amount, false, false);
  perform private.update_financial_transaction_core(
    actor_id, p_transaction_id, p_account_id, p_kind, amount_value, 'MXN',
    p_date, p_description, p_category_id, p_notes, p_is_shared,
    p_split_ratio, p_status, p_tag_ids
  );
  return private.personal_transaction_payload(p_transaction_id, actor_id);
end
$$;

-- The unchecked primitives are private implementation details. Personal entrypoints
-- always use the guarded cores below; Household may use these only after proving
-- that it owns the exact linked source row inside the same transaction.
alter function private.update_financial_transaction_core(
  uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid,
  text, boolean, jsonb, text, uuid[]
) rename to update_financial_transaction_unchecked_core;

alter function private.delete_financial_transaction_core(uuid, uuid)
  rename to delete_financial_transaction_unchecked_core;

create function private.update_financial_transaction_core(
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
  ) then
    raise exception 'Linked shared expense must be mutated through its Household RPC'
      using errcode = '23514';
  end if;
  return private.update_financial_transaction_unchecked_core(
    p_user_id, p_id, p_account_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, p_tag_ids
  );
end
$$;

create function private.delete_financial_transaction_core(p_user_id uuid, p_id uuid)
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
  ) then
    raise exception 'Linked shared expense must be mutated through its Household RPC'
      using errcode = '23514';
  end if;
  return private.delete_financial_transaction_unchecked_core(p_user_id, p_id);
end
$$;

create function private.assert_household_personal_source(
  p_expense_id uuid, p_actor_id uuid, p_transaction_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform 1 from public.household_expenses expense
   where expense.id = p_expense_id
     and expense.funding_source = 'personal_account'
     and expense.personal_payer_user_id = p_actor_id
     and expense.personal_transaction_id = p_transaction_id
   for update;
  if not found then raise exception 'Household expense not found' using errcode = 'P0002'; end if;
end
$$;

create or replace function public.update_shared_expense(
  p_expense_id uuid, p_source_account_id uuid, p_amount text, p_date date,
  p_description text, p_split_mode text, p_splits jsonb, p_category_id uuid,
  p_notes text, p_status text
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
    perform private.assert_household_personal_source(
      p_expense_id, actor_id, expense_row.personal_transaction_id
    );
    perform private.update_financial_transaction_unchecked_core(
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

create or replace function public.delete_shared_expense(p_expense_id uuid)
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
  if expense_row.funding_source = 'personal_account' then
    perform private.assert_household_personal_source(
      p_expense_id, actor_id, expense_row.personal_transaction_id
    );
  end if;
  delete from public.household_expenses where id = p_expense_id;
  if expense_row.funding_source = 'personal_account' then
    perform private.delete_financial_transaction_unchecked_core(
      actor_id, expense_row.personal_transaction_id
    );
  else
    perform private.delete_household_transaction_core(
      expense_row.household_account_transaction_id, expense_row.household_id
    );
  end if;
  return p_expense_id;
end
$$;

create function public.delete_personal_transaction(p_transaction_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return private.delete_financial_transaction_core(actor_id, p_transaction_id);
end
$$;

alter function public.get_personal_accounts() owner to postgres;
alter function public.get_personal_account(uuid) owner to postgres;
alter function public.create_personal_account(text, text, text, boolean, text) owner to postgres;
alter function public.get_personal_transactions(uuid, uuid, date, date, integer, integer) owner to postgres;
alter function public.get_personal_transaction(uuid) owner to postgres;
alter function public.create_personal_transaction_exact(uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) owner to postgres;
alter function public.update_personal_transaction_exact(uuid, uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) owner to postgres;
alter function public.delete_personal_transaction(uuid) owner to postgres;

revoke insert on table public.accounts from public, anon, authenticated, service_role;
revoke insert (
  id, user_id, name, type, balance, initial_balance, currency, is_shared,
  institution, last_synced_at, created_at
) on public.accounts from public, anon, authenticated, service_role;
revoke update on table public.accounts from public, anon, authenticated, service_role;
revoke update (
  id, user_id, name, type, balance, initial_balance, currency, is_shared,
  institution, last_synced_at, created_at
) on public.accounts from public, anon, authenticated, service_role;
grant update (name, type, is_shared, institution) on public.accounts to authenticated;

revoke all on function private.personal_account_payload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.personal_transaction_payload(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_personal_accounts() from public, anon, authenticated, service_role;
revoke all on function public.get_personal_account(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_personal_account(text, text, text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.get_personal_transactions(uuid, uuid, date, date, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.get_personal_transaction(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_personal_transaction_exact(uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.update_personal_transaction_exact(uuid, uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.delete_personal_transaction(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_financial_transaction(uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, text, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.update_financial_transaction(uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.delete_financial_transaction(uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_financial_transaction_unchecked_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.delete_financial_transaction_unchecked_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_financial_transaction_core(uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.delete_financial_transaction_core(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.assert_household_personal_source(uuid, uuid, uuid) from public, anon, authenticated, service_role;

grant execute on function public.get_personal_accounts() to authenticated;
grant execute on function public.get_personal_account(uuid) to authenticated;
grant execute on function public.create_personal_account(text, text, text, boolean, text) to authenticated;
grant execute on function public.get_personal_transactions(uuid, uuid, date, date, integer, integer) to authenticated;
grant execute on function public.get_personal_transaction(uuid) to authenticated;
grant execute on function public.create_personal_transaction_exact(uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) to authenticated;
grant execute on function public.update_personal_transaction_exact(uuid, uuid, public.transaction_kind, text, date, text, uuid, text, boolean, jsonb, text, uuid[]) to authenticated;
grant execute on function public.delete_personal_transaction(uuid) to authenticated;

commit;
