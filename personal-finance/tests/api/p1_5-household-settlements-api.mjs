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
      email: `p15-settlement-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `P15 Settlement ${label}` } },
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

  // 1. Unauthorized check
  assert.equal((await request('/api/household/settlements', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request('/api/household/settlements/00000000-0000-0000-0000-000000000000/cancel', { method: 'POST', body: '{}' })).status, 401);

  // 2. Setup household with A and B
  const householdResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Settlements Home ${unique}` }),
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

  // 3. Setup personal account for A and record personal shared expense: 100.00
  const personalResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'Personal A checking', type: 'checking', initial_balance: '1000.00' }),
  }, a.cookie);
  assert.equal(personalResponse.status, 201);
  const personal = await personalResponse.json();

  const expenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      funding_source: 'personal_account',
      source_account_id: personal.id,
      amount: '100.00',
      date: '2026-09-06',
      description: 'Shared dinner',
      split_mode: 'equal',
      splits: null,
      notes: null,
      category_id: null,
      status: 'posted',
    }),
  }, a.cookie);
  assert.equal(expenseResponse.status, 201);

  // 4. Verify initial balance: B owes A 50.00
  const balanceResponse = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceResponse.status, 200);
  const initialBalance = await balanceResponse.json();
  assert.equal(initialBalance.amount, '50.00');
  assert.equal(initialBalance.owed_by_user_id, b.user.id);
  assert.equal(initialBalance.owed_to_user_id, a.user.id);

  // 5. Validation rejection on settlement creation
  const idempotencyKey1 = crypto.randomUUID();
  const validBody = {
    household_id: householdId,
    amount: '20.00',
    date: '2026-09-06',
    notes: 'Pago parcial',
    idempotency_key: idempotencyKey1,
  };

  for (const invalidAmount of [20.0, '0.00', '-0.00', '-20.00', '020.00', '1e2', '20.001']) {
    const res = await request('/api/household/settlements', {
      method: 'POST', body: JSON.stringify({ ...validBody, amount: invalidAmount, idempotency_key: crypto.randomUUID() }),
    }, b.cookie);
    assert.equal(res.status, 400, String(invalidAmount));
  }

  // Reject extra keys
  assert.equal((await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, currency: 'MXN' }),
  }, b.cookie)).status, 400);

  // 6. Exceeding current debt (50.00) returns 400
  const exceedResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, amount: '60.00', idempotency_key: crypto.randomUUID() }),
  }, b.cookie);
  assert.equal(exceedResponse.status, 400);

  // 7. Successful partial settlement of 20.00 by B
  const settleResponse1 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(settleResponse1.status, 201);
  const settlement1 = await settleResponse1.json();
  assert.equal(settlement1.amount, '20.00');
  assert.equal(settlement1.payer_user_id, b.user.id);
  assert.equal(settlement1.payee_user_id, a.user.id);
  assert.equal(settlement1.recorded_by_user_id, b.user.id);
  assert.equal(settlement1.is_cancelled, false);
  assert.equal(settlement1.entry_type, 'settlement');

  // Idempotency retry with same key returns existing settlement
  const retryResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(retryResponse.status, 201);
  assert.equal((await retryResponse.json()).id, settlement1.id);

  // Same key with different amount returns 409 Conflict
  const conflictResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, amount: '25.00' }),
  }, b.cookie);
  assert.equal(conflictResponse.status, 409);

  // 8. Balance is now 30.00
  const balanceAfterPart = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceAfterPart.amount, '30.00');
  assert.equal(balanceAfterPart.owed_by_user_id, b.user.id);
  assert.equal(balanceAfterPart.owed_to_user_id, a.user.id);

  // 9. Settle remaining 30.00
  const idempotencyKey2 = crypto.randomUUID();
  const settleResponse2 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '30.00',
      date: '2026-09-06',
      notes: 'Liquidación total',
      idempotency_key: idempotencyKey2,
    }),
  }, b.cookie);
  assert.equal(settleResponse2.status, 201);

  // Balance is now 0.00
  const balanceZero = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceZero.amount, '0.00');
  assert.equal(balanceZero.owed_by_user_id, null);
  assert.equal(balanceZero.owed_to_user_id, null);

  // 10. Attempting settlement when debt is 0.00 fails
  const zeroDebtSettle = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '10.00',
      date: '2026-09-06',
    }),
  }, b.cookie);
  assert.equal(zeroDebtSettle.status, 400);

  // 11. Cancel first settlement (20.00)
  // Invalid UUID returns 400
  assert.equal((await request('/api/household/settlements/invalid-uuid/cancel', { method: 'POST', body: '{}' }, a.cookie)).status, 400);

  const cancelResponse = await request(`/api/household/settlements/${settlement1.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(cancelResponse.status, 200);
  const cancelled = await cancelResponse.json();
  assert.equal(cancelled.id, settlement1.id);
  assert.equal(cancelled.is_cancelled, true);

  // Idempotent cancel replay returns 200
  const cancelRetry = await request(`/api/household/settlements/${settlement1.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(cancelRetry.status, 200);
  assert.equal((await cancelRetry.json()).is_cancelled, true);

  // Balance reflects cancellation (now B owes A 20.00)
  const balanceRestored = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceRestored.amount, '20.00');
  assert.equal(balanceRestored.owed_by_user_id, b.user.id);
  assert.equal(balanceRestored.owed_to_user_id, a.user.id);

  // 12. History includes settlements
  const historyResponse = await request(`/api/household/history?household_id=${householdId}`, {}, a.cookie);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  const settlementsInHistory = history.items.filter((item) => item.entry_type === 'settlement');
  assert.equal(settlementsInHistory.length, 2);

  console.log('P1.4 / P1.5 settlements API: PASS (auth, validation, idempotency, balance math, cancellation, history).');
} finally {
  const admin = await connectPostgres();
  try {
    const userIds = fixtures.map(({ user }) => `'${user.id}'::uuid`).join(',') || 'null::uuid';
    const households = householdIds.map((id) => `'${id}'::uuid`).join(',') || 'null::uuid';
    await admin.query(`
      begin;
      set local session_replication_role = replica;
      set constraints all deferred;
      delete from public.household_settlements where household_id in (${households});
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
