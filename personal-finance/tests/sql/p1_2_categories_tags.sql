\set ON_ERROR_STOP on

begin;

-- Make historical fixed fixtures rerunnable without deleting persistent data.
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
    raise exception 'Refusing to replace non-test users that collide with P1.2 fixture IDs';
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
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'p12-a@example.test', '{"display_name":"P12 A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'p12-b@example.test', '{"display_name":"P12 B"}', now(), now());

insert into public.accounts(id, user_id, name, type, initial_balance, currency) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', '11111111-1111-1111-1111-111111111111', 'A', 'checking', 1000, 'MXN');

insert into public.categories(id, user_id, name, type, color) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1', '11111111-1111-1111-1111-111111111111', 'A propia', 'expense', '#123456'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1', '22222222-2222-2222-2222-222222222222', 'B propia', 'expense', '#123456');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select pg_temp.assert_true('A ve globales', (
  select count(*) > 0 from public.categories where user_id is null
));
select pg_temp.assert_true('A ve su categoría', (
  select count(*) = 1 from public.categories where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1'
));
select pg_temp.assert_true('A no ve categoría B', (
  select count(*) = 0 from public.categories where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1'
));

insert into public.categories(id, user_id, name, type, parent_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac2', auth.uid(), 'Hija', 'expense', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1');
select pg_temp.assert_true('parent propio permitido', (
  select parent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1' from public.categories
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac2'
));

do $$ begin
  begin
    insert into public.categories(user_id, name, type, parent_id)
    values (auth.uid(), 'Padre ajeno', 'expense', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbc1');
    raise exception 'foreign parent accepted';
  exception when check_violation then insert into test_results values ('parent ajeno rechazado', true); end;
end $$;

insert into public.categories(id, user_id, name, type, parent_id)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac3', auth.uid(), 'Nieto', 'expense', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac2');
do $$ begin
  begin
    update public.categories set parent_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac3'
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1';
    raise exception 'cycle accepted';
  exception when check_violation then insert into test_results values ('ciclo indirecto rechazado', true); end;
end $$;

select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 100, 'MXN', '2026-09-01',
  'Categoría eliminable', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1'
);
insert into public.goals(user_id, name, target_amount, category_id)
values (auth.uid(), 'Meta P12', 1000, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1');
insert into public.subscriptions(user_id, name, amount, billing_cycle, next_charge_date, category_id)
values (auth.uid(), 'Suscripción P12', 10, 'monthly', '2026-10-01', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1');

-- A budget reference must block deletion; the transaction/goal/subscription checks use a second category.
insert into public.categories(id, user_id, name, type) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4', auth.uid(), 'Con referencias ledger', 'expense');
select public.create_financial_transaction(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'expense', 25, 'MXN', '2026-09-02',
  'Referencia', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4'
);
insert into public.budgets(user_id, category_id, month, amount)
values (auth.uid(), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4', '2026-09-01', 300);
do $$ begin
  begin
    delete from public.categories where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4';
    raise exception 'budget category deleted';
  exception when foreign_key_violation then insert into test_results values ('budget bloquea borrado', true); end;
end $$;

delete from public.budgets where category_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4';
delete from public.categories where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac1';
select pg_temp.assert_true('transaction conserva fila y nulifica categoría', (
  select count(*) = 1 and bool_and(category_id is null) from public.transactions
  where description = 'Categoría eliminable'
));
select pg_temp.assert_true('goal conserva entidad y nulifica categoría', (
  select count(*) = 1 and bool_and(category_id is null) from public.goals where name = 'Meta P12'
));
select pg_temp.assert_true('subscription conserva entidad y nulifica categoría', (
  select count(*) = 1 and bool_and(category_id is null) from public.subscriptions where name = 'Suscripción P12'
));
select pg_temp.assert_true('hija nulifica parent', (
  select parent_id is null from public.categories where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac2'
));

insert into public.tags(id, user_id, name, color) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaad1', auth.uid(), 'P12 tag', '#abcdef');
select public.update_financial_transaction(
  p_id => (select id from public.transactions where description = 'Referencia'),
  p_account_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  p_kind => 'expense', p_amount => 25, p_currency => 'MXN', p_date => '2026-09-02',
  p_description => 'Referencia', p_category_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaac4',
  p_notes => null, p_is_shared => false, p_split_ratio => null, p_status => 'posted',
  p_tag_ids => array['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaad1']::uuid[]
);
select pg_temp.assert_true('tag propio visible', (select count(*) = 1 from public.tags where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaad1'));
do $$ begin
  begin
    insert into public.tags(user_id, name) values (auth.uid(), 'P12 tag');
    raise exception 'duplicate tag accepted';
  exception when unique_violation then insert into test_results values ('tag duplicado bloqueado', true); end;
end $$;
delete from public.tags where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaad1';
select pg_temp.assert_true('borrar tag no borra transacción', (
  select count(*) = 1 from public.transactions where description = 'Referencia'
));
select pg_temp.assert_true('borrar tag elimina enlace', (
  select count(*) = 0 from public.transaction_tags where tag_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaad1'
));
select public.update_financial_transaction(
  p_id => (select id from public.transactions where description = 'Referencia'),
  p_account_id => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  p_kind => 'expense', p_amount => 25, p_currency => 'MXN', p_date => '2026-09-02',
  p_description => 'Referencia actualizada', p_category_id => null,
  p_notes => 'Nota actualizada', p_is_shared => false, p_split_ratio => null,
  p_status => 'posted', p_tag_ids => '{}'::uuid[]
);
select pg_temp.assert_true('updates no financieros no cambian balance', (
  select balance = 875 from public.accounts where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));
select pg_temp.assert_true('trigger contable solo cubre columnas financieras', (
  select pg_get_triggerdef(oid) like '%UPDATE OF account_id, amount, kind, status%'
  from pg_trigger where tgname = 'transactions_maintain_account_balance'
));
select pg_temp.assert_true('balance sin drift', (
  select drift = 0 from public.account_balance_reconciliation
  where account_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'
));

reset role;
select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;

rollback;
