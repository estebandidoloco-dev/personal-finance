import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';
import { loadLocalHouseholdTestEnv, signUpTrackedFixture } from './p1_4-household-harness.mjs';

const { env, supabaseUrl, baseUrl } = await loadLocalHouseholdTestEnv();
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtures = [];
const householdIds = [];

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return signUpTrackedFixture({
    client, fixtures,
    storageKey: `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`,
    credentials: {
      email: `p15-contribution-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `P15 ${label}` } },
    },
  });
}

function request(path, options = {}, cookie = '') {
  return fetch(new URL(path, baseUrl), {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...(options.headers ?? {}) },
  });
}

let a;
let b;
try {
  a = await makeUser('a');
  b = await makeUser('b');
  assert.equal((await request('/api/household/contributions', { method: 'POST', body: '{}' })).status, 401);

  const householdResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Contributions ${unique}` }),
  }, a.cookie);
  assert.equal(householdResponse.status, 201);
  const householdId = (await householdResponse.json()).id;
  householdIds.push(householdId);

  const invitationResponse = await request('/api/household/invitations', {
    method: 'POST', body: JSON.stringify({ household_id: householdId, invited_email: b.user.email }),
  }, a.cookie);
  const invitation = await invitationResponse.json();
  assert.equal(invitationResponse.status, 201);
  assert.equal((await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: invitation.invitation_token }),
  }, b.cookie)).status, 200);

  const personalResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'Contribution source', type: 'checking', initial_balance: '1000.00' }),
  }, a.cookie);
  assert.equal(personalResponse.status, 201);
  const personal = await personalResponse.json();
  const householdAccountResponse = await request('/api/household/accounts', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, name: 'Contribution destination', type: 'cash', initial_balance: '0.00',
    }),
  }, a.cookie);
  assert.equal(householdAccountResponse.status, 201);
  const householdAccount = await householdAccountResponse.json();
  const idempotencyKey = crypto.randomUUID();
  const body = {
    household_id: householdId,
    source_personal_account_id: personal.id,
    destination_household_account_id: householdAccount.id,
    amount: '250.01',
    date: '2026-09-06',
    note: 'Fondo compartido',
    idempotency_key: idempotencyKey,
  };

  for (const invalidAmount of [250.01, '0.00', '-0.00', '01.00', '1e3', '10.001']) {
    const response = await request('/api/household/contributions', {
      method: 'POST', body: JSON.stringify({ ...body, amount: invalidAmount, idempotency_key: crypto.randomUUID() }),
    }, a.cookie);
    assert.equal(response.status, 400, String(invalidAmount));
  }
  assert.equal((await request('/api/household/contributions', {
    method: 'POST', body: JSON.stringify({ ...body, currency: 'MXN' }),
  }, a.cookie)).status, 400);

  const createResponse = await request('/api/household/contributions', {
    method: 'POST', body: JSON.stringify(body),
  }, a.cookie);
  assert.equal(createResponse.status, 201);
  const contribution = await createResponse.json();
  assert.equal(contribution.amount, '250.01');
  assert.equal(typeof contribution.amount, 'string');
  assert.equal(contribution.currency, 'MXN');
  assert.equal(contribution.status, 'posted');
  assert.equal(contribution.contributed_by_user_id, a.user.id);
  assert.equal(contribution.note, body.note);
  for (const privateKey of ['source_personal_account_id', 'personal_transaction_id', 'idempotency_key', 'institution']) {
    assert.equal(Object.hasOwn(contribution, privateKey), false, privateKey);
  }

  const retryResponse = await request('/api/household/contributions', {
    method: 'POST', body: JSON.stringify(body),
  }, a.cookie);
  assert.equal(retryResponse.status, 201);
  assert.equal((await retryResponse.json()).id, contribution.id);
  assert.equal((await request('/api/household/contributions', {
    method: 'POST', body: JSON.stringify({ ...body, amount: '250.02' }),
  }, a.cookie)).status, 409);
  assert.equal((await request(`/api/household/contributions/${contribution.id}/cancel`, {
    method: 'POST', body: '{}',
  }, b.cookie)).status, 404);

  const cancelResponse = await request(`/api/household/contributions/${contribution.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(cancelResponse.status, 200);
  const cancelled = await cancelResponse.json();
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelled_at);
  const cancelRetry = await request(`/api/household/contributions/${contribution.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(cancelRetry.status, 200);
  assert.equal((await cancelRetry.json()).cancelled_at, cancelled.cancelled_at);

  console.log('P1.5 contributions API: PASS (auth, strict money, privacy, idempotency, conflict and cancel).');
} finally {
  const admin = await connectPostgres();
  try {
    const userIds = fixtures.map(({ user }) => `'${user.id}'::uuid`).join(',') || 'null::uuid';
    const households = householdIds.map((id) => `'${id}'::uuid`).join(',') || 'null::uuid';
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
