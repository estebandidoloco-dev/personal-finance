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
  ('44000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'money-a@example.test', '{"display_name":"Money A"}', now(), now()),
  ('44000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'money-b@example.test', '{"display_name":"Money B"}', now(), now()),
  ('44000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'money-x@example.test', '{"display_name":"Money X"}', now(), now());
insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('44100000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001', 'Personal A', 'checking', 1000),
  ('44100000-0000-4000-8000-000000000002', '44000000-0000-4000-8000-000000000002', 'Personal B', 'checking', 1000);
insert into public.households(id, name, status, created_by_user_id, activated_at)
values ('44200000-0000-4000-8000-000000000001', 'Casa Money', 'active', '44000000-0000-4000-8000-000000000001', now());
insert into public.household_members(household_id, user_id) values
  ('44200000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000001'),
  ('44200000-0000-4000-8000-000000000001', '44000000-0000-4000-8000-000000000002');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('RPCs financieras solo authenticated',
  has_function_privilege('authenticated', 'public.create_shared_expense(uuid,text,uuid,text,date,text,text,jsonb,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_shared_expense(uuid,text,uuid,text,date,text,text,jsonb,uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_shared_expense(uuid,text,uuid,text,date,text,text,jsonb,uuid,text,text)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
insert into payloads values ('account', public.create_household_account(
  '44200000-0000-4000-8000-000000000001', 'Común', 'checking', '100.00'
));
select pg_temp.assert_true('cuenta Household nace MXN y dinero string exacto', (
  select payload->>'currency' = 'MXN'
     and payload->>'initial_balance' = '100.00'
     and payload->>'balance' = '100.00'
     and jsonb_typeof(payload->'balance') = 'string'
    from payloads where label = 'account'
));

insert into payloads values ('income', public.create_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '25.00', '2026-09-05', 'Ingreso', null, 'posted'
));
insert into payloads values ('pending_income', public.create_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '100.00', '2026-09-05', 'Pendiente', null, 'pending'
));
select pg_temp.assert_true('solo posted impacta saldo Household', (
  select balance = 125 from public.household_accounts
   where id = (select (payload->>'id')::uuid from payloads where label = 'account')
));
update payloads set payload = public.update_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'pending_income'),
  (select (payload->>'id')::uuid from payloads where label = 'account'),
  '100.00', '2026-09-05', 'Ahora posted', null, 'posted'
) where label = 'pending_income';
select pg_temp.assert_true('pending a posted aplica una vez', (
  select balance = 225 from public.household_accounts
   where id = (select (payload->>'id')::uuid from payloads where label = 'account')
));
select public.delete_household_account_income(
  (select (payload->>'id')::uuid from payloads where label = 'pending_income')
);
select pg_temp.assert_true('delete income revierte saldo', (
  select balance = 125 from public.household_accounts
   where id = (select (payload->>'id')::uuid from payloads where label = 'account')
));

insert into payloads values ('household_expense', public.create_shared_expense(
  p_household_id => '44200000-0000-4000-8000-000000000001',
  p_funding_source => 'household_account',
  p_source_account_id => (select (payload->>'id')::uuid from payloads where label = 'account'),
  p_amount => '100.00', p_date => '2026-09-05', p_description => 'Súper',
  p_split_mode => 'equal'
));
select pg_temp.assert_true('gasto Household afecta solo saldo común',
  (select balance = 25 from public.household_accounts
    where id = (select (payload->>'id')::uuid from payloads where label = 'account'))
  and (select balance = 1000 from public.accounts where id = '44100000-0000-4000-8000-000000000001')
  and (select payload->>'personal_payer_user_id' is null
         and payload->>'recorded_by_user_id' = '44000000-0000-4000-8000-000000000001'
       from payloads where label = 'household_expense'));

insert into payloads values ('personal_expense', public.create_shared_expense(
  p_household_id => '44200000-0000-4000-8000-000000000001',
  p_funding_source => 'personal_account', p_source_account_id => '44100000-0000-4000-8000-000000000001',
  p_amount => '100.00', p_date => '2026-09-05', p_description => 'Personal A',
  p_split_mode => 'custom', p_splits => jsonb_build_array(
    jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000001', 'amount', '30.00'),
    jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000002', 'amount', '70.00')
  )
));
select pg_temp.assert_true('personal-funded deriva payer actor y saldo personal',
  (select balance = 900 from public.accounts where id = '44100000-0000-4000-8000-000000000001')
  and (select payload->>'personal_payer_user_id' = '44000000-0000-4000-8000-000000000001'
         and payload->>'recorded_by_user_id' = '44000000-0000-4000-8000-000000000001'
       from payloads where label = 'personal_expense'));

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', true);
do $$ begin
  begin
    perform public.delete_shared_expense(
      (select (payload->>'id')::uuid from payloads where label = 'personal_expense')
    );
    raise exception 'partner deleted personal-funded expense';
  exception when no_data_found then
    insert into test_results values ('solo payer muta personal-funded', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
update payloads set payload = public.update_shared_expense(
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense'),
  '44100000-0000-4000-8000-000000000001', '80.00', '2026-09-05',
  'Personal actualizada', 'equal', null, null, null, 'posted'
) where label = 'personal_expense';
select pg_temp.assert_true('update compartido mantiene saldo y split exactos',
  (select balance = 920 from public.accounts where id = '44100000-0000-4000-8000-000000000001')
  and (select count(*) = 2 and sum(amount) = 80
       from public.household_expense_splits
       where household_expense_id = (select (payload->>'id')::uuid from payloads where label = 'personal_expense')));

do $$ begin
  begin
    perform public.delete_financial_transaction(
      (select (payload->>'personal_transaction_id')::uuid from payloads where label = 'personal_expense')
    );
    raise exception 'linked personal transaction deleted directly';
  exception when check_violation then
    insert into test_results values ('ledger personal enlazado rechaza delete aislado', true);
  end;
end $$;

update payloads set payload = public.update_shared_expense(
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense'),
  '44100000-0000-4000-8000-000000000001', '80.00', '2026-09-05',
  'Cancelada', 'equal', null, null, null, 'cancelled'
) where label = 'personal_expense';
select pg_temp.assert_true('posted a cancelled revierte saldo personal', (
  select balance = 1000 from public.accounts where id = '44100000-0000-4000-8000-000000000001'
));
update payloads set payload = public.update_shared_expense(
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense'),
  '44100000-0000-4000-8000-000000000001', '80.00', '2026-09-05',
  'Reposted', 'equal', null, null, null, 'posted'
) where label = 'personal_expense';

insert into payloads values ('custom_zero', public.create_shared_expense(
  p_household_id => '44200000-0000-4000-8000-000000000001',
  p_funding_source => 'household_account',
  p_source_account_id => (select (payload->>'id')::uuid from payloads where label = 'account'),
  p_amount => '10.00', p_date => '2026-09-05', p_description => '100/0',
  p_split_mode => 'custom', p_splits => jsonb_build_array(
    jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000001', 'amount', '10.00'),
    jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000002', 'amount', '0.00')
  )
));
select pg_temp.assert_true('custom permite 100/0', (
  select count(*) = 2 and min(amount) = 0 and max(amount) = 10
    from public.household_expense_splits
   where household_expense_id = (select (payload->>'id')::uuid from payloads where label = 'custom_zero')
));

insert into payloads values ('odd_personal', public.create_shared_expense(
  '44200000-0000-4000-8000-000000000001', 'personal_account',
  '44100000-0000-4000-8000-000000000001', '0.01', '2026-09-05',
  'Centavo personal', 'equal'
));
select pg_temp.assert_true('residuo equal personal va al payer', (
  select amount = 0.01 from public.household_expense_splits
   where household_expense_id = (select (payload->>'id')::uuid from payloads where label = 'odd_personal')
     and user_id = '44000000-0000-4000-8000-000000000001'
));

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000002', true);
insert into payloads values ('odd_household', public.create_shared_expense(
  '44200000-0000-4000-8000-000000000001', 'household_account',
  (select (payload->>'id')::uuid from payloads where label = 'account'), '0.01',
  '2026-09-05', 'Centavo común', 'equal'
));
select pg_temp.assert_true('residuo equal Household va al recorder', (
  select amount = 0.01 from public.household_expense_splits
   where household_expense_id = (select (payload->>'id')::uuid from payloads where label = 'odd_household')
     and user_id = '44000000-0000-4000-8000-000000000002'
));

do $$ begin
  begin
    perform public.create_shared_expense(
      p_household_id => '44200000-0000-4000-8000-000000000001',
      p_funding_source => 'household_account',
      p_source_account_id => (select (payload->>'id')::uuid from payloads where label = 'account'),
      p_amount => '5.00', p_date => '2026-09-05', p_description => 'Split inválido',
      p_split_mode => 'custom', p_splits => jsonb_build_array(
        jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000001', 'amount', '2.50'),
        jsonb_build_object('user_id', '44000000-0000-4000-8000-000000000002', 'amount', '2.49')
      )
    );
    raise exception 'invalid custom split accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('split custom inválido revierte toda la escritura', true);
  end;
end $$;
select pg_temp.assert_true('split fallido no causa drift ni movimiento huérfano',
  (select balance = 14.99 from public.household_accounts
   where id = (select (payload->>'id')::uuid from payloads where label = 'account'))
  and not exists (
    select 1 from public.household_account_transactions where description = 'Split inválido'
  ));

select pg_temp.assert_true('RPC no acepta payer ni recorder forjables', (
  select not ('p_personal_payer_user_id' = any(coalesce(proargnames, '{}'::text[])))
     and not ('p_recorded_by_user_id' = any(coalesce(proargnames, '{}'::text[])))
    from pg_proc where oid = 'public.create_shared_expense(uuid,text,uuid,text,date,text,text,jsonb,uuid,text,text)'::regprocedure
));

do $$ begin
  begin
    perform public.create_shared_expense(
      '44200000-0000-4000-8000-000000000001', 'household_account',
      (select (payload->>'id')::uuid from payloads where label = 'account'), '-0.00',
      '2026-09-05', 'Inválido', 'equal'
    );
    raise exception 'negative zero accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('dinero no canónico rechazado', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000003', true);
do $$ begin
  begin
    perform public.create_household_account(
      '44200000-0000-4000-8000-000000000001', 'Forjada', 'cash', '0.00'
    );
    raise exception 'external created household account';
  exception when no_data_found then
    insert into test_results values ('externo no opera por RPC', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '44000000-0000-4000-8000-000000000001', true);
select public.delete_shared_expense((select (payload->>'id')::uuid from payloads where label = 'odd_personal'));
select public.delete_shared_expense((select (payload->>'id')::uuid from payloads where label = 'personal_expense'));
select public.delete_shared_expense((select (payload->>'id')::uuid from payloads where label = 'household_expense'));
select public.delete_shared_expense((select (payload->>'id')::uuid from payloads where label = 'custom_zero'));
select public.delete_shared_expense((select (payload->>'id')::uuid from payloads where label = 'odd_household'));
select pg_temp.assert_true('delete shared revierte ambos ledgers',
  (select balance = 1000 from public.accounts where id = '44100000-0000-4000-8000-000000000001')
  and (select balance = 125 from public.household_accounts
       where id = (select (payload->>'id')::uuid from payloads where label = 'account')));
reset role;
select pg_temp.assert_true('reconciliación Household sin drift', not exists (
  select 1 from public.household_account_balance_reconciliation where drift <> 0
));
select pg_temp.assert_true('reconciliación numérica no es contrato público',
  not has_table_privilege('authenticated', 'public.household_account_balance_reconciliation', 'SELECT'));

select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
