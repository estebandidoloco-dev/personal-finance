-- Harden tenant isolation and ownership integrity for the single-user MVP.
-- `is_shared` remains a product flag only; it grants no database access.

-- Abort instead of silently changing legacy rows that violate the new model.
do $$
begin
  if exists (
    select 1
    from public.categories child
    join public.categories parent on parent.id = child.parent_id
    where parent.user_id is not null
      and parent.user_id is distinct from child.user_id
  ) then
    raise exception 'Cannot harden ownership: categories contains a cross-owner parent reference';
  end if;

  if exists (
    with recursive category_walk as (
      select id as start_id, id, parent_id, array[id] as path, false as has_cycle
      from public.categories
      union all
      select walk.start_id,
             parent.id,
             parent.parent_id,
             walk.path || parent.id,
             parent.id = any(walk.path)
      from category_walk walk
      join public.categories parent on parent.id = walk.parent_id
      where not walk.has_cycle
    )
    select 1 from category_walk where has_cycle
  ) then
    raise exception 'Cannot harden ownership: categories contains a parent cycle';
  end if;

  if exists (
    select 1
    from public.transactions row_to_check
    join public.categories category on category.id = row_to_check.category_id
    where category.user_id is not null
      and category.user_id <> row_to_check.user_id
  ) then
    raise exception 'Cannot harden ownership: transactions contains a cross-owner category';
  end if;

  if exists (
    select 1
    from public.budgets row_to_check
    join public.categories category on category.id = row_to_check.category_id
    where category.user_id is not null
      and category.user_id <> row_to_check.user_id
  ) then
    raise exception 'Cannot harden ownership: budgets contains a cross-owner category';
  end if;

  if exists (
    select 1
    from public.goals row_to_check
    join public.categories category on category.id = row_to_check.category_id
    where category.user_id is not null
      and category.user_id <> row_to_check.user_id
  ) then
    raise exception 'Cannot harden ownership: goals contains a cross-owner category';
  end if;

  if exists (
    select 1
    from public.subscriptions row_to_check
    join public.categories category on category.id = row_to_check.category_id
    where category.user_id is not null
      and category.user_id <> row_to_check.user_id
  ) then
    raise exception 'Cannot harden ownership: subscriptions contains a cross-owner category';
  end if;

  if exists (
    select 1
    from public.transaction_tags link
    join public.transactions transaction_row on transaction_row.id = link.transaction_id
    join public.tags tag on tag.id = link.tag_id
    where transaction_row.user_id <> tag.user_id
  ) then
    raise exception 'Cannot harden ownership: transaction_tags contains a cross-owner link';
  end if;
end
$$;

-- Composite foreign keys guarantee that account references match the row owner.
alter table public.accounts
  add constraint accounts_id_user_id_unique unique (id, user_id);

alter table public.transactions
  add constraint transactions_account_owner_fkey
  foreign key (account_id, user_id)
  references public.accounts (id, user_id);

alter table public.goals
  add constraint goals_account_owner_fkey
  foreign key (account_id, user_id)
  references public.accounts (id, user_id);

alter table public.subscriptions
  add constraint subscriptions_account_owner_fkey
  foreign key (account_id, user_id)
  references public.accounts (id, user_id);

alter table public.csv_imports
  add constraint csv_imports_account_owner_fkey
  foreign key (account_id, user_id)
  references public.accounts (id, user_id);

-- A category reference may be global or owned by the referencing row's user.
create or replace function public.enforce_owned_category_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referenced_owner uuid;
begin
  if new.category_id is null then
    return new;
  end if;

  select category.user_id
    into referenced_owner
    from public.categories category
   where category.id = new.category_id;

  if not found then
    raise exception 'Referenced category % does not exist', new.category_id
      using errcode = '23503';
  end if;

  if referenced_owner is not null and referenced_owner is distinct from new.user_id then
    raise exception 'Category % does not belong to user %', new.category_id, new.user_id
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_owned_category_reference() from public, anon, authenticated;

create trigger transactions_enforce_category_owner
  before insert or update of category_id, user_id on public.transactions
  for each row execute function public.enforce_owned_category_reference();

create trigger budgets_enforce_category_owner
  before insert or update of category_id, user_id on public.budgets
  for each row execute function public.enforce_owned_category_reference();

