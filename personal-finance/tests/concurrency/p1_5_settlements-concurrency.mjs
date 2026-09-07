import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connect } from './mxn-only-migration-concurrency.mjs';

const labels = ['main_a', 'main_b', 'create_a', 'create_b', 'cancel_a', 'cancel_b'];
const users = Object.fromEntries(labels.map((label) => [label, crypto.randomUUID()]));
const ids = {
  mainHousehold: crypto.randomUUID(),
  createHousehold: crypto.randomUUID(),
  cancelHousehold: crypto.randomUUID(),
  mainPersonalA: crypto.randomUUID(),
  createPersonalA: crypto.randomUUID(),
  cancelPersonalA: crypto.randomUUID(),
};
const suffix = crypto.randomBytes(6).toString('hex');
const clients = [];
let admin;

async function authenticated(userId) {
  const client = await connect();
  clients.push(client);
  await client.query(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false)`);
  return client;
}

function createSettlementSql(householdId, amount, key, note) {
  return `select public.create_household_settlement(
    '${householdId}', '${amount}', '2026-09-06', '${note}', '${key}'
  ) as settlement`;
}

function payload(result) {
  return JSON.parse(result[0].settlement);
}

function fulfilled(results) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

try {
  admin = await connect();
  const usersSql = labels.map((label) =>
    `('${users[label]}', 'authenticated', 'authenticated', 'p15-settle-${label}-${suffix}@example.test',
      '{"display_name":"P15 Settle ${label}"}', now(), now())`
  ).join(',');

  await admin.query(`
    begin;
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ${usersSql};
    insert into public.households(id, name, status, created_by_user_id, activated_at) values
      ('${ids.mainHousehold}', 'Settlement races', 'active', '${users.main_a}', now()),
      ('${ids.createHousehold}', 'Settlement close race', 'active', '${users.create_a}', now()),
      ('${ids.cancelHousehold}', 'Settlement cancel race', 'active', '${users.cancel_a}', now());
    insert into public.household_members(household_id, user_id) values
      ('${ids.mainHousehold}', '${users.main_a}'), ('${ids.mainHousehold}', '${users.main_b}'),
      ('${ids.createHousehold}', '${users.create_a}'), ('${ids.createHousehold}', '${users.create_b}'),
      ('${ids.cancelHousehold}', '${users.cancel_a}'), ('${ids.cancelHousehold}', '${users.cancel_b}');
    insert into public.accounts(id, user_id, name, type, initial_balance) values
      ('${ids.mainPersonalA}', '${users.main_a}', 'Main personal A', 'checking', 10000),
      ('${ids.createPersonalA}', '${users.create_a}', 'Create personal A', 'checking', 10000),
      ('${ids.cancelPersonalA}', '${users.cancel_a}', 'Cancel personal A', 'checking', 10000);
    commit;
  `);

  const mainA = await authenticated(users.main_a);
  const mainB = await authenticated(users.main_b);
  const mainB2 = await authenticated(users.main_b);
  const createA = await authenticated(users.create_a);
  const createB = await authenticated(users.create_b);
  const cancelA = await authenticated(users.cancel_a);
  const cancelB = await authenticated(users.cancel_b);
  const cancelB2 = await authenticated(users.cancel_b);

  // Generate initial shared debt on mainHousehold: A pays 200.00, B owes 100.00
  await mainA.query(`select public.create_shared_expense(
    '${ids.mainHousehold}', 'personal_account', '${ids.mainPersonalA}', '200.00',
    '2026-09-06', 'Main dinner', 'equal', null, null, null, 'posted'
  )`);

  // Generate initial debt on createHousehold: A pays 200.00, B owes 100.00
  await createA.query(`select public.create_shared_expense(
    '${ids.createHousehold}', 'personal_account', '${ids.createPersonalA}', '200.00',
    '2026-09-06', 'Create dinner', 'equal', null, null, null, 'posted'
  )`);

  // Generate initial debt on cancelHousehold: A pays 200.00, B owes 100.00
  await cancelA.query(`select public.create_shared_expense(
    '${ids.cancelHousehold}', 'personal_account', '${ids.cancelPersonalA}', '200.00',
    '2026-09-06', 'Cancel dinner', 'equal', null, null, null, 'posted'
  )`);

  // 1. same key concurrent
  const sameKey = crypto.randomUUID();
  const sameResults = await Promise.allSettled([
    mainB.query(createSettlementSql(ids.mainHousehold, '10.00', sameKey, 'same-key-a'), 10_000),
    mainB2.query(createSettlementSql(ids.mainHousehold, '10.00', sameKey, 'same-key-a'), 10_000),
  ]);
  assert.equal(fulfilled(sameResults), 2, 'Both same-key callers must receive the same successful settlement.');
  assert.equal(payload(sameResults[0].value).id, payload(sameResults[1].value).id);
  assert.deepEqual((await admin.query(`
    select count(*)::text as settlements
      from public.household_settlements
     where recorded_by_user_id = '${users.main_b}' and idempotency_key = '${sameKey}'
  `))[0], { settlements: '1' });

  // 2. conflicting payload concurrent
  const conflictingKey = crypto.randomUUID();
  const conflictingResults = await Promise.allSettled([
    mainB.query(createSettlementSql(ids.mainHousehold, '11.00', conflictingKey, 'conflict-a'), 10_000),
    mainB2.query(createSettlementSql(ids.mainHousehold, '12.00', conflictingKey, 'conflict-b'), 10_000),
  ]);
  assert.equal(fulfilled(conflictingResults), 1, 'Conflicting same-key payloads must have exactly one winner.');
  assert.equal(conflictingResults.find((result) => result.status === 'rejected').reason.code, '23505');
  assert.deepEqual((await admin.query(`
    select count(*)::text as settlements
      from public.household_settlements
     where recorded_by_user_id = '${users.main_b}' and idempotency_key = '${conflictingKey}'
  `))[0], { settlements: '1' });

  // 3. two settlements same debt (concurrent serialization)
  // Current debt: 100 - 10 (sameKey) - 11 or 12 (conflict) = 79 or 78.
  // Both B callers pay 15.00 concurrently. Both must fulfill and serialize without deadlock.
  const twoResults = await Promise.allSettled([
    mainB.query(createSettlementSql(ids.mainHousehold, '15.00', crypto.randomUUID(), 'two-a'), 10_000),
    mainB2.query(createSettlementSql(ids.mainHousehold, '15.00', crypto.randomUUID(), 'two-b'), 10_000),
  ]);
  assert.equal(fulfilled(twoResults), 2, 'Two valid partial settlements must serialize without deadlock.');

  // 4. concurrent overpay
  // Now debt is ~48.00. We query exact balance to know current debt.
  const currentBalance = JSON.parse((await mainB.query(`
    select public.get_household_balance_between_members('${ids.mainHousehold}') as balance
  `))[0].balance);
  const remainingDebt = Number(currentBalance.amount);
  const overpayAmount = (remainingDebt * 0.75).toFixed(2); // 2 * 0.75 = 1.5x debt -> sum exceeds debt!
  const overpayResults = await Promise.allSettled([
    mainB.query(createSettlementSql(ids.mainHousehold, overpayAmount, crypto.randomUUID(), 'overpay-a'), 10_000),
    mainB2.query(createSettlementSql(ids.mainHousehold, overpayAmount, crypto.randomUUID(), 'overpay-b'), 10_000),
  ]);
  assert.equal(fulfilled(overpayResults), 1, 'In concurrent overpay, exactly one settlement must succeed.');
  const overpayRejected = overpayResults.find((result) => result.status === 'rejected');
  assert.equal(overpayRejected.reason.code, '22023', 'Second settlement must fail because amount exceeds debt.');

  // 5. settlement vs close
  const createCloseKey = crypto.randomUUID();
  const createClose = await Promise.allSettled([
    createB.query(createSettlementSql(ids.createHousehold, '50.00', createCloseKey, 'create-close'), 10_000),
    createA.query(`select public.leave_household('${ids.createHousehold}')`, 10_000),
  ]);
  assert.equal(createClose[1].status, 'fulfilled', 'Household close must complete.');
  assert.ok([1, 2].includes(fulfilled(createClose)));
  if (createClose[0].status === 'rejected') {
    assert.equal(createClose[0].reason.code, 'P0002');
  }

  // 6. double cancel
  const doubleTarget = payload(await cancelB.query(
    createSettlementSql(ids.cancelHousehold, '40.00', crypto.randomUUID(), 'double-cancel-target')
  ));
  const doubleCancel = await Promise.allSettled([
    cancelB.query(`select public.cancel_household_settlement('${doubleTarget.id}') as settlement`, 10_000),
    cancelB2.query(`select public.cancel_household_settlement('${doubleTarget.id}') as settlement`, 10_000),
  ]);
  assert.equal(fulfilled(doubleCancel), 2, 'Concurrent double cancel must be idempotent and succeed.');
  assert.equal(payload(doubleCancel[0].value).status, 'cancelled');
  assert.equal(payload(doubleCancel[1].value).status, 'cancelled');
  assert.equal(payload(doubleCancel[0].value).cancelled_at, payload(doubleCancel[1].value).cancelled_at);

  // 7. cancel vs another settlement
  const settleToCancel = payload(await cancelB.query(
    createSettlementSql(ids.cancelHousehold, '30.00', crypto.randomUUID(), 'cancel-vs-settle-target')
  ));
  const cancelVsSettle = await Promise.allSettled([
    cancelB.query(`select public.cancel_household_settlement('${settleToCancel.id}') as settlement`, 10_000),
    cancelB2.query(createSettlementSql(ids.cancelHousehold, '20.00', crypto.randomUUID(), 'new-settle'), 10_000),
  ]);
  assert.equal(fulfilled(cancelVsSettle), 2, 'Cancel racing another settlement must serialize cleanly.');

  console.log('P1.5.2 settlements concurrency: PASS (same key, conflict, two settlements, overpay, close race, double cancel, cancel vs settle).');
  // 8. recorder cancel vs partner cancel concurrent
  const partnerCancelTarget = payload(await cancelB.query(
    createSettlementSql(ids.cancelHousehold, '20.00', crypto.randomUUID(), 'partner-cancel-target')
  ));
  const recorderVsPartner = await Promise.allSettled([
    cancelB.query(`select public.cancel_household_settlement('${partnerCancelTarget.id}') as settlement`, 10_000),
    cancelA.query(`select public.cancel_household_settlement('${partnerCancelTarget.id}') as settlement`, 10_000),
  ]);
  assert.equal(recorderVsPartner[0].status, 'fulfilled', 'Recorder cancel must succeed');
  assert.equal(payload(recorderVsPartner[0].value).status, 'cancelled');
  assert.equal(recorderVsPartner[1].status, 'rejected', 'Partner cancel must be rejected');
  assert.equal(recorderVsPartner[1].reason.code, '22023', 'Partner rejected with controlled authorization error');
  const postCancelState = (await admin.query(`
    select status, cancelled_by_user_id
      from public.household_settlements
     where id = '${partnerCancelTarget.id}'
  `))[0];
  assert.equal(postCancelState.status, 'cancelled');
  assert.equal(postCancelState.cancelled_by_user_id, users.cancel_b);

  console.log('P1.5.2 settlements concurrency: PASS (same key, conflict, two settlements, overpay, close race, double cancel, cancel vs settle, recorder vs partner cancel).');
} finally {
  for (const client of clients) {
    try { client.close(); } catch {}
  }
  if (admin) {
    try {
      const allHouseholds = [ids.mainHousehold, ids.createHousehold, ids.cancelHousehold].map((id) => `'${id}'::uuid`).join(',');
      const allUsers = Object.values(users).map((id) => `'${id}'::uuid`).join(',');
      await admin.query(`
        begin;
        set local session_replication_role = replica;
        delete from public.household_settlements where household_id in (${allHouseholds});
        delete from public.household_expense_splits where household_expense_id in (
          select id from public.household_expenses where household_id in (${allHouseholds})
        );
        delete from public.household_expenses where household_id in (${allHouseholds});
        delete from public.household_members where household_id in (${allHouseholds});
        delete from public.households where id in (${allHouseholds});
        delete from public.transactions where user_id in (${allUsers});
        delete from public.accounts where user_id in (${allUsers});
        delete from public.profiles where id in (${allUsers});
        delete from auth.users where id in (${allUsers});
        commit;
      `);
    } catch (e) {
      console.error('Teardown error:', e);
    }
    try { admin.close(); } catch {}
  }
}

