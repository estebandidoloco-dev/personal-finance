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

create function pg_temp.assert_not_found(p_name text, p_expense_id uuid)
returns void language plpgsql as $$
begin
  begin
    perform public.get_household_expense_detail(p_expense_id);
    raise exception 'FAIL: %', p_name;
  exception when no_data_found then
    insert into test_results values (p_name, true);
  end;
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('57000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'detail-a@example.test', '{"display_name":"Detail A"}', now(), now()),
  ('57000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'detail-b@example.test', '{"display_name":"Detail B"}', now(), now()),
  ('57000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'detail-x@example.test', '{"display_name":"Detail X"}', now(), now()),
  ('57000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'detail-y@example.test', '{"display_name":"Detail Y"}', now(), now());
insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('57100000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000001', 'Private A', 'checking', 500),
  ('57100000-0000-4000-8000-000000000003', '57000000-0000-4000-8000-000000000003', 'Private X', 'checking', 500);
insert into public.households(id, name, status, created_by_user_id, activated_at)
values
  ('57200000-0000-4000-8000-000000000001', 'Detail Casa', 'active', '57000000-0000-4000-8000-000000000001', now()),
  ('57200000-0000-4000-8000-000000000002', 'Other Casa', 'active', '57000000-0000-4000-8000-000000000003', now());
insert into public.household_members(household_id, user_id) values
  ('57200000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000001'),
  ('57200000-0000-4000-8000-000000000001', '57000000-0000-4000-8000-000000000002'),
  ('57200000-0000-4000-8000-000000000002', '57000000-0000-4000-8000-000000000003'),
  ('57200000-0000-4000-8000-000000000002', '57000000-0000-4000-8000-000000000004');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('RPC detail usa privilegio minimo',
  has_function_privilege('authenticated', 'public.get_household_expense_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_expense_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_expense_detail(uuid)', 'EXECUTE'));
select pg_temp.assert_true('RPC detail es stable security definer y search_path vacio', (
  select routine.provolatile = 's'
     and routine.prosecdef
     and exists (
       select 1 from unnest(routine.proconfig) setting
        where setting like 'search_path=%'
     )
    from pg_proc routine
   where routine.oid = 'public.get_household_expense_detail(uuid)'::regprocedure
));

set role authenticated;
select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
insert into payloads values ('household_account', public.create_household_account(
  '57200000-0000-4000-8000-000000000001', 'Comun', 'cash', '100.00'
));
insert into payloads values ('personal_expense', public.create_shared_expense(
  '57200000-0000-4000-8000-000000000001', 'personal_account',
  '57100000-0000-4000-8000-000000000001', '100.01', '2026-09-05',
  'Cena personal', 'custom', jsonb_build_array(
    jsonb_build_object('user_id', '57000000-0000-4000-8000-000000000001', 'amount', '40.00'),
    jsonb_build_object('user_id', '57000000-0000-4000-8000-000000000002', 'amount', '60.01')
  ), null, 'nota solo payer', 'posted'
));
insert into payloads values ('household_expense', public.create_shared_expense(
  '57200000-0000-4000-8000-000000000001', 'household_account',
  (select (payload->>'id')::uuid from payloads where label = 'household_account'),
  '20.00', '2026-09-06', 'Cena comun', 'equal', null, null, 'nota compartida', 'posted'
));

insert into payloads values ('payer_detail', public.get_household_expense_detail(
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense')
));
select pg_temp.assert_true('payer ve cuenta y nota privadas', (
  select payload->>'source_account_id' = '57100000-0000-4000-8000-000000000001'
     and payload->>'notes' = 'nota solo payer'
     and payload->>'amount' = '100.01'
     and payload->>'currency' = 'MXN'
     and payload->>'date' = '2026-09-05'
    from payloads where label = 'payer_detail'
));
select pg_temp.assert_true('contrato detail contiene solo claves congeladas', (
  select array_agg(key order by key) = array[
    'amount','category','category_id','created_at','currency','date','description','funding_source',
    'household_id','id','notes','personal_payer_user_id','recorded_by_user_id',
    'source_account_id','split_mode','splits','status','updated_at'
  ]::text[]
    from payloads, jsonb_object_keys(payload) key
   where label = 'payer_detail'
));
select pg_temp.assert_true('detail contiene dos splits exactos', (
  select jsonb_array_length(payload->'splits') = 2
     and (select sum((split->>'amount')::numeric)
            from jsonb_array_elements(payload->'splits') split) = 100.01
     and not (payload ? 'personal_transaction_id')
     and not (payload ? 'household_account_transaction_id')
    from payloads where label = 'payer_detail'
));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000002', true);
insert into payloads values ('partner_detail', public.get_household_expense_detail(
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense')
));
select pg_temp.assert_true('partner no ve cuenta ni nota personales', (
  select payload->'source_account_id' = 'null'::jsonb
     and payload->'notes' = 'null'::jsonb
     and payload->>'personal_payer_user_id' = '57000000-0000-4000-8000-000000000001'
     and payload->>'amount' = '100.01'
     and payload->>'description' = 'Cena personal'
     and jsonb_array_length(payload->'splits') = 2
    from payloads where label = 'partner_detail'
));
select pg_temp.assert_true('partner ve fuente household y nota compartida', (
  select (detail->>'source_account_id')::uuid =
           (select (payload->>'id')::uuid from payloads where label = 'household_account')
     and detail->>'notes' = 'nota compartida'
     and detail->'personal_payer_user_id' = 'null'::jsonb
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'household_expense')
    ) detail
));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true('payer tambien ve fuente household y nota compartida', (
  select detail->>'source_account_id' =
           (select payload->>'id' from payloads where label = 'household_account')
     and detail->>'notes' = 'nota compartida'
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'household_expense')
    ) detail
));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000003', true);
insert into payloads values ('other_expense', public.create_shared_expense(
  '57200000-0000-4000-8000-000000000002', 'personal_account',
  '57100000-0000-4000-8000-000000000003', '1.00', '2026-09-05',
  'Otro Household', 'equal', null, null, 'otra privada', 'posted'
));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_not_found('ID de otro Household no se puede enumerar',
  (select (payload->>'id')::uuid from payloads where label = 'other_expense'));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_not_found('outsider no obtiene UUID conocido',
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense'));
select pg_temp.assert_not_found('UUID inexistente responde no encontrado', gen_random_uuid());

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000002', true);
select public.leave_household('57200000-0000-4000-8000-000000000001');
select pg_temp.assert_true('miembro archivado conserva detalle read-only',
  public.get_household_expense_detail(
    (select (payload->>'id')::uuid from payloads where label = 'personal_expense')
  )->'source_account_id' = 'null'::jsonb);
select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true('payer archivado conserva cuenta y nota historicas', (
  select detail->>'source_account_id' = '57100000-0000-4000-8000-000000000001'
     and detail->>'notes' = 'nota solo payer'
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'personal_expense')
    ) detail
));

reset role;
update public.household_members
   set status = 'removed', ended_at = coalesce(ended_at, now())
 where household_id = '57200000-0000-4000-8000-000000000001'
   and user_id = '57000000-0000-4000-8000-000000000002';
set constraints all immediate;
set constraints all deferred;
set role authenticated;
select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_not_found('miembro removed no obtiene detalle',
  (select (payload->>'id')::uuid from payloads where label = 'personal_expense'));

select set_config('request.jwt.claim.sub', '57000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true('feed paginado sigue ocultando fuente personal', not exists (
  select 1
    from jsonb_array_elements(public.get_household_expenses_page(
      '57200000-0000-4000-8000-000000000001', 25, null, null, null
    )) item
   where item->>'funding_source' = 'personal_account'
     and (item->'account_id' <> 'null'::jsonb or item->'notes' <> 'null'::jsonb)
));

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
