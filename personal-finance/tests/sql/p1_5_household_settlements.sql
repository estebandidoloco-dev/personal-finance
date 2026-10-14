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
  insert into test_results values (p_name, true) on conflict (test_name) do nothing;
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
  ('personal_b', gen_random_uuid()),
  ('household_acct', gen_random_uuid()),
  ('idempotency_1', gen_random_uuid()),
  ('idempotency_2', gen_random_uuid()),
  ('idempotency_3', gen_random_uuid()),
  ('idempotency_4', gen_random_uuid());

insert into public.accounts(id, user_id, name, type, initial_balance)
values
  ((select id from fixtures where label = 'personal_a'), (select id from actors where label = 'a'), 'Personal A', 'checking', 10000),
  ((select id from fixtures where label = 'personal_b'), (select id from actors where label = 'b'), 'Personal B', 'checking', 1000);

insert into public.households(id, name, status, created_by_user_id, activated_at)
values ((select id from fixtures where label = 'household'), 'Settlement household', 'active',
        (select id from actors where label = 'a'), now());

insert into public.household_members(household_id, user_id)
select (select id from fixtures where label = 'household'), id from actors where label in ('a', 'b');

insert into public.household_accounts(id, household_id, name, type, initial_balance, currency, status, created_by_user_id)
values ((select id from fixtures where label = 'household_acct'), (select id from fixtures where label = 'household'), 'Common Pool', 'checking', 500.00, 'MXN', 'active', (select id from actors where label = 'a'));

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
  perform pg_temp.assert_true('No pending settlement initially', (bal->>'pending_settlement') is null);
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

-- 4. Actor B records partial cash settlement of 20.00
do $$
declare
  h_id uuid;
  a_id uuid;
  b_id uuid;
  idem_1 uuid;
  settlement jsonb;
  bal jsonb;
  failed boolean := false;
  s_id uuid;
begin
  select id into a_id from actors where label = 'a';
  select id into b_id from actors where label = 'b';
  select id into h_id from fixtures where label = 'household';
  select id into idem_1 from fixtures where label = 'idempotency_1';

  settlement := public.create_household_settlement(
    h_id, '20.00', current_date, 'Partial cash settlement', idem_1, 'cash'
  );
  s_id := (settlement->>'id')::uuid;

  perform pg_temp.assert_true('Settlement amount is 20.00', (settlement->>'amount') = '20.00');
  perform pg_temp.assert_true('Settlement payer is B', (settlement->>'payer_user_id')::uuid = b_id);
  perform pg_temp.assert_true('Settlement payee is A', (settlement->>'payee_user_id')::uuid = a_id);
  perform pg_temp.assert_true('Settlement status is pending', (settlement->>'status') = 'pending');
  perform pg_temp.assert_true('Settlement funding_source is cash', (settlement->>'funding_source') = 'cash');
  perform pg_temp.assert_true('Settlement not cancelled', (settlement->>'is_cancelled')::boolean = false);

  -- Balance before confirmation: debt is STILL 50.00, but pending_settlement is present!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Debt remains 50.00 while settlement is pending', (bal->>'amount') = '50.00');
  perform pg_temp.assert_true('Pending settlement id matches', (bal->'pending_settlement'->>'id')::uuid = s_id);
  perform pg_temp.assert_true('Pending settlement amount is 20.00', (bal->'pending_settlement'->>'amount') = '20.00');

  -- Payer B tries to self-confirm -> must fail
  begin
    perform public.confirm_household_settlement(s_id);
  exception when sqlstate '23514' then
    failed := true;
  end;
  perform pg_temp.assert_true('Payer cannot self-confirm settlement', failed);
end $$;

-- 5. Recipient A confirms the 20.00 cash settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$
declare
  h_id uuid;
  a_id uuid;
  b_id uuid;
  s_id uuid;
  confirmed jsonb;
  bal jsonb;
