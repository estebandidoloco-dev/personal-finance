\set ON_ERROR_STOP on

begin;

create temporary table actors(label text primary key, id uuid not null, email text not null);
create temporary table fixtures(label text primary key, id uuid not null);
create temporary table payloads(label text primary key, payload jsonb not null);
create temporary table test_results(test_name text primary key, passed boolean not null);
grant select on actors, fixtures to authenticated;
grant select, insert, update on payloads, test_results to authenticated;
create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into actors
select label, gen_random_uuid(), 'settlement-' || gen_random_uuid() || '@example.test'
from unnest(array['a', 'b', 'pending', 'removed', 'outsider', 'foreign_a', 'foreign_b']) label;
insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', email,
       jsonb_build_object('display_name', 'Settlement ' || label), now(), now()
from actors;

insert into fixtures values
  ('household', gen_random_uuid()), ('personal_a', gen_random_uuid()),
  ('personal_b', gen_random_uuid()), ('idempotency_1', gen_random_uuid()),
  ('idempotency_2', gen_random_uuid()), ('pending_household', gen_random_uuid()),
  ('foreign_household', gen_random_uuid()), ('foreign_personal', gen_random_uuid());

insert into public.accounts(id, user_id, name, type, initial_balance)
select (select id from fixtures where label = 'personal_a'), (select id from actors where label = 'a'), 'Personal A', 'checking', 10000
union all
select (select id from fixtures where label = 'personal_b'), (select id from actors where label = 'b'), 'Personal B', 'checking', 10000
union all
select (select id from fixtures where label = 'foreign_personal'), (select id from actors where label = 'foreign_a'), 'Foreign personal', 'checking', 10000;

insert into public.households(id, name, status, created_by_user_id, activated_at)
select (select id from fixtures where label = 'household'), 'Settlement home', 'active',
       (select id from actors where label = 'a'), now()
union all
select (select id from fixtures where label = 'pending_household'), 'Pending home', 'forming',
       (select id from actors where label = 'outsider'), null
union all
select (select id from fixtures where label = 'foreign_household'), 'Foreign home', 'active',
       (select id from actors where label = 'foreign_a'), now();

insert into public.household_members(household_id, user_id, status, ended_at)
select (select id from fixtures where label = 'household'), id, 'current', null::timestamptz from actors where label in ('a', 'b')
union all
select (select id from fixtures where label = 'pending_household'), id, 'current', null::timestamptz from actors where label = 'outsider'
union all
select (select id from fixtures where label = 'foreign_household'), id, 'current', null::timestamptz from actors where label in ('foreign_a', 'foreign_b');

insert into public.household_invitations(
  household_id, invited_by_user_id, invited_email, token_hash, expires_at
)
select (select id from fixtures where label = 'pending_household'), (select id from actors where label = 'outsider'),
       (select email from actors where label = 'pending'), digest(gen_random_uuid()::text, 'sha256'), now() + interval '1 day';

set constraints all immediate;
set constraints all deferred;

-- 1. Security and RLS verification
select pg_temp.assert_true('settlement RLS and direct DML are least privilege',
  (select relrowsecurity from pg_class where oid = 'public.household_settlements'::regclass)
  and has_column_privilege('authenticated', 'public.household_settlements', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.household_settlements', 'amount', 'SELECT')
  and not has_column_privilege('authenticated', 'public.household_settlements', 'idempotency_key', 'SELECT')
  and not has_table_privilege('authenticated', 'public.household_settlements', 'INSERT')
  and not has_table_privilege('authenticated', 'public.household_settlements', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.household_settlements', 'DELETE'));

select pg_temp.assert_true('settlement RPC grants are exact',
  has_function_privilege('authenticated', 'public.create_household_settlement(uuid,text,date,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_household_settlement(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_balance_between_members(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_household_settlement(uuid,text,date,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_household_settlement(uuid,text,date,text,uuid)', 'EXECUTE')
  and not exists (
    select 1 from aclexplode((select proacl from pg_proc
      where oid = 'public.cancel_household_settlement(uuid)'::regprocedure)) acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ));

-- 2. Test debt none rejection before any expense
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);

do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '50.00', current_date, 'No debt settlement',
      (select id from fixtures where label = 'idempotency_1')
    );
    raise exception 'settlement without debt accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('debt none rejected', true);
  end;
end $$;

-- 3. Create personal expense by user A shared with B (100.00 each)
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('expense', public.create_shared_expense(
  (select id from fixtures where label = 'household'),
  'personal_account',
  (select id from fixtures where label = 'personal_a'),
  '200.00',
  current_date,
  'Shared dinner',
  'equal',
  null,
  null,
  'Dinner notes',
  'posted'
));

insert into payloads values ('balance_initial', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));

