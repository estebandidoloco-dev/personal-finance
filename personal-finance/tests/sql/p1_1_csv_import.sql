\set ON_ERROR_STOP on

begin;

-- Fixed IDs are historical contract fixtures. Remove only recognized prior test
-- rows inside this transaction; the final ROLLBACK restores the original state.
do $$
begin
  if exists (
    select 1 from auth.users
     where id in (
       '11111111-1111-1111-1111-111111111111',
       '22222222-2222-2222-2222-222222222222'
     )
       and email not in (
         'csv-a@example.test', 'csv-b@example.test',
         'p12-a@example.test', 'p12-b@example.test',
         'dashboard-a@example.test', 'dashboard-b@example.test'
       )
  ) then
    raise exception 'Refusing to replace non-test users that collide with P1.1 fixture IDs';
  end if;
end
$$;

delete from public.transactions where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.budgets where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.goals where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.subscriptions where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.csv_imports where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.split_rules where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.tags where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.categories where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from public.accounts where user_id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'
);

create temporary table test_results(test_name text primary key, passed boolean not null);
grant select, insert on test_results to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'FAIL: %', p_name;
  end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'csv-a@example.test', '{"display_name":"CSV A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'csv-b@example.test', '{"display_name":"CSV B"}', now(), now());

insert into public.accounts(id, user_id, name, type, initial_balance, currency)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'Cuenta A', 'checking', 1000, 'MXN'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '22222222-2222-2222-2222-222222222222', 'Cuenta B', 'checking', 1000, 'MXN');

insert into public.categories(id, user_id, name, type)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1', '11111111-1111-1111-1111-111111111111', 'Personal A', 'expense'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1', '22222222-2222-2222-2222-222222222222', 'Personal B', 'expense');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

insert into public.csv_imports(
  id, user_id, account_id, file_name, file_hash, rows_total,
  rows_imported, rows_skipped, metadata
) values (
  'aaaaaaaa-0000-0000-0000-000000000001', auth.uid(),
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'first.csv', repeat('a', 64), 3,
  0, 0, '{"source_provider":"bank-a"}'
);

select * from public.import_csv_transactions_batch(
  'aaaaaaaa-0000-0000-0000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1',
  '[
    {"row_number":2,"date":"2026-09-01","description":"Cargo igual","amount":"100.00","kind":"expense","notes":null,"external_id":null},
    {"row_number":3,"date":"2026-09-01","description":"Cargo igual","amount":"100.00","kind":"expense","notes":null,"external_id":null},
    {"row_number":4,"date":"2026-09-02","description":"Ingreso","amount":"50.00","kind":"income","notes":null,"external_id":"EXT-001"}
  ]'::jsonb
);

select pg_temp.assert_true('primer import: tres filas importadas', (
  select count(*) = 3 from public.transactions where csv_import_id = 'aaaaaaaa-0000-0000-0000-000000000001'
));
select pg_temp.assert_true('dos cargos idénticos sin external_id se conservan', (
  select count(*) = 2 from public.transactions
  where csv_import_id = 'aaaaaaaa-0000-0000-0000-000000000001' and description = 'Cargo igual'
));
select pg_temp.assert_true('balance después del primer import', (
  select balance = 850 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));

do $$
begin
  begin
    insert into public.csv_imports(user_id, account_id, file_name, file_hash, rows_total)
    values (auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'same-again.csv', repeat('a', 64), 3);
    raise exception 'duplicate file was accepted';
  exception when unique_violation then
    insert into test_results values ('mismo archivo bloqueado por índice único', true);
  end;
end
$$;
select pg_temp.assert_true('reimportar mismo archivo crea cero movimientos', (
  select count(*) = 3 from public.transactions where user_id = auth.uid() and source = 'csv'
));

insert into public.csv_imports(id, user_id, account_id, file_name, file_hash, rows_total, metadata)
values ('aaaaaaaa-0000-0000-0000-000000000002', auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'external-duplicate.csv', repeat('b', 64), 1, '{"source_provider":"bank-a"}');
select * from public.import_csv_transactions_batch(
  'aaaaaaaa-0000-0000-0000-000000000002', null,
  '[{"row_number":2,"date":"2026-09-05","description":"Otra descripción","amount":"999.00","kind":"expense","external_id":"ext-001"}]'::jsonb
);
select pg_temp.assert_true('external_id repetido es duplicado fuerte', (
  select rows_imported = 0 and rows_duplicate = 1 from public.csv_imports
  where id = 'aaaaaaaa-0000-0000-0000-000000000002'
));