begin
  select id into a_id from actors where label = 'a';
  select id into b_id from actors where label = 'b';
  select id into h_id from fixtures where label = 'household';
  select id into s_id from public.household_settlements where amount = 20.00 and household_id = h_id;

  confirmed := public.confirm_household_settlement(s_id);
  perform pg_temp.assert_true('Confirmed settlement status is confirmed', (confirmed->>'status') = 'confirmed');

  -- Balance after confirmation: debt is now 30.00, pending_settlement is null
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Debt is 30.00 after confirmation', (bal->>'amount') = '30.00');
  perform pg_temp.assert_true('Pending settlement is cleared after confirmation', (bal->>'pending_settlement') is null);
  perform pg_temp.assert_true('Debtor is still B', (bal->>'owed_by_user_id')::uuid = b_id);
  perform pg_temp.assert_true('Creditor is still A', (bal->>'owed_to_user_id')::uuid = a_id);
end $$;

-- 6. Test rejection workflow: B creates 10.00 in_kind settlement, A rejects it
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  idem_2 uuid;
  settlement jsonb;
  s_id uuid;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into idem_2 from fixtures where label = 'idempotency_2';

  settlement := public.create_household_settlement(
    h_id, '10.00', current_date, 'In-kind payment', idem_2, 'in_kind'
  );
  s_id := (settlement->>'id')::uuid;
  perform pg_temp.assert_true('In-kind settlement created as pending', (settlement->>'status') = 'pending');
  perform pg_temp.assert_true('In-kind funding_source is in_kind', (settlement->>'funding_source') = 'in_kind');
end $$;

-- Recipient A rejects the settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$
declare
  h_id uuid;
  s_id uuid;
  rejected jsonb;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into s_id from public.household_settlements where amount = 10.00 and household_id = h_id;

  rejected := public.reject_household_settlement(s_id);
  perform pg_temp.assert_true('Settlement status is rejected', (rejected->>'status') = 'rejected');

  -- Balance remains 30.00 untouched!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Balance untouched at 30.00 after rejection', (bal->>'amount') = '30.00');
  perform pg_temp.assert_true('No pending settlement after rejection', (bal->>'pending_settlement') is null);
end $$;

-- 7. Test personal_account funding source:
-- B creates 15.00 settlement funded from personal account
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  b_acct uuid;
  idem_3 uuid;
  settlement jsonb;
  b_bal numeric;
  tx_status text;
begin
  select id into h_id from fixtures where label = 'household';
  select id into b_acct from fixtures where label = 'personal_b';
  select id into idem_3 from fixtures where label = 'idempotency_3';

  settlement := public.create_household_settlement(
    h_id, '15.00', current_date, 'Personal bank transfer', idem_3, 'personal_account', b_acct, null
  );

  -- Payer B personal account balance must be untouched (1000.00) while pending!
  select balance into b_bal from public.accounts where id = b_acct;
  perform pg_temp.assert_true('Personal account balance unchanged while pending (1000.00)', b_bal = 1000.00);

  -- Linked personal transaction must have status pending
  select status into tx_status from public.transactions
   where id = (select personal_transaction_id from public.household_settlements where id = (settlement->>'id')::uuid);
  perform pg_temp.assert_true('Linked personal transaction status is pending', tx_status = 'pending');
end $$;

-- A confirms the personal account settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$
declare
  h_id uuid;
  s_id uuid;
  b_acct uuid;
  b_bal numeric;
  bal jsonb;
  tx_status text;
begin
  select id into h_id from fixtures where label = 'household';
  select id into b_acct from fixtures where label = 'personal_b';
  select id into s_id from public.household_settlements where amount = 15.00 and household_id = h_id;

  perform public.confirm_household_settlement(s_id);

  -- Interpersonal debt is now 15.00!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Interpersonal debt reduced to 15.00', (bal->>'amount') = '15.00');
end $$;

-- Switch to Actor B to verify Actor B's personal ledger (under RLS)
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  s_id uuid;
  b_acct uuid;
  b_bal numeric;
  tx_status text;
begin
  select id into h_id from fixtures where label = 'household';
  select id into b_acct from fixtures where label = 'personal_b';
  select id into s_id from public.household_settlements where amount = 15.00 and household_id = h_id;

  -- Linked personal transaction is now posted!
  select status into tx_status from public.transactions
   where id = (select personal_transaction_id from public.household_settlements where id = s_id);
  perform pg_temp.assert_true('Linked personal transaction status is posted after confirmation', tx_status = 'posted');

  -- Personal balance updated to 985.00!
  select balance into b_bal from public.accounts where id = b_acct;
  perform pg_temp.assert_true('Personal balance debited to 985.00 after confirmation', b_bal = 985.00);