select pg_temp.assert_true('expense creates expected interpersonal debt',
  (select payload->>'amount' = '100.00'
      and payload->>'owed_by_user_id' = (select id::text from actors where label = 'b')
      and payload->>'owed_to_user_id' = (select id::text from actors where label = 'a')
     from payloads where label = 'balance_initial'));

-- Snapshot balances and dashboard before settlements
reset role;
insert into payloads values ('personal_a_balance_before', jsonb_build_object('balance', (select balance from public.accounts where id = (select id from fixtures where label = 'personal_a'))));
insert into payloads values ('personal_b_balance_before', jsonb_build_object('balance', (select balance from public.accounts where id = (select id from fixtures where label = 'personal_b'))));
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('dashboard_a_before', public.get_dashboard_summary('this_month'));
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
insert into payloads values ('dashboard_b_before', public.get_dashboard_summary('this_month'));

-- 4. Rejection of unauthorized actors
-- Actor A (creditor / partner, not debtor)
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '50.00', current_date, 'Partner paying',
      gen_random_uuid()
    );
    raise exception 'partner / non-debtor settlement accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('partner / actor no deudor rejected', true);
  end;
end $$;

-- Outsider
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'outsider'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '50.00', current_date, 'Outsider paying',
      gen_random_uuid()
    );
    raise exception 'outsider settlement accepted';
  exception when no_data_found then
    insert into test_results values ('outsider rejected', true);
  end;
end $$;

-- Pending member
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'pending'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '50.00', current_date, 'Pending paying',
      gen_random_uuid()
    );
    raise exception 'pending member settlement accepted';
  exception when no_data_found then
    insert into test_results values ('pending member rejected', true);
  end;
end $$;

-- Removed member
reset role;
insert into public.household_members(household_id, user_id, status, ended_at)
select (select id from fixtures where label = 'household'),
       (select id from actors where label = 'removed'), 'removed', now();
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'removed'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '50.00', current_date, 'Removed paying',
      gen_random_uuid()
    );
    raise exception 'removed member settlement accepted';
  exception when no_data_found then
    insert into test_results values ('removed member rejected', true);
  end;
end $$;

reset role;
delete from public.household_members
 where household_id = (select id from fixtures where label = 'household')
   and user_id = (select id from actors where label = 'removed');
set role authenticated;

-- 5. Overpay rejection
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '100.01', current_date, 'Overpay',
      gen_random_uuid()
    );
    raise exception 'overpay settlement accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('overpay rejected', true);
  end;
end $$;

-- 6. Pago parcial (40.00)
insert into payloads values ('partial_settlement', public.create_household_settlement(
  (select id from fixtures where label = 'household'),
  '40.00',
  current_date,
  'Pago parcial 1',
  (select id from fixtures where label = 'idempotency_1')
));

select pg_temp.assert_true('partial settlement response is exact and private', (
  select payload->>'amount' = '40.00'
     and jsonb_typeof(payload->'amount') = 'string'
     and payload->>'currency' = 'MXN'
     and payload->>'status' = 'posted'
     and payload->>'from_user_id' = (select id::text from actors where label = 'b')
     and payload->>'to_user_id' = (select id::text from actors where label = 'a')
     and payload->>'recorded_by_user_id' = (select id::text from actors where label = 'b')
     and payload->>'note' = 'Pago parcial 1'
     and payload->>'cancelled_at' is null
     and not payload ? 'idempotency_key'
     and not payload ? 'cancelled_by_user_id'
    from payloads where label = 'partial_settlement'
));

insert into payloads values ('balance_after_partial', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));

