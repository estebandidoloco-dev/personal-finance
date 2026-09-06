\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
grant select, insert on test_results to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'dashboard-a@example.test', '{"display_name":"Dashboard A"}', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'dashboard-b@example.test', '{"display_name":"Dashboard B"}', now(), now()),
  ('33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'dashboard-large-a@example.test', '{"display_name":"Large A"}', now(), now()),
  ('44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'dashboard-large-b@example.test', '{"display_name":"Large B"}', now(), now());

insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Cuenta A', 'checking', 1000),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '22222222-2222-4222-8222-222222222222', 'Cuenta B', 'checking', 500);

insert into public.categories(id, user_id, name, type, color) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1', '11111111-1111-4111-8111-111111111111', 'Personal', 'expense', '#123456'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', null, 'Global', 'expense', '#abcdef');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'income', '500.00',
  (now() at time zone 'America/Mexico_City')::date, 'Ingreso posted', null
);
select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'expense', '500.01',
  (now() at time zone 'America/Mexico_City')::date, 'Neto menos un centavo',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaac1'
);
select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'expense', '1.00',
  (now() at time zone 'America/Mexico_City')::date - 1, 'Categoría global',
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
);
select public.create_personal_transaction_exact(
  p_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', p_kind => 'income', p_amount => '999.00',
  p_date => (now() at time zone 'America/Mexico_City')::date,
  p_description => 'Pending excluida', p_status => 'pending'
);
select public.create_personal_transaction_exact(
  p_account_id => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', p_kind => 'expense', p_amount => '999.00',
  p_date => (now() at time zone 'America/Mexico_City')::date,
  p_description => 'Cancelled excluida', p_status => 'cancelled'
);
select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'income', '2.00',
  (date_trunc('month', now() at time zone 'America/Mexico_City')::date - 1),
  'Reciente fuera del mes', null
);

create temporary table dashboard_snapshots(period_key text primary key, payload jsonb not null);
grant select, insert on dashboard_snapshots to authenticated;
insert into dashboard_snapshots values
  ('this_month', public.get_dashboard_summary('this_month')),
  ('previous_month', public.get_dashboard_summary('previous_month')),
  ('last_30_days', public.get_dashboard_summary('last_30_days'));

