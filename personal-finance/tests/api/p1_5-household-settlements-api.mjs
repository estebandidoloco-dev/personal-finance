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
      email: `p15-settle-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `P15 Settle ${label}` } },
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
let c;
try {
  a = await makeUser('a');
  b = await makeUser('b');
  c = await makeUser('c');

  // 1. Unauthenticated checks
  assert.equal((await request('/api/household/settlements', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request(`/api/household/settlements/${crypto.randomUUID()}/cancel`, { method: 'POST', body: '{}' })).status, 401);

  // 2. Setup household and partner
  const householdResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Settlements ${unique}` }),
  }, a.cookie);
  assert.equal(householdResponse.status, 201);
  const householdId = (await householdResponse.json()).id;
  householdIds.push(householdId);

  const invitationResponse = await request('/api/household/invitations', {
    method: 'POST', body: JSON.stringify({ household_id: householdId, invited_email: b.user.email }),
  }, a.cookie);
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  assert.equal((await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: invitation.invitation_token }),
  }, b.cookie)).status, 200);

  // 3. User A creates personal account and shared personal-funded expense of 200.00
  const personalResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'Personal source', type: 'checking', initial_balance: '10000.00' }),
  }, a.cookie);
  assert.equal(personalResponse.status, 201);
  const personal = await personalResponse.json();

  const expenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      funding_source: 'personal_account',
      source_account_id: personal.id,
      amount: '200.00',
      date: '2026-09-06',
      description: 'Cena compartida',
      split_mode: 'equal',
      splits: null,
      notes: null,
      status: 'posted',
    }),
  }, a.cookie);
  assert.equal(expenseResponse.status, 201);

  // Initial balance check: debt of 100.00 owed by B to A
  const initialBalanceResponse = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(initialBalanceResponse.status, 200);
  const initialBalance = await initialBalanceResponse.json();
  assert.equal(initialBalance.amount, '100.00');
  assert.equal(initialBalance.owed_by_user_id, b.user.id);
  assert.equal(initialBalance.owed_to_user_id, a.user.id);

  // 4. Strict request validation
  const idempotencyKey1 = crypto.randomUUID();
  const validBody = {
    household_id: householdId,
    amount: '40.00',
    date: '2026-09-06',
    note: 'Pago parcial cena',
    idempotency_key: idempotencyKey1,
  };

  // Rejection of extra / forged fields
  for (const forbidden of ['from_user_id', 'to_user_id', 'currency', 'status', 'recorded_by_user_id']) {
    const res = await request('/api/household/settlements', {
      method: 'POST', body: JSON.stringify({ ...validBody, [forbidden]: a.user.id }),
    }, b.cookie);
    assert.equal(res.status, 400, `Forbidden field ${forbidden} should be rejected`);
  }

  // Rejection of invalid money formats
  for (const invalidAmount of [40.0, '0.00', '-0.00', '-10.00', '01.00', '1e3', '40.001']) {
    const res = await request('/api/household/settlements', {
      method: 'POST', body: JSON.stringify({ ...validBody, amount: invalidAmount, idempotency_key: crypto.randomUUID() }),
    }, b.cookie);
    assert.equal(res.status, 400, `Invalid amount ${invalidAmount} should be rejected`);
  }

  // Partner (creditor A) cannot create settlement
  const partnerAttempt = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, idempotency_key: crypto.randomUUID() }),
  }, a.cookie);
  assert.equal(partnerAttempt.status, 400, 'Non-debtor partner must be rejected');

  // Overpay rejected (debt is 100.00, try 100.01)
  const overpayAttempt = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, amount: '100.01', idempotency_key: crypto.randomUUID() }),
  }, b.cookie);
  assert.equal(overpayAttempt.status, 400, 'Overpay must be rejected');

  // 5. Successful partial settlement (40.00)
  const partialResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(partialResponse.status, 201);
  const partialSettlement = await partialResponse.json();
  assert.equal(partialSettlement.household_id, householdId);
  assert.equal(partialSettlement.from_user_id, b.user.id);
  assert.equal(partialSettlement.to_user_id, a.user.id);
  assert.equal(partialSettlement.recorded_by_user_id, b.user.id);
  assert.equal(partialSettlement.amount, '40.00');
  assert.equal(partialSettlement.currency, 'MXN');
  assert.equal(partialSettlement.date, '2026-09-06');
  assert.equal(partialSettlement.note, 'Pago parcial cena');
  assert.equal(partialSettlement.status, 'posted');
  assert.equal(partialSettlement.cancelled_at, null);

  // Privacy & no leakage
  for (const privateKey of ['idempotency_key', 'cancelled_by_user_id']) {
    assert.equal(Object.hasOwn(partialSettlement, privateKey), false, `Response must not leak ${privateKey}`);
  }

  // Balance after partial settlement: remaining debt 60.00
  const balanceAfterPartialRes = await request(`/api/household/balance?household_id=${householdId}`, {}, b.cookie);
  assert.equal(balanceAfterPartialRes.status, 200);
  const balanceAfterPartial = await balanceAfterPartialRes.json();
  assert.equal(balanceAfterPartial.amount, '60.00');
  assert.equal(balanceAfterPartial.owed_by_user_id, b.user.id);
  assert.equal(balanceAfterPartial.owed_to_user_id, a.user.id);

  // 6. Idempotency tests
  // Same payload -> 201 with identical id
  const retryResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(retryResponse.status, 201);
  assert.equal((await retryResponse.json()).id, partialSettlement.id);

  // Conflicting payload with same idempotency key -> 409 Conflict
  const conflictResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, amount: '40.01' }),
  }, b.cookie);
  assert.equal(conflictResponse.status, 409);

  // 7. Cancel settlement authorization tests & debt restoration
  // Partner (creditor A) tries to cancel -> 400
  const partnerCancelAttempt = await request(`/api/household/settlements/${partialSettlement.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(partnerCancelAttempt.status, 400, 'Partner/creditor cannot cancel settlement');

  // Debt after partner cancel rejection: remains 60.00
  const balanceAfterPartnerReject = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterPartnerReject.status, 200);
  assert.equal((await balanceAfterPartnerReject.json()).amount, '60.00', 'Debt stays 60.00 after partner cancel rejection');

  // Outsider (user C) tries to cancel -> 404
  const outsiderCancelAttempt = await request(`/api/household/settlements/${partialSettlement.id}/cancel`, {
    method: 'POST', body: '{}',
  }, c.cookie);
  assert.equal(outsiderCancelAttempt.status, 404, 'Outsider cannot cancel settlement');

  // Debt after outsider cancel rejection: remains 60.00
  const balanceAfterOutsiderReject = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterOutsiderReject.status, 200);
  assert.equal((await balanceAfterOutsiderReject.json()).amount, '60.00', 'Debt stays 60.00 after outsider cancel rejection');

  // Debtor / recorder cancels their settlement
  const cancelResponse = await request(`/api/household/settlements/${partialSettlement.id}/cancel`, {
    method: 'POST', body: '{}',
  }, b.cookie);
  assert.equal(cancelResponse.status, 200);
  const cancelled = await cancelResponse.json();
  assert.equal(cancelled.id, partialSettlement.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.cancelled_at);

  // Check debt restored: debt should be restored to 100.00!
  const balanceAfterCancelRes = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterCancelRes.status, 200);
  const balanceAfterCancel = await balanceAfterCancelRes.json();
  assert.equal(balanceAfterCancel.amount, '100.00', 'Debt restored to 100.00 after cancellation');
  assert.equal(balanceAfterCancel.owed_by_user_id, b.user.id);
  assert.equal(balanceAfterCancel.owed_to_user_id, a.user.id);

  // Repeated cancel by debtor/recorder: idempotent 200
  const repeatedCancel = await request(`/api/household/settlements/${partialSettlement.id}/cancel`, {
    method: 'POST', body: '{}',
  }, b.cookie);
  assert.equal(repeatedCancel.status, 200);
  assert.equal((await repeatedCancel.json()).cancelled_at, cancelled.cancelled_at);

  // Check debt remains 100.00 after repeated cancel
  const balanceAfterRepeatedCancel = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterRepeatedCancel.status, 200);
  assert.equal((await balanceAfterRepeatedCancel.json()).amount, '100.00', 'Debt remains 100.00 after repeated cancel');

  // Partner attempting to cancel after settlement is cancelled is still rejected -> 400
  const partnerCancelAfter = await request(`/api/household/settlements/${partialSettlement.id}/cancel`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(partnerCancelAfter.status, 400, 'Partner cannot cancel already cancelled settlement');

  // Debt remains 100.00
  const balanceAfterPartnerRejectCancelled = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterPartnerRejectCancelled.status, 200);
  assert.equal((await balanceAfterPartnerRejectCancelled.json()).amount, '100.00', 'Debt remains 100.00');

  // 8. Full settlement (now that debt is 100.00)
  const idempotencyKey2 = crypto.randomUUID();
  const fullResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '100.00',
      date: '2026-09-06',
      note: 'Liquidación final',
      idempotency_key: idempotencyKey2,
    }),
  }, b.cookie);
  assert.equal(fullResponse.status, 201);
  const fullSettlement = await fullResponse.json();
  assert.equal(fullSettlement.amount, '100.00');
  assert.equal(fullSettlement.status, 'posted');

  // Balance after full settlement: debt is 0.00
  const balanceAfterFullRes = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceAfterFullRes.status, 200);
  const balanceAfterFull = await balanceAfterFullRes.json();
  assert.equal(balanceAfterFull.amount, '0.00');
  assert.equal(balanceAfterFull.owed_by_user_id, null);
  assert.equal(balanceAfterFull.owed_to_user_id, null);

  // Attempting to settle when debt is 0 -> 400
  const zeroDebtAttempt = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '10.00',
      date: '2026-09-06',
      idempotency_key: crypto.randomUUID(),
    }),
  }, b.cookie);
  assert.equal(zeroDebtAttempt.status, 400, 'Settling zero debt must be rejected');

  // 9. Accounts balance and dashboard isolation
  const personalAccountCheck = await request('/api/accounts', {}, a.cookie);
  const personalAccount = (await personalAccountCheck.json())[0];
  assert.equal(personalAccount.balance, '9800.00', 'Personal balance only affected by the initial 200.00 expense');

  console.log('P1.5 settlements API: PASS (auth, validation, strict money, idempotency, conflict, partial/full payment, overpay prevention, cancellation, privacy).');
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
  } finally {
    admin.close();
  }
}