select pg_temp.assert_true('preview marca external_id como duplicate', (
  select strong_duplicate from public.preview_csv_import_rows(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bank-a',
    '[{"row_number":2,"date":"2026-09-06","description":"x","amount":"1.00","kind":"expense","external_id":"EXT-001"}]'::jsonb
  )
));
select pg_temp.assert_true('preview marca heurística como possible_duplicate', (
  select possible_duplicate and not strong_duplicate from public.preview_csv_import_rows(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'bank-a',
    '[{"row_number":2,"date":"2026-09-01","description":"  cargo   IGUAL ","amount":"100.00","kind":"expense","external_id":null}]'::jsonb
  )
));

do $$
begin
  begin
    perform * from public.preview_csv_import_rows(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'bank-a',
      '[{"row_number":2,"date":"2026-09-01","description":"x","amount":"1.00","kind":"expense"}]'::jsonb
    );
    raise exception 'foreign account was accepted';
  exception when no_data_found then
    insert into test_results values ('cuenta ajena rechazada', true);
  end;
end
$$;

do $$
begin
  begin
    insert into public.transactions(user_id, account_id, kind, amount, currency, date, description)
    values (auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 1, 'MXN', '2026-09-01', 'Directa');
    raise exception 'direct ledger insert was accepted';
  exception when insufficient_privilege then
    insert into test_results values ('INSERT directo al ledger rechazado', true);
  end;
end
$$;

insert into public.csv_imports(id, user_id, account_id, file_name, file_hash, rows_total, metadata)
values ('aaaaaaaa-0000-0000-0000-000000000003', auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'mixed.csv', repeat('c', 64), 2, '{"source_provider":"bank-a"}');
select * from public.import_csv_transactions_batch(
  'aaaaaaaa-0000-0000-0000-000000000003', null,
  '[
    {"row_number":2,"date":"2026-09-07","description":"Válida","amount":"25.00","kind":"expense"},
    {"row_number":3,"date":"2026-02-31","description":"Fecha inválida","amount":"10.00","kind":"expense"}
  ]'::jsonb
);
select pg_temp.assert_true('error de fila no revierte la fila válida', (
  select rows_imported = 1 and rows_invalid = 1 from public.csv_imports
  where id = 'aaaaaaaa-0000-0000-0000-000000000003'
));
select pg_temp.assert_true('balance exacto después de batch parcial', (
  select balance = 825 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));

insert into public.csv_imports(id, user_id, account_id, file_name, file_hash, rows_total, metadata)
values ('aaaaaaaa-0000-0000-0000-000000000004', auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
        'structural.csv', repeat('d', 64), 1, '{"source_provider":"bank-a"}');
do $$
declare before_count bigint;
begin
  select count(*) into before_count from public.transactions where user_id = auth.uid();
  begin
    perform * from public.import_csv_transactions_batch(
      'aaaaaaaa-0000-0000-0000-000000000004',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1',
      '[{"row_number":2,"date":"2026-09-08","description":"No debe entrar","amount":"10.00","kind":"expense"}]'::jsonb
    );
    raise exception 'structural error was hidden';
  exception when check_violation then
    if (select count(*) from public.transactions where user_id = auth.uid()) <> before_count then
      raise exception 'structural error changed ledger';
    end if;
    insert into test_results values ('error estructural aborta batch completo', true);
  end;
end
$$;

select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', '10.00', '2026-09-09', 'Manual idéntica'
);
select public.create_personal_transaction_exact(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', '10.00', '2026-09-09', 'Manual idéntica'
);
select pg_temp.assert_true('transacciones manuales idénticas permitidas', (
  select count(*) = 2 from public.transactions where source = 'manual' and description = 'Manual idéntica'
));

select pg_temp.assert_true('reconciliación sin drift', (
  select drift = 0 from public.account_balance_reconciliation
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));
select pg_temp.assert_true('balance final exacto', (
  select balance = 805 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));

reset role;
select pg_temp.assert_true('preview es SECURITY INVOKER', (
  select not prosecdef from pg_proc where oid = 'public.preview_csv_import_rows(uuid,text,jsonb)'::regprocedure
));
select pg_temp.assert_true('batch es SECURITY DEFINER', (
  select prosecdef from pg_proc where oid = 'public.import_csv_transactions_batch(uuid,uuid,jsonb)'::regprocedure
));
select pg_temp.assert_true('anon no ejecuta batch', not has_function_privilege(
  'anon', 'public.import_csv_transactions_batch(uuid,uuid,jsonb)', 'EXECUTE'
));
select pg_temp.assert_true('service_role no ejecuta batch', not has_function_privilege(
  'service_role', 'public.import_csv_transactions_batch(uuid,uuid,jsonb)', 'EXECUTE'
));
select pg_temp.assert_true('authenticated ejecuta batch', has_function_privilege(
  'authenticated', 'public.import_csv_transactions_batch(uuid,uuid,jsonb)', 'EXECUTE'
));

select test_name, case when passed then 'PASS' else 'FAIL' end as result
from test_results order by test_name;
select count(*) as total_pass from test_results where passed;

rollback;
