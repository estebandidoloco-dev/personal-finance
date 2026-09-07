import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connect } from './mxn-only-migration-concurrency.mjs';

const labels = ['main_a', 'main_b', 'create_a', 'create_b', 'cancel_a', 'cancel_b'];
const users = Object.fromEntries(labels.map((label) => [label, crypto.randomUUID()]));
const ids = {
  mainHousehold: crypto.randomUUID(), createHousehold: crypto.randomUUID(), cancelHousehold: crypto.randomUUID(),
  mainPersonal: crypto.randomUUID(), createPersonal: crypto.randomUUID(), cancelPersonal: crypto.randomUUID(),
  mainCommon: crypto.randomUUID(), createCommon: crypto.randomUUID(), cancelCommon: crypto.randomUUID(),
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

function createSql(household, personal, common, amount, key, note) {
  return `select public.create_household_contribution(
    '${household}', '${personal}', '${common}', '${amount}', '2026-09-06', '${note}', '${key}'
  ) as contribution`;
}

function payload(result) {
  return JSON.parse(result[0].contribution);
}

function fulfilled(results) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

try {
  admin = await connect();
  const usersSql = labels.map((label) =>
    `('${users[label]}', 'authenticated', 'authenticated', 'p15-${label}-${suffix}@example.test',
      '{"display_name":"P15 ${label}"}', now(), now())`
  ).join(',');
  await admin.query(`
    begin;
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ${usersSql};
    insert into public.households(id, name, status, created_by_user_id, activated_at) values
      ('${ids.mainHousehold}', 'Contribution races', 'active', '${users.main_a}', now()),
      ('${ids.createHousehold}', 'Contribution close race', 'active', '${users.create_a}', now()),
      ('${ids.cancelHousehold}', 'Cancel close race', 'active', '${users.cancel_a}', now());
    insert into public.household_members(household_id, user_id) values
      ('${ids.mainHousehold}', '${users.main_a}'), ('${ids.mainHousehold}', '${users.main_b}'),
      ('${ids.createHousehold}', '${users.create_a}'), ('${ids.createHousehold}', '${users.create_b}'),
      ('${ids.cancelHousehold}', '${users.cancel_a}'), ('${ids.cancelHousehold}', '${users.cancel_b}');
    insert into public.accounts(id, user_id, name, type, initial_balance) values
      ('${ids.mainPersonal}', '${users.main_a}', 'Main personal', 'checking', 1000),
      ('${ids.createPersonal}', '${users.create_a}', 'Create personal', 'checking', 1000),
      ('${ids.cancelPersonal}', '${users.cancel_a}', 'Cancel personal', 'checking', 1000);
    insert into public.household_accounts(id, household_id, name, type, initial_balance, created_by_user_id) values
      ('${ids.mainCommon}', '${ids.mainHousehold}', 'Main common', 'cash', 1000, '${users.main_a}'),
      ('${ids.createCommon}', '${ids.createHousehold}', 'Create common', 'cash', 1000, '${users.create_a}'),
      ('${ids.cancelCommon}', '${ids.cancelHousehold}', 'Cancel common', 'cash', 1000, '${users.cancel_a}');
    commit;
  `);
  const aclBefore = await admin.query(`
    select coalesce((select proacl::text from pg_proc where oid =
      'public.create_household_contribution(uuid,uuid,uuid,text,date,text,uuid)'::regprocedure), 'NULL') as create_acl,
      coalesce((select proacl::text from pg_proc where oid =
      'public.cancel_household_contribution(uuid)'::regprocedure), 'NULL') as cancel_acl,
      coalesce((select relacl::text from pg_class where oid =
      'public.household_contributions'::regclass), 'NULL') as table_acl
  `);

  const mainA = await authenticated(users.main_a);
  const mainA2 = await authenticated(users.main_a);
  const mainB = await authenticated(users.main_b);
  const createA = await authenticated(users.create_a);
  const createA2 = await authenticated(users.create_a);
  const cancelA = await authenticated(users.cancel_a);
  const cancelA2 = await authenticated(users.cancel_a);

  const sameKey = crypto.randomUUID();
  const sameResults = await Promise.allSettled([
    mainA.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '100.00', sameKey, 'same-key'), 10_000),
    mainA2.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '100.00', sameKey, 'same-key'), 10_000),
  ]);
  assert.equal(fulfilled(sameResults), 2, 'Both same-key callers must receive the same successful operation.');
  assert.equal(payload(sameResults[0].value).id, payload(sameResults[1].value).id);
  assert.deepEqual((await admin.query(`
    select count(*)::text as contributions,
      count(distinct personal_transaction_id)::text as personal_legs,
      count(distinct household_account_transaction_id)::text as household_legs
    from public.household_contributions
    where recorded_by_user_id = '${users.main_a}' and idempotency_key = '${sameKey}'
  `))[0], { contributions: '1', personal_legs: '1', household_legs: '1' });

  const conflictingKey = crypto.randomUUID();
  const conflictingResults = await Promise.allSettled([
    mainA.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '11.00', conflictingKey, 'conflict-a'), 10_000),
    mainA2.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '12.00', conflictingKey, 'conflict-b'), 10_000),
  ]);
  assert.equal(fulfilled(conflictingResults), 1, 'Conflicting same-key payloads must have exactly one winner.');
  assert.equal(conflictingResults.find((result) => result.status === 'rejected').reason.code, '23505');
  assert.deepEqual((await admin.query(`
    select count(*)::text as contributions,
      count(distinct personal_transaction_id)::text as personal_legs,
      count(distinct household_account_transaction_id)::text as household_legs
    from public.household_contributions
    where recorded_by_user_id = '${users.main_a}' and idempotency_key = '${conflictingKey}'
  `))[0], { contributions: '1', personal_legs: '1', household_legs: '1' });

  const twoResults = await Promise.allSettled([
    mainA.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '20.00', crypto.randomUUID(), 'two-a'), 10_000),
    mainA2.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '20.00', crypto.randomUUID(), 'two-b'), 10_000),
  ]);
  assert.equal(fulfilled(twoResults), 2, 'Two contributions on the same accounts must serialize without deadlock.');

  const expenseRace = await Promise.allSettled([
    mainA.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '30.00', crypto.randomUUID(), 'expense-race'), 10_000),
    mainB.query(`select public.create_shared_expense(
      '${ids.mainHousehold}', 'household_account', '${ids.mainCommon}', '30.00',
      '2026-09-06', 'Concurrent expense', 'equal', null, null, null, 'posted'
    )`, 10_000),
  ]);
  assert.equal(fulfilled(expenseRace), 2, 'Contribution and Household expense must serialize without deadlock.');

  const createCloseKey = crypto.randomUUID();
  const createClose = await Promise.allSettled([
    createA.query(createSql(ids.createHousehold, ids.createPersonal, ids.createCommon, '70.00', createCloseKey, 'create-close'), 10_000),
    createA2.query(`select public.leave_household('${ids.createHousehold}')`, 10_000),
  ]);
  assert.equal(createClose[1].status, 'fulfilled', 'Household close must complete.');
  assert.ok([1, 2].includes(fulfilled(createClose)));

  const cancelTarget = payload(await cancelA.query(
    createSql(ids.cancelHousehold, ids.cancelPersonal, ids.cancelCommon, '80.00', crypto.randomUUID(), 'cancel-close')
  ));
  const cancelClose = await Promise.allSettled([
    cancelA.query(`select public.cancel_household_contribution('${cancelTarget.id}')`, 10_000),
    cancelA2.query(`select public.leave_household('${ids.cancelHousehold}')`, 10_000),
  ]);
  assert.equal(cancelClose[1].status, 'fulfilled', 'Close racing cancellation must complete.');
  assert.ok([1, 2].includes(fulfilled(cancelClose)));

  const doubleTarget = payload(await mainA.query(
    createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '50.00', crypto.randomUUID(), 'double-cancel')
  ));
  const doubleCancel = await Promise.allSettled([
    mainA.query(`select public.cancel_household_contribution('${doubleTarget.id}')`, 10_000),
    mainA2.query(`select public.cancel_household_contribution('${doubleTarget.id}')`, 10_000),
  ]);
  assert.equal(fulfilled(doubleCancel), 2, 'Concurrent repeated cancellation must be idempotent.');

  const cancelRetryKey = crypto.randomUUID();
  const cancelRetryTarget = payload(await mainA.query(
    createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '60.00', cancelRetryKey, 'cancel-retry')
  ));
  const cancelRetry = await Promise.allSettled([
    mainA.query(`select public.cancel_household_contribution('${cancelRetryTarget.id}')`, 10_000),
    mainA2.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '60.00', cancelRetryKey, 'cancel-retry'), 10_000),
  ]);
  assert.equal(fulfilled(cancelRetry), 2, 'Cancel and same-key retry must serialize without duplicate impact.');

  const cancelExpenseTarget = payload(await mainA.query(
    createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '40.00', crypto.randomUUID(), 'cancel-expense')
  ));
  const cancelExpense = await Promise.allSettled([
    mainA.query(`select public.cancel_household_contribution('${cancelExpenseTarget.id}')`, 10_000),
    mainB.query(`select public.create_shared_expense(
      '${ids.mainHousehold}', 'household_account', '${ids.mainCommon}', '25.00',
      '2026-09-06', 'Cancel race expense', 'equal', null, null, null, 'posted'
    )`, 10_000),
  ]);
  assert.equal(fulfilled(cancelExpense), 2, 'Cancel and Household expense must serialize without deadlock.');

  const cancelAnotherTarget = payload(await mainA.query(
    createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '35.00', crypto.randomUUID(), 'cancel-another-target')
  ));
  const anotherKey = crypto.randomUUID();
  const cancelAnother = await Promise.allSettled([
    mainA.query(`select public.cancel_household_contribution('${cancelAnotherTarget.id}')`, 10_000),
    mainA2.query(createSql(ids.mainHousehold, ids.mainPersonal, ids.mainCommon, '45.00', anotherKey, 'cancel-another-create'), 10_000),
  ]);
  assert.equal(fulfilled(cancelAnother), 2, 'Cancel and another contribution must serialize without deadlock.');
  const cancelAnotherState = (await admin.query(`
    select
      (select status from public.transactions transaction_row
        join public.household_contributions contribution
          on contribution.personal_transaction_id = transaction_row.id
       where contribution.id = '${cancelAnotherTarget.id}') as cancelled_status,
      (select transaction_row.status from public.transactions transaction_row
        join public.household_contributions contribution
          on contribution.personal_transaction_id = transaction_row.id
       where contribution.recorded_by_user_id = '${users.main_a}'
         and contribution.idempotency_key = '${anotherKey}') as another_status,
      (select count(*) from public.household_contributions
       where recorded_by_user_id = '${users.main_a}' and idempotency_key = '${anotherKey}')::text as another_count
  `))[0];
  assert.deepEqual(cancelAnotherState, {
    cancelled_status: 'cancelled', another_status: 'posted', another_count: '1',
  });

  const state = (await admin.query(`
    select
      (select count(*) from public.household_contributions contribution
        left join public.transactions personal on personal.id = contribution.personal_transaction_id
        left join public.household_account_transactions household_leg
          on household_leg.id = contribution.household_account_transaction_id
       where contribution.household_id in ('${ids.mainHousehold}', '${ids.createHousehold}', '${ids.cancelHousehold}')
         and (personal.id is null or household_leg.id is null))::text as partial_count,
      (select count(*) from public.account_balance_reconciliation
        where account_id in ('${ids.mainPersonal}', '${ids.createPersonal}', '${ids.cancelPersonal}')
          and drift <> 0)::text as personal_drift,
      (select count(*) from public.household_account_balance_reconciliation
        where account_id in ('${ids.mainCommon}', '${ids.createCommon}', '${ids.cancelCommon}')
          and drift <> 0)::text as household_drift,
      (select balance::text from public.accounts where id = '${ids.createPersonal}') as create_personal,
      (select balance::text from public.household_accounts where id = '${ids.createCommon}') as create_common,
      (select balance::text from public.accounts where id = '${ids.cancelPersonal}') as cancel_personal,
      (select balance::text from public.household_accounts where id = '${ids.cancelCommon}') as cancel_common,
      (select balance::text from public.accounts where id = '${ids.mainPersonal}') as main_personal,
      (select balance::text from public.household_accounts where id = '${ids.mainCommon}') as main_common
  `))[0];
  assert.equal(state.partial_count, '0');
  assert.equal(state.personal_drift, '0');
  assert.equal(state.household_drift, '0');
  assert.ok([
    ['1000.00', '1000.00'], ['930.00', '1070.00'],
  ].some(([personal, common]) => state.create_personal === personal && state.create_common === common));
  assert.ok([
    ['1000.00', '1000.00'], ['920.00', '1080.00'],
  ].some(([personal, common]) => state.cancel_personal === personal && state.cancel_common === common));
  assert.ok([
    ['774.00', '1171.00'], ['773.00', '1172.00'],
  ].some(([personal, common]) => state.main_personal === personal && state.main_common === common));

  const aclAfter = await admin.query(`
    select coalesce((select proacl::text from pg_proc where oid =
      'public.create_household_contribution(uuid,uuid,uuid,text,date,text,uuid)'::regprocedure), 'NULL') as create_acl,
      coalesce((select proacl::text from pg_proc where oid =
      'public.cancel_household_contribution(uuid)'::regprocedure), 'NULL') as cancel_acl,
      coalesce((select relacl::text from pg_class where oid =
      'public.household_contributions'::regclass), 'NULL') as table_acl
  `);
  assert.deepEqual(aclAfter, aclBefore, 'Concurrency harness must not mutate ACL/catalog state.');
  console.log('P1.5 contribution concurrency: PASS (10 races, exactly once, no deadlock, no drift, no partial legs).');
} finally {
  if (admin) {
    try {
      const households = [ids.mainHousehold, ids.createHousehold, ids.cancelHousehold].map((id) => `'${id}'`).join(',');
      const userIds = Object.values(users).map((id) => `'${id}'`).join(',');
      await admin.query(`
        begin;
        set local session_replication_role = replica;
        set constraints all deferred;
        delete from public.household_contributions where household_id in (${households});
        delete from public.household_expense_splits where household_expense_id in (
          select id from public.household_expenses where household_id in (${households})
        );
        delete from public.household_expenses where household_id in (${households});
        delete from public.household_account_transactions where household_id in (${households});
        delete from public.household_accounts where household_id in (${households});
        delete from public.household_invitations where household_id in (${households});
        delete from public.household_members where household_id in (${households});
        delete from public.households where id in (${households});
        delete from public.transaction_tags where transaction_id in (
          select id from public.transactions where user_id in (${userIds})
        );
        delete from public.transactions where user_id in (${userIds});
        delete from public.accounts where user_id in (${userIds});
        delete from public.profiles where id in (${userIds});
        delete from auth.users where id in (${userIds});
        commit;
      `, 20_000);
      const residue = await admin.query(`
        select (select count(*) from public.households where id in (${households}))::text as households,
               (select count(*) from auth.users where id in (${userIds}))::text as users
      `);
      assert.deepEqual(residue[0], { households: '0', users: '0' });
    } finally {
      admin.close();
    }
  }
  for (const client of clients) client.close();
}