select pg_temp.assert_true('periodos y timezone exactos', not exists (
  select 1 from dashboard_snapshots
   where payload->'period'->>'key' <> period_key
      or payload->'period'->>'timezone' <> 'America/Mexico_City'
));
select pg_temp.assert_true('this_month usa límites inclusivo exclusivo', (
  select (payload->'period'->>'start_date')::date = date_trunc('month', now() at time zone 'America/Mexico_City')::date
     and (payload->'period'->>'end_date_exclusive')::date = (date_trunc('month', now() at time zone 'America/Mexico_City') + interval '1 month')::date
    from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('previous_month cubre mes anterior completo', (
  select (payload->'period'->>'start_date')::date = (date_trunc('month', now() at time zone 'America/Mexico_City') - interval '1 month')::date
     and (payload->'period'->>'end_date_exclusive')::date = date_trunc('month', now() at time zone 'America/Mexico_City')::date
    from dashboard_snapshots where period_key = 'previous_month'
));
select pg_temp.assert_true('last_30_days tiene exactamente 30 puntos', (
  select jsonb_array_length(payload->'time_series'->'points') = 30
    from dashboard_snapshots where period_key = 'last_30_days'
));
select pg_temp.assert_true('calendario completo consecutivo sin duplicados', not exists (
  select 1
    from dashboard_snapshots snapshot
   where jsonb_array_length(snapshot.payload->'time_series'->'points') < 1
      or exists (
        select 1
          from jsonb_array_elements(snapshot.payload->'time_series'->'points') with ordinality point(value, ordinal)
         where (value->>'date')::date <> (snapshot.payload->'period'->>'start_date')::date + (ordinal - 1)::integer
      )
      or jsonb_array_length(snapshot.payload->'time_series'->'points') <>
         (snapshot.payload->'period'->>'end_date_exclusive')::date - (snapshot.payload->'period'->>'start_date')::date
));
select pg_temp.assert_true('días sin actividad usan cero canónico', exists (
  select 1 from dashboard_snapshots snapshot,
       jsonb_array_elements(snapshot.payload->'time_series'->'points') point(value)
   where period_key = 'last_30_days'
     and value->>'income' = '0.00' and value->>'expense' = '0.00' and value->>'net' = '0.00'
));
select pg_temp.assert_true('solo posted y neto negativo exacto', (
  select payload->'totals'->>'income' = '500.00'
     and payload->'totals'->>'expense' = '501.01'
     and payload->'totals'->>'net' = '-1.01'
    from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('saldo actual independiente del periodo', (
  select count(distinct payload->'totals'->>'total_balance') = 1 from dashboard_snapshots
));
select pg_temp.assert_true('recientes globales independientes del periodo', (
  select count(distinct payload->'recent_transactions') = 1 from dashboard_snapshots
));
select pg_temp.assert_true('reciente fuera del periodo sigue presente', (
  select exists (
    select 1 from jsonb_array_elements(payload->'recent_transactions') item(value)
     where value->>'description' = 'Reciente fuera del mes'
  ) from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('recent máximo diez, posted y orden determinista', not exists (
  select 1 from dashboard_snapshots
   where jsonb_array_length(payload->'recent_transactions') > 10
      or payload->'recent_transactions' @> '[{"description":"Pending excluida"}]'::jsonb
      or payload->'recent_transactions' @> '[{"description":"Cancelled excluida"}]'::jsonb
));
select pg_temp.assert_true('categorías personal y global visibles sin cruce', (
  select exists (select 1 from jsonb_array_elements(payload->'expenses_by_category') item(value) where value->>'name' = 'Personal')
     and exists (select 1 from jsonb_array_elements(payload->'expenses_by_category') item(value) where value->>'name' = 'Global')
    from dashboard_snapshots where period_key = 'this_month'
));
select pg_temp.assert_true('contrato excluye claves multicurrency', not exists (
  select 1 from dashboard_snapshots
   where payload ?| array['balances_by_currency', 'period_totals_by_currency', 'selected_currency']
      or payload->'totals' ? 'currency'
));
select pg_temp.assert_true('todos los importes JSON son strings con dos decimales', not exists (
  select 1 from (
    select total.value as amount from dashboard_snapshots snapshot
      cross join lateral jsonb_each(snapshot.payload->'totals') total
    union all
    select account.value->'balance' from dashboard_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.payload->'accounts') account(value)
    union all
    select category.value->'amount' from dashboard_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.payload->'expenses_by_category') category(value)
    union all
    select point.value->field.name from dashboard_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.payload->'time_series'->'points') point(value)
      cross join (values ('income'), ('expense'), ('net')) field(name)
    union all
    select recent.value->'amount' from dashboard_snapshots snapshot
      cross join lateral jsonb_array_elements(snapshot.payload->'recent_transactions') recent(value)
  ) monetary
   where jsonb_typeof(amount) <> 'string' or trim(both '"' from amount::text) !~ '^-?(0|[1-9][0-9]*)\.[0-9]{2}$'
));
select pg_temp.assert_true('nunca serializa cero negativo', not exists (
  select 1 from dashboard_snapshots where payload::text like '%-0.00%'
));
select pg_temp.assert_true('reconciliación drift cero', not exists (
  select 1 from public.account_balance_reconciliation where user_id = auth.uid() and drift <> 0
));

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_temp.assert_true('aislamiento entre usuarios', (
  select jsonb_array_length(payload->'accounts') = 1
     and not payload::text like '%Cuenta A%'
    from (select public.get_dashboard_summary('this_month') payload) isolated
));

reset role;

insert into public.accounts(user_id, name, type, initial_balance)
values
  ('33333333-3333-4333-8333-333333333333', 'Large 600 A', 'checking', 600000000000.00),
  ('33333333-3333-4333-8333-333333333333', 'Large 600 B', 'checking', 600000000000.00);
insert into public.accounts(user_id, name, type, initial_balance)
select '44444444-4444-4444-8444-444444444444', 'Maximum ' || series, 'checking', 999999999999.99
  from generate_series(1, 100) series;
insert into public.accounts(user_id, name, type, initial_balance)
values ('44444444-4444-4444-8444-444444444444', 'Remainder', 'cash', 0.99);

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select pg_temp.assert_true('agregado 1200000000000 exacto como string', (
  select payload->'totals'->>'total_balance' = '1200000000000.00'
     and jsonb_typeof(payload->'totals'->'total_balance') = 'string'
  from (select public.get_dashboard_summary('this_month') payload) result
));
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select pg_temp.assert_true('agregado sobre safe cents exacto como string', (
  select payload->'totals'->>'total_balance' = '99999999999999.99'
     and jsonb_typeof(payload->'totals'->'total_balance') = 'string'
  from (select public.get_dashboard_summary('this_month') payload) result
));

select pg_temp.assert_true('RPC SECURITY INVOKER y search_path vacío', (
  select prosecdef = false
     and pg_get_functiondef(oid) like '%SET search_path TO ''''%'
    from pg_proc where oid = 'public.get_dashboard_summary(text)'::regprocedure
));
select pg_temp.assert_true('matriz EXECUTE mínima',
  has_function_privilege('authenticated', 'public.get_dashboard_summary(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_dashboard_summary(text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_dashboard_summary(text)', 'EXECUTE'));

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;

rollback;
