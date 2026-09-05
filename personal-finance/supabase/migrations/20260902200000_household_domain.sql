-- P1.4 phase 1: isolated Household domain and structural integrity.
-- Authorization and public mutation entrypoints are added by later migrations.

begin;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'MXN',
  status text not null default 'forming',
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  closed_at timestamptz,
  constraint households_name_check check (btrim(name) <> '' and char_length(name) <= 100),
  constraint households_currency_format_check check (currency ~ '^[A-Z]{3}$'),
  constraint households_status_check check (status in ('forming', 'active', 'closed')),
  constraint households_timestamps_check check (
    (status = 'forming' and activated_at is null and closed_at is null)
    or (status = 'active' and activated_at is not null and closed_at is null)
    or (status = 'closed' and closed_at is not null)
  ),
  constraint households_timestamp_order_check check (
    (activated_at is null or activated_at >= created_at)
    and (closed_at is null or closed_at >= created_at)
    and (activated_at is null or closed_at is null or closed_at >= activated_at)
  )
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'current',
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (household_id, user_id),
  constraint household_members_status_check check (status in ('current', 'archived', 'removed')),
  constraint household_members_ended_at_check check (
    (status = 'current' and ended_at is null)
    or (status in ('archived', 'removed') and ended_at is not null)
  ),
  constraint household_members_timestamp_order_check check (ended_at is null or ended_at >= joined_at)
);

create unique index household_members_one_current_per_user
  on public.household_members(user_id)
  where status = 'current';

alter table public.households
  add constraint households_creator_membership_fkey
  foreign key (id, created_by_user_id)
  references public.household_members(household_id, user_id)
  on delete no action
  deferrable initially deferred;

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  invited_by_user_id uuid not null references public.profiles(id) on delete restrict,
  invited_email text not null,
  token_hash bytea not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved_at timestamptz,
  constraint household_invitations_email_check check (
    invited_email = lower(btrim(invited_email))
    and char_length(invited_email) between 3 and 320
    and invited_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint household_invitations_token_hash_check check (octet_length(token_hash) = 32),
  constraint household_invitations_status_check check (
    status in ('pending', 'accepted', 'rejected', 'revoked', 'expired')
  ),
  constraint household_invitations_expiry_check check (expires_at > created_at),
  constraint household_invitations_resolution_check check (
    (status = 'pending' and resolved_at is null)
    or (status <> 'pending' and resolved_at is not null and resolved_at >= created_at)
  ),
  constraint household_invitations_inviter_membership_fkey
    foreign key (household_id, invited_by_user_id)
    references public.household_members(household_id, user_id)
    on delete restrict
);

create unique index household_invitations_token_hash_unique
  on public.household_invitations(token_hash);
create unique index household_invitations_one_pending_per_household
  on public.household_invitations(household_id)
  where status = 'pending';

create table public.household_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  name text not null,
  type text not null,
  initial_balance numeric(14,2) not null default 0,
  balance numeric(14,2) not null default 0,
  currency text not null default 'MXN',
  status text not null default 'active',
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint household_accounts_id_household_unique unique (id, household_id),
  constraint household_accounts_name_check check (btrim(name) <> '' and char_length(name) <= 100),
  constraint household_accounts_type_check check (
    type in ('checking', 'savings', 'credit', 'cash', 'investment', 'other')
  ),
  constraint household_accounts_currency_format_check check (currency ~ '^[A-Z]{3}$'),
  constraint household_accounts_status_check check (status in ('active', 'closed')),
  constraint household_accounts_closed_at_check check (
    (status = 'active' and closed_at is null)
    or (status = 'closed' and closed_at is not null and closed_at >= created_at)
  ),
  constraint household_accounts_creator_membership_fkey
    foreign key (household_id, created_by_user_id)
    references public.household_members(household_id, user_id)
    on delete restrict
);

create table public.household_account_transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  account_id uuid not null,
  kind public.transaction_kind not null,
  amount numeric(14,2) not null,
  currency text not null,
  date date not null,
  description text not null,
  notes text,
  status text not null default 'posted',
  recorded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_account_transactions_id_household_unique unique (id, household_id),
  constraint household_account_transactions_account_fkey
    foreign key (account_id, household_id)
    references public.household_accounts(id, household_id)
    on delete restrict,
  constraint household_account_transactions_amount_check check (amount > 0),
  constraint household_account_transactions_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint household_account_transactions_description_check check (
    btrim(description) <> '' and char_length(description) <= 200
  ),
  constraint household_account_transactions_notes_check check (
    notes is null or char_length(notes) <= 2000
  ),
  constraint household_account_transactions_status_check check (
    status in ('pending', 'posted', 'cancelled', 'duplicate')
  ),
  constraint household_account_transactions_recorder_membership_fkey
    foreign key (household_id, recorded_by_user_id)
    references public.household_members(household_id, user_id)
    on delete restrict
);

