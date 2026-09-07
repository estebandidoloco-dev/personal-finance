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
select label, gen_random_uuid(), 'contribution-' || gen_random_uuid() || '@example.test'
from unnest(array['a', 'b', 'pending', 'removed', 'outsider', 'foreign_a', 'foreign_b']) label;
insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', email,
       jsonb_build_object('display_name', 'Contribution ' || label), now(), now()
from actors;
insert into fixtures values
  ('household', gen_random_uuid()), ('personal_a', gen_random_uuid()),
  ('personal_b', gen_random_uuid()), ('household_account', gen_random_uuid()),
  ('idempotency', gen_random_uuid()), ('pending_household', gen_random_uuid()),
  ('foreign_household', gen_random_uuid()), ('foreign_personal', gen_random_uuid()),
  ('foreign_household_account', gen_random_uuid()), ('foreign_idempotency', gen_random_uuid());
insert into public.accounts(id, user_id, name, type, initial_balance)
select (select id from fixtures where label = 'personal_a'), (select id from actors where label = 'a'), 'Personal A', 'checking', 10000
union all
select (select id from fixtures where label = 'personal_b'), (select id from actors where label = 'b'), 'Personal B', 'checking', 10000;
insert into public.accounts(id, user_id, name, type, initial_balance)
select (select id from fixtures where label = 'foreign_personal'),
       (select id from actors where label = 'foreign_a'), 'Foreign personal', 'checking', 500;
insert into public.households(id, name, status, created_by_user_id, activated_at)
select (select id from fixtures where label = 'household'), 'Contribution home', 'active',
       (select id from actors where label = 'a'), now()
union all
select (select id from fixtures where label = 'pending_household'), 'Pending home', 'forming',
       (select id from actors where label = 'outsider'), null
union all
select (select id from fixtures where label = 'foreign_household'), 'Foreign contribution home', 'active',
       (select id from actors where label = 'foreign_a'), now();
insert into public.household_members(household_id, user_id)
select (select id from fixtures where label = 'household'), id from actors where label in ('a', 'b')
union all
select (select id from fixtures where label = 'pending_household'), id from actors where label = 'outsider';
insert into public.household_members(household_id, user_id)
select (select id from fixtures where label = 'foreign_household'), id
  from actors where label in ('foreign_a', 'foreign_b');
insert into public.household_invitations(
  household_id, invited_by_user_id, invited_email, token_hash, expires_at
)
select (select id from fixtures where label = 'pending_household'), (select id from actors where label = 'outsider'),
       (select email from actors where label = 'pending'), digest(gen_random_uuid()::text, 'sha256'), now() + interval '1 day';
insert into public.household_accounts(
  id, household_id, name, type, initial_balance, created_by_user_id
)
select (select id from fixtures where label = 'household_account'),
       (select id from fixtures where label = 'household'), 'Common', 'checking', 100,
       (select id from actors where label = 'a')
union all
select (select id from fixtures where label = 'foreign_household_account'),
       (select id from fixtures where label = 'foreign_household'), 'Foreign common', 'checking', 50,
       (select id from actors where label = 'foreign_a');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('contribution RLS and direct DML are least privilege',
  (select relrowsecurity from pg_class where oid = 'public.household_contributions'::regclass)
  and has_column_privilege('authenticated', 'public.household_contributions', 'id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.household_contributions', 'personal_transaction_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.household_contributions', 'idempotency_key', 'SELECT')
  and not has_table_privilege('authenticated', 'public.household_contributions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.household_contributions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.household_contributions', 'DELETE'));
select pg_temp.assert_true('contribution RPC grants are exact',
  has_function_privilege('authenticated', 'public.create_household_contribution(uuid,uuid,uuid,text,date,text,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.cancel_household_contribution(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_household_contribution(uuid,uuid,uuid,text,date,text,uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.create_household_contribution(uuid,uuid,uuid,text,date,text,uuid)', 'EXECUTE')
  and not exists (
    select 1 from aclexplode((select proacl from pg_proc
      where oid = 'public.cancel_household_contribution(uuid)'::regprocedure)) acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ));
