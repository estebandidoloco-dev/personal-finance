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
  ('59000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'category-a@example.test', '{"display_name":"Category A"}', now(), now()),
  ('59000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'category-b@example.test', '{"display_name":"Category B"}', now(), now()),
  ('59000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'category-x@example.test', '{"display_name":"Category X"}', now(), now());
insert into public.categories(id, user_id, name, color, type, is_system) values
  ('59100000-0000-4000-8000-000000000001', null, 'Vivienda', '#112233', 'expense', true),
  ('59100000-0000-4000-8000-000000000002', '59000000-0000-4000-8000-000000000001', 'Privada', '#445566', 'expense', false);
insert into public.accounts(id, user_id, name, type, initial_balance) values
  ('59200000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001', 'Personal A', 'checking', 1000);
insert into public.households(id, name, status, created_by_user_id, activated_at)
values ('59300000-0000-4000-8000-000000000001', 'Category Casa', 'active', '59000000-0000-4000-8000-000000000001', now());
insert into public.household_members(household_id, user_id) values
  ('59300000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000001'),
  ('59300000-0000-4000-8000-000000000001', '59000000-0000-4000-8000-000000000002');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('helpers y RPCs conservan seguridad',
  not has_function_privilege('anon', 'private.household_global_category_payload(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.household_global_category_payload(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'private.household_global_category_payload(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_transactions(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_transactions(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_transactions(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_expenses(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_expenses(uuid,integer)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_expenses(uuid,integer)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_household_expense_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_household_expense_detail(uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.get_household_expense_detail(uuid)', 'EXECUTE'));

set role authenticated;
select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000001', true);
insert into payloads values ('household_account', public.create_household_account(
  '59300000-0000-4000-8000-000000000001', 'Comun', 'cash', '100.00'
));
insert into payloads values ('categorized', public.create_shared_expense(
  '59300000-0000-4000-8000-000000000001', 'personal_account',
  '59200000-0000-4000-8000-000000000001', '10.00', '2026-09-05',
  'Renta', 'equal', null, '59100000-0000-4000-8000-000000000001', 'privada A', 'posted'
));
insert into payloads values ('uncategorized', public.create_shared_expense(
  '59300000-0000-4000-8000-000000000001', 'household_account',
  (select (payload->>'id')::uuid from payloads where label = 'household_account'),
  '2.00', '2026-09-04', 'Sin categoria', 'equal', null, null, 'compartida', 'posted'
));

select pg_temp.assert_true('detail proyecta categoria global exacta y segura', (
  select detail->'category' = jsonb_build_object(
           'id', '59100000-0000-4000-8000-000000000001',
           'name', 'Vivienda', 'color', '#112233'
         )
     and detail->>'category_id' = '59100000-0000-4000-8000-000000000001'
     and not (detail->'category' ? 'user_id')
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'categorized')
    ) detail
));
select pg_temp.assert_true('detail sin categoria devuelve null',
  public.get_household_expense_detail(
    (select (payload->>'id')::uuid from payloads where label = 'uncategorized')
  )->'category' = 'null'::jsonb);

select pg_temp.assert_true('legacy expenses y dashboard feed proyectan categoria',
  public.get_household_expenses('59300000-0000-4000-8000-000000000001', 100)->0->'category' =
    jsonb_build_object('id', '59100000-0000-4000-8000-000000000001', 'name', 'Vivienda', 'color', '#112233')
  and exists (
    select 1 from jsonb_array_elements(
      public.get_household_transactions('59300000-0000-4000-8000-000000000001', 100)
    ) item
    where item->>'description' = 'Renta' and item->'category'->>'name' = 'Vivienda'
  ));
select pg_temp.assert_true('history y expenses page proyectan la misma categoria',
  exists (
    select 1 from jsonb_array_elements(public.get_household_activity_page(
      '59300000-0000-4000-8000-000000000001', 25, null, null, null
    )) item where item->>'description' = 'Renta' and item->'category'->>'name' = 'Vivienda'
  ) and exists (
    select 1 from jsonb_array_elements(public.get_household_expenses_page(
      '59300000-0000-4000-8000-000000000001', 25, null, null, null
    )) item where item->>'description' = 'Renta' and item->'category'->>'name' = 'Vivienda'
  ));

do $$ begin
  begin
    perform public.create_shared_expense(
      '59300000-0000-4000-8000-000000000001', 'personal_account',
      '59200000-0000-4000-8000-000000000001', '1.00', '2026-09-05',
      'No privada', 'equal', null, '59100000-0000-4000-8000-000000000002'
    );
    raise exception 'personal category accepted';
  exception when check_violation then
    insert into test_results values ('create rechaza categoria personal', true);
  end;
end $$;
do $$ begin
  begin
    perform public.update_shared_expense(
      (select (payload->>'id')::uuid from payloads where label = 'categorized'),
      '59200000-0000-4000-8000-000000000001', '10.00', '2026-09-05',
      'No privada', 'equal', null, '59100000-0000-4000-8000-000000000002',
      'privada A', 'posted'
    );
    raise exception 'personal category update accepted';
  exception when check_violation then
    insert into test_results values ('update rechaza categoria personal', true);
  end;
end $$;

do $$
declare iteration integer;
begin
  for iteration in 1..105 loop
    perform public.create_shared_expense(
      '59300000-0000-4000-8000-000000000001', 'personal_account',
      '59200000-0000-4000-8000-000000000001', '1.00',
      ('2026-06-01'::date + iteration)::date, 'Pagina ' || iteration,
      'equal', null, '59100000-0000-4000-8000-000000000001'
    );
  end loop;
end
$$;
insert into payloads values ('page_one', public.get_household_expenses_page(
  '59300000-0000-4000-8000-000000000001', 100, null, null, null
));
insert into payloads
select 'page_two', public.get_household_expenses_page(
  '59300000-0000-4000-8000-000000000001', 100,
  (payload->99->>'date')::date,
  (payload->99->>'created_at')::timestamptz,
  (payload->99->>'id')::uuid
)
from payloads where label = 'page_one';
select pg_temp.assert_true('pagination mayor a 100 no duplica ni omite', (
  with combined as (
    select item->>'id' id from payloads, jsonb_array_elements(
      case when label = 'page_one' then payload - 100 else payload end
    ) item where label in ('page_one', 'page_two')
  )
  select count(*) = 107 and count(distinct id) = 107 from combined
));
select pg_temp.assert_true('todas las paginas conservan categoria segura', not exists (
  select 1 from payloads, jsonb_array_elements(payload) item
   where label in ('page_one', 'page_two')
     and item->>'description' like 'Pagina %'
     and (item->'category'->>'name' <> 'Vivienda' or item->'category' ? 'user_id')
));

select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000002', true);
select pg_temp.assert_true('partner recibe la misma categoria sin datos personales', (
  select detail->'category'->>'name' = 'Vivienda'
     and not (detail->'category' ? 'user_id')
     and detail->'source_account_id' = 'null'::jsonb
     and detail->'notes' = 'null'::jsonb
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'categorized')
    ) detail
));
select public.leave_household('59300000-0000-4000-8000-000000000001');

select pg_temp.assert_true('partner archived conserva categoria y privacidad', (
  select detail->'category'->>'name' = 'Vivienda'
     and detail->'source_account_id' = 'null'::jsonb
     and detail->'notes' = 'null'::jsonb
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'categorized')
    ) detail
));
select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000001', true);
select pg_temp.assert_true('payer archived conserva categoria y privacidad contextual', (
  select detail->'category'->>'name' = 'Vivienda'
     and detail->>'source_account_id' = '59200000-0000-4000-8000-000000000001'
     and detail->>'notes' = 'privada A'
    from public.get_household_expense_detail(
      (select (payload->>'id')::uuid from payloads where label = 'categorized')
    ) detail
));
select pg_temp.assert_true('categoria historica aparece en archived history', exists (
  select 1 from jsonb_array_elements(public.get_household_activity_page(
    '59300000-0000-4000-8000-000000000001', 100, null, null, null
  )) item where item->>'description' = 'Renta' and item->'category'->>'name' = 'Vivienda'
));
select public.create_household('Casa actual posterior');
select pg_temp.assert_true('Household current nuevo no interfiere con archived anterior',
  public.get_archived_household('59300000-0000-4000-8000-000000000001')->>'status' = 'closed'
  and jsonb_array_length(public.get_household_members('59300000-0000-4000-8000-000000000001')) = 2
  and public.get_household_balance_between_members('59300000-0000-4000-8000-000000000001')->>'currency' = 'MXN');

select set_config('request.jwt.claim.sub', '59000000-0000-4000-8000-000000000003', true);
do $$ begin
  begin
    perform public.get_household_expenses_page(
      '59300000-0000-4000-8000-000000000001', 25, null, null, null
    );
    raise exception 'outsider read accepted';
  exception when no_data_found then
    insert into test_results values ('outsider no lee categoria ni archivo', true);
  end;
end $$;

reset role;
select test_name, 'PASS' result from test_results order by test_name;
select count(*) total_pass from test_results;
rollback;
