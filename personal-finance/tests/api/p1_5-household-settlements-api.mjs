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
  assert.equal((await request('/api/household/settlements/00000000-0000-0000-0000-000000000000/confirm', { method: 'POST', body: '{}' })).status, 401);
  assert.equal((await request('/api/household/settlements/00000000-0000-0000-0000-000000000000/reject', { method: 'POST', body: '{}' })).status, 401);

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
  const personalAResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'Personal A checking', type: 'checking', initial_balance: '1000.00' }),
  }, a.cookie);
  assert.equal(personalAResponse.status, 201);
  const personalA = await personalAResponse.json();

  const expenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      funding_source: 'personal_account',
      source_account_id: personalA.id,
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

  // 4. Verify initial balance: B owes A 50.00, pending_settlement is null
  const balanceResponse = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(balanceResponse.status, 200);
  const initialBalance = await balanceResponse.json();
  assert.equal(initialBalance.amount, '50.00');
  assert.equal(initialBalance.owed_by_user_id, b.user.id);
  assert.equal(initialBalance.owed_to_user_id, a.user.id);
  assert.equal(initialBalance.pending_settlement, null);

  // 5. Validation rejection on settlement creation
  const idempotencyKey1 = crypto.randomUUID();
  const validBody = {
    household_id: householdId,
    amount: '20.00',
    date: '2026-09-06',
    notes: 'Pago parcial',
    idempotency_key: idempotencyKey1,
    funding_source: 'cash',
  };

  for (const invalidAmount of [20.0, '0.00', '-0.00', '-20.00', '020.00', '1e2', '20.001']) {
    const res = await request('/api/household/settlements', {
      method: 'POST', body: JSON.stringify({ ...validBody, amount: invalidAmount, idempotency_key: crypto.randomUUID() }),
    }, b.cookie);
    assert.equal(res.status, 400, String(invalidAmount));
  }

  // Reject personal_account without source_personal_account_id
  assert.equal((await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, funding_source: 'personal_account', idempotency_key: crypto.randomUUID() }),
  }, b.cookie)).status, 400);

  // Reject household_account without source_household_account_id
  assert.equal((await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, funding_source: 'household_account', idempotency_key: crypto.randomUUID() }),
  }, b.cookie)).status, 400);

  // Reject extra keys
  assert.equal((await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, currency: 'MXN' }),
  }, b.cookie)).status, 400);

  // 6. Exceeding current debt (50.00) returns 400
  const exceedResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({ ...validBody, amount: '60.00', idempotency_key: crypto.randomUUID() }),
  }, b.cookie);
  assert.equal(exceedResponse.status, 400);

  // 7. Successful partial settlement of 20.00 by B (cash)
  const settleResponse1 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(settleResponse1.status, 201);
  const settlement1 = await settleResponse1.json();
  assert.equal(settlement1.amount, '20.00');
  assert.equal(settlement1.payer_user_id, b.user.id);
  assert.equal(settlement1.payee_user_id, a.user.id);
  assert.equal(settlement1.recorded_by_user_id, b.user.id);
  assert.equal(settlement1.status, 'pending');
  assert.equal(settlement1.funding_source, 'cash');
  assert.equal(settlement1.is_cancelled, false);
  assert.equal(settlement1.entry_type, 'settlement');

  // Idempotency retry with same key returns existing settlement
  const retryResponse = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify(validBody),
  }, b.cookie);
  assert.equal(retryResponse.status, 201);
  assert.equal((await retryResponse.json()).id, settlement1.id);

  // Balance remains 50.00 while pending, with pending_settlement populated!
  const balanceWhilePending = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceWhilePending.amount, '50.00');
  assert.equal(balanceWhilePending.pending_settlement?.id, settlement1.id);
  assert.equal(balanceWhilePending.pending_settlement?.amount, '20.00');
  assert.equal(balanceWhilePending.pending_settlement?.funding_source, 'cash');

  // Permission check: Payer B CANNOT self-confirm
  const selfConfirmResponse = await request(`/api/household/settlements/${settlement1.id}/confirm`, {
    method: 'POST', body: '{}',
  }, b.cookie);
  assert.equal(selfConfirmResponse.status, 400);

  // Payee A confirms the settlement
  const confirmResponse = await request(`/api/household/settlements/${settlement1.id}/confirm`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(confirmResponse.status, 200);
  const confirmedSettlement = await confirmResponse.json();
  assert.equal(confirmedSettlement.status, 'confirmed');

  // Balance is now 30.00, pending_settlement is null
  const balanceAfterConfirm = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceAfterConfirm.amount, '30.00');
  assert.equal(balanceAfterConfirm.owed_by_user_id, b.user.id);
  assert.equal(balanceAfterConfirm.owed_to_user_id, a.user.id);
  assert.equal(balanceAfterConfirm.pending_settlement, null);

  // 8. Rejection workflow: B creates 10.00 in_kind settlement, A rejects it
  const idempotencyKey2 = crypto.randomUUID();
  const settleResponse2 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '10.00',
      date: '2026-09-06',
      notes: 'Pago en especie',
      idempotency_key: idempotencyKey2,
      funding_source: 'in_kind',
    }),
  }, b.cookie);
  assert.equal(settleResponse2.status, 201);
  const settlement2 = await settleResponse2.json();
  assert.equal(settlement2.status, 'pending');
  assert.equal(settlement2.funding_source, 'in_kind');

  // Payer B cannot reject
  assert.equal((await request(`/api/household/settlements/${settlement2.id}/reject`, { method: 'POST', body: '{}' }, b.cookie)).status, 400);

  // Payee A rejects
  const rejectResponse = await request(`/api/household/settlements/${settlement2.id}/reject`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(rejectResponse.status, 200);
  assert.equal((await rejectResponse.json()).status, 'rejected');

  // Balance remains 30.00 untouched
  const balanceAfterReject = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceAfterReject.amount, '30.00');
  assert.equal(balanceAfterReject.pending_settlement, null);

  // 9. Personal account funding source:
  // Setup personal account for B with 1000.00
  const personalBResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'Personal B checking', type: 'checking', initial_balance: '1000.00' }),
  }, b.cookie);
  assert.equal(personalBResponse.status, 201);
  const personalB = await personalBResponse.json();

  const idempotencyKey3 = crypto.randomUUID();
  const settleResponse3 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '15.00',
      date: '2026-09-06',
      notes: 'Transferencia bancaria personal',
      idempotency_key: idempotencyKey3,
      funding_source: 'personal_account',
      source_personal_account_id: personalB.id,
    }),
  }, b.cookie);
  assert.equal(settleResponse3.status, 201);
  const settlement3 = await settleResponse3.json();
  assert.equal(settlement3.status, 'pending');
  assert.equal(settlement3.funding_source, 'personal_account');

  // Check personal account balance of B is still 1000.00 while pending
  const accountsBWhilePending = await (await request('/api/accounts', {}, b.cookie)).json();
  const acctBWhilePending = accountsBWhilePending.find((acct) => acct.id === personalB.id);
  assert.equal(acctBWhilePending.balance, '1000.00');

  // Payee A confirms personal account settlement
  const confirmPersonalResponse = await request(`/api/household/settlements/${settlement3.id}/confirm`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(confirmPersonalResponse.status, 200);
  assert.equal((await confirmPersonalResponse.json()).status, 'confirmed');

  // Check personal account balance of B is now 985.00
  const accountsBAfterConfirm = await (await request('/api/accounts', {}, b.cookie)).json();
  const acctBAfterConfirm = accountsBAfterConfirm.find((acct) => acct.id === personalB.id);
  assert.equal(acctBAfterConfirm.balance, '985.00');

  // Balance is now 15.00
  const balanceAfterPersonal = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceAfterPersonal.amount, '15.00');

  // 10. Household account funding source:
  // Setup household account with 500.00
  const householdAccountResponse = await request('/api/household/accounts', {
    method: 'POST', body: JSON.stringify({ household_id: householdId, name: 'Common Pool', type: 'checking', initial_balance: '500.00' }),
  }, a.cookie);
  assert.equal(householdAccountResponse.status, 201);
  const householdAcct = await householdAccountResponse.json();

  const idempotencyKey4 = crypto.randomUUID();
  const settleResponse4 = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '15.00',
      date: '2026-09-06',
      notes: 'Desde fondo común',
      idempotency_key: idempotencyKey4,
      funding_source: 'household_account',
      source_household_account_id: householdAcct.id,
    }),
  }, b.cookie);
  assert.equal(settleResponse4.status, 201);
  const settlement4 = await settleResponse4.json();
  assert.equal(settlement4.status, 'pending');
  assert.equal(settlement4.funding_source, 'household_account');

  // Check household account balance is still 500.00 while pending
  const hhAcctsWhilePending = await (await request(`/api/household/accounts?household_id=${householdId}`, {}, a.cookie)).json();
  const hhAcctWhilePending = hhAcctsWhilePending.find((acct) => acct.id === householdAcct.id);
  assert.equal(hhAcctWhilePending.balance, '500.00');

  // Payee A confirms household account settlement
  const confirmHouseholdResponse = await request(`/api/household/settlements/${settlement4.id}/confirm`, {
    method: 'POST', body: '{}',
  }, a.cookie);
  assert.equal(confirmHouseholdResponse.status, 200);

  // Check household account balance is now 485.00
  const hhAcctsAfterConfirm = await (await request(`/api/household/accounts?household_id=${householdId}`, {}, a.cookie)).json();
  const hhAcctAfterConfirm = hhAcctsAfterConfirm.find((acct) => acct.id === householdAcct.id);
  assert.equal(hhAcctAfterConfirm.balance, '485.00');

  // Debt is now fully settled (0.00)
  const balanceZero = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceZero.amount, '0.00');
  assert.equal(balanceZero.owed_by_user_id, null);
  assert.equal(balanceZero.owed_to_user_id, null);

  // 11. Attempting settlement when debt is 0.00 fails
  const zeroDebtSettle = await request('/api/household/settlements', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId,
      amount: '10.00',
      date: '2026-09-06',
    }),
  }, b.cookie);
  assert.equal(zeroDebtSettle.status, 400);

  // 12. Cancel confirmed settlement (settlement3 - personal account 15.00)
  const cancelResponse = await request(`/api/household/settlements/${settlement3.id}/cancel`, {
    method: 'POST', body: '{}',
  }, b.cookie);
  assert.equal(cancelResponse.status, 200);
  const cancelled = await cancelResponse.json();
  assert.equal(cancelled.id, settlement3.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.is_cancelled, true);

  // Payer personal account balance restored to 1000.00!
  const accountsBAfterCancel = await (await request('/api/accounts', {}, b.cookie)).json();
  const acctBAfterCancel = accountsBAfterCancel.find((acct) => acct.id === personalB.id);
  assert.equal(acctBAfterCancel.balance, '1000.00');

  // Balance restored to 15.00!
  const balanceRestored = await (await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie)).json();
  assert.equal(balanceRestored.amount, '15.00');
  assert.equal(balanceRestored.owed_by_user_id, b.user.id);
  assert.equal(balanceRestored.owed_to_user_id, a.user.id);

  // 13. History includes settlements with status and funding_source
  const historyResponse = await request(`/api/household/history?household_id=${householdId}`, {}, a.cookie);
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  const settlementsInHistory = history.items.filter((item) => item.entry_type === 'settlement');
  assert.equal(settlementsInHistory.length, 4);
  for (const s of settlementsInHistory) {
    assert.ok(s.status);
    assert.ok(s.funding_source);
  }

  console.log('P1.5 settlements API: PASS (funding sources, pending, confirm, reject, cancel, ledger balance restoration).');
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
