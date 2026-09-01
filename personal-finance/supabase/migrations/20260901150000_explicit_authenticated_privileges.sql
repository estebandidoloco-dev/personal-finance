-- Make API privileges deterministic when Supabase auto_expose_new_tables is disabled.
-- RLS remains responsible for row-level authorization.

revoke create on schema public from authenticated;
grant usage on schema public to authenticated;

-- Remove implicit or legacy table grants before applying the explicit matrix below.
revoke all privileges on table
  public.profiles,
  public.accounts,
  public.categories,
  public.tags,
  public.transactions,
  public.transaction_tags,
  public.budgets,
  public.goals,
  public.subscriptions,
  public.csv_imports,
  public.split_rules
from public, anon, authenticated;

-- Table-level revokes do not remove column-level privileges. Reset every mutable
-- account column explicitly, then grant the approved insert/update allowlists.
revoke insert (
  id,
  user_id,
  name,
  type,
  balance,
  initial_balance,
  currency,
  is_shared,
  institution,
  last_synced_at,
  created_at
) on public.accounts from public, anon, authenticated;

revoke update (
  id,
  user_id,
  name,
  type,
  balance,
  initial_balance,
  currency,
  is_shared,
  institution,
  last_synced_at,
  created_at
) on public.accounts from public, anon, authenticated;

grant select, update on public.profiles to authenticated;

grant select, delete on public.accounts to authenticated;
grant insert (
  user_id,
  name,
  type,
  initial_balance,
  currency,
  is_shared,
  institution
) on public.accounts to authenticated;
grant update (
  name,
  type,
  currency,
  is_shared,
  institution,
  last_synced_at
) on public.accounts to authenticated;

grant select, insert, update, delete on public.categories to authenticated;
grant select, insert, update, delete on public.tags to authenticated;

grant select on public.transactions to authenticated;
grant select on public.transaction_tags to authenticated;

grant select, insert, update, delete on public.budgets to authenticated;
grant select, insert, update, delete on public.goals to authenticated;
grant select, insert, update, delete on public.subscriptions to authenticated;
grant select, insert, update, delete on public.csv_imports to authenticated;
grant select, insert, update, delete on public.split_rules to authenticated;

-- No sequence grants are required: the schema uses UUID defaults, not serial/identity columns.
-- Future tables must receive an explicit privilege review; no default privileges are changed here.
