create temporary table test_results(test_name text primary key, passed boolean not null);
grant select, insert on test_results to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

create temporary table dashboard_snapshots(period_key text primary key, payload jsonb not null);
grant select, insert on dashboard_snapshots to authenticated;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'dashboard-a@example.test', '{"display_name":"Dashboard A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'dashboard-b@example.test', '{"display_name":"Dashboard B"}', now(), now());

insert into public.accounts(id, user_id, name, type, initial_balance, currency) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'Cuenta MXN', 'checking', 1000, 'MXN'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', '11111111-1111-1111-1111-111111111111', 'Cuenta USD', 'savings', 200, 'USD'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '22222222-2222-2222-2222-222222222222', 'Cuenta B', 'checking', 500, 'MXN');

insert into public.categories(id, user_id, name, type, color) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1', '11111111-1111-1111-1111-111111111111', 'Categoría A', 'expense', '#123456'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1', '22222222-2222-2222-2222-222222222222', 'Categoría B', 'expense', '#abcdef');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'income', 500, 'MXN',
  (now() at time zone 'America/Mexico_City')::date, 'Ingreso posted', null
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 100, 'MXN',
  date_trunc('month', (now() at time zone 'America/Mexico_City'))::date, 'Gasto personal',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1'
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 50, 'MXN',
  (now() at time zone 'America/Mexico_City')::date - 1, 'Gasto global',
  (select id from public.categories where user_id is null limit 1)
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'expense', 10, 'USD',
  (now() at time zone 'America/Mexico_City')::date, 'Gasto USD', null
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'income', 999, 'MXN',
  (now() at time zone 'America/Mexico_City')::date, 'Ingreso pending', null, null, false, null, 'pending'
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 888, 'MXN',
  (now() at time zone 'America/Mexico_City')::date, 'Gasto cancelled', null, null, false, null, 'cancelled'
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 7, 'MXN',
  (now() at time zone 'America/Mexico_City')::date - 29, 'Límite incluido', null
);
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 8, 'MXN',
  (now() at time zone 'America/Mexico_City')::date - 30, 'Fuera de 30 días', null
);

insert into dashboard_snapshots values ('this_month', public.get_dashboard_summary('this_month'));
insert into dashboard_snapshots values ('previous_month', public.get_dashboard_summary('previous_month'));
insert into dashboard_snapshots values ('last_30_days', public.get_dashboard_summary('last_30_days'));

select pg_temp.assert_true('period timezone y formato', (
  select payload->'period'->>'timezone' = 'America/Mexico_City'
    and payload->'period'->>'key' = period_key
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('this_month comienza en el primer día', (
  select (payload->'period'->>'start_date')::date = date_trunc('month', (now() at time zone 'America/Mexico_City'))::date
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('last_30_days incluye hoy y excluye hace 30 días', (
  select (payload->'period'->>'end_date_exclusive')::date = (now() at time zone 'America/Mexico_City')::date + 1
    and (payload->'period'->>'start_date')::date = (now() at time zone 'America/Mexico_City')::date - 29
  from dashboard_snapshots where period_key = 'last_30_days'
));
select pg_temp.assert_true('solo posted entra en totales', (
  select (payload->'period_totals_by_currency'->0->>'income')::numeric = 500
    and (payload->'period_totals_by_currency'->0->>'expense')::numeric = 150
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('multicurrency no consolida totales', (
  select payload->'totals'->>'total_balance' is null
    and payload->'totals'->>'currency' is null
    and jsonb_array_length(payload->'balances_by_currency') = 2
    and jsonb_array_length(payload->'period_totals_by_currency') = 2
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('serie temporal no mezcla monedas y rellena días', (
  select jsonb_array_length(payload->'time_series') = 2
    and (select jsonb_array_length(value->'points') = 30 from jsonb_array_elements(payload->'time_series') item(value) limit 1)
  from dashboard_snapshots where period_key = 'last_30_days'
));
select pg_temp.assert_true('categorías incluye personal y sin categoría', (
  select exists (select 1 from jsonb_array_elements(payload->'expenses_by_category') item(value)
                 where value->>'category_id' = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1')
    and exists (select 1 from jsonb_array_elements(payload->'expenses_by_category') item(value)
                where (value->>'is_uncategorized')::boolean)
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('recent máximo diez y solo posted', (
  select jsonb_array_length(payload->'recent_transactions') <= 10
    and not exists (select 1 from jsonb_array_elements(payload->'recent_transactions') item(value)
                   where value->>'description' in ('Ingreso pending', 'Gasto cancelled'))
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('accounts usa saldo almacenado y ownership', (
  select jsonb_array_length(payload->'accounts') = 2
    and exists (select 1 from jsonb_array_elements(payload->'accounts') item(value)
                where value->>'id' = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')
    and not exists (select 1 from jsonb_array_elements(payload->'accounts') item(value)
                    where value->>'id' = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1')
  from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('dashboard no muta balances y mantiene reconciliación', (
  (select balance = 1335 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1')
    and (select balance = 190 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2')
    and (select bool_and(drift = 0) from public.account_balance_reconciliation
         where user_id = '11111111-1111-1111-1111-111111111111')
));
select pg_temp.assert_true('RPC es invoker y solo authenticated ejecuta', (
  select not prosecdef from pg_proc where oid = 'public.get_dashboard_summary(text)'::regprocedure
));

reset role;
select pg_temp.assert_true('anon no ejecuta dashboard', not has_function_privilege(
  'anon', 'public.get_dashboard_summary(text)', 'EXECUTE'
));
select pg_temp.assert_true('service_role no ejecuta dashboard', not has_function_privilege(
  'service_role', 'public.get_dashboard_summary(text)', 'EXECUTE'
));
select pg_temp.assert_true('authenticated ejecuta dashboard', has_function_privilege(
  'authenticated', 'public.get_dashboard_summary(text)', 'EXECUTE'
));

select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;