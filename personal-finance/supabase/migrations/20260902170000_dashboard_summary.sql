-- P1.3: read-only dashboard snapshot, scoped by auth.uid() and existing RLS.
create function public.get_dashboard_summary(p_period text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  authenticated_user_id uuid := auth.uid();
  today_local date := (now() at time zone 'America/Mexico_City')::date;
  start_date date;
  end_date_exclusive date;
  account_snapshot jsonb;
  balances_snapshot jsonb;
  period_totals_snapshot jsonb;
  expense_categories_snapshot jsonb;
  time_series_snapshot jsonb;
  recent_snapshot jsonb;
  currency_count integer;
  total_balance numeric;
  total_currency text;
  period_income numeric;
  period_expense numeric;
  period_net numeric;
begin
  if authenticated_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_period = 'this_month' then
    start_date := date_trunc('month', today_local)::date;
    end_date_exclusive := (start_date + interval '1 month')::date;
  elsif p_period = 'previous_month' then
    end_date_exclusive := date_trunc('month', today_local)::date;
    start_date := (end_date_exclusive - interval '1 month')::date;
  elsif p_period = 'last_30_days' then
    start_date := today_local - 29;
    end_date_exclusive := today_local + 1;
  else
    raise exception 'Invalid dashboard period' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(account_row) order by account_row.created_at, account_row.id), '[]'::jsonb)
    into account_snapshot
    from (
      select account.id, account.name, account.type, account.balance, account.currency, account.created_at
      from public.accounts account
      where account.user_id = authenticated_user_id
    ) account_row;

  select coalesce(jsonb_agg(to_jsonb(balance_row) order by balance_row.currency), '[]'::jsonb)
    into balances_snapshot
    from (
      select account.currency, sum(account.balance)::numeric(14,2) as balance
      from public.accounts account
      where account.user_id = authenticated_user_id
      group by account.currency
    ) balance_row;

  select count(distinct account.currency),
         case when count(distinct account.currency) = 1 then min(account.currency) end,
         case when count(distinct account.currency) = 1 then sum(account.balance) end
    into currency_count, total_currency, total_balance
    from public.accounts account
    where account.user_id = authenticated_user_id;

  select coalesce(jsonb_agg(to_jsonb(total_row) order by total_row.currency), '[]'::jsonb)
    into period_totals_snapshot
    from (
      select transaction_row.currency,
             coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'income'), 0)::numeric(14,2) as income,
             coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'expense'), 0)::numeric(14,2) as expense,
             (coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'income'), 0)
              - coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'expense'), 0))::numeric(14,2) as net
      from public.transactions transaction_row
      where transaction_row.user_id = authenticated_user_id
        and transaction_row.status = 'posted'
        and transaction_row.date >= start_date
        and transaction_row.date < end_date_exclusive
      group by transaction_row.currency
    ) total_row;

  select coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'income'), 0),
         coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'expense'), 0)
    into period_income, period_expense
    from public.transactions transaction_row
    where transaction_row.user_id = authenticated_user_id
      and transaction_row.status = 'posted'
      and transaction_row.date >= start_date
      and transaction_row.date < end_date_exclusive
      and currency_count <= 1;
  period_net := period_income - period_expense;

  select coalesce(jsonb_agg(to_jsonb(category_row) order by category_row.amount desc, category_row.name), '[]'::jsonb)
    into expense_categories_snapshot
    from (
      select transaction_row.category_id,
             coalesce(category.name, 'Sin categoría') as name,
             category.color,
             (category.id is null) as is_uncategorized,
             transaction_row.currency,
             sum(transaction_row.amount)::numeric(14,2) as amount
      from public.transactions transaction_row
      left join public.categories category on category.id = transaction_row.category_id
      where transaction_row.user_id = authenticated_user_id
        and transaction_row.status = 'posted'
        and transaction_row.kind = 'expense'
        and transaction_row.date >= start_date
        and transaction_row.date < end_date_exclusive
      group by transaction_row.category_id, category.id, category.name, category.color, transaction_row.currency
    ) category_row;

  select coalesce(jsonb_agg(to_jsonb(series_row) order by series_row.currency), '[]'::jsonb)
    into time_series_snapshot
    from (
      select currency_row.currency,
             (
               select coalesce(jsonb_agg(to_jsonb(point_row) order by point_row.date), '[]'::jsonb)
               from (
                 select calendar.date,
                        coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'income'), 0)::numeric(14,2) as income,
                        coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'expense'), 0)::numeric(14,2) as expense,
                        (coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'income'), 0)
                         - coalesce(sum(transaction_row.amount) filter (where transaction_row.kind = 'expense'), 0))::numeric(14,2) as net
                 from pg_catalog.generate_series(start_date, end_date_exclusive - 1, interval '1 day') calendar(date)
                 left join public.transactions transaction_row
                   on transaction_row.user_id = authenticated_user_id
                  and transaction_row.currency = currency_row.currency
                  and transaction_row.status = 'posted'
                  and transaction_row.date = calendar.date::date
                 group by calendar.date
               ) point_row
             ) as points
      from (
        select distinct transaction_row.currency
        from public.transactions transaction_row
        where transaction_row.user_id = authenticated_user_id
          and transaction_row.status = 'posted'
          and transaction_row.date >= start_date
          and transaction_row.date < end_date_exclusive
      ) currency_row
    ) series_row;

  select coalesce(jsonb_agg(to_jsonb(recent_row) order by recent_row.date desc, recent_row.created_at desc), '[]'::jsonb)
    into recent_snapshot
    from (
      select transaction_row.id, transaction_row.date, transaction_row.description,
             transaction_row.amount, transaction_row.kind, transaction_row.currency,
             case when category.id is null then null else jsonb_build_object(
               'id', category.id, 'name', category.name, 'color', category.color
             ) end as category,
             jsonb_build_object('id', account.id, 'name', account.name) as account,
             transaction_row.created_at
      from public.transactions transaction_row
      join public.accounts account on account.id = transaction_row.account_id
      left join public.categories category on category.id = transaction_row.category_id
      where transaction_row.user_id = authenticated_user_id
        and transaction_row.status = 'posted'
      order by transaction_row.date desc, transaction_row.created_at desc
      limit 10
    ) recent_row;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'key', p_period,
      'start_date', start_date,
      'end_date_exclusive', end_date_exclusive,
      'timezone', 'America/Mexico_City'
    ),
    'accounts', account_snapshot,
    'balances_by_currency', balances_snapshot,
    'totals', jsonb_build_object(
      'total_balance', case when currency_count <= 1 then coalesce(total_balance, 0) else null end,
      'currency', case when currency_count <= 1 then total_currency else null end,
      'income', case when currency_count <= 1 then period_income else null end,
      'expense', case when currency_count <= 1 then period_expense else null end,
      'net', case when currency_count <= 1 then period_net else null end
    ),
    'period_totals_by_currency', period_totals_snapshot,
    'expenses_by_category', expense_categories_snapshot,
    'time_series', time_series_snapshot,
    'recent_transactions', recent_snapshot
  );
end
$$;

revoke all on function public.get_dashboard_summary(text) from public, anon, authenticated, service_role;
grant execute on function public.get_dashboard_summary(text) to authenticated;