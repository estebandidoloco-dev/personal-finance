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
  ('24000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test', '{"display_name":"RLS A"}', now(), now()),
  ('24000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test', '{"display_name":"RLS B"}', now(), now()),
  ('24000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'rls-forming@example.test', '{"display_name":"RLS C"}', now(), now()),
  ('24000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'rls-archived@example.test', '{"display_name":"RLS D"}', now(), now()),
  ('24000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'rls-removed@example.test', '{"display_name":"RLS E"}', now(), now()),
  ('24000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'rls-external@example.test', '{"display_name":"RLS F"}', now(), now());

insert into public.households(id, name, created_by_user_id) values
  ('24100000-0000-4000-8000-000000000001', 'Active AB', '24000000-0000-4000-8000-000000000001'),
  ('24100000-0000-4000-8000-000000000002', 'Forming C', '24000000-0000-4000-8000-000000000003'),
  ('24100000-0000-4000-8000-000000000003', 'Closed DE', '24000000-0000-4000-8000-000000000004');
insert into public.household_members(household_id, user_id) values
  ('24100000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001'),
  ('24100000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000002'),
  ('24100000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000003'),
  ('24100000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000004'),
  ('24100000-0000-4000-8000-000000000003', '24000000-0000-4000-8000-000000000005');
update public.households set status = 'active', activated_at = now()
 where id in ('24100000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000003');

insert into public.household_invitations(
  household_id, invited_by_user_id, invited_email, token_hash, expires_at
) values (
  '24100000-0000-4000-8000-000000000002',
  '24000000-0000-4000-8000-000000000003', 'invitee@example.test',
  decode(repeat('11', 32), 'hex'), now() + interval '7 days'
);

insert into public.household_accounts(
  id, household_id, name, type, initial_balance, balance, created_by_user_id
) values
  ('24200000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', 'Active', 'cash', 10, 10, '24000000-0000-4000-8000-000000000001'),
  ('24200000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000003', 'Historic', 'cash', 20, 20, '24000000-0000-4000-8000-000000000004');

insert into public.household_account_transactions(
  id, household_id, account_id, kind, amount, currency, date, description, recorded_by_user_id
) values
  ('24300000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', '24200000-0000-4000-8000-000000000001', 'expense', 5, 'MXN', '2026-09-05', 'Active expense', '24000000-0000-4000-8000-000000000001'),
  ('24300000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000003', '24200000-0000-4000-8000-000000000002', 'expense', 8, 'MXN', '2026-09-05', 'Historic expense', '24000000-0000-4000-8000-000000000004');
insert into public.household_expenses(
  id, household_id, funding_source, recorded_by_user_id,
  household_account_transaction_id, split_mode
) values
  ('24400000-0000-4000-8000-000000000001', '24100000-0000-4000-8000-000000000001', 'household_account', '24000000-0000-4000-8000-000000000001', '24300000-0000-4000-8000-000000000001', 'equal'),
  ('24400000-0000-4000-8000-000000000002', '24100000-0000-4000-8000-000000000003', 'household_account', '24000000-0000-4000-8000-000000000004', '24300000-0000-4000-8000-000000000002', 'equal');
insert into public.household_expense_splits(household_expense_id, user_id, amount) values
  ('24400000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000001', 2.50),
  ('24400000-0000-4000-8000-000000000001', '24000000-0000-4000-8000-000000000002', 2.50),
  ('24400000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000004', 4),
  ('24400000-0000-4000-8000-000000000002', '24000000-0000-4000-8000-000000000005', 4);

update public.households set status = 'closed', closed_at = now()
 where id = '24100000-0000-4000-8000-000000000003';
update public.household_members set status = 'archived', ended_at = now()
 where household_id = '24100000-0000-4000-8000-000000000003';
update public.household_members set status = 'removed'
 where household_id = '24100000-0000-4000-8000-000000000003'
   and user_id = '24000000-0000-4000-8000-000000000005';
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('grants financieros son SELECT-only',
  has_table_privilege('authenticated', 'public.household_accounts', 'SELECT')
  and not has_table_privilege('authenticated', 'public.household_accounts', 'INSERT')
  and not has_table_privilege('authenticated', 'public.household_accounts', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.household_accounts', 'DELETE'));
select pg_temp.assert_true('anon PUBLIC y service_role sin grants Household',
  not has_table_privilege('anon', 'public.households', 'SELECT')
  and not has_table_privilege('public', 'public.households', 'SELECT')
  and not has_table_privilege('service_role', 'public.households', 'SELECT'));
select pg_temp.assert_true('token_hash no se concede a authenticated',
  not has_column_privilege('authenticated', 'public.household_invitations', 'token_hash', 'SELECT')
  and has_column_privilege('authenticated', 'public.household_invitations', 'status', 'SELECT'));
select pg_temp.assert_true('helper privado no acepta identidad forjada', (
  select pronargs = 1
    from pg_proc
   where oid = 'private.household_access_level(uuid)'::regprocedure
));
select pg_temp.assert_true('policies Household son SELECT-only y no usan is_shared',
  not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename like 'household%'
       and (cmd <> 'SELECT' or coalesce(qual, '') ilike '%is_shared%'
            or coalesce(with_check, '') ilike '%is_shared%')
  ));
select pg_temp.assert_true('helper no se expone a anon ni service_role',
  not has_function_privilege('anon', 'private.household_access_level(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.household_access_level(uuid)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true('current active lee su Household y finanzas',
  (select count(*) = 1 from public.households)
  and (select count(*) = 2 from public.household_members)
  and (select count(*) = 1 from public.household_accounts)
  and (select count(*) = 1 from public.household_account_transactions)
  and (select count(*) = 1 from public.household_expenses)
  and (select count(*) = 2 from public.household_expense_splits));

select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000003', true);
select pg_temp.assert_true('forming ve lifecycle pero no finanzas',
  (select count(*) = 1 from public.households)
  and (select count(*) = 1 from public.household_members)
  and (select count(*) = 1 from public.household_invitations)
  and (select count(*) = 0 from public.household_accounts));
do $$ begin
  begin
    perform token_hash from public.household_invitations;
    raise exception 'token_hash was readable';
  exception when insufficient_privilege then
    insert into test_results values ('token hash ilegible directamente', true);
  end;
end $$;

select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000004', true);
select pg_temp.assert_true('archived conserva lectura histórica',
  (select count(*) = 1 from public.households)
  and (select count(*) = 2 from public.household_members)
  and (select count(*) = 1 from public.household_accounts)
  and (select count(*) = 1 from public.household_account_transactions)
  and (select count(*) = 1 from public.household_expenses)
  and (select count(*) = 2 from public.household_expense_splits));

select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000005', true);
select pg_temp.assert_true('removed pierde toda lectura',
  (select count(*) = 0 from public.households)
  and (select count(*) = 0 from public.household_members)
  and (select count(*) = 0 from public.household_accounts));

select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000006', true);
select pg_temp.assert_true('externo obtiene cero filas Household',
  (select count(*) = 0 from public.households)
  and (select count(*) = 0 from public.household_members)
  and (select count(*) = 0 from public.household_accounts)
  and (select count(*) = 0 from public.household_expense_splits));

select set_config('request.jwt.claim.sub', '24000000-0000-4000-8000-000000000003', true);
do $$ begin
  begin
    insert into public.households(name, created_by_user_id)
    values ('Direct write', auth.uid());
    raise exception 'direct insert was accepted';
  exception when insufficient_privilege then
    insert into test_results values ('authenticated no escribe tablas directamente', true);
  end;
end $$;

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;
rollback;