create trigger goals_enforce_category_owner
  before insert or update of category_id, user_id on public.goals
  for each row execute function public.enforce_owned_category_reference();

create trigger subscriptions_enforce_category_owner
  before insert or update of category_id, user_id on public.subscriptions
  for each row execute function public.enforce_owned_category_reference();

-- Category parents may be global or owned by the child owner. Cycles are rejected.
create or replace function public.enforce_category_parent_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_owner uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A category cannot be its own parent'
      using errcode = '23514';
  end if;

  select parent.user_id
    into parent_owner
    from public.categories parent
   where parent.id = new.parent_id;

  if not found then
    raise exception 'Parent category % does not exist', new.parent_id
      using errcode = '23503';
  end if;

  if parent_owner is not null and parent_owner is distinct from new.user_id then
    raise exception 'Parent category % belongs to a different user', new.parent_id
      using errcode = '23514';
  end if;

  if exists (
    with recursive ancestors as (
      select category.id, category.parent_id
      from public.categories category
      where category.id = new.parent_id
      union
      select parent.id, parent.parent_id
      from public.categories parent
      join ancestors child on parent.id = child.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Category parent assignment would create a cycle'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_category_parent_ownership() from public, anon, authenticated;

create trigger categories_enforce_parent_ownership
  before insert or update of parent_id, user_id on public.categories
  for each row execute function public.enforce_category_parent_ownership();

-- Both ends of a transaction-tag link must have the same owner.
create or replace function public.enforce_transaction_tag_ownership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_owner uuid;
  tag_owner uuid;
begin
  select transaction_row.user_id
    into transaction_owner
    from public.transactions transaction_row
   where transaction_row.id = new.transaction_id;

  if not found then
    raise exception 'Referenced transaction % does not exist', new.transaction_id
      using errcode = '23503';
  end if;

  select tag.user_id
    into tag_owner
    from public.tags tag
   where tag.id = new.tag_id;

  if not found then
    raise exception 'Referenced tag % does not exist', new.tag_id
      using errcode = '23503';
  end if;

  if transaction_owner <> tag_owner then
    raise exception 'Transaction and tag must have the same owner'
      using errcode = '23514';
  end if;

  return new;
end
$$;

revoke all on function public.enforce_transaction_tag_ownership() from public, anon, authenticated;

create trigger transaction_tags_enforce_owner
  before insert or update of transaction_id, tag_id on public.transaction_tags
  for each row execute function public.enforce_transaction_tag_ownership();

-- Replace the broad initial policies with explicit per-operation policies.
drop policy if exists "own_profile" on public.profiles;
drop policy if exists "own_accounts" on public.accounts;
drop policy if exists "own_categories" on public.categories;
drop policy if exists "own_tags" on public.tags;
drop policy if exists "own_transactions" on public.transactions;
drop policy if exists "own_transaction_tags" on public.transaction_tags;
drop policy if exists "own_budgets" on public.budgets;
drop policy if exists "own_goals" on public.goals;
drop policy if exists "own_subscriptions" on public.subscriptions;
drop policy if exists "own_csv_imports" on public.csv_imports;
drop policy if exists "own_split_rules" on public.split_rules;

-- Profiles are created by the auth.users trigger, not directly by clients.
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "accounts_select_own"
  on public.accounts for select to authenticated
  using (user_id = (select auth.uid()));

create policy "accounts_insert_own"
  on public.accounts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "accounts_update_own"
  on public.accounts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "accounts_delete_own"
  on public.accounts for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "categories_select_global_or_own"
  on public.categories for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));

create policy "categories_insert_own"
  on public.categories for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and is_system is not true
  );

create policy "categories_update_own"
  on public.categories for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and is_system is not true
  );

create policy "categories_delete_own"
  on public.categories for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "tags_select_own"
  on public.tags for select to authenticated
  using (user_id = (select auth.uid()));

create policy "tags_insert_own"
  on public.tags for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "tags_update_own"
  on public.tags for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "tags_delete_own"
  on public.tags for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "transactions_select_own"
  on public.transactions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "transactions_insert_own"
  on public.transactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts account
      where account.id = account_id
        and account.user_id = (select auth.uid())
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "transactions_update_own"
  on public.transactions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts account
      where account.id = account_id
        and account.user_id = (select auth.uid())
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "transactions_delete_own"
  on public.transactions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "transaction_tags_select_own"
  on public.transaction_tags for select to authenticated
  using (
    exists (
      select 1
      from public.transactions transaction_row
      join public.tags tag on tag.id = transaction_tags.tag_id
      where transaction_row.id = transaction_tags.transaction_id
        and transaction_row.user_id = (select auth.uid())
        and tag.user_id = (select auth.uid())
    )
  );

