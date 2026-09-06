begin;

create temporary table actors(label text primary key, id uuid not null, email text not null);
create temporary table fixtures(label text primary key, id uuid not null);
create temporary table test_results(test_name text primary key, passed boolean not null);
create temporary table payloads(label text primary key, payload jsonb not null);
grant select on actors, fixtures to authenticated;
grant insert on fixtures to authenticated;
grant select, insert, update on test_results, payloads to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into actors
select label, gen_random_uuid(), 'handoff-' || gen_random_uuid() || '@example.test'
from unnest(array['a', 'removed', 'outsider']) label;
insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', email,
       jsonb_build_object('display_name', 'Handoff ' || label), now(), now()
from actors;

insert into fixtures values ('archived', gen_random_uuid()), ('current', gen_random_uuid());
insert into public.households(id, name, status, currency, created_by_user_id, created_at, activated_at, closed_at)
select (select id from fixtures where label = 'archived'), 'Archived', 'closed', 'MXN',
       (select id from actors where label = 'a'), now() - interval '3 days', now() - interval '2 days', now() - interval '1 day'
union all
select (select id from fixtures where label = 'current'), 'Current', 'forming', 'MXN',
       (select id from actors where label = 'a'), now(), null, null;
insert into public.household_members(household_id, user_id, status, ended_at)
values
  ((select id from fixtures where label = 'archived'), (select id from actors where label = 'a'), 'archived', now()),
  ((select id from fixtures where label = 'archived'), (select id from actors where label = 'removed'), 'removed', now()),
  ((select id from fixtures where label = 'current'), (select id from actors where label = 'a'), 'current', null);
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('handoff RPC grants use least privilege',
  has_function_privilege('authenticated', 'public.get_archived_households()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_activity_page(uuid,integer,date,timestamp with time zone,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_personal_account(text,text,text,boolean,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_archived_households()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_archived_households()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.create_personal_account(text,text,text,boolean,text)', 'EXECUTE'));
select pg_temp.assert_true('historical numeric transaction RPCs are not public',
  not has_function_privilege('authenticated', 'public.create_financial_transaction(uuid,public.transaction_kind,numeric,text,date,text,uuid,text,boolean,jsonb,text,text,text,uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.update_financial_transaction(uuid,uuid,public.transaction_kind,numeric,text,date,text,uuid,text,boolean,jsonb,text,uuid[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.delete_financial_transaction(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_personal_transaction_exact(uuid,public.transaction_kind,text,date,text,uuid,text,boolean,jsonb,text,uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.update_personal_transaction_exact(uuid,uuid,public.transaction_kind,text,date,text,uuid,text,boolean,jsonb,text,uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.delete_personal_transaction(uuid)', 'EXECUTE'));
select pg_temp.assert_true('PUBLIC anon and service_role have no financial mutation RPCs', not exists (
  select 1
    from unnest(array['public', 'anon', 'service_role']) client_role
    cross join unnest(array[
      'public.create_financial_transaction(uuid,public.transaction_kind,numeric,text,date,text,uuid,text,boolean,jsonb,text,text,text,uuid[])'::regprocedure,
      'public.update_financial_transaction(uuid,uuid,public.transaction_kind,numeric,text,date,text,uuid,text,boolean,jsonb,text,uuid[])'::regprocedure,
      'public.delete_financial_transaction(uuid)'::regprocedure,
      'public.create_personal_account(text,text,text,boolean,text)'::regprocedure,
      'public.create_personal_transaction_exact(uuid,public.transaction_kind,text,date,text,uuid,text,boolean,jsonb,text,uuid[])'::regprocedure,
      'public.update_personal_transaction_exact(uuid,uuid,public.transaction_kind,text,date,text,uuid,text,boolean,jsonb,text,uuid[])'::regprocedure,
      'public.delete_personal_transaction(uuid)'::regprocedure
    ]) procedure_oid
   where has_function_privilege(client_role, procedure_oid, 'EXECUTE')
));
select pg_temp.assert_true('personal table DML is least privilege',
  has_table_privilege('authenticated', 'public.accounts', 'SELECT')
  and has_table_privilege('authenticated', 'public.accounts', 'DELETE')
  and not has_table_privilege('authenticated', 'public.accounts', 'INSERT')
  and not has_column_privilege('authenticated', 'public.accounts', 'initial_balance', 'INSERT')
  and has_column_privilege('authenticated', 'public.accounts', 'name', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'balance', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'initial_balance', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'currency', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'user_id', 'UPDATE')
  and has_table_privilege('authenticated', 'public.transactions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.transactions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.transactions', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.transactions', 'DELETE'));

set role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$ begin
  begin
    insert into public.accounts(user_id, name, type, initial_balance)
    values (auth.uid(), 'Direct rounded', 'checking', 1.235);
    raise exception 'direct account insert accepted';
  exception when insufficient_privilege then
    insert into test_results values ('direct account INSERT denied', true);
  end;
end $$;
select pg_temp.assert_true('archive only returns archived membership, not current',
  jsonb_array_length(public.get_archived_households()) = 1
  and public.get_archived_households()->0->>'id' = (select id::text from fixtures where label = 'archived')
  and public.get_archived_household((select id from fixtures where label = 'archived'))->>'currency' = 'MXN');
select pg_temp.assert_true('archived actor can page history',
  public.get_household_activity_page((select id from fixtures where label = 'archived')) = '[]'::jsonb);

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'removed'), true);
select pg_temp.assert_true('removed membership cannot discover archive',
  public.get_archived_households() = '[]'::jsonb);
