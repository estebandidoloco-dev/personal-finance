-- P1.3 final MXN-only dashboard contract and concurrency-safe privilege boundary.
-- The migration is intentionally atomic: the table lock is held through validation,
-- privilege repair, function replacement, and COMMIT.

begin;

-- BEGIN MXN_ONLY_CRITICAL_SECTION
-- INSERT/UPDATE/DELETE acquire ROW EXCLUSIVE, which conflicts with SHARE ROW
-- EXCLUSIVE. Earlier writers must finish before validation sees their committed
-- state; later writers cannot interleave with validation or the grant repair.
-- Ordinary ACCESS SHARE readers remain compatible with this lock.
lock table public.accounts in share row exclusive mode;

do $$
declare
  currency_default text;
begin
  if exists (
    select 1
      from public.accounts
     where currency is null
        or currency is distinct from 'MXN'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'MXN-only migration aborted: public.accounts contains NULL or non-MXN currency values.';
  end if;

  select pg_catalog.pg_get_expr(default_definition.adbin, default_definition.adrelid)
    into currency_default
    from pg_catalog.pg_attrdef default_definition
    join pg_catalog.pg_attribute attribute_definition
      on attribute_definition.attrelid = default_definition.adrelid
     and attribute_definition.attnum = default_definition.adnum
   where default_definition.adrelid = 'public.accounts'::pg_catalog.regclass
     and attribute_definition.attname = 'currency';

  if currency_default is distinct from '''MXN''::text' then
    raise exception using
      errcode = 'P0001',
      message = pg_catalog.format(
        'MXN-only migration aborted: public.accounts.currency default is %s, expected %s.',
        coalesce(currency_default, 'NULL'),
        '''MXN''::text'
      );
  end if;
end
$$;

revoke insert, update on public.accounts from public, anon, authenticated;
revoke insert (
  id, user_id, name, type, balance, initial_balance, currency, is_shared,
  institution, last_synced_at, created_at
) on public.accounts from public, anon, authenticated;
revoke update (
  id, user_id, name, type, balance, initial_balance, currency, is_shared,
  institution, last_synced_at, created_at
) on public.accounts from public, anon, authenticated;

grant insert (
  user_id, name, type, initial_balance, is_shared, institution
) on public.accounts to authenticated;
grant update (
  name, type, is_shared, institution, last_synced_at
) on public.accounts to authenticated;
-- SELECT remains the existing table-level authenticated grant, including currency.
-- No privileges are added for anon, PUBLIC, or service_role.
-- END MXN_ONLY_CRITICAL_SECTION