alter table public.transactions
  add constraint transactions_id_user_id_unique unique (id, user_id);

create table public.household_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  funding_source text not null,
  personal_payer_user_id uuid,
  recorded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  personal_transaction_id uuid,
  household_account_transaction_id uuid,
  split_mode text not null,
  category_id uuid references public.categories(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint household_expenses_funding_source_check check (
    funding_source in ('personal_account', 'household_account')
  ),
  constraint household_expenses_split_mode_check check (split_mode in ('equal', 'custom')),
  constraint household_expenses_exact_source_check check (
    (
      funding_source = 'personal_account'
      and personal_payer_user_id is not null
      and personal_transaction_id is not null
      and household_account_transaction_id is null
    )
    or
    (
      funding_source = 'household_account'
      and personal_payer_user_id is null
      and personal_transaction_id is null
      and household_account_transaction_id is not null
    )
  ),
  constraint household_expenses_personal_source_fkey
    foreign key (personal_transaction_id, personal_payer_user_id)
    references public.transactions(id, user_id)
    on delete restrict,
  constraint household_expenses_household_source_fkey
    foreign key (household_account_transaction_id, household_id)
    references public.household_account_transactions(id, household_id)
    on delete restrict,
  constraint household_expenses_payer_membership_fkey
    foreign key (household_id, personal_payer_user_id)
    references public.household_members(household_id, user_id)
    on delete restrict,
  constraint household_expenses_recorder_membership_fkey
    foreign key (household_id, recorded_by_user_id)
    references public.household_members(household_id, user_id)
    on delete restrict,
  constraint household_expenses_personal_source_unique unique (personal_transaction_id),
  constraint household_expenses_household_source_unique unique (household_account_transaction_id)
);

create table public.household_expense_splits (
  household_expense_id uuid not null references public.household_expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(14,2) not null,
  primary key (household_expense_id, user_id),
  constraint household_expense_splits_amount_check check (amount >= 0)
);

create function private.enforce_household_status_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'Closed Household is terminal' using errcode = '23514';
  end if;
  if old.status = 'active' and new.status = 'forming' then
    raise exception 'Active Household cannot return to forming' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger households_enforce_status_transition
  before update of status on public.households
  for each row execute function private.enforce_household_status_transition();

create function private.enforce_household_member_transition_and_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.household_id is distinct from old.household_id
       or new.user_id is distinct from old.user_id then
      raise exception 'Household membership identity is immutable' using errcode = '23514';
    end if;
    if old.status = 'removed' and new.status is distinct from old.status then
      raise exception 'Removed membership cannot transition' using errcode = '23514';
    end if;
    if old.status = 'archived' and new.status not in ('archived', 'removed') then
      raise exception 'Archived membership may only transition to removed'
        using errcode = '23514';
    end if;
  end if;

  if new.status = 'current' then
    perform 1 from public.households
     where id = new.household_id
     for update;
    if not found then
      raise exception 'Household does not exist' using errcode = '23503';
    end if;

    select count(*)
      into current_count
      from public.household_members member_row
     where member_row.household_id = new.household_id
       and member_row.status = 'current'
       and member_row.user_id <> new.user_id;
    if current_count >= 2 then
      raise exception 'Household cannot have more than two current members' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger household_members_enforce_transition_and_capacity
  before insert or update of household_id, user_id, status
  on public.household_members
  for each row execute function private.enforce_household_member_transition_and_capacity();