end $$;

-- 8. Test household_account funding source:
-- B creates 15.00 settlement funded from household account (common pool)
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  h_acct uuid;
  idem_4 uuid;
  settlement jsonb;
  h_bal numeric;
  tx_status text;
begin
  select id into h_id from fixtures where label = 'household';
  select id into h_acct from fixtures where label = 'household_acct';
  select id into idem_4 from fixtures where label = 'idempotency_4';

  settlement := public.create_household_settlement(
    h_id, '15.00', current_date, 'From pool', idem_4, 'household_account', null, h_acct
  );

  -- Household account balance must be untouched (500.00) while pending!
  select balance into h_bal from public.household_accounts where id = h_acct;
  perform pg_temp.assert_true('Household account balance unchanged while pending (500.00)', h_bal = 500.00);

  select status into tx_status from public.household_account_transactions
   where id = (select household_account_transaction_id from public.household_settlements where id = (settlement->>'id')::uuid);
  perform pg_temp.assert_true('Linked household transaction status is pending', tx_status = 'pending');
end $$;

-- A confirms the household account settlement
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'a'), true);
do $$
declare
  h_id uuid;
  h_acct uuid;
  s_id uuid;
  h_bal numeric;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into h_acct from fixtures where label = 'household_acct';
  select id into s_id from public.household_settlements where amount = 15.00 and funding_source = 'household_account' and household_id = h_id;

  perform public.confirm_household_settlement(s_id);

  -- Household balance updated to 485.00!
  select balance into h_bal from public.household_accounts where id = h_acct;
  perform pg_temp.assert_true('Household balance debited to 485.00 after confirmation', h_bal = 485.00);

  -- Interpersonal debt is now 0.00!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Interpersonal debt fully settled (0.00)', (bal->>'amount') = '0.00');
  perform pg_temp.assert_true('Debtor is null after full settlement', (bal->>'owed_by_user_id') is null);
  perform pg_temp.assert_true('Creditor is null after full settlement', (bal->>'owed_to_user_id') is null);
end $$;

-- 9. Test cancellation of confirmed personal account settlement (15.00)
-- B cancels the 15.00 personal settlement -> account balance restored to 1000.00, debt restored to 15.00!
select set_config('request.jwt.claim.sub', (select id::text from actors where label = 'b'), true);
do $$
declare
  h_id uuid;
  b_acct uuid;
  s_id uuid;
  cancelled jsonb;
  b_bal numeric;
  bal jsonb;
begin
  select id into h_id from fixtures where label = 'household';
  select id into b_acct from fixtures where label = 'personal_b';
  select id into s_id from public.household_settlements where amount = 15.00 and funding_source = 'personal_account' and household_id = h_id;

  cancelled := public.cancel_household_settlement(s_id);
  perform pg_temp.assert_true('Cancelled settlement status is cancelled', (cancelled->>'status') = 'cancelled');
  perform pg_temp.assert_true('is_cancelled is true', (cancelled->>'is_cancelled')::boolean = true);

  -- Payer personal account balance restored to 1000.00!
  select balance into b_bal from public.accounts where id = b_acct;
  perform pg_temp.assert_true('Payer personal account balance restored to 1000.00', b_bal = 1000.00);

  -- Interpersonal debt restored to 15.00!
  bal := public.get_household_balance_between_members(h_id);
  perform pg_temp.assert_true('Interpersonal debt restored to 15.00', (bal->>'amount') = '15.00');
end $$;

-- 10. Activity / Transactions include settlements with status and funding_source
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
      perform pg_temp.assert_true('Settlement activity has status', (elem->>'status') is not null);
      perform pg_temp.assert_true('Settlement activity has funding_source', (elem->>'funding_source') is not null);
    end if;
  end loop;

  perform pg_temp.assert_true('Transactions include settlements', settlement_count = 4);
end $$;

reset role;

select * from test_results order by test_name;

rollback;
