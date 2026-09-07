\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
create temporary table fixtures(label text primary key, id uuid not null);
create temporary table payloads(label text primary key, payload jsonb not null);
grant select, insert, update, delete on test_results, fixtures, payloads to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

create function pg_temp.assert_not_found(p_name text, p_household_id uuid)
returns void language plpgsql as $$
begin
  begin
    perform public.get_household_balance_between_members(p_household_id);
    raise exception 'FAIL: %', p_name;
  exception when no_data_found then
    insert into test_results values (p_name, true);
  end;
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('5a000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'balance-a@example.test', '{"display_name":"Balance A"}', now(), now()),
  ('5a000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'balance-b@example.test', '{"display_name":"Balance B"}', now(), now()),
  ('5a000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'balance-c@example.test', '{"display_name":"Balance C"}', now(), now()),
  ('5a000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'balance-x@example.test', '{"display_name":"Balance X"}', now(), now());
insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('5a100000-0000-4000-8000-000000000002', '5a000000-0000-4000-8000-000000000002', 'Personal B', 'checking', 1000);

select pg_temp.assert_true('definicion efectiva unica y corregida', (
  select count(*) = 1
     and bool_and(routine.provolatile = 's')
     and bool_and(routine.prosecdef)
     and bool_and(pg_get_functiondef(routine.oid) like '%member_count not in (1, 2)%')
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
   where namespace.nspname = 'public'
     and routine.proname = 'get_household_balance_between_members'
));
select pg_temp.assert_true('balance mantiene grants minimos',
  has_function_privilege('authenticated', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_balance_between_members(uuid)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000001', true);
insert into fixtures values ('solo_archived_source', public.create_household('Solo archived'));
select public.leave_household((select id from fixtures where label = 'solo_archived_source'));
insert into payloads values ('solo_balance', public.get_household_balance_between_members(
  (select id from fixtures where label = 'solo_archived_source')
));
select pg_temp.assert_true('forming cerrado de un miembro devuelve balance cero exacto', (
  select jsonb_array_length(payload->'positions') = 1
     and payload->'positions'->0->>'user_id' = '5a000000-0000-4000-8000-000000000001'
     and payload->'positions'->0->>'amount' = '0.00'
     and jsonb_typeof(payload->'positions'->0->'amount') = 'string'
     and payload->'owed_by_user_id' = 'null'::jsonb
     and payload->'owed_to_user_id' = 'null'::jsonb
     and payload->>'amount' = '0.00'
    from payloads where label = 'solo_balance'
));
insert into fixtures values ('a_current', public.create_household('A current nuevo'));
select pg_temp.assert_true('current nuevo no interfiere con balance archived de un miembro',
  public.get_household_balance_between_members(
    (select id from fixtures where label = 'solo_archived_source')
  )->>'amount' = '0.00');

reset role;
insert into public.households(id, name, status, created_by_user_id, activated_at)
values ('5a200000-0000-4000-8000-000000000001', 'Pareja BC', 'active', '5a000000-0000-4000-8000-000000000002', now());
insert into public.household_members(household_id, user_id) values
  ('5a200000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000002'),
  ('5a200000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000003');
set constraints all immediate;
set constraints all deferred;
set role authenticated;
select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000002', true);
insert into payloads values ('household_account', public.create_household_account(
  '5a200000-0000-4000-8000-000000000001', 'Comun', 'cash', '100.00'
));
insert into payloads values ('posted_personal', public.create_shared_expense(
  '5a200000-0000-4000-8000-000000000001', 'personal_account',
  '5a100000-0000-4000-8000-000000000002', '20.00', '2026-09-06',
  'Personal posted', 'equal', null, null, null, 'posted'
));
insert into payloads values ('pending_personal', public.create_shared_expense(
  '5a200000-0000-4000-8000-000000000001', 'personal_account',
  '5a100000-0000-4000-8000-000000000002', '50.00', '2026-09-06',
  'Personal pending', 'equal', null, null, null, 'pending'
));
insert into payloads values ('household_funded', public.create_shared_expense(
  '5a200000-0000-4000-8000-000000000001', 'household_account',
  (select (payload->>'id')::uuid from payloads where label = 'household_account'),
  '80.00', '2026-09-06', 'Household funded', 'equal', null, null, null, 'posted'
));
insert into payloads values ('active_balance', public.get_household_balance_between_members(
  '5a200000-0000-4000-8000-000000000001'
));
select pg_temp.assert_true('active conserva formula solo personal posted', (
  select payload->>'amount' = '10.00'
     and payload->>'owed_by_user_id' = '5a000000-0000-4000-8000-000000000003'
     and payload->>'owed_to_user_id' = '5a000000-0000-4000-8000-000000000002'
     and (select sum((position->>'amount')::numeric)
            from jsonb_array_elements(payload->'positions') position) = 0
     and jsonb_typeof(payload->'amount') = 'string'
     and not (concat_ws('', payload->>'amount', payload->'positions'->0->>'amount',
                         payload->'positions'->1->>'amount') ~ '[eE,#[:space:]]')
    from payloads where label = 'active_balance'
));

select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000003', true);
select public.leave_household('5a200000-0000-4000-8000-000000000001');
select pg_temp.assert_true('archived B y C conservan mismo balance',
  public.get_household_balance_between_members('5a200000-0000-4000-8000-000000000001') =
  (select payload from payloads where label = 'active_balance'));
select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true('payer archived obtiene balance 200 equivalente',
  public.get_household_balance_between_members('5a200000-0000-4000-8000-000000000001') =
  (select payload from payloads where label = 'active_balance'));
insert into fixtures values ('b_current', public.create_household('B current nuevo'));
select public.create_household_invitation(
  (select id from fixtures where label = 'b_current'), 'balance-x@example.test'
);

select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000004', true);
select pg_temp.assert_not_found('pending invite no concede balance ajeno',
  '5a200000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_not_found('outsider denied', '5a200000-0000-4000-8000-000000000001');
select pg_temp.assert_not_found('unknown Household denied', gen_random_uuid());

reset role;
update public.household_members
   set status = 'removed', ended_at = coalesce(ended_at, now())
 where household_id = '5a200000-0000-4000-8000-000000000001'
   and user_id = '5a000000-0000-4000-8000-000000000003';
set role authenticated;
select set_config('request.jwt.claim.sub', '5a000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_not_found('removed denied', '5a200000-0000-4000-8000-000000000001');

reset role;
select test_name, 'PASS' result from test_results order by test_name;
select count(*) total_pass from test_results;
rollback;
