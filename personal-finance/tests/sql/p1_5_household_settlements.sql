\set ON_ERROR_STOP on

begin;

create temporary table actors(label text primary key, id uuid not null, email text not null);
create temporary table fixtures(label text primary key, id uuid not null);
create temporary table test_results(test_name text primary key, passed boolean not null);
grant select on actors, fixtures to authenticated;
grant select, insert, update on test_results to authenticated;

create function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then raise exception 'FAIL: %', p_name; end if;
  insert into test_results values (p_name, true);
end
$$;

-- Create actors
insert into actors
select label, gen_random_uuid(), 'settlement-' || gen_random_uuid() || '@example.test'
from unnest(array['a', 'b', 'outsider']) label;

insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
select id, 'authenticated', 'authenticated', email,
       jsonb_build_object('display_name', 'Settlement ' || label), now(), now()
from actors;

insert into fixtures values
  ('household', gen_random_uuid()),
  ('personal_a', gen_random_uuid()),
  ('idempotency_1', gen_random_uuid()),
  ('idempotency_2', gen_random_uuid());

insert into public.accounts(id, user_id, name, type, initial_balance)
select (select id from fixtures where label = 'personal_a'), (select id from actors where label = 'a'), 'Personal A', 'checking', 10000;

insert into public.households(id, name, status, created_by_user_id, activated_at)
values ((select id from fixtures where label = 'household'), 'Settlement household', 'active',
        (select id from actors where label = 'a'), now());

insert into public.household_members(household_id, user_id)
select (select id from fixtures where label = 'household'), id from actors where label in ('a', 'b');

-- 1. Create a shared expense where A pays 100.00, split 50/50 with B
set local role authenticated;
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);

select public.create_shared_expense(
  p_household_id => (select id from fixtures where label = 'household'),
  p_funding_source => 'personal_account',
  p_source_account_id => (select id from fixtures where label = 'personal_a'),
  p_amount => '100.00',
  p_date => current_date,
  p_description => 'Shared dinner',
  p_split_mode => 'equal'
);

-- 2. Verify initial balance: B owes A 50.00
do $$
declare
  b_id uuid;
  a_id uuid;
  h_id uuid;
  bal jsonb;
begin
  select id into a_id from actors where label = 'a';
  select id into b_id from actors where label = 'b';
  select id into h_id from fixtures where label = 'household';

  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Initial debt amount is 50.00', (bal->>'amount') = '50.00');
  perform pg_temp.assert_true('Debtor is B', (bal->>'owed_by_user_id')::uuid = b_id);
  perform pg_temp.assert_true('Creditor is A', (bal->>'owed_to_user_id')::uuid = a_id);
end $$;

-- 3. Actor B tries to settle more than the debt (e.g. 60.00) -> should fail
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  failed boolean := false;
begin
  select id into h_id from fixtures where label = 'household';
  begin
    perform public.create_household_settlement(h_id, '60.00', current_date);
  exception when sqlstate '23514' then
    failed := true;
  end;
  perform pg_temp.assert_true('Exceeding debt fails with 23514', failed);
end $$;

-- 4. Actor B records partial settlement of 20.00
do $$
declare
  h_id uuid;
  a_id uuid;
  b_id uuid;
  idem_1 uuid;
  settlement jsonb;
  bal jsonb;
begin
  select id into a_id from actors where label = 'a';
  select id into b_id from actors where label = 'b';
  select id into h_id from fixtures where label = 'household';
  select id into idem_1 from fixtures where label = 'idempotency_1';

  settlement := public.create_household_settlement(
    h_id, '20.00', current_date, 'Partial settlement', idem_1
  );

  perform pg_temp.assert_true('Settlement amount is 20.00', (settlement->>'amount') = '20.00');
  perform pg_temp.assert_true('Settlement payer is B', (settlement->>'payer_user_id')::uuid = b_id);
  perform pg_temp.assert_true('Settlement payee is A', (settlement->>'payee_user_id')::uuid = a_id);
  perform pg_temp.assert_true('Settlement not cancelled', (settlement->>'is_cancelled')::boolean = false);
  perform pg_temp.assert_true('Settlement entry_type is settlement', (settlement->>'entry_type') = 'settlement');

  -- Balance after 20.00 settlement: debt is now 30.00
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Balance after 20.00 settlement is 30.00', (bal->>'amount') = '30.00');
  perform pg_temp.assert_true('Debtor is still B', (bal->>'owed_by_user_id')::uuid = b_id);
  perform pg_temp.assert_true('Creditor is still A', (bal->>'owed_to_user_id')::uuid = a_id);
end $$;

-- 5. Test idempotency: replaying same settlement returns existing payload
do $$
declare
  h_id uuid;
  idem_1 uuid;
  replayed jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into idem_1 from fixtures where label = 'idempotency_1';

  replayed := public.create_household_settlement(
    h_id, '20.00', current_date, 'Partial settlement', idem_1
  );
  perform pg_temp.assert_true('Idempotent replay succeeds', (replayed->>'amount') = '20.00');
end $$;

-- 6. Record remaining 30.00 settlement
do $$
declare
  h_id uuid;
  idem_2 uuid;
  settlement jsonb;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into idem_2 from fixtures where label = 'idempotency_2';

  settlement := public.create_household_settlement(
    h_id, '30.00', current_date, 'Final settlement', idem_2
  );
  perform pg_temp.assert_true('Second settlement is 30.00', (settlement->>'amount') = '30.00');

  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Balance after full settlement is 0.00', (bal->>'amount') = '0.00');
  perform pg_temp.assert_true('Debtor is null after full settlement', (bal->>'owed_by_user_id') is null);
  perform pg_temp.assert_true('Creditor is null after full settlement', (bal->>'owed_to_user_id') is null);
end $$;

-- 7. Attempting to settle when debt is 0.00 -> fails
do $$
declare
  h_id uuid;
  failed boolean := false;
begin
  select id into h_id from fixtures where label = 'household';
  begin
    perform public.create_household_settlement(h_id, '10.00', current_date);
  exception when sqlstate '23514' then
    failed := true;
  end;
  perform pg_temp.assert_true('Settling zero debt fails with 23514', failed);
end $$;

-- 8. Cancel the first settlement (20.00)
do $$
declare
  h_id uuid;
  s_id uuid;
  cancelled jsonb;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into s_id from public.household_settlements where amount = 20.00 and household_id = h_id;

  cancelled := public.cancel_household_settlement(s_id);
  perform pg_temp.assert_true('Cancelled settlement reports is_cancelled = true', (cancelled->>'is_cancelled')::boolean = true);

  -- Balance should now be 20.00 again!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Balance after cancelling 20.00 settlement is 20.00', (bal->>'amount') = '20.00');
end $$;

-- 9. Activity / Transactions include settlements
do $$
declare
  h_id uuid;
  txs jsonb;
  settlement_count integer := 0;
  elem jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  txs := public.get_household_transactions(h_id, 100);

  for elem in select * from jsonb_array_elements(txs) loop
    if (elem->>'entry_type') = 'settlement' then
      settlement_count := settlement_count + 1;
    end if;
  end loop;

  perform pg_temp.assert_true('Transactions include exactly 2 settlements', settlement_count = 2);
end $$;

reset role;

select * from test_results order by test_name;

rollback;