create policy "transaction_tags_insert_own"
  on public.transaction_tags for insert to authenticated
  with check (
    exists (
      select 1
      from public.transactions transaction_row
      join public.tags tag on tag.id = transaction_tags.tag_id
      where transaction_row.id = transaction_tags.transaction_id
        and transaction_row.user_id = (select auth.uid())
        and tag.user_id = (select auth.uid())
    )
  );

create policy "transaction_tags_update_own"
  on public.transaction_tags for update to authenticated
  using (
    exists (
      select 1
      from public.transactions transaction_row
      join public.tags tag on tag.id = transaction_tags.tag_id
      where transaction_row.id = transaction_tags.transaction_id
        and transaction_row.user_id = (select auth.uid())
        and tag.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.transactions transaction_row
      join public.tags tag on tag.id = transaction_tags.tag_id
      where transaction_row.id = transaction_tags.transaction_id
        and transaction_row.user_id = (select auth.uid())
        and tag.user_id = (select auth.uid())
    )
  );

create policy "transaction_tags_delete_own"
  on public.transaction_tags for delete to authenticated
  using (
    exists (
      select 1
      from public.transactions transaction_row
      join public.tags tag on tag.id = transaction_tags.tag_id
      where transaction_row.id = transaction_tags.transaction_id
        and transaction_row.user_id = (select auth.uid())
        and tag.user_id = (select auth.uid())
    )
  );

create policy "budgets_select_own"
  on public.budgets for select to authenticated
  using (user_id = (select auth.uid()));

create policy "budgets_insert_own"
  on public.budgets for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.categories category
      where category.id = category_id
        and (category.user_id is null or category.user_id = (select auth.uid()))
    )
  );

create policy "budgets_update_own"
  on public.budgets for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.categories category
      where category.id = category_id
        and (category.user_id is null or category.user_id = (select auth.uid()))
    )
  );

create policy "budgets_delete_own"
  on public.budgets for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "goals_select_own"
  on public.goals for select to authenticated
  using (user_id = (select auth.uid()));

create policy "goals_insert_own"
  on public.goals for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      account_id is null
      or exists (
        select 1 from public.accounts account
        where account.id = account_id
          and account.user_id = (select auth.uid())
      )
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "goals_update_own"
  on public.goals for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      account_id is null
      or exists (
        select 1 from public.accounts account
        where account.id = account_id
          and account.user_id = (select auth.uid())
      )
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "goals_delete_own"
  on public.goals for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "subscriptions_select_own"
  on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "subscriptions_insert_own"
  on public.subscriptions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (
      account_id is null
      or exists (
        select 1 from public.accounts account
        where account.id = account_id
          and account.user_id = (select auth.uid())
      )
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "subscriptions_update_own"
  on public.subscriptions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      account_id is null
      or exists (
        select 1 from public.accounts account
        where account.id = account_id
          and account.user_id = (select auth.uid())
      )
    )
    and (
      category_id is null
      or exists (
        select 1 from public.categories category
        where category.id = category_id
          and (category.user_id is null or category.user_id = (select auth.uid()))
      )
    )
  );

create policy "subscriptions_delete_own"
  on public.subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "csv_imports_select_own"
  on public.csv_imports for select to authenticated
  using (user_id = (select auth.uid()));

create policy "csv_imports_insert_own"
  on public.csv_imports for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts account
      where account.id = account_id
        and account.user_id = (select auth.uid())
    )
  );

create policy "csv_imports_update_own"
  on public.csv_imports for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.accounts account
      where account.id = account_id
        and account.user_id = (select auth.uid())
    )
  );

create policy "csv_imports_delete_own"
  on public.csv_imports for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "split_rules_select_own"
  on public.split_rules for select to authenticated
  using (user_id = (select auth.uid()));

create policy "split_rules_insert_own"
  on public.split_rules for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "split_rules_update_own"
  on public.split_rules for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "split_rules_delete_own"
  on public.split_rules for delete to authenticated
  using (user_id = (select auth.uid()));