select pg_temp.assert_true('partial settlement reduces debt exactly to 60.00',
  (select payload->>'amount' = '60.00'
      and payload->>'owed_by_user_id' = (select id::text from actors where label = 'b')
      and payload->>'owed_to_user_id' = (select id::text from actors where label = 'a')
      and (payload->'positions'->0->>'amount' = '60.00' or payload->'positions'->1->>'amount' = '60.00')
      and (payload->'positions'->0->>'amount' = '-60.00' or payload->'positions'->1->>'amount' = '-60.00')
     from payloads where label = 'balance_after_partial'));

-- 7. Idempotency: same payload returns existing record
insert into payloads values ('retry_settlement', public.create_household_settlement(
  (select id from fixtures where label = 'household'),
  '40.00',
  current_date,
  'Pago parcial 1',
  (select id from fixtures where label = 'idempotency_1')
));

select pg_temp.assert_true('idempotency with same payload returns identical settlement',
  (select payload->>'id' from payloads where label = 'retry_settlement') =
  (select payload->>'id' from payloads where label = 'partial_settlement'));

-- 8. Idempotency: conflicting payload raises 23505
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '40.01',
      current_date,
      'Pago parcial modificado',
      (select id from fixtures where label = 'idempotency_1')
    );
    raise exception 'conflicting idempotency accepted';
  exception when unique_violation then
    insert into test_results values ('conflicting idempotency rejected', true);
  end;
end $$;

-- 9. Cancel settlement authorization tests & debt restoration
-- Partner / creditor A attempts to cancel settlement recorded by B
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    perform public.cancel_household_settlement(
      (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
    );
    raise exception 'partner cancel accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('partner cancel rejected', true);
  end;
end $$;

-- Debt remains 60.00 after partner cancel rejection
insert into payloads values ('balance_after_partner_reject', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
select pg_temp.assert_true('debt remains 60.00 after partner cancel rejection',
  (select payload->>'amount' = '60.00' from payloads where label = 'balance_after_partner_reject'));

-- Outsider attempts to cancel settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'outsider'), true);
do $$ begin
  begin
    perform public.cancel_household_settlement(
      (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
    );
    raise exception 'outsider cancel accepted';
  exception when no_data_found then
    insert into test_results values ('outsider cancel rejected', true);
  end;
end $$;

-- Debt remains 60.00 after outsider cancel rejection
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('balance_after_outsider_reject', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
select pg_temp.assert_true('debt remains 60.00 after outsider cancel rejection',
  (select payload->>'amount' = '60.00' from payloads where label = 'balance_after_outsider_reject'));

-- Removed member attempts to cancel settlement
reset role;
insert into public.household_members(household_id, user_id, status, ended_at)
select (select id from fixtures where label = 'household'),
       (select id from actors where label = 'removed'), 'removed', now();
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'removed'), true);
do $$ begin
  begin
    perform public.cancel_household_settlement(
      (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
    );
    raise exception 'removed member cancel accepted';
  exception when no_data_found then
    insert into test_results values ('removed member cancel rejected', true);
  end;
end $$;
reset role;
delete from public.household_members
 where household_id = (select id from fixtures where label = 'household')
   and user_id = (select id from actors where label = 'removed');
set role authenticated;

-- Switch back to debtor / recorder B
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);

-- Debtor / recorder cancels their partial settlement
insert into payloads values ('cancelled_settlement', public.cancel_household_settlement(
  (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
));

select pg_temp.assert_true('cancel settlement marks status cancelled with timestamp',
  (select payload->>'status' = 'cancelled'
      and payload->>'cancelled_at' is not null
     from payloads where label = 'cancelled_settlement'));

-- Check debt restored: debt should now be restored to 100.00!
insert into payloads values ('balance_after_cancel', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));

select pg_temp.assert_true('cancelled settlement restores debt exactly to 100.00',
  (select payload->>'amount' = '100.00'
      and payload->>'owed_by_user_id' = (select id::text from actors where label = 'b')
      and payload->>'owed_to_user_id' = (select id::text from actors where label = 'a')
     from payloads where label = 'balance_after_cancel'));

