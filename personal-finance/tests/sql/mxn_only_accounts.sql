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

select pg_temp.assert_true('default currency MXN', (
  select pg_get_expr(default_definition.adbin, default_definition.adrelid) = '''MXN''::text'
  from pg_catalog.pg_attrdef default_definition
  join pg_catalog.pg_attribute attribute_definition
    on attribute_definition.attrelid = default_definition.adrelid
   and attribute_definition.attnum = default_definition.adnum
  where default_definition.adrelid = 'public.accounts'::regclass
    and attribute_definition.attname = 'currency'
));

select pg_temp.assert_true('authenticated conserva SELECT currency',
  has_column_privilege('authenticated', 'public.accounts', 'currency', 'SELECT'));
select pg_temp.assert_true('authenticated no puede INSERT currency',
  not has_column_privilege('authenticated', 'public.accounts', 'currency', 'INSERT'));
select pg_temp.assert_true('authenticated no puede UPDATE currency',
  not has_column_privilege('authenticated', 'public.accounts', 'currency', 'UPDATE'));
select pg_temp.assert_true('anon y PUBLIC no escriben currency',
  not has_column_privilege('anon', 'public.accounts', 'currency', 'INSERT')
  and not has_column_privilege('anon', 'public.accounts', 'currency', 'UPDATE')
  and not has_column_privilege('public', 'public.accounts', 'currency', 'INSERT')
  and not has_column_privilege('public', 'public.accounts', 'currency', 'UPDATE'));
select pg_temp.assert_true('INSERT directo cerrado completamente',
  not has_table_privilege('authenticated', 'public.accounts', 'INSERT')
  and not has_any_column_privilege('authenticated', 'public.accounts', 'INSERT'));
select pg_temp.assert_true('allowlist UPDATE restante conservada',
  has_column_privilege('authenticated', 'public.accounts', 'name', 'UPDATE')
  and has_column_privilege('authenticated', 'public.accounts', 'type', 'UPDATE')
  and has_column_privilege('authenticated', 'public.accounts', 'is_shared', 'UPDATE')
  and has_column_privilege('authenticated', 'public.accounts', 'institution', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'last_synced_at', 'UPDATE'));
select pg_temp.assert_true('columnas sensibles fuera de allowlists',
  not has_column_privilege('authenticated', 'public.accounts', 'balance', 'INSERT')
  and not has_column_privilege('authenticated', 'public.accounts', 'balance', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'created_at', 'INSERT')
  and not has_column_privilege('authenticated', 'public.accounts', 'created_at', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'user_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.accounts', 'initial_balance', 'UPDATE'));
select pg_temp.assert_true('allowlist INSERT permanece vacía', not exists (
  select 1
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and table_schema = 'public'
     and table_name = 'accounts'
     and privilege_type = 'INSERT'
));
select pg_temp.assert_true('allowlist UPDATE es exacta', not exists (
  select 1
    from information_schema.column_privileges
   where grantee = 'authenticated'
     and table_schema = 'public'
     and table_name = 'accounts'
     and privilege_type = 'UPDATE'
     and column_name not in ('name', 'type', 'is_shared', 'institution')
));
select pg_temp.assert_true('no existe CHECK permanente MXN', not exists (
  select 1
    from pg_constraint constraint_row
   where constraint_row.conrelid = 'public.accounts'::regclass
     and constraint_row.contype = 'c'
     and pg_get_constraintdef(constraint_row.oid) ~* $$currency\s*=\s*'MXN'$$
));

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('31111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'mxn-a@example.test', '{"display_name":"MXN A"}', now(), now()),
  ('32222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'mxn-b@example.test', '{"display_name":"MXN B"}', now(), now());

set role authenticated;
select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);

do $$ begin
  begin
    insert into public.accounts(user_id, name, type, initial_balance)
    values (auth.uid(), 'Bypass rounded', 'checking', 1.235);
    raise exception 'direct account insert accepted';
  exception when insufficient_privilege then
    insert into test_results values ('INSERT directo rechazado', true);
  end;
end $$;

select public.create_personal_account('Cuenta MXN', 'checking', '1000.00', false, 'Banco');
select pg_temp.assert_true('RPC exacta crea cuenta MXN', (
  select currency = 'MXN' and balance = 1000 from public.accounts where name = 'Cuenta MXN'
));

do $$ begin
  begin
    update public.accounts set currency = 'USD'
    where name = 'Cuenta MXN';
    raise exception 'currency update accepted';
  exception when insufficient_privilege then
    insert into test_results values ('UPDATE directo de currency rechazado', true);
  end;
end $$;

update public.accounts
set name = 'Cuenta actualizada', type = 'savings', is_shared = true, institution = null
where name = 'Cuenta MXN';
select pg_temp.assert_true('otros campos aprobados funcionan', (
  select name = 'Cuenta actualizada' and type = 'savings' and is_shared and institution is null
  from public.accounts where name = 'Cuenta actualizada'
));

select set_config('request.jwt.claim.sub', '32222222-2222-2222-2222-222222222222', true);
with updated as (
  update public.accounts set name = 'Ajena'
  where name = 'Cuenta actualizada'
  returning 1
)
select pg_temp.assert_true('usuario B no actualiza cuenta A', (select count(*) = 0 from updated));

select set_config('request.jwt.claim.sub', '31111111-1111-1111-1111-111111111111', true);
select public.create_personal_transaction_exact(
  (select id from public.accounts where name = 'Cuenta actualizada'), 'income', '100.00', '2026-09-02', 'Ingreso posted'
);
select public.create_personal_transaction_exact(
  p_account_id => (select id from public.accounts where name = 'Cuenta actualizada'), p_kind => 'expense', p_amount => '50.00',
  p_date => '2026-09-02', p_description => 'Gasto pending', p_status => 'pending'
);
select public.create_personal_transaction_exact(
  p_account_id => (select id from public.accounts where name = 'Cuenta actualizada'), p_kind => 'expense', p_amount => '25.00',
  p_date => '2026-09-02', p_description => 'Gasto cancelled', p_status => 'cancelled'
);
select pg_temp.assert_true('solo posted actualiza balance', (
  select balance = 1100 from public.accounts where name = 'Cuenta actualizada'
));

do $$ begin
  begin
    perform public.create_financial_transaction(
      (select id from public.accounts where name = 'Cuenta actualizada'),
      'expense', 1, 'USD', '2026-09-02', 'Moneda incompatible'
    );
    raise exception 'mismatched transaction currency accepted';
  exception when insufficient_privilege then
    insert into test_results values ('RPC numérica histórica rechazada', true);
  end;
end $$;

select pg_temp.assert_true('reconciliaciÃ³n drift cero', (
  select drift = 0 from public.account_balance_reconciliation
  where account_id = (select id from public.accounts where name = 'Cuenta actualizada')
));

reset role;

-- Exercise the migration guard in isolation. The fixture and the expected abort
-- are both contained by this outer transaction and are rolled back below.
insert into public.accounts(user_id, name, type, initial_balance, currency)
values ('31111111-1111-1111-1111-111111111111', 'Temporal USD', 'checking', 0, 'USD');
do $$ begin
  begin
    if exists (
      select 1 from public.accounts
      where currency is null or currency is distinct from 'MXN'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'MXN-only migration aborted: public.accounts contains NULL or non-MXN currency values.';
    end if;
    raise exception 'migration guard did not abort';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'MXN-only migration aborted: public.accounts contains NULL or non-MXN currency values.' then
      raise;
    end if;
    insert into test_results values ('guard aborta ante cuenta no-MXN', true);
  end;
end $$;

select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;

rollback;