do $$ begin
  begin
    perform public.get_archived_household((select id from fixtures where label = 'archived'));
    raise exception 'removed read archive detail';
  exception when no_data_found then
    insert into test_results values ('removed UUID does not authorize', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'outsider'), true);
do $$ begin
  begin
    perform public.get_household_activity_page((select id from fixtures where label = 'archived'));
    raise exception 'outsider read history';
  exception when no_data_found then
    insert into test_results values ('outsider UUID does not authorize', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
insert into payloads values ('account', public.create_personal_account('Exact', 'checking', '999999999999.99'));
insert into fixtures select 'account', (payload->>'id')::uuid from payloads where label = 'account';
select pg_temp.assert_true('personal account RPC preserves exact large strings',
  public.get_personal_account((select id from fixtures where label = 'account'))->>'balance' = '999999999999.99'
  and jsonb_typeof(public.get_personal_account((select id from fixtures where label = 'account'))->'balance') = 'string');
do $$
declare sensitive_column text;
begin
  foreach sensitive_column in array array['balance', 'initial_balance', 'currency'] loop
    begin
      execute format('update public.accounts set %I = %L where id = %L',
        sensitive_column, case when sensitive_column = 'currency' then 'USD' else '1.23' end,
        (select id from fixtures where label = 'account'));
      raise exception 'direct sensitive update accepted: %', sensitive_column;
    exception when insufficient_privilege then
      insert into test_results values ('direct account UPDATE ' || sensitive_column || ' denied', true);
    end;
  end loop;
end $$;
insert into payloads values ('transaction', public.create_personal_transaction_exact(
  (select id from fixtures where label = 'account'), 'expense', '999999999999.99',
  '2026-09-05', 'Pending exact', p_status := 'pending'
));
insert into fixtures select 'transaction', (payload->>'id')::uuid from payloads where label = 'transaction';
select pg_temp.assert_true('personal transaction RPC preserves exact large strings',
  public.get_personal_transaction((select id from fixtures where label = 'transaction'))->>'amount' = '999999999999.99');
update payloads set payload = public.update_personal_transaction_exact(
  (select id from fixtures where label = 'transaction'),
  (select id from fixtures where label = 'account'), 'expense', '999999999999.99',
  '2026-09-05', 'Pending exact updated', null, null, false, null, 'pending', '{}'::uuid[]
) where label = 'transaction';
select pg_temp.assert_true('exact update works for an unlinked transaction',
  (select payload->>'description' = 'Pending exact updated' from payloads where label = 'transaction'));
do $$ begin
  begin
    perform public.create_personal_account('Bad', 'cash', '1e2');
    raise exception 'accepted exponent money';
  exception when invalid_parameter_value then
    insert into test_results values ('DB exact parser rejects exponent', true);
  end;
end $$;
do $$ begin
  begin
    perform public.update_financial_transaction(
      (select id from fixtures where label = 'transaction'),
      (select id from fixtures where label = 'account'), 'expense', 1.235,
      'MXN', '2026-09-05', 'Legacy update attack', null, null, false, null, 'pending', '{}'::uuid[]
    );
    raise exception 'legacy numeric update accepted';
  exception when insufficient_privilege then
    insert into test_results values ('legacy numeric update denied at execution', true);
  end;
end $$;
do $$ begin
  begin
    perform public.delete_financial_transaction((select id from fixtures where label = 'transaction'));
    raise exception 'legacy delete accepted';
  exception when insufficient_privilege then
    insert into test_results values ('legacy delete denied at execution', true);
  end;
end $$;
do $$ begin
  begin
    perform public.create_financial_transaction(
      (select id from fixtures where label = 'account'), 'expense', 1.235,
      'MXN', '2026-09-05', 'Legacy attack'
    );
    raise exception 'legacy numeric create accepted';
  exception when insufficient_privilege then
    insert into test_results values ('legacy numeric create denied at execution', true);
  end;
end $$;
do $$ begin
  begin
    perform public.create_personal_transaction_exact(
      (select id from fixtures where label = 'account'), 'expense', 1.235,
      '2026-09-05', 'Numeric exact attack'
    );
    raise exception 'numeric exact wrapper accepted';
  exception when undefined_function then
    insert into test_results values ('numeric cannot resolve exact wrapper', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'removed'), true);
do $$ begin
  begin
    perform public.get_personal_account((select id from fixtures where label = 'account'));
    raise exception 'Household member read personal account';
  exception when no_data_found then
    insert into test_results values ('Household membership never opens personal data', true);
  end;
end $$;

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