-- Repeated cancel by recorder: returns identical cancelled record
insert into payloads values ('repeated_cancel', public.cancel_household_settlement(
  (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
));

select pg_temp.assert_true('repeated cancel is idempotent',
  (select payload->>'cancelled_at' from payloads where label = 'repeated_cancel') =
  (select payload->>'cancelled_at' from payloads where label = 'cancelled_settlement'));

-- Check debt remains 100.00 after repeated cancel
insert into payloads values ('balance_after_repeated_cancel', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
select pg_temp.assert_true('debt remains 100.00 after repeated cancel',
  (select payload->>'amount' = '100.00' from payloads where label = 'balance_after_repeated_cancel'));

-- Partner attempting to cancel already cancelled settlement is still rejected
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    perform public.cancel_household_settlement(
      (select (payload->>'id')::uuid from payloads where label = 'partial_settlement')
    );
    raise exception 'partner cancel on already cancelled accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('partner cancel on already cancelled rejected', true);
  end;
end $$;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);

-- 10. Pago total (ahora que la deuda vuelve a ser 100.00)
insert into payloads values ('full_settlement', public.create_household_settlement(
  (select id from fixtures where label = 'household'),
  '100.00',
  current_date,
  'Liquidacion final',
  (select id from fixtures where label = 'idempotency_2')
));

insert into payloads values ('balance_after_full', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));

select pg_temp.assert_true('pago total brings debt to 0.00 with null debtor/creditor',
  (select payload->>'amount' = '0.00'
      and payload->>'owed_by_user_id' is null
      and payload->>'owed_to_user_id' is null
      and payload->'positions'->0->>'amount' = '0.00'
      and payload->'positions'->1->>'amount' = '0.00'
     from payloads where label = 'balance_after_full'));

-- Attempt settlement now that debt is 0.00
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '1.00', current_date, 'Over-settle',
      gen_random_uuid()
    );
    raise exception 'settlement with 0 debt accepted';
  exception when invalid_parameter_value then
    insert into test_results values ('settlement with zero debt rejected', true);
  end;
end $$;

-- 11. No accounts.balance changes and no dashboard economic effects
reset role;
select pg_temp.assert_true('settlements leave personal accounts balance untouched',
  (select balance from public.accounts where id = (select id from fixtures where label = 'personal_a')) =
  (select (payload->>'balance')::numeric from payloads where label = 'personal_a_balance_before')
  and
  (select balance from public.accounts where id = (select id from fixtures where label = 'personal_b')) =
  (select (payload->>'balance')::numeric from payloads where label = 'personal_b_balance_before'));

set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('dashboard_a_after', public.get_dashboard_summary('this_month'));
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
insert into payloads values ('dashboard_b_after', public.get_dashboard_summary('this_month'));

select pg_temp.assert_true('settlements leave dashboard summary untouched',
  (select payload from payloads where label = 'dashboard_a_after') =
  (select payload from payloads where label = 'dashboard_a_before')
  and
  (select payload from payloads where label = 'dashboard_b_after') =
  (select payload from payloads where label = 'dashboard_b_before'));

-- 12. Close household and test archive reads & mutations
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
select public.leave_household((select id from fixtures where label = 'household'));

-- Archived members can still read balance and settlements
insert into payloads values ('archived_balance', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
select pg_temp.assert_true('archived members can read balance',
  (select payload->>'amount' = '0.00' from payloads where label = 'archived_balance'));

select pg_temp.assert_true('archived members can select settlements',
  (select count(*) from public.household_settlements where household_id = (select id from fixtures where label = 'household')) = 2);

-- Closed household rejects new settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$ begin
  begin
    perform public.create_household_settlement(
      (select id from fixtures where label = 'household'),
      '40.00', current_date, 'Post-close settle', gen_random_uuid()
    );
    raise exception 'settlement on closed household accepted';
  exception when no_data_found then
    insert into test_results values ('closed household rejects create settlement', true);
  end;
end $$;

-- Closed household rejects cancel
do $$ begin
  begin
    perform public.cancel_household_settlement(
      (select (payload->>'id')::uuid from payloads where label = 'full_settlement')
    );
    raise exception 'cancel on closed household accepted';
  exception when no_data_found then
    insert into test_results values ('closed household rejects cancel settlement', true);
  end;
end $$;

-- Outsider RLS on settlements
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'outsider'), true);
select pg_temp.assert_true('outsider sees zero settlements via RLS',
  (select count(*) from public.household_settlements where household_id = (select id from fixtures where label = 'household')) = 0);

reset role;

-- Output summary
select count(*) as tests_passed from test_results where passed = true;

rollback;
