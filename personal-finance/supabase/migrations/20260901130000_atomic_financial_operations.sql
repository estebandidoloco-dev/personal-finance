-- Atomic financial operations.
-- Transactions are the ledger; accounts.balance is a PostgreSQL-maintained cache.

create type public.transaction_kind as enum ('income', 'expense');

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.transaction_impact(
  p_kind public.transaction_kind,
  p_amount numeric,
  p_status text
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status <> 'posted' then 0::numeric
    when p_kind = 'income' then p_amount
    else -p_amount
  end
$$;

revoke all on function private.transaction_impact(public.transaction_kind, numeric, text)
  from public, anon, authenticated;

alter table public.accounts
  add column initial_balance numeric(14,2) not null default 0;

alter table public.transactions
  add column kind public.transaction_kind;

-- Do not silently reinterpret ambiguous or malformed historical financial data.
do $$
begin
  if exists (select 1 from public.accounts where balance is null or currency is null) then
    raise exception 'Atomic ledger migration requires non-null account balances and currencies';
  end if;

  if exists (
    select 1
    from public.accounts
    where currency !~ '^[A-Z]{3}$'
  ) then
    raise exception 'Atomic ledger migration requires account currencies in ISO-like uppercase format';
  end if;

  if exists (
    select 1
    from public.transactions transaction_row
    join public.accounts account on account.id = transaction_row.account_id
    where transaction_row.amount = 0
       or transaction_row.status is null
       or transaction_row.currency is null
       or transaction_row.currency <> account.currency
  ) then
    raise exception 'Atomic ledger migration requires non-zero amounts, statuses, and matching currencies';
  end if;
end
$$;

-- Historical signed amounts are normalized before the positive-amount constraint is installed.
update public.transactions
set kind = case when amount < 0 then 'expense'::public.transaction_kind
                else 'income'::public.transaction_kind end;

update public.transactions
set amount = abs(amount);

-- Bootstrap initial_balance from the current snapshot without asserting that the snapshot is
-- externally correct. This preserves stored balances at migration time. The reconciliation view
-- below must be reviewed before any remote rollout and remains available to detect future drift.
with ledger as (
  select transaction_row.account_id,
         coalesce(sum(private.transaction_impact(
           transaction_row.kind,
           transaction_row.amount,
           transaction_row.status
         )), 0)::numeric(14,2) as ledger_impact
  from public.transactions transaction_row
  group by transaction_row.account_id
)
update public.accounts account
set initial_balance = account.balance - coalesce(ledger.ledger_impact, 0)
from ledger
where ledger.account_id = account.id;

-- Accounts without transactions keep their existing balance as the accounting starting point.
update public.accounts account
set initial_balance = account.balance
where not exists (
  select 1 from public.transactions transaction_row where transaction_row.account_id = account.id
);

alter table public.accounts
  alter column balance set not null,
  alter column currency set not null,
  add constraint accounts_currency_format_check check (currency ~ '^[A-Z]{3}$');

alter table public.transactions
  alter column kind set not null,
  alter column currency set not null,
  alter column status set not null,
  add constraint transactions_amount_positive_check check (amount > 0),
  add constraint transactions_currency_format_check check (currency ~ '^[A-Z]{3}$'),
  add constraint transactions_description_length_check
    check (char_length(description) between 1 and 200),
  add constraint transactions_notes_length_check
    check (notes is null or char_length(notes) <= 2000);

comment on column public.accounts.initial_balance is
  'Accounting starting point. Bootstrapped from the pre-migration balance snapshot minus ledger impact.';
comment on column public.accounts.balance is
  'Derived cache maintained by the transaction ledger trigger. Clients must not update it directly.';
comment on column public.transactions.amount is
  'Positive magnitude. Accounting sign is determined by kind.';

-- Backward-compatible account creation: the legacy client may still send balance as the opening
-- value. New clients should send initial_balance. In both cases stored balance is forced to equal
-- initial_balance at insert time.
create function private.initialize_account_balance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.initial_balance = 0 and new.balance <> 0 then
    new.initial_balance := new.balance;
  end if;
  new.balance := new.initial_balance;
  return new;
end
$$;

revoke all on function private.initialize_account_balance() from public, anon, authenticated;

create trigger accounts_initialize_balance
  before insert on public.accounts
  for each row execute function private.initialize_account_balance();

-- Account currency is editable only while the account has no ledger entries.
create function private.prevent_account_currency_change_with_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.currency is distinct from old.currency
     and exists (
       select 1
       from public.transactions transaction_row
       where transaction_row.account_id = old.id
     ) then
    raise exception 'Account currency cannot change after ledger entries exist'
      using errcode = '23514';
  end if;
  return new;
end
$$;

revoke all on function private.prevent_account_currency_change_with_ledger()
  from public, anon, authenticated;

create trigger accounts_prevent_currency_change_with_ledger
  before update of currency on public.accounts
  for each row execute function private.prevent_account_currency_change_with_ledger();

-- Lock every affected account in UUID order. Both the RPC path and privileged direct ledger writes
-- reach this primitive through the mandatory ledger trigger.
create function private.lock_accounts(p_account_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  expected_count integer;
  locked_count integer := 0;
  locked_account_id uuid;
begin
  select count(distinct account_id)
    into expected_count
    from unnest(p_account_ids) account_id
   where account_id is not null;

  for locked_account_id in
    select account.id
    from public.accounts account
    where account.id = any(p_account_ids)
    order by account.id
    for no key update
  loop
    locked_count := locked_count + 1;
  end loop;

  if locked_count <> expected_count then
    raise exception 'One or more ledger accounts do not exist'
      using errcode = '23503';
  end if;
end
$$;

revoke all on function private.lock_accounts(uuid[]) from public, anon, authenticated;

-- Mandatory structural balance maintenance for INSERT, UPDATE and DELETE on the ledger.
create function private.maintain_account_balance_from_ledger()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_impact numeric := 0;
  new_impact numeric := 0;
  new_account_currency text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_impact := private.transaction_impact(old.kind, old.amount, old.status);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    new_impact := private.transaction_impact(new.kind, new.amount, new.status);
  end if;

  if tg_op = 'INSERT' then
    perform private.lock_accounts(array[new.account_id]);
  elsif tg_op = 'DELETE' then
    perform private.lock_accounts(array[old.account_id]);
  else
    perform private.lock_accounts(array[old.account_id, new.account_id]);
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select account.currency
      into new_account_currency
      from public.accounts account
     where account.id = new.account_id;

    if new.currency <> new_account_currency then
      raise exception 'Transaction currency % does not match account currency %',
        new.currency, new_account_currency
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    update public.accounts
       set balance = balance + new_impact
     where id = new.account_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.accounts
       set balance = balance - old_impact
     where id = old.account_id;
    return old;
  elsif old.account_id = new.account_id then
    update public.accounts
       set balance = balance + (new_impact - old_impact)
     where id = new.account_id;
  else
    update public.accounts
       set balance = balance - old_impact
     where id = old.account_id;

    update public.accounts
       set balance = balance + new_impact
     where id = new.account_id;
  end if;

  return new;
end
$$;

revoke all on function private.maintain_account_balance_from_ledger()
  from public, anon, authenticated;

create trigger transactions_maintain_account_balance
  after insert or update or delete on public.transactions
  for each row execute function private.maintain_account_balance_from_ledger();

create function private.touch_transaction_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

revoke all on function private.touch_transaction_updated_at() from public, anon, authenticated;

create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function private.touch_transaction_updated_at();

create function private.validate_financial_resources(
  p_user_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_currency text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  account_currency text;
  category_owner uuid;
begin
  select account.currency
    into account_currency
    from public.accounts account
   where account.id = p_account_id
     and account.user_id = p_user_id;

  if not found then
    raise exception 'Account not found'
      using errcode = 'P0002';
  end if;

  if p_currency <> account_currency then
    raise exception 'Transaction currency % does not match account currency %',
      p_currency, account_currency
      using errcode = '23514';
  end if;

  if p_category_id is not null then
    select category.user_id
      into category_owner
      from public.categories category
     where category.id = p_category_id;

    if not found then
      raise exception 'Category not found'
        using errcode = 'P0002';
    end if;

    if category_owner is not null and category_owner <> p_user_id then
      raise exception 'Category does not belong to the authenticated user'
        using errcode = '23514';
    end if;
  end if;
end
$$;

revoke all on function private.validate_financial_resources(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create function private.replace_transaction_tags(
  p_transaction_id uuid,
  p_user_id uuid,
  p_tag_ids uuid[]
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  normalized_tag_ids uuid[] := coalesce(p_tag_ids, '{}'::uuid[]);
  supplied_count integer;
  distinct_count integer;
  owned_count integer;
begin
  supplied_count := cardinality(normalized_tag_ids);

  if supplied_count > 50 then
    raise exception 'A transaction can have at most 50 tags'
      using errcode = '23514';
  end if;

  if array_position(normalized_tag_ids, null) is not null then
    raise exception 'Tag IDs cannot contain null values'
      using errcode = '23514';
  end if;

  select count(distinct tag_id)
    into distinct_count
    from unnest(normalized_tag_ids) tag_id;

  if distinct_count <> supplied_count then
    raise exception 'Tag IDs must be unique'
      using errcode = '23514';
  end if;

  select count(*)
    into owned_count
    from public.tags tag
   where tag.id = any(normalized_tag_ids)
     and tag.user_id = p_user_id;

  if owned_count <> supplied_count then
    raise exception 'One or more tags do not belong to the authenticated user'
      using errcode = '23514';
  end if;

  delete from public.transaction_tags link
   where link.transaction_id = p_transaction_id;

  insert into public.transaction_tags(transaction_id, tag_id)
  select p_transaction_id, tag_id
  from unnest(normalized_tag_ids) tag_id;
end
$$;

revoke all on function private.replace_transaction_tags(uuid, uuid, uuid[])
  from public, anon, authenticated;

-- Internal primitives are reused by the small public RPC wrappers and can later be reused by a
-- batch importer without duplicating accounting logic.
create function private.create_financial_transaction_core(
  p_user_id uuid,
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
  p_source text,
  p_external_id text,
  p_tag_ids uuid[]
)
returns public.transactions
language plpgsql
set search_path = ''
as $$
declare
  created_transaction public.transactions;
begin
  perform private.validate_financial_resources(
    p_user_id, p_account_id, p_category_id, p_currency
  );

  insert into public.transactions(
    user_id, account_id, category_id, kind, amount, currency, date,
    description, notes, is_shared, split_ratio, status, source, external_id
  ) values (
    p_user_id, p_account_id, p_category_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_notes, p_is_shared, p_split_ratio, p_status, p_source, p_external_id
  )
  returning * into created_transaction;

  -- Validation happens after the ledger write so any tag failure proves full transaction rollback.
  perform private.replace_transaction_tags(created_transaction.id, p_user_id, p_tag_ids);

  return created_transaction;
end
$$;

revoke all on function private.create_financial_transaction_core(
  uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text,
  boolean, jsonb, text, text, text, uuid[]
) from public, anon, authenticated;

create function private.update_financial_transaction_core(
  p_user_id uuid,
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
set search_path = ''
as $$
declare
  existing_transaction public.transactions;
  updated_transaction public.transactions;
begin
  select transaction_row.*
    into existing_transaction
    from public.transactions transaction_row
   where transaction_row.id = p_id
     and transaction_row.user_id = p_user_id
   for update;

  if not found then
    raise exception 'Transaction not found'
      using errcode = 'P0002';
  end if;

  perform private.validate_financial_resources(
    p_user_id, p_account_id, p_category_id, p_currency
  );

  update public.transactions
     set account_id = p_account_id,
         category_id = p_category_id,
         kind = p_kind,
         amount = p_amount,
         currency = p_currency,
         date = p_date,
         description = p_description,
         notes = p_notes,
         is_shared = p_is_shared,
         split_ratio = p_split_ratio,
         status = p_status
   where id = p_id
  returning * into updated_transaction;

  perform private.replace_transaction_tags(p_id, p_user_id, p_tag_ids);

  return updated_transaction;
end
$$;

revoke all on function private.update_financial_transaction_core(
  uuid, uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid,
  text, boolean, jsonb, text, uuid[]
) from public, anon, authenticated;

create function private.delete_financial_transaction_core(p_user_id uuid, p_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  delete from public.transactions transaction_row
   where transaction_row.id = p_id
     and transaction_row.user_id = p_user_id
  returning transaction_row.id into deleted_id;

  if deleted_id is null then
    raise exception 'Transaction not found'
      using errcode = 'P0002';
  end if;

  return deleted_id;
end
$$;

revoke all on function private.delete_financial_transaction_core(uuid, uuid)
  from public, anon, authenticated;

create function public.create_financial_transaction(
  p_account_id uuid,
  p_kind public.transaction_kind,
  p_amount numeric,
  p_currency text,
  p_date date,
  p_description text,
  p_category_id uuid default null,
  p_notes text default null,
  p_is_shared boolean default false,
  p_split_ratio jsonb default null,
  p_status text default 'posted',
  p_source text default 'manual',
  p_external_id text default null,
  p_tag_ids uuid[] default '{}'::uuid[]
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
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  return private.create_financial_transaction_core(
    authenticated_user_id, p_account_id, p_kind, p_amount, p_currency, p_date,
    p_description, p_category_id, p_notes, p_is_shared, p_split_ratio, p_status,
    p_source, p_external_id, p_tag_ids
  );
end
$$;

create function public.update_financial_transaction(
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
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  return private.update_financial_transaction_core(
    authenticated_user_id, p_id, p_account_id, p_kind, p_amount, p_currency,
    p_date, p_description, p_category_id, p_notes, p_is_shared, p_split_ratio,
    p_status, p_tag_ids
  );
end
$$;

create function public.delete_financial_transaction(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;

  return private.delete_financial_transaction_core(authenticated_user_id, p_id);
end
$$;

revoke all on function public.create_financial_transaction(
  uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean,
  jsonb, text, text, text, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.update_financial_transaction(
  uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text,
  boolean, jsonb, text, uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.delete_financial_transaction(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_financial_transaction(
  uuid, public.transaction_kind, numeric, text, date, text, uuid, text, boolean,
  jsonb, text, text, text, uuid[]
) to authenticated;
grant execute on function public.update_financial_transaction(
  uuid, uuid, public.transaction_kind, numeric, text, date, text, uuid, text,
  boolean, jsonb, text, uuid[]
) to authenticated;
grant execute on function public.delete_financial_transaction(uuid)
  to authenticated;

-- Clients may read their ledger but all writes must pass through the atomic RPCs.
drop policy if exists "transactions_insert_own" on public.transactions;
drop policy if exists "transactions_update_own" on public.transactions;
drop policy if exists "transactions_delete_own" on public.transactions;
drop policy if exists "transaction_tags_insert_own" on public.transaction_tags;
drop policy if exists "transaction_tags_update_own" on public.transaction_tags;
drop policy if exists "transaction_tags_delete_own" on public.transaction_tags;

revoke insert, update, delete on public.transactions from anon, authenticated;
revoke insert, update, delete on public.transaction_tags from anon, authenticated;

-- Remove table-level account mutation grants before granting an explicit column allowlist.
revoke insert, update on public.accounts from anon, authenticated;
grant insert (
  user_id, name, type, balance, initial_balance, currency, is_shared, institution
) on public.accounts to authenticated;
grant update (
  name, type, currency, is_shared, institution, last_synced_at
) on public.accounts to authenticated;

-- Security-invoker reconciliation keeps each user scoped by the underlying RLS policies.
create view public.account_balance_reconciliation
with (security_invoker = true)
as
select account.id as account_id,
       account.user_id,
       account.initial_balance,
       coalesce(sum(case
         when transaction_row.status <> 'posted' then 0
         when transaction_row.kind = 'income' then transaction_row.amount
         when transaction_row.kind = 'expense' then -transaction_row.amount
         else 0
       end), 0)::numeric(14,2) as ledger_impact,
       (
         account.initial_balance
         + coalesce(sum(case
             when transaction_row.status <> 'posted' then 0
             when transaction_row.kind = 'income' then transaction_row.amount
             when transaction_row.kind = 'expense' then -transaction_row.amount
             else 0
           end), 0)
       )::numeric(14,2) as expected_balance,
       account.balance as stored_balance,
       (
         account.balance
         - account.initial_balance
         - coalesce(sum(case
             when transaction_row.status <> 'posted' then 0
             when transaction_row.kind = 'income' then transaction_row.amount
             when transaction_row.kind = 'expense' then -transaction_row.amount
             else 0
           end), 0)
       )::numeric(14,2) as drift
from public.accounts account
left join public.transactions transaction_row on transaction_row.account_id = account.id
group by account.id, account.user_id, account.initial_balance, account.balance;

revoke all on public.account_balance_reconciliation from public, anon, authenticated;
grant select on public.account_balance_reconciliation to authenticated;
