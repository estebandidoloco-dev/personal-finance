-- P1.4 phase 2: Household row visibility and least-privilege table grants.

begin;

create function private.household_access_level(p_household_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when household.status = 'forming' and member_row.status = 'current' then 'forming'
    when household.status = 'active' and member_row.status = 'current' then 'active'
    when household.status = 'closed' and member_row.status = 'archived' then 'archived'
    else null
  end
    from public.households household
    join public.household_members member_row
      on member_row.household_id = household.id
     and member_row.user_id = auth.uid()
   where household.id = p_household_id
$$;

alter function private.household_access_level(uuid) owner to postgres;
revoke all on function private.household_access_level(uuid)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.household_access_level(uuid) to authenticated;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
alter table public.household_accounts enable row level security;
alter table public.household_account_transactions enable row level security;
alter table public.household_expenses enable row level security;
alter table public.household_expense_splits enable row level security;

create policy households_select_member_history
  on public.households
  for select
  to authenticated
  using (private.household_access_level(id) in ('forming', 'active', 'archived'));

create policy household_members_select_member_history
  on public.household_members
  for select
  to authenticated
  using (private.household_access_level(household_id) in ('forming', 'active', 'archived'));

create policy household_invitations_select_forming_member
  on public.household_invitations
  for select
  to authenticated
  using (private.household_access_level(household_id) = 'forming');

create policy household_accounts_select_member_history
  on public.household_accounts
  for select
  to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

create policy household_transactions_select_member_history
  on public.household_account_transactions
  for select
  to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

create policy household_expenses_select_member_history
  on public.household_expenses
  for select
  to authenticated
  using (private.household_access_level(household_id) in ('active', 'archived'));

create policy household_expense_splits_select_member_history
  on public.household_expense_splits
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.household_expenses expense
       where expense.id = household_expense_id
         and private.household_access_level(expense.household_id) in ('active', 'archived')
    )
  );

revoke all on table public.households
  from public, anon, authenticated, service_role;
revoke all on table public.household_members
  from public, anon, authenticated, service_role;
revoke all on table public.household_invitations
  from public, anon, authenticated, service_role;
revoke all on table public.household_accounts
  from public, anon, authenticated, service_role;
revoke all on table public.household_account_transactions
  from public, anon, authenticated, service_role;
revoke all on table public.household_expenses
  from public, anon, authenticated, service_role;
revoke all on table public.household_expense_splits
  from public, anon, authenticated, service_role;

grant select on table public.households to authenticated;
grant select on table public.household_members to authenticated;
grant select (
  id, household_id, invited_by_user_id, invited_email, status,
  created_at, expires_at, resolved_at
) on public.household_invitations to authenticated;
grant select on table public.household_accounts to authenticated;
grant select on table public.household_account_transactions to authenticated;
grant select on table public.household_expenses to authenticated;
grant select on table public.household_expense_splits to authenticated;

commit;
