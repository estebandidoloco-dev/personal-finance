\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
create temporary table payloads(label text primary key, payload jsonb not null);
grant select, insert, update, delete on test_results, payloads to authenticated;
create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('54000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'read-a@example.test', '{"display_name":"Read A"}', now(), now()),
  ('54000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'read-b@example.test', '{"display_name":"Read B"}', now(), now()),
  ('54000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'read-x@example.test', '{"display_name":"Read X"}', now(), now());
insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('54100000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001', 'Private A', 'checking', 1000),
  ('54100000-0000-4000-8000-000000000002', '54000000-0000-4000-8000-000000000002', 'Private B', 'checking', 1000),
  ('54100000-0000-4000-8000-000000000003', '54000000-0000-4000-8000-000000000001', 'Overflow source', 'checking', 0);
insert into public.households(id, name, status, created_by_user_id, activated_at)
values ('54200000-0000-4000-8000-000000000001', 'Read Casa', 'active', '54000000-0000-4000-8000-000000000001', now());
insert into public.household_members(household_id, user_id) values
  ('54200000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000001'),
  ('54200000-0000-4000-8000-000000000001', '54000000-0000-4000-8000-000000000002');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('read RPCs solo authenticated',
  has_function_privilege('authenticated', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_expenses(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_expenses(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_expenses(uuid,integer)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000001', true);
insert into payloads values ('account', public.create_household_account(
  '54200000-0000-4000-8000-000000000001', 'Común', 'cash', '500.00'
));
insert into payloads values ('income', public.create_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '50.00', '2026-09-01', 'Ingreso común', 'visible', 'posted'
));
insert into payloads values ('household_expense', public.create_shared_expense(
  '54200000-0000-4000-8000-000000000001', 'household_account',
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '60.00', '2026-09-02', 'Gasto común', 'equal', null, null, 'nota común', 'posted'
));
insert into payloads values ('personal_a', public.create_shared_expense(
  '54200000-0000-4000-8000-000000000001', 'personal_account',
  '54100000-0000-4000-8000-000000000001', '100.00', '2026-09-03',
  'A pagó', 'custom', jsonb_build_array(
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000001', 'amount', '30.00'),
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000002', 'amount', '70.00')
  ), null, 'nota privada A', 'posted'
));
insert into payloads values ('pending_a', public.create_shared_expense(
  '54200000-0000-4000-8000-000000000001', 'personal_account',
  '54100000-0000-4000-8000-000000000001', '99.00', '2026-09-04',
  'Pendiente', 'equal', null, null, null, 'pending'
));

select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000002', true);
insert into payloads values ('personal_b', public.create_shared_expense(
  '54200000-0000-4000-8000-000000000001', 'personal_account',
  '54100000-0000-4000-8000-000000000002', '40.00', '2026-09-05',
  'B pagó', 'equal', null, null, 'nota privada B', 'posted'
));

insert into payloads values ('later_standalone', public.create_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '1.00', '2026-09-30', 'Standalone posterior', null, 'posted'
));
select pg_temp.assert_true('limit de expenses se aplica despues de excluir standalone',
  jsonb_array_length(public.get_household_expenses('54200000-0000-4000-8000-000000000001', 1)) = 1
  and public.get_household_expenses('54200000-0000-4000-8000-000000000001', 1)->0->>'entry_type'
    = 'shared_expense'
  and public.get_household_expenses('54200000-0000-4000-8000-000000000001', 1)->0->>'description'
    = 'B pagó');
select public.delete_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'later_standalone')
);

select pg_temp.assert_true('current Household y members legibles',
  (public.get_current_household()->>'id') = '54200000-0000-4000-8000-000000000001'
  and jsonb_array_length(public.get_household_members('54200000-0000-4000-8000-000000000001')) = 2);
select pg_temp.assert_true('cuentas read model usa dinero string',
  jsonb_typeof(public.get_household_accounts('54200000-0000-4000-8000-000000000001')->0->'balance') = 'string'
  and (public.get_household_accounts('54200000-0000-4000-8000-000000000001')->0->>'balance') = '490.00');

insert into payloads values ('activity', jsonb_build_object(
  'items', public.get_household_transactions('54200000-0000-4000-8000-000000000001', 100)
));
select pg_temp.assert_true('actividad unificada incluye ambos ledgers una vez', (
  select jsonb_array_length(payload->'items') = 5 from payloads where label = 'activity'
));
select pg_temp.assert_true('actividad personal no filtra cuenta ni notas', not exists (
  select 1 from payloads, jsonb_array_elements(payload->'items') item
   where label = 'activity' and item->>'funding_source' = 'personal_account'
     and (item->'account_id' <> 'null'::jsonb or item->'notes' <> 'null'::jsonb)
));
select pg_temp.assert_true('actividad común conserva datos compartidos', exists (
  select 1 from payloads, jsonb_array_elements(payload->'items') item
   where label = 'activity' and item->>'description' = 'Gasto común'
     and item->>'notes' = 'nota común' and item->>'amount' = '60.00'
     and jsonb_typeof(item->'amount') = 'string'
));

insert into payloads values ('balance', public.get_household_balance_between_members(
  '54200000-0000-4000-8000-000000000001'
));
select pg_temp.assert_true('balance interpersonal exacto y suma cero', (
  select payload->>'owed_by_user_id' = '54000000-0000-4000-8000-000000000002'
     and payload->>'owed_to_user_id' = '54000000-0000-4000-8000-000000000001'
     and payload->>'amount' = '50.00'
     and (
       select sum((position->>'amount')::numeric) = 0
       from jsonb_array_elements(payload->'positions') position
     )
    from payloads where label = 'balance'
));
select pg_temp.assert_true('fondos Household y pending no generan deuda',
  (select payload->>'amount' = '50.00' from payloads where label = 'balance'));

select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000001', true);
savepoint before_large_aggregate;
do $$
declare
  iteration integer;
  balance_payload jsonb;
begin
  for iteration in 1..1001 loop
    perform public.create_personal_transaction_exact(
      p_account_id := '54100000-0000-4000-8000-000000000003',
      p_kind := 'income', p_amount := '999999999999.99',
      p_date := '2026-09-06', p_description := 'Overflow funding'
    );
    perform public.create_shared_expense(
      p_household_id := '54200000-0000-4000-8000-000000000001',
      p_funding_source := 'personal_account',
      p_source_account_id := '54100000-0000-4000-8000-000000000003',
      p_amount := '999999999999.99', p_date := '2026-09-06',
      p_description := 'Overflow expense', p_split_mode := 'custom',
      p_splits := jsonb_build_array(
        jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000001', 'amount', '0.00'),
        jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000002', 'amount', '999999999999.99')
      )
    );
  end loop;
  balance_payload := public.get_household_balance_between_members(
    '54200000-0000-4000-8000-000000000001'
  );
  if balance_payload->>'amount' <> '1001000000000039.99'
     or balance_payload->'positions'->0->>'amount' <> '1001000000000039.99'
     or balance_payload->'positions'->1->>'amount' <> '-1001000000000039.99'
     or jsonb_typeof(balance_payload->'amount') <> 'string'
     or (select sum((position->>'amount')::numeric)
           from jsonb_array_elements(balance_payload->'positions') position) <> 0
     or concat_ws('', balance_payload->>'amount',
                       balance_payload->'positions'->0->>'amount',
                       balance_payload->'positions'->1->>'amount') ~ '[#eE,[:space:]]' then
    raise exception 'FAIL: 16+ digit interpersonal aggregate: %', balance_payload;
  end if;
end
$$;
rollback to savepoint before_large_aggregate;
select pg_temp.assert_true('deuda agregada de 16 digitos exacta y canonica', true);

update payloads set payload = public.update_shared_expense(
  (select (payload->>'id')::uuid from payloads where label = 'personal_a'),
  '54100000-0000-4000-8000-000000000001', '100.00', '2026-09-03',
  'A canceló', 'custom', jsonb_build_array(
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000001', 'amount', '30.00'),
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000002', 'amount', '70.00')
  ), null, 'nota privada A', 'cancelled'
) where label = 'personal_a';
select pg_temp.assert_true('posted a cancelled retira deuda sin compensación doble',
  (public.get_household_balance_between_members('54200000-0000-4000-8000-000000000001')->>'owed_by_user_id')
    = '54000000-0000-4000-8000-000000000001'
  and (public.get_household_balance_between_members('54200000-0000-4000-8000-000000000001')->>'owed_to_user_id')
    = '54000000-0000-4000-8000-000000000002'
  and (public.get_household_balance_between_members('54200000-0000-4000-8000-000000000001')->>'amount') = '20.00');
update payloads set payload = public.update_shared_expense(
  (select (payload->>'id')::uuid from payloads where label = 'personal_a'),
  '54100000-0000-4000-8000-000000000001', '100.00', '2026-09-03',
  'A pagó', 'custom', jsonb_build_array(
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000001', 'amount', '30.00'),
    jsonb_build_object('user_id', '54000000-0000-4000-8000-000000000002', 'amount', '70.00')
  ), null, 'nota privada A', 'posted'
) where label = 'personal_a';

select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true('pareja no lee ledger personal ajeno', not exists (
  select 1 from public.transactions where user_id = '54000000-0000-4000-8000-000000000001'
));

select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000003', true);
do $$ begin
  begin
    perform public.get_household_transactions('54200000-0000-4000-8000-000000000001', 100);
    raise exception 'external read household';
  exception when no_data_found then
    insert into test_results values ('externo no usa read models', true);
  end;
end $$;
do $$ begin
  begin
    perform public.get_household_expenses('54200000-0000-4000-8000-000000000001', 100);
    raise exception 'external read household expenses';
  exception when no_data_found then
    insert into test_results values ('externo no usa expenses read model', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '54000000-0000-4000-8000-000000000002', true);
select public.leave_household('54200000-0000-4000-8000-000000000001');
select pg_temp.assert_true('archived conserva read models y no current',
  public.get_current_household() is null
  and jsonb_array_length(public.get_household_accounts('54200000-0000-4000-8000-000000000001')) = 1
  and jsonb_array_length(public.get_household_transactions('54200000-0000-4000-8000-000000000001', 100)) = 5
  and jsonb_array_length(public.get_household_expenses('54200000-0000-4000-8000-000000000001', 100)) = 4
  and (public.get_household_balance_between_members('54200000-0000-4000-8000-000000000001')->>'amount') = '50.00');

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
