import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { connect } from './mxn-only-migration-concurrency.mjs';

const suffix = crypto.randomBytes(6).toString('hex');
const users = Object.fromEntries(
  ['create', 'same_creator', 'same_target', 'dual_creator_a', 'dual_creator_b', 'dual_target',
    'revoke_creator', 'revoke_target', 'leave_creator', 'leave_target',
    'double_leave_creator', 'double_leave_target']
    .map((label) => [label, crypto.randomUUID()])
);
const foreignUserId = crypto.randomUUID();
const foreignEmail = `p14-foreign-${suffix}@example.test`;
const emails = Object.fromEntries(
  Object.entries(users).map(([label]) => [label, `p14-${label}-${suffix}@example.test`])
);
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

async function createHousehold(client, name) {
  const rows = await client.query(`select public.create_household('${name}') as id`, 10_000);
  return rows[0].id;
}

async function invite(client, householdId, email) {
  const rows = await client.query(`
    select invitation_id, invitation_token
      from public.create_household_invitation('${householdId}', '${email}')
  `, 10_000);
  return rows[0];
}

function fulfilledCount(results) {
  return results.filter((result) => result.status === 'fulfilled').length;
}

try {
  admin = await connect();
  await admin.query(`
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values ('${foreignUserId}', 'authenticated', 'authenticated', '${foreignEmail}',
      '{"display_name":"Foreign sentinel"}', now(), now());
  `, 15_000);
  const values = Object.entries(users).map(([label, id]) =>
    `('${id}', 'authenticated', 'authenticated', '${emails[label]}',
      '{"display_name":"P14 ${label}"}', now(), now())`
  ).join(',');
  await admin.query(`
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values ${values}
  `);

  const createA = await authenticated(users.create);
  const createB = await authenticated(users.create);
  const createResults = await Promise.allSettled([
    createHousehold(createA, 'Concurrent create A'),
    createHousehold(createB, 'Concurrent create B'),
  ]);
  assert.equal(
    fulfilledCount(createResults),
    1,
    `Exactly one concurrent create must succeed: ${JSON.stringify(createResults.map((result) =>
      result.status === 'rejected' ? { code: result.reason.code, message: result.reason.message } : 'ok'))}`
  );
  assert.equal(createResults.find((result) => result.status === 'rejected').reason.code, '23505');

  const sameCreator = await authenticated(users.same_creator);
  const sameTargetA = await authenticated(users.same_target);
  const sameTargetB = await authenticated(users.same_target);
  const sameHousehold = await createHousehold(sameCreator, 'Same token race');
  const sameInvite = await invite(sameCreator, sameHousehold, emails.same_target);
  const sameResults = await Promise.allSettled([
    sameTargetA.query(`select public.accept_household_invitation('${sameInvite.invitation_token}')`, 10_000),
    sameTargetB.query(`select public.accept_household_invitation('${sameInvite.invitation_token}')`, 10_000),
  ]);
  assert.equal(fulfilledCount(sameResults), 1, 'An invitation token must be consumed once.');
  assert.equal((await admin.query(`
    select count(*)::text as count from public.household_members
     where household_id = '${sameHousehold}' and status = 'current'
  `))[0].count, '2');

  const dualCreatorA = await authenticated(users.dual_creator_a);
  const dualCreatorB = await authenticated(users.dual_creator_b);
  const dualTargetA = await authenticated(users.dual_target);
  const dualTargetB = await authenticated(users.dual_target);
  const dualHouseholdA = await createHousehold(dualCreatorA, 'Dual A');
  const dualHouseholdB = await createHousehold(dualCreatorB, 'Dual B');
  const dualInviteA = await invite(dualCreatorA, dualHouseholdA, emails.dual_target);
  const dualInviteB = await invite(dualCreatorB, dualHouseholdB, emails.dual_target);
  const dualResults = await Promise.allSettled([
    dualTargetA.query(`select public.accept_household_invitation('${dualInviteA.invitation_token}')`, 10_000),
    dualTargetB.query(`select public.accept_household_invitation('${dualInviteB.invitation_token}')`, 10_000),
  ]);
  assert.equal(fulfilledCount(dualResults), 1, 'A user may accept only one current Household.');
  assert.equal((await admin.query(`
    select count(*)::text as count from public.household_members
     where user_id = '${users.dual_target}' and status = 'current'
  `))[0].count, '1');

  const revokeCreator = await authenticated(users.revoke_creator);
  const revokeTarget = await authenticated(users.revoke_target);
  const revokeHousehold = await createHousehold(revokeCreator, 'Accept revoke race');
  const revokeInvite = await invite(revokeCreator, revokeHousehold, emails.revoke_target);
  const revokeResults = await Promise.allSettled([
    revokeTarget.query(`select public.accept_household_invitation('${revokeInvite.invitation_token}')`, 10_000),
    revokeCreator.query(`select public.revoke_household_invitation('${revokeInvite.invitation_id}')`, 10_000),
  ]);
  assert.equal(fulfilledCount(revokeResults), 1, 'Accept versus revoke must have one winner.');
  assert.ok(['accepted', 'revoked'].includes((await admin.query(`
    select status from public.household_invitations where id = '${revokeInvite.invitation_id}'
  `))[0].status));

  const leaveCreator = await authenticated(users.leave_creator);
  const leaveTarget = await authenticated(users.leave_target);
  const leaveHousehold = await createHousehold(leaveCreator, 'Leave accept race');
  const leaveInvite = await invite(leaveCreator, leaveHousehold, emails.leave_target);
  const leaveResults = await Promise.allSettled([
    leaveTarget.query(`select public.accept_household_invitation('${leaveInvite.invitation_token}')`, 10_000),
    leaveCreator.query(`select public.leave_household('${leaveHousehold}')`, 10_000),
  ]);
  assert.ok([1, 2].includes(fulfilledCount(leaveResults)), 'Leave must win or follow a completed accept.');
  const leaveState = (await admin.query(`
    select household.status,
           count(*) filter (where member_row.status = 'current')::text as current_count
      from public.households household
      left join public.household_members member_row on member_row.household_id = household.id
     where household.id = '${leaveHousehold}'
     group by household.status
  `))[0];
  assert.equal(leaveState.status, 'closed');
  assert.equal(leaveState.current_count, '0');

  const doubleLeaveCreator = await authenticated(users.double_leave_creator);
  const doubleLeaveTarget = await authenticated(users.double_leave_target);
  const doubleLeaveHousehold = await createHousehold(doubleLeaveCreator, 'Double leave race');
  const doubleLeaveInvite = await invite(
    doubleLeaveCreator, doubleLeaveHousehold, emails.double_leave_target
  );
  await doubleLeaveTarget.query(
    `select public.accept_household_invitation('${doubleLeaveInvite.invitation_token}')`, 10_000
  );
  const doubleLeaveResults = await Promise.allSettled([
    doubleLeaveCreator.query(`select public.leave_household('${doubleLeaveHousehold}')`, 10_000),
    doubleLeaveTarget.query(`select public.leave_household('${doubleLeaveHousehold}')`, 10_000),
  ]);
  assert.equal(fulfilledCount(doubleLeaveResults), 1, 'Exactly one simultaneous leave closes the Household.');
  const doubleLeaveState = (await admin.query(`
    select household.status,
           count(*) filter (where member_row.status = 'current')::text as current_count
      from public.households household
      left join public.household_members member_row on member_row.household_id = household.id
     where household.id = '${doubleLeaveHousehold}'
     group by household.status
  `))[0];
  assert.equal(doubleLeaveState.status, 'closed');
  assert.equal(doubleLeaveState.current_count, '0');
  await assert.rejects(
    doubleLeaveCreator.query(`select public.create_household_invitation('${doubleLeaveHousehold}', '${emails.create}')`, 10_000),
    (error) => ['P0002', '23514'].includes(error.code)
  );
} finally {
  if (admin) {
    try {
      const ids = Object.values(users).map((id) => `'${id}'`).join(',');
      await admin.query(`
        begin;
        set constraints all deferred;
        delete from public.household_invitations
         where household_id in (select id from public.households where created_by_user_id in (${ids}));
        delete from public.household_members
         where household_id in (select id from public.households where created_by_user_id in (${ids}));
        delete from public.households where created_by_user_id in (${ids});
        delete from auth.users where id in (${ids});
        commit;
      `, 15_000);
      const foreignRows = await admin.query(`
        select email from auth.users where id = '${foreignUserId}'
      `);
      assert.equal(foreignRows.length, 1, 'Cleanup must preserve similar-email foreign fixtures.');
      assert.equal(foreignRows[0].email, foreignEmail);
      await admin.query(`
        begin;
        delete from public.profiles where id = '${foreignUserId}';
        delete from auth.users where id = '${foreignUserId}';
        commit;
      `);
    } finally {
      admin.close();
    }
  }
  for (const client of clients) client.close();
}

console.log('P1.4 lifecycle concurrency: PASS (6 races, isolated cleanup)');