create or replace function public.get_dashboard_summary(p_period text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  today_local date := (pg_catalog.now() at time zone 'America/Mexico_City')::date;
  start_date date;
  end_date_exclusive date;
  account_snapshot jsonb;
  total_balance numeric;
  period_income numeric;
  period_expense numeric;
  expense_categories_snapshot jsonb;
  time_series_snapshot jsonb;
  recent_snapshot jsonb;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_period = 'this_month' then
    start_date := pg_catalog.date_trunc('month', today_local)::date;
    end_date_exclusive := (start_date + interval '1 month')::date;
  elsif p_period = 'previous_month' then
    end_date_exclusive := pg_catalog.date_trunc('month', today_local)::date;
    start_date := (end_date_exclusive - interval '1 month')::date;
  elsif p_period = 'last_30_days' then
    start_date := today_local - 29;
    end_date_exclusive := today_local + 1;
  else
    raise exception 'Invalid dashboard period' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.accounts account
     where account.user_id = authenticated_user_id
       and account.currency is distinct from 'MXN'
  ) or exists (
    select 1 from public.transactions transaction_row
     where transaction_row.user_id = authenticated_user_id
       and transaction_row.currency is distinct from 'MXN'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Dashboard unavailable: user data violates the MXN-only boundary.';
  end if;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', account.id,
               'name', account.name,
               'type', account.type,
               'balance', case when account.balance = 0 then '0.00' else
                 pg_catalog.split_part(pg_catalog.round(account.balance, 2)::text, '.', 1)
                 || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(account.balance, 2)::text, '.', 2), 2, '0') end
             ) order by account.created_at, account.id
           ),
           '[]'::jsonb
         ),
         coalesce(pg_catalog.sum(account.balance), 0)
    into account_snapshot, total_balance
    from public.accounts account
   where account.user_id = authenticated_user_id;

  select coalesce(pg_catalog.sum(transaction_row.amount)
           filter (where transaction_row.kind = 'income'), 0),
         coalesce(pg_catalog.sum(transaction_row.amount)
           filter (where transaction_row.kind = 'expense'), 0)
    into period_income, period_expense
    from public.transactions transaction_row
   where transaction_row.user_id = authenticated_user_id
     and transaction_row.status = 'posted'
     and transaction_row.date >= start_date
     and transaction_row.date < end_date_exclusive;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'category_id', category_total.category_id,
               'name', category_total.name,
               'color', category_total.color,
               'is_uncategorized', category_total.is_uncategorized,
               'amount', case when category_total.amount = 0 then '0.00' else
                 pg_catalog.split_part(pg_catalog.round(category_total.amount, 2)::text, '.', 1)
                 || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(category_total.amount, 2)::text, '.', 2), 2, '0') end
             ) order by category_total.amount desc, category_total.name, category_total.category_id
           ),
           '[]'::jsonb
         )
    into expense_categories_snapshot
    from (
      select transaction_row.category_id,
             coalesce(category.name, 'Sin categoría') as name,
             category.color,
             category.id is null as is_uncategorized,
             pg_catalog.sum(transaction_row.amount) as amount
        from public.transactions transaction_row
        left join public.categories category on category.id = transaction_row.category_id
       where transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
         and transaction_row.kind = 'expense'
         and transaction_row.date >= start_date
         and transaction_row.date < end_date_exclusive
       group by transaction_row.category_id, category.id, category.name, category.color
    ) category_total;

  select pg_catalog.jsonb_build_object(
           'points', coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object(
                 'date', daily.date::text,
                 'income', case when daily.income = 0 then '0.00' else
                   pg_catalog.split_part(pg_catalog.round(daily.income, 2)::text, '.', 1)
                   || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.income, 2)::text, '.', 2), 2, '0') end,
                 'expense', case when daily.expense = 0 then '0.00' else
                   pg_catalog.split_part(pg_catalog.round(daily.expense, 2)::text, '.', 1)
                   || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.expense, 2)::text, '.', 2), 2, '0') end,
                 'net', case when daily.income - daily.expense = 0 then '0.00' else
                   pg_catalog.split_part(pg_catalog.round(daily.income - daily.expense, 2)::text, '.', 1)
                   || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(daily.income - daily.expense, 2)::text, '.', 2), 2, '0') end
               ) order by daily.date
             ),
             '[]'::jsonb
           )
         )
    into time_series_snapshot
    from (
      select calendar.date::date as date,
             coalesce(pg_catalog.sum(transaction_row.amount)
               filter (where transaction_row.kind = 'income'), 0) as income,
             coalesce(pg_catalog.sum(transaction_row.amount)
               filter (where transaction_row.kind = 'expense'), 0) as expense
        from pg_catalog.generate_series(
               start_date::timestamp,
               (end_date_exclusive - 1)::timestamp,
               interval '1 day'
             ) calendar(date)
        left join public.transactions transaction_row
          on transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
         and transaction_row.date = calendar.date::date
       group by calendar.date
    ) daily;

  select coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'id', recent.id,
               'date', recent.date::text,
               'description', recent.description,
               'amount', case when recent.amount = 0 then '0.00' else
                 pg_catalog.split_part(pg_catalog.round(recent.amount, 2)::text, '.', 1)
                 || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(recent.amount, 2)::text, '.', 2), 2, '0') end,
               'kind', recent.kind,
               'category', recent.category,
               'account', recent.account
             ) order by recent.date desc, recent.created_at desc, recent.id desc
           ),
           '[]'::jsonb
         )
    into recent_snapshot
    from (
      select transaction_row.id, transaction_row.date, transaction_row.description,
             transaction_row.amount, transaction_row.kind, transaction_row.created_at,
             case when category.id is null then null else pg_catalog.jsonb_build_object(
               'id', category.id, 'name', category.name, 'color', category.color
             ) end as category,
             pg_catalog.jsonb_build_object('id', account.id, 'name', account.name) as account
        from public.transactions transaction_row
        join public.accounts account on account.id = transaction_row.account_id
        left join public.categories category on category.id = transaction_row.category_id
       where transaction_row.user_id = authenticated_user_id
         and transaction_row.status = 'posted'
       order by transaction_row.date desc, transaction_row.created_at desc, transaction_row.id desc
       limit 10
    ) recent;

  return pg_catalog.jsonb_build_object(
    'period', pg_catalog.jsonb_build_object(
      'key', p_period,
      'start_date', start_date::text,
      'end_date_exclusive', end_date_exclusive::text,
      'timezone', 'America/Mexico_City'
    ),
    'currency', 'MXN',
    'accounts', account_snapshot,
    'totals', pg_catalog.jsonb_build_object(
      'total_balance', case when total_balance = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(total_balance, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(total_balance, 2)::text, '.', 2), 2, '0') end,
      'income', case when period_income = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_income, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_income, 2)::text, '.', 2), 2, '0') end,
      'expense', case when period_expense = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_expense, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_expense, 2)::text, '.', 2), 2, '0') end,
      'net', case when period_income - period_expense = 0 then '0.00' else
        pg_catalog.split_part(pg_catalog.round(period_income - period_expense, 2)::text, '.', 1)
        || '.' || pg_catalog.rpad(pg_catalog.split_part(pg_catalog.round(period_income - period_expense, 2)::text, '.', 2), 2, '0') end
    ),
    'expenses_by_category', expense_categories_snapshot,
    'time_series', time_series_snapshot,
    'recent_transactions', recent_snapshot
  );
end
$$;

revoke all on function public.get_dashboard_summary(text) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_summary(text) to authenticated;

commit;