select pg_temp.assert_true('dashboard definer and exact-money helper stay least privilege',
  (select prosecdef and pg_get_userbyid(proowner) = 'postgres'
     from pg_proc where oid = 'public.get_dashboard_summary(text)'::regprocedure)
  and (select proconfig = array['search_path=""']
     from pg_proc where oid = 'public.get_dashboard_summary(text)'::regprocedure)
  and not has_function_privilege('authenticated', 'private.format_exact_money(numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.format_exact_money(numeric)', 'EXECUTE')
  and not exists (
    select 1 from aclexplode((select proacl from pg_proc
      where oid = 'private.format_exact_money(numeric)'::regprocedure)) acl
     where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ));

set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'foreign_a'), true);
insert into payloads values ('foreign_contribution', public.create_household_contribution(
  (select id from fixtures where label = 'foreign_household'),
  (select id from fixtures where label = 'foreign_personal'),
  (select id from fixtures where label = 'foreign_household_account'),
  '25.00', current_date, 'Foreign sentinel',
  (select id from fixtures where label = 'foreign_idempotency')
));
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('economic', public.create_personal_transaction_exact(
  (select id from fixtures where label = 'personal_a'), 'expense', '10.00', current_date,
  'Economic expense'
));
insert into payloads values ('dashboard_before', public.get_dashboard_summary('this_month'));
insert into payloads values ('debt_before', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
insert into payloads values ('history_before', public.get_household_activity_page(
  (select id from fixtures where label = 'household')
));

insert into payloads values ('contribution', public.create_household_contribution(
  (select id from fixtures where label = 'household'),
  (select id from fixtures where label = 'personal_a'),
  (select id from fixtures where label = 'household_account'),
  '3000.00', current_date, 'Ahorro compartido',
  (select id from fixtures where label = 'idempotency')
));
select pg_temp.assert_true('create response is exact and private', (
  select payload->>'amount' = '3000.00'
     and jsonb_typeof(payload->'amount') = 'string'
     and payload->>'currency' = 'MXN'
     and payload->>'status' = 'posted'
     and payload->>'contributed_by_user_id' = (select id::text from actors where label = 'a')
     and payload->>'recorded_by_user_id' = (select id::text from actors where label = 'a')
     and payload->>'destination_household_account_id' = (select id::text from fixtures where label = 'household_account')
     and payload->>'note' = 'Ahorro compartido'
     and not payload ? 'source_personal_account_id'
     and not payload ? 'personal_transaction_id'
     and not payload ? 'idempotency_key'
    from payloads where label = 'contribution'
));
reset role;
insert into fixtures
select 'personal_leg', contribution.personal_transaction_id
  from public.household_contributions contribution
 where contribution.id = (select (payload->>'id')::uuid from payloads where label = 'contribution')
union all
select 'household_leg', contribution.household_account_transaction_id
  from public.household_contributions contribution
 where contribution.id = (select (payload->>'id')::uuid from payloads where label = 'contribution');
select pg_temp.assert_true('foreign contribution remains present during isolated assertions',
  exists (
    select 1 from public.household_contributions contribution
     where contribution.id = (select (payload->>'id')::uuid from payloads where label = 'foreign_contribution')
       and contribution.household_id = (select id from fixtures where label = 'foreign_household')
  ));
do $$ begin
  begin
    update public.household_contributions
       set cancelled_at = now(), cancelled_by_user_id = null
     where id = (select (payload->>'id')::uuid from payloads where label = 'contribution');
    raise exception 'partial cancelled_at metadata accepted' using errcode = 'P0002';
  exception when check_violation then
    insert into test_results values ('cancelled_at without cancelled_by rejected', true);
  end;
  begin
    update public.household_contributions
       set cancelled_at = null,
           cancelled_by_user_id = (select id from actors where label = 'a')
     where id = (select (payload->>'id')::uuid from payloads where label = 'contribution');
    raise exception 'partial cancelled_by metadata accepted' using errcode = 'P0002';
  exception when check_violation then
    insert into test_results values ('cancelled_by without cancelled_at rejected', true);
  end;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
select pg_temp.assert_true('create debits personal and credits Household once',
  (select balance = 6990 from public.accounts where id = (select id from fixtures where label = 'personal_a'))
  and (select balance = 3100 from public.household_accounts where id = (select id from fixtures where label = 'household_account'))
  and (select count(id) = 1 from public.household_contributions
        where id = (select (payload->>'id')::uuid from payloads where label = 'contribution'))
  and (select count(*) = 1 from public.transactions
        where id = (select id from fixtures where label = 'personal_leg'))
  and (select count(*) = 1 from public.household_account_transactions
        where id = (select id from fixtures where label = 'household_leg')));

insert into payloads values ('retry', public.create_household_contribution(
  (select id from fixtures where label = 'household'),
  (select id from fixtures where label = 'personal_a'),
  (select id from fixtures where label = 'household_account'),
  '3000.00', current_date, 'Ahorro compartido',
  (select id from fixtures where label = 'idempotency')
));
select pg_temp.assert_true('same idempotency payload returns existing operation',
  (select payload->>'id' from payloads where label = 'retry') =
    (select payload->>'id' from payloads where label = 'contribution')
  and (select count(id) = 1 from public.household_contributions
        where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
do $$ begin
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_a'),
      (select id from fixtures where label = 'household_account'),
      '3000.01', current_date, 'Ahorro compartido',
      (select id from fixtures where label = 'idempotency'));
    raise exception 'different idempotency payload accepted';
  exception when unique_violation then
    insert into test_results values ('different idempotency payload conflicts', true);
  end;
end $$;

insert into payloads values ('dashboard_after', public.get_dashboard_summary('this_month'));
insert into payloads values ('debt_after', public.get_household_balance_between_members(
  (select id from fixtures where label = 'household')
));
select pg_temp.assert_true('dashboard excludes contribution but keeps account balance',
  (select payload#>>'{totals,income}' from payloads where label = 'dashboard_after') =
    (select payload#>>'{totals,income}' from payloads where label = 'dashboard_before')
  and (select payload#>>'{totals,expense}' from payloads where label = 'dashboard_after') =
    (select payload#>>'{totals,expense}' from payloads where label = 'dashboard_before')
  and (select payload#>>'{totals,net}' from payloads where label = 'dashboard_after') =
    (select payload#>>'{totals,net}' from payloads where label = 'dashboard_before')
  and (select payload#>>'{totals,total_balance}' = '6990.00'
         from payloads where label = 'dashboard_after')
  and (select payload->'expenses_by_category' from payloads where label = 'dashboard_after') =
    (select payload->'expenses_by_category' from payloads where label = 'dashboard_before')
  and (select payload->'time_series' from payloads where label = 'dashboard_after') =
    (select payload->'time_series' from payloads where label = 'dashboard_before')
  and (select payload->'recent_transactions' from payloads where label = 'dashboard_after') =
    (select payload->'recent_transactions' from payloads where label = 'dashboard_before')
  and public.get_personal_account((select id from fixtures where label = 'personal_a'))->>'balance' = '6990.00');
select pg_temp.assert_true('contribution changes neither debt nor Household economic history',
  (select payload from payloads where label = 'debt_after') =
    (select payload from payloads where label = 'debt_before')
  and public.get_household_activity_page((select id from fixtures where label = 'household')) =
    (select payload from payloads where label = 'history_before'));

insert into payloads values ('before_injected_failure', jsonb_build_object(
  'personal_balance', (select balance from public.accounts where id = (select id from fixtures where label = 'personal_a')),
  'household_balance', (select balance from public.household_accounts where id = (select id from fixtures where label = 'household_account'))
));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    perform public.update_personal_transaction_exact(
      (select id from fixtures where label = 'personal_leg'),
      (select id from fixtures where label = 'personal_a'), 'expense', '1.00', current_date,
      'Bypass', null, null, false, null, 'posted', '{}'::uuid[]);
    raise exception 'personal contribution leg updated';
  exception when check_violation then
    insert into test_results values ('personal contribution update guard', true);
  end;
  begin
    perform public.delete_personal_transaction((select id from fixtures where label = 'personal_leg'));
    raise exception 'personal contribution leg deleted';
  exception when check_violation then
    insert into test_results values ('personal contribution delete guard', true);
  end;
  begin
    perform public.update_household_account_income(
      (select id from fixtures where label = 'household_leg'),
      (select id from fixtures where label = 'household_account'), '1.00', current_date,
      'Bypass', null, 'posted');
    raise exception 'Household contribution leg updated';
  exception when no_data_found then
    insert into test_results values ('Household contribution update guard', true);
  end;
  begin
    perform public.delete_household_account_income((select id from fixtures where label = 'household_leg'));
    raise exception 'Household contribution leg deleted';
  exception when no_data_found then
    insert into test_results values ('Household contribution delete guard', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
select pg_temp.assert_true('partner can read safe contribution columns',
  (select count(id) = 1 from public.household_contributions
    where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
do $$ begin
  begin
    perform personal_transaction_id from public.household_contributions
     where id = (select (payload->>'id')::uuid from payloads where label = 'contribution');
    raise exception 'partner read private transaction id';
  exception when insufficient_privilege then
    insert into test_results values ('partner cannot discover personal source link', true);
  end;
  begin
    perform public.cancel_household_contribution((select (payload->>'id')::uuid from payloads where label = 'contribution'));
    raise exception 'partner cancelled foreign contribution';
  exception when no_data_found then
    insert into test_results values ('partner cannot cancel foreign contribution', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'pending'), true);
select pg_temp.assert_true('pending invitation has no contribution read access',
  (select count(id) = 0 from public.household_contributions
    where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'outsider'), true);
select pg_temp.assert_true('outsider has no contribution read access',
  (select count(id) = 0 from public.household_contributions
    where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
do $$ begin
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_a'),
      (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'outsider contribution accepted';
  exception when no_data_found then
    insert into test_results values ('outsider contribution denied generically', true);
  end;
end $$;

reset role;
insert into public.household_members(household_id, user_id, status, ended_at)
select (select id from fixtures where label = 'household'),
       (select id from actors where label = 'removed'), 'removed', now();
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'removed'), true);
select pg_temp.assert_true('removed member has no contribution read access',
  (select count(id) = 0 from public.household_contributions
    where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
do $$ begin
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      gen_random_uuid(), (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'removed contribution accepted';
  exception when no_data_found then
    insert into test_results values ('removed member contribution denied generically', true);
  end;
end $$;
reset role;
delete from public.household_members
 where household_id = (select id from fixtures where label = 'household')
   and user_id = (select id from actors where label = 'removed');
set role authenticated;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    update public.household_contributions set cancelled_at = now()
     where id = (select (payload->>'id')::uuid from payloads where label = 'contribution');
    raise exception 'direct contribution update accepted';
  exception when insufficient_privilege then
    insert into test_results values ('direct contribution DML denied', true);
  end;
end $$;
do $$ begin
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_b'),
      (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'foreign personal source accepted';
  exception when no_data_found then
    insert into test_results values ('wrong personal source rejected', true);
  end;
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_a'),
      gen_random_uuid(), '1.00', current_date, null, gen_random_uuid());
    raise exception 'wrong Household destination accepted';
  exception when no_data_found then
    insert into test_results values ('wrong Household destination rejected', true);
  end;
  begin
    perform public.create_household_contribution(
      gen_random_uuid(), (select id from fixtures where label = 'personal_a'),
      (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'wrong Household accepted';
  exception when no_data_found then
    insert into test_results values ('wrong Household rejected', true);
  end;
end $$;
do $$ declare invalid text;
begin
  foreach invalid in array array['0.00', '-0.00', '1e3', '10.001', '01.00'] loop
    begin
      perform public.create_household_contribution(
        (select id from fixtures where label = 'household'),
        (select id from fixtures where label = 'personal_a'),
        (select id from fixtures where label = 'household_account'),
        invalid, current_date, null, gen_random_uuid());
      raise exception 'invalid money accepted: %', invalid;
    exception when invalid_parameter_value then null;
    end;
  end loop;
  insert into test_results values ('noncanonical contribution money rejected', true);
end $$;

reset role;
create function pg_temp.fail_contribution_household_leg()
returns trigger language plpgsql as $$
begin
  raise exception 'Injected second-leg failure' using errcode = 'P0001';
end
$$;
create trigger test_fail_contribution_household_leg
  before insert on public.household_account_transactions
  for each row execute function pg_temp.fail_contribution_household_leg();
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_a'),
      (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'injected second-leg failure accepted' using errcode = 'P0002';
  exception when raise_exception then
    insert into test_results values ('second-leg failure rolls back personal leg', true);
  end;
end $$;
reset role;
drop trigger test_fail_contribution_household_leg on public.household_account_transactions;
select pg_temp.assert_true('second-leg failure leaves no partial transaction',
  not exists (
    select 1 from public.transactions
     where user_id = (select id from actors where label = 'a')
       and account_id = (select id from fixtures where label = 'personal_a')
       and amount = 1 and notes is null
  ));
select pg_temp.assert_true('second-leg failure leaves personal balance unchanged',
  (select balance from public.accounts where id = (select id from fixtures where label = 'personal_a')) =
    (select (payload->>'personal_balance')::numeric from payloads where label = 'before_injected_failure'));
select pg_temp.assert_true('second-leg failure leaves Household balance unchanged',
  (select balance from public.household_accounts where id = (select id from fixtures where label = 'household_account')) =
    (select (payload->>'household_balance')::numeric from payloads where label = 'before_injected_failure'));
set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
update payloads set payload = public.cancel_household_contribution(
  (select (payload->>'id')::uuid from payloads where label = 'contribution')
) where label = 'contribution';
select pg_temp.assert_true('cancel reverses both balances exactly',
  (select balance = 9990 from public.accounts where id = (select id from fixtures where label = 'personal_a'))
  and (select balance = 100 from public.household_accounts where id = (select id from fixtures where label = 'household_account'))
  and (select payload->>'status' = 'cancelled' and payload->>'cancelled_at' is not null
         from payloads where label = 'contribution'));
insert into payloads values ('cancel_retry', public.cancel_household_contribution(
  (select (payload->>'id')::uuid from payloads where label = 'contribution')
));
select pg_temp.assert_true('repeated cancel is idempotent',
  (select balance = 9990 from public.accounts where id = (select id from fixtures where label = 'personal_a'))
  and (select balance = 100 from public.household_accounts where id = (select id from fixtures where label = 'household_account'))
  and (select payload->>'cancelled_at' from payloads where label = 'cancel_retry') =
      (select payload->>'cancelled_at' from payloads where label = 'contribution'));
select pg_temp.assert_true('cancel still does not alter interpersonal debt',
  public.get_household_balance_between_members((select id from fixtures where label = 'household')) =
    (select payload from payloads where label = 'debt_before'));

select public.leave_household((select id from fixtures where label = 'household'));
select pg_temp.assert_true('archived member retains safe contribution read',
  (select count(id) = 1 from public.household_contributions
    where id = (select (payload->>'id')::uuid from payloads where label = 'contribution')));
do $$ begin
  begin
    perform public.cancel_household_contribution((select (payload->>'id')::uuid from payloads where label = 'contribution'));
    raise exception 'closed contribution mutation accepted';
  exception when no_data_found then
    insert into test_results values ('closed Household contribution mutation denied', true);
  end;
  begin
    perform public.create_household_contribution(
      (select id from fixtures where label = 'household'),
      (select id from fixtures where label = 'personal_a'),
      (select id from fixtures where label = 'household_account'),
      '1.00', current_date, null, gen_random_uuid());
    raise exception 'closed contribution create accepted';
  exception when no_data_found then
    insert into test_results values ('closed Household contribution create denied', true);
  end;
end $$;

reset role;
select pg_temp.assert_true('personal ledger reconciliation has zero drift', not exists (
  select 1 from public.account_balance_reconciliation
   where account_id in (
     (select id from fixtures where label = 'personal_a'),
     (select id from fixtures where label = 'foreign_personal')
   ) and drift <> 0
));
select pg_temp.assert_true('Household ledger reconciliation has zero drift', not exists (
  select 1 from public.household_account_balance_reconciliation
   where account_id in (
     (select id from fixtures where label = 'household_account'),
     (select id from fixtures where label = 'foreign_household_account')
   ) and drift <> 0
));
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
