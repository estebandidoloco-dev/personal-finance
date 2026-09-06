import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connect } from './mxn-only-migration-concurrency.mjs';

const ids = {
  userA: crypto.randomUUID(), userB: crypto.randomUUID(),
  userC: crypto.randomUUID(), userD: crypto.randomUUID(),
  householdLedger: crypto.randomUUID(), householdLeave: crypto.randomUUID(),
  personalAccount: crypto.randomUUID(),
};
const suffix = crypto.randomBytes(6).toString('hex');
const clients = [];
let admin;

async function authenticated(userId) {
  const client = await connect();
  clients.push(client);
  await client.query(
    `set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`
  );
  return client;
}

function payload(row, key) {
  return JSON.parse(row[key]);
}

try {
  admin = await connect();
  await admin.query(`
    begin;
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
      ('${ids.userA}', 'authenticated', 'authenticated', 'p14-fin-a-${suffix}@example.test', '{"display_name":"Fin A"}', now(), now()),
      ('${ids.userB}', 'authenticated', 'authenticated', 'p14-fin-b-${suffix}@example.test', '{"display_name":"Fin B"}', now(), now()),
      ('${ids.userC}', 'authenticated', 'authenticated', 'p14-fin-c-${suffix}@example.test', '{"display_name":"Fin C"}', now(), now()),
      ('${ids.userD}', 'authenticated', 'authenticated', 'p14-fin-d-${suffix}@example.test', '{"display_name":"Fin D"}', now(), now());
    insert into public.households(id, name, status, created_by_user_id, activated_at) values
      ('${ids.householdLedger}', 'Ledger race', 'active', '${ids.userA}', now()),
      ('${ids.householdLeave}', 'Leave race', 'active', '${ids.userC}', now());
    insert into public.household_members(household_id, user_id) values
      ('${ids.householdLedger}', '${ids.userA}'), ('${ids.householdLedger}', '${ids.userB}'),
      ('${ids.householdLeave}', '${ids.userC}'), ('${ids.householdLeave}', '${ids.userD}');
    insert into public.accounts(id, user_id, name, type, initial_balance)
    values ('${ids.personalAccount}', '${ids.userA}', 'Linked personal race', 'checking', 100);
    commit;
  `);

  const userA = await authenticated(ids.userA);
  const userASecond = await authenticated(ids.userA);
  const userB = await authenticated(ids.userB);
  const userC = await authenticated(ids.userC);
  const userD = await authenticated(ids.userD);
  const ledgerAccount = payload((await userA.query(`
    select public.create_household_account('${ids.householdLedger}', 'Concurrent', 'cash', '0.00') as account
  `))[0], 'account');
  const secondLedgerAccount = payload((await userA.query(`
    select public.create_household_account('${ids.householdLedger}', 'Concurrent second', 'cash', '0.00') as account
  `))[0], 'account');
  const leaveAccount = payload((await userC.query(`
    select public.create_household_account('${ids.householdLeave}', 'Leave', 'cash', '0.00') as account
  `))[0], 'account');

  const incomeResults = await Promise.allSettled([
    userA.query(`select public.create_household_account_income('${ledgerAccount.id}', '10.00', '2026-09-05', 'A')`, 10_000),
    userB.query(`select public.create_household_account_income('${ledgerAccount.id}', '20.00', '2026-09-05', 'B')`, 10_000),
  ]);
  assert.equal(incomeResults.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal((await admin.query(`
    select balance::text from public.household_accounts where id = '${ledgerAccount.id}'
  `))[0].balance, '30.00');

  const updateTarget = payload((await userA.query(`
    select public.create_household_account_income('${ledgerAccount.id}', '5.00', '2026-09-05', 'Update target') as transaction
  `))[0], 'transaction');
  const updateResults = await Promise.allSettled([
    userA.query(`select public.update_household_account_income('${updateTarget.id}', '${ledgerAccount.id}', '20.00', '2026-09-05', 'Update A', null, 'posted')`, 10_000),
    userB.query(`select public.update_household_account_income('${updateTarget.id}', '${ledgerAccount.id}', '30.00', '2026-09-05', 'Update B', null, 'posted')`, 10_000),
  ]);
  assert.equal(updateResults.filter((result) => result.status === 'fulfilled').length, 2);
  assert.equal((await admin.query(`
    select count(*)::text as drift_count
      from public.household_account_balance_reconciliation
     where account_id = '${ledgerAccount.id}' and drift <> 0
  `))[0].drift_count, '0');

  const moveFromFirst = payload((await userA.query(`
    select public.create_household_account_income('${ledgerAccount.id}', '11.00', '2026-09-05', 'Move first') as transaction
  `))[0], 'transaction');
  const moveFromSecond = payload((await userA.query(`
    select public.create_household_account_income('${secondLedgerAccount.id}', '13.00', '2026-09-05', 'Move second') as transaction
  `))[0], 'transaction');
  const moveResults = await Promise.allSettled([
    userA.query(`select public.update_household_account_income('${moveFromFirst.id}', '${secondLedgerAccount.id}', '11.00', '2026-09-05', 'Moved first', null, 'posted')`, 10_000),
    userB.query(`select public.update_household_account_income('${moveFromSecond.id}', '${ledgerAccount.id}', '13.00', '2026-09-05', 'Moved second', null, 'posted')`, 10_000),
  ]);
  assert.equal(moveResults.filter((result) => result.status === 'fulfilled').length, 2,
    'Opposite account moves must complete without deadlock.');
  assert.equal((await admin.query(`
    select count(*)::text as drift_count
      from public.household_account_balance_reconciliation
     where account_id in ('${ledgerAccount.id}', '${secondLedgerAccount.id}') and drift <> 0
  `))[0].drift_count, '0');

  const linkedExpense = payload((await userA.query(`
    select public.create_shared_expense(
      '${ids.householdLedger}', 'personal_account', '${ids.personalAccount}', '40.00',
      '2026-09-05', 'Linked race', 'equal', null, null, null, 'posted'
    ) as expense
  `))[0], 'expense');
  const linkedResults = await Promise.allSettled([
    userA.query(`select public.update_personal_transaction_exact(
      '${linkedExpense.personal_transaction_id}', '${ids.personalAccount}', 'expense', '45.00',
      '2026-09-05', 'Forbidden isolated update', null, null, true, null, 'posted', array[]::uuid[]
    )`, 10_000),
    userASecond.query(`select public.update_shared_expense(
      '${linkedExpense.id}', '${ids.personalAccount}', '50.00', '2026-09-05',
      'Household update wins', 'equal', null, null, null, 'posted'
    )`, 10_000),
  ]);
  assert.equal(linkedResults.filter((result) => result.status === 'fulfilled').length, 1,
    'Only the Household RPC may mutate a linked personal transaction.');
  const linkedFailure = linkedResults.find((result) => result.status === 'rejected');
  assert.equal(linkedFailure.reason.code, '23514');
  const linkedState = (await admin.query(`
    select transaction_row.amount::text as amount,
           sum(split.amount)::text as split_total,
           count(split.*)::text as split_count
      from public.household_expenses expense
      join public.transactions transaction_row on transaction_row.id = expense.personal_transaction_id
      join public.household_expense_splits split on split.household_expense_id = expense.id
     where expense.id = '${linkedExpense.id}'
     group by transaction_row.amount
  `))[0];
  assert.equal(linkedState.amount, '50.00');
  assert.equal(linkedState.split_total, '50.00');
  assert.equal(linkedState.split_count, '2');
  assert.equal((await admin.query(`
    select count(*)::text as drift_count from public.account_balance_reconciliation
     where account_id = '${ids.personalAccount}' and drift <> 0
  `))[0].drift_count, '0');

  const leaveResults = await Promise.allSettled([
    userC.query(`select public.leave_household('${ids.householdLeave}')`, 10_000),
    userD.query(`select public.create_household_account_income('${leaveAccount.id}', '7.00', '2026-09-05', 'Racing writer')`, 10_000),
  ]);
  assert.ok([1, 2].includes(leaveResults.filter((result) => result.status === 'fulfilled').length));
  const leaveState = (await admin.query(`
    select household.status, account.balance::text as balance,
           count(member_row.*) filter (where member_row.status = 'current')::text as current_count
      from public.households household
      join public.household_accounts account on account.household_id = household.id
      left join public.household_members member_row on member_row.household_id = household.id
     where household.id = '${ids.householdLeave}' and account.id = '${leaveAccount.id}'
     group by household.status, account.balance
  `))[0];
  assert.equal(leaveState.status, 'closed');
  assert.equal(leaveState.current_count, '0');
  assert.ok(['0.00', '7.00'].includes(leaveState.balance));

  console.log('P1.4 financial concurrency: PASS (5 races, zero drift)');
} finally {
  if (admin) {
    try {
      await admin.query(`
        begin;
        set local session_replication_role = replica;
        set constraints all deferred;
        delete from public.household_expense_splits
         where household_expense_id in (
           select id from public.household_expenses
            where household_id in ('${ids.householdLedger}', '${ids.householdLeave}')
         );
        delete from public.household_expenses
         where household_id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.household_account_transactions
         where household_id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.household_accounts
         where household_id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.household_invitations
         where household_id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.household_members
         where household_id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.households
         where id in ('${ids.householdLedger}', '${ids.householdLeave}');
        delete from public.transaction_tags
         where transaction_id in (select id from public.transactions where user_id in ('${ids.userA}', '${ids.userB}'));
        delete from public.transactions where user_id in ('${ids.userA}', '${ids.userB}');
        delete from public.accounts where user_id in ('${ids.userA}', '${ids.userB}');
        delete from auth.users
         where id in ('${ids.userA}', '${ids.userB}', '${ids.userC}', '${ids.userD}');
        commit;
      `, 15_000);
    } finally {
      admin.close();
    }
  }
  for (const client of clients) client.close();
}