create function private.validate_household_state(p_household_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  household_status text;
  current_count integer;
  pending_count integer;
begin
  select household.status
    into household_status
    from public.households household
   where household.id = p_household_id;
  if not found then return; end if;

  select count(*) into current_count
    from public.household_members member_row
   where member_row.household_id = p_household_id
     and member_row.status = 'current';
  select count(*) into pending_count
    from public.household_invitations invitation
   where invitation.household_id = p_household_id
     and invitation.status = 'pending';

  if (household_status = 'forming' and current_count <> 1)
     or (household_status = 'active' and current_count <> 2)
     or (household_status = 'closed' and current_count <> 0) then
    raise exception 'Household % has invalid current member count % for status %',
      p_household_id, current_count, household_status using errcode = '23514';
  end if;
  if household_status in ('active', 'closed') and pending_count <> 0 then
    raise exception 'Household % cannot keep pending invitations while %',
      p_household_id, household_status using errcode = '23514';
  end if;
end
$$;

create function private.validate_household_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.validate_household_state(old.household_id);
  else
    perform private.validate_household_state(new.household_id);
    if tg_op = 'UPDATE' and old.household_id is distinct from new.household_id then
      perform private.validate_household_state(old.household_id);
    end if;
  end if;
  return null;
end
$$;

create constraint trigger household_members_validate_household_state
  after insert or update or delete on public.household_members
  deferrable initially deferred
  for each row execute function private.validate_household_state_trigger();

create constraint trigger household_invitations_validate_household_state
  after insert or update or delete on public.household_invitations
  deferrable initially deferred
  for each row execute function private.validate_household_state_trigger();

create function private.validate_household_row_state_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_household_state(new.id);
  return null;
end
$$;

create constraint trigger households_validate_household_state
  after insert or update of status on public.households
  deferrable initially deferred
  for each row execute function private.validate_household_row_state_trigger();

create function private.enforce_active_household_financial_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_household_id uuid;
  household_status text;
begin
  if tg_table_name = 'household_expense_splits' then
    if tg_op = 'UPDATE'
       and old.household_expense_id is distinct from new.household_expense_id then
      raise exception 'Household expense split identity is immutable' using errcode = '23514';
    end if;
    select expense.household_id
      into target_household_id
      from public.household_expenses expense
     where expense.id = case when tg_op = 'DELETE'
                             then old.household_expense_id
                             else new.household_expense_id end;
    if target_household_id is null and tg_op = 'DELETE' then
      return old;
    end if;
  else
    if tg_op = 'UPDATE' and old.household_id is distinct from new.household_id then
      raise exception 'Household financial ownership is immutable' using errcode = '23514';
    end if;
    target_household_id := case when tg_op = 'DELETE'
                                then old.household_id
                                else new.household_id end;
  end if;

  select household.status
    into household_status
    from public.households household
   where household.id = target_household_id
   for share;
  if not found then
    raise exception 'Household does not exist' using errcode = '23503';
  end if;
  if household_status <> 'active' then
    raise exception 'Household financial writes require an active Household'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger household_accounts_require_active_household
  before insert or update or delete on public.household_accounts
  for each row execute function private.enforce_active_household_financial_write();

create trigger household_account_transactions_require_active_household
  before insert or update or delete on public.household_account_transactions
  for each row execute function private.enforce_active_household_financial_write();

create trigger household_expenses_require_active_household
  before insert or update or delete on public.household_expenses
  for each row execute function private.enforce_active_household_financial_write();

create trigger household_expense_splits_require_active_household
  before insert or update or delete on public.household_expense_splits
  for each row execute function private.enforce_active_household_financial_write();

create function private.validate_household_account_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  account_currency text;
begin
  select account.currency
    into account_currency
    from public.household_accounts account
   where account.id = new.account_id
     and account.household_id = new.household_id;
  if not found then
    raise exception 'Household account does not exist' using errcode = '23503';
  end if;
  if new.currency is distinct from account_currency then
    raise exception 'Household transaction currency does not match account currency'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger household_account_transactions_validate_account
  before insert or update of household_id, account_id, currency
  on public.household_account_transactions
  for each row execute function private.validate_household_account_transaction();

create function private.validate_household_expense()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  category_owner uuid;
  source_kind public.transaction_kind;
begin
  if new.category_id is not null then
    select category.user_id into category_owner
      from public.categories category
     where category.id = new.category_id;
    if not found then
      raise exception 'Category does not exist' using errcode = '23503';
    end if;
    if category_owner is not null then
      raise exception 'Household expenses may use only global categories'
        using errcode = '23514';
    end if;
  end if;

  if new.funding_source = 'personal_account' then
    select transaction_row.kind into source_kind
      from public.transactions transaction_row
     where transaction_row.id = new.personal_transaction_id
       and transaction_row.user_id = new.personal_payer_user_id;
  else
    select transaction_row.kind into source_kind
      from public.household_account_transactions transaction_row
     where transaction_row.id = new.household_account_transaction_id
       and transaction_row.household_id = new.household_id;
  end if;
  if source_kind is distinct from 'expense'::public.transaction_kind then
    raise exception 'Household expense source must be an expense transaction'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger household_expenses_validate_source_and_category
  before insert or update of funding_source, personal_payer_user_id,
    personal_transaction_id, household_account_transaction_id, household_id, category_id
  on public.household_expenses
  for each row execute function private.validate_household_expense();

create function private.validate_household_expense_splits(p_expense_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expense_household_id uuid;
  source_amount numeric;
  split_count integer;
  split_total numeric;
begin
  select expense.household_id,
         case
           when expense.funding_source = 'personal_account' then personal_transaction.amount
           else household_transaction.amount
         end
    into expense_household_id, source_amount
    from public.household_expenses expense
    left join public.transactions personal_transaction
      on personal_transaction.id = expense.personal_transaction_id
     and personal_transaction.user_id = expense.personal_payer_user_id
    left join public.household_account_transactions household_transaction
      on household_transaction.id = expense.household_account_transaction_id
     and household_transaction.household_id = expense.household_id
   where expense.id = p_expense_id;
  if not found then return; end if;

  select count(*), coalesce(sum(split.amount), 0)
    into split_count, split_total
    from public.household_expense_splits split
   where split.household_expense_id = p_expense_id;

  if split_count <> 2 then
    raise exception 'Household expense must have exactly two splits' using errcode = '23514';
  end if;
  if split_total is distinct from source_amount then
    raise exception 'Household expense splits must equal source amount' using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.household_expense_splits split
      left join public.household_members member_row
        on member_row.household_id = expense_household_id
       and member_row.user_id = split.user_id
     where split.household_expense_id = p_expense_id
       and member_row.user_id is null
  ) then
    raise exception 'Household expense splits must belong to Household members'
      using errcode = '23514';
  end if;
end
$$;

create function private.validate_household_expense_splits_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.validate_household_expense_splits(old.household_expense_id);
  else
    perform private.validate_household_expense_splits(new.household_expense_id);
    if tg_op = 'UPDATE'
       and old.household_expense_id is distinct from new.household_expense_id then
      perform private.validate_household_expense_splits(old.household_expense_id);
    end if;
  end if;
  return null;
end
$$;

create constraint trigger household_expense_splits_validate_complete
  after insert or update or delete on public.household_expense_splits
  deferrable initially deferred
  for each row execute function private.validate_household_expense_splits_trigger();

create function private.validate_household_expense_complete_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.validate_household_expense_splits(new.id);
  return null;
end
$$;

create constraint trigger household_expenses_validate_complete_splits
  after insert or update on public.household_expenses
  deferrable initially deferred
  for each row execute function private.validate_household_expense_complete_trigger();

create function private.validate_personal_household_expense_source_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_id uuid;
begin
  for expense_id in
    select expense.id
      from public.household_expenses expense
     where expense.personal_transaction_id = new.id
  loop
    if new.kind is distinct from 'expense'::public.transaction_kind then
      raise exception 'Household expense source must remain an expense transaction'
        using errcode = '23514';
    end if;
    perform private.validate_household_expense_splits(expense_id);
  end loop;
  return null;
end
$$;

create constraint trigger transactions_validate_linked_household_expense
  after update on public.transactions
  deferrable initially deferred
  for each row execute function private.validate_personal_household_expense_source_trigger();

create function private.validate_household_expense_source_transaction_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expense_id uuid;
begin
  for expense_id in
    select expense.id
      from public.household_expenses expense
     where expense.household_account_transaction_id = new.id
  loop
    if new.kind is distinct from 'expense'::public.transaction_kind then
      raise exception 'Household expense source must remain an expense transaction'
        using errcode = '23514';
    end if;
    perform private.validate_household_expense_splits(expense_id);
  end loop;
  return null;
end
$$;

create constraint trigger household_transactions_validate_linked_expense
  after update on public.household_account_transactions
  deferrable initially deferred
  for each row execute function private.validate_household_expense_source_transaction_trigger();

alter function private.validate_household_state_trigger() owner to postgres;
alter function private.validate_household_row_state_trigger() owner to postgres;
alter function private.validate_household_expense_splits_trigger() owner to postgres;
alter function private.validate_household_expense_complete_trigger() owner to postgres;
alter function private.validate_personal_household_expense_source_trigger() owner to postgres;
alter function private.validate_household_expense_source_transaction_trigger() owner to postgres;

revoke all on function private.enforce_household_status_transition() from public, anon, authenticated;
revoke all on function private.enforce_household_member_transition_and_capacity() from public, anon, authenticated;
revoke all on function private.validate_household_state(uuid) from public, anon, authenticated;
revoke all on function private.validate_household_state_trigger() from public, anon, authenticated;
revoke all on function private.validate_household_row_state_trigger() from public, anon, authenticated;
revoke all on function private.enforce_active_household_financial_write() from public, anon, authenticated;
revoke all on function private.validate_household_account_transaction() from public, anon, authenticated;
revoke all on function private.validate_household_expense() from public, anon, authenticated;
revoke all on function private.validate_household_expense_splits(uuid) from public, anon, authenticated;
revoke all on function private.validate_household_expense_splits_trigger() from public, anon, authenticated;
revoke all on function private.validate_household_expense_complete_trigger() from public, anon, authenticated;
revoke all on function private.validate_personal_household_expense_source_trigger() from public, anon, authenticated;
revoke all on function private.validate_household_expense_source_transaction_trigger() from public, anon, authenticated;

commit;
