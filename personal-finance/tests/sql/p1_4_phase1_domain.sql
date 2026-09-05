\set ON_ERROR_STOP on

begin;

create temporary table test_results(test_name text primary key, passed boolean not null);
create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
  ('14000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'phase1-a@example.test', '{"display_name":"Phase1 A"}', now(), now()),
  ('14000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'phase1-b@example.test', '{"display_name":"Phase1 B"}', now(), now()),
  ('14000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'phase1-c@example.test', '{"display_name":"Phase1 C"}', now(), now());

insert into public.households(id, name, created_by_user_id)
values ('14100000-0000-4000-8000-000000000001', 'Casa AB', '14000000-0000-4000-8000-000000000001');
insert into public.household_members(household_id, user_id)
values ('14100000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001');
set constraints all immediate;
set constraints all deferred;

select pg_temp.assert_true('forming tiene exactamente un current', (
  select household.status = 'forming' and count(member_row.*) = 1
    from public.households household
    join public.household_members member_row on member_row.household_id = household.id
   where household.id = '14100000-0000-4000-8000-000000000001'
   group by household.status
));
select pg_temp.assert_true('currency Household default MXN sin CHECK permanente', (
  select household.currency = 'MXN'
     and not exists (
       select 1 from pg_constraint constraint_row
        where constraint_row.conrelid = 'public.households'::regclass
          and constraint_row.contype = 'c'
          and pg_get_constraintdef(constraint_row.oid) ~* $$currency\s*=\s*'MXN'$$
     )
    from public.households household
   where household.id = '14100000-0000-4000-8000-000000000001'
));

do $$ begin
  begin
    insert into public.household_accounts(
      household_id, name, type, created_by_user_id
    ) values (
      '14100000-0000-4000-8000-000000000001', 'No permitida', 'checking',
      '14000000-0000-4000-8000-000000000001'
    );
    raise exception 'forming household accepted a financial account';
  exception when check_violation then
    insert into test_results values ('forming rechaza escrituras financieras', true);
  end;
end $$;

insert into public.household_invitations(
  id, household_id, invited_by_user_id, invited_email, token_hash, expires_at
) values (
  '14500000-0000-4000-8000-000000000001',
  '14100000-0000-4000-8000-000000000001',
  '14000000-0000-4000-8000-000000000001',
  'phase1-b@example.test', decode(repeat('01', 32), 'hex'), now() + interval '7 days'
);

do $$ begin
  begin
    insert into public.household_invitations(
      household_id, invited_by_user_id, invited_email, token_hash, expires_at
    ) values (
      '14100000-0000-4000-8000-000000000001',
      '14000000-0000-4000-8000-000000000001',
      'other@example.test', decode(repeat('02', 32), 'hex'), now() + interval '7 days'
    );
    raise exception 'second pending invitation accepted';
  exception when unique_violation then
    insert into test_results values ('segunda invitación pending rechazada', true);
  end;
end $$;

do $$ begin
  begin
    insert into public.household_members(household_id, user_id)
    values ('14100000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002');
    update public.households
       set status = 'active', activated_at = now()
     where id = '14100000-0000-4000-8000-000000000001';
    set constraints all immediate;
    raise exception 'active household kept a pending invitation';
  exception when check_violation then
    set constraints all deferred;
    insert into test_results values ('active rechaza invitación pending', true);
  end;
end $$;

update public.household_invitations
   set status = 'revoked', resolved_at = now()
 where id = '14500000-0000-4000-8000-000000000001';

insert into public.household_members(household_id, user_id)
values ('14100000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002');
update public.households
   set status = 'active', activated_at = now()
 where id = '14100000-0000-4000-8000-000000000001';
set constraints all immediate;
set constraints all deferred;
select pg_temp.assert_true('active tiene exactamente dos current', (
  select count(*) = 2 from public.household_members
   where household_id = '14100000-0000-4000-8000-000000000001' and status = 'current'
));

do $$ begin
  begin
    insert into public.household_members(household_id, user_id)
    values ('14100000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000003');
    raise exception 'third member accepted';
  exception when check_violation then
    insert into test_results values ('tercer current rechazado', true);
  end;
end $$;

insert into public.households(id, name, created_by_user_id)
values (
  '14100000-0000-4000-8000-000000000002', 'Casa C',
  '14000000-0000-4000-8000-000000000003'
);
insert into public.household_members(household_id, user_id)
values ('14100000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000003');

do $$ begin
  begin
    insert into public.household_members(household_id, user_id)
    values ('14100000-0000-4000-8000-000000000002', '14000000-0000-4000-8000-000000000002');
    raise exception 'user accepted two current memberships';
  exception when unique_violation then
    insert into test_results values ('usuario no puede tener dos memberships current', true);
  end;
end $$;

insert into public.household_accounts(
  id, household_id, name, type, initial_balance, balance, created_by_user_id
) values (
  '14200000-0000-4000-8000-000000000001',
  '14100000-0000-4000-8000-000000000001', 'Común', 'checking', 1000, 1000,
  '14000000-0000-4000-8000-000000000001'
);
insert into public.household_account_transactions(
  id, household_id, account_id, kind, amount, currency, date, description,
  recorded_by_user_id
) values (
  '14300000-0000-4000-8000-000000000001',
  '14100000-0000-4000-8000-000000000001',
  '14200000-0000-4000-8000-000000000001', 'expense', 100, 'MXN', '2026-09-05',
  'Supermercado', '14000000-0000-4000-8000-000000000001'
);
insert into public.household_expenses(
  id, household_id, funding_source, recorded_by_user_id,
  household_account_transaction_id, split_mode
) values (
  '14400000-0000-4000-8000-000000000001',
  '14100000-0000-4000-8000-000000000001', 'household_account',
  '14000000-0000-4000-8000-000000000001',
  '14300000-0000-4000-8000-000000000001', 'equal'
);
insert into public.household_expense_splits(household_expense_id, user_id, amount) values
  ('14400000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000001', 50),
  ('14400000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002', 50);
set constraints all immediate;
set constraints all deferred;

do $$ begin
  begin
    update public.household_account_transactions
       set amount = 101
     where id = '14300000-0000-4000-8000-000000000001';
    set constraints all immediate;
    raise exception 'source amount diverged from splits';
  exception when check_violation then
    set constraints all deferred;
    insert into test_results values ('cambio de source conserva suma exacta', true);
  end;
end $$;

do $$ begin
  begin
    update public.household_account_transactions
       set kind = 'income'
     where id = '14300000-0000-4000-8000-000000000001';
    set constraints all immediate;
    raise exception 'linked source changed to income';
  exception when check_violation then
    set constraints all deferred;
    insert into test_results values ('source enlazada debe seguir siendo expense', true);
  end;
end $$;

do $$ begin
  begin
    update public.household_expense_splits
       set user_id = '14000000-0000-4000-8000-000000000003'
     where household_expense_id = '14400000-0000-4000-8000-000000000001'
       and user_id = '14000000-0000-4000-8000-000000000002';
    set constraints all immediate;
    raise exception 'non-member split accepted';
  exception when check_violation then
    set constraints all deferred;
    insert into test_results values ('split de no miembro rechazado', true);
  end;
end $$;

select pg_temp.assert_true('gasto tiene fuente XOR y dos splits exactos', (
  select expense.personal_payer_user_id is null
     and expense.personal_transaction_id is null
     and expense.household_account_transaction_id is not null
     and count(split.*) = 2
     and sum(split.amount) = 100
    from public.household_expenses expense
    join public.household_expense_splits split on split.household_expense_id = expense.id
   where expense.id = '14400000-0000-4000-8000-000000000001'
   group by expense.personal_payer_user_id, expense.personal_transaction_id,
            expense.household_account_transaction_id
));

do $$ begin
  begin
    update public.household_expense_splits set amount = 49
     where household_expense_id = '14400000-0000-4000-8000-000000000001'
       and user_id = '14000000-0000-4000-8000-000000000002';
    set constraints all immediate;
    raise exception 'invalid split sum accepted';
  exception when check_violation then
    set constraints all deferred;
    insert into test_results values ('suma inválida de splits rechazada', true);
  end;
end $$;

do $$ begin
  begin
    update public.households set status = 'forming', activated_at = null
     where id = '14100000-0000-4000-8000-000000000001';
    raise exception 'active household returned to forming';
  exception when check_violation then
    insert into test_results values ('active no vuelve a forming', true);
  end;
end $$;

update public.households
   set status = 'closed', closed_at = now()
 where id = '14100000-0000-4000-8000-000000000001';
update public.household_members
   set status = 'archived', ended_at = now()
 where household_id = '14100000-0000-4000-8000-000000000001'
   and status = 'current';
set constraints all immediate;
set constraints all deferred;

update public.household_members
   set status = 'removed'
 where household_id = '14100000-0000-4000-8000-000000000001'
   and user_id = '14000000-0000-4000-8000-000000000002';
select pg_temp.assert_true('archived puede pasar a removed sin romper histórico', (
  select status = 'removed'
    from public.household_members
   where household_id = '14100000-0000-4000-8000-000000000001'
     and user_id = '14000000-0000-4000-8000-000000000002'
));

do $$ begin
  begin
    update public.household_accounts
       set name = 'Mutación prohibida'
     where id = '14200000-0000-4000-8000-000000000001';
    raise exception 'closed household accepted a financial write';
  exception when check_violation then
    insert into test_results values ('closed rechaza escrituras financieras', true);
  end;
end $$;

do $$ begin
  begin
    update public.households set status = 'active', closed_at = null
     where id = '14100000-0000-4000-8000-000000000001';
    raise exception 'closed household reopened';
  exception when check_violation then
    insert into test_results values ('closed es terminal', true);
  end;
end $$;

select pg_temp.assert_true('unique compuesto de transacción personal presente', exists (
  select 1 from pg_constraint
   where conrelid = 'public.transactions'::regclass
     and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (id, user_id)'
));

select test_name, 'PASS' as result from test_results order by test_name;
select count(*) as total_pass from test_results;

rollback;
