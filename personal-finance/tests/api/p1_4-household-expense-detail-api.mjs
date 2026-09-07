import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';
import { loadLocalHouseholdTestEnv, signUpTrackedFixture } from './p1_4-household-harness.mjs';

const { env, supabaseUrl, baseUrl } = await loadLocalHouseholdTestEnv();
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtures = [];
const householdIds = [];
const categoryIds = [crypto.randomUUID(), crypto.randomUUID()];

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return signUpTrackedFixture({
    client,
    fixtures,
    storageKey: `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`,
    credentials: {
      email: `p14-detail-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `P14 Detail ${label}` } },
    },
  });
}

async function request(path, options = {}, cookie = '') {
  return fetch(new URL(path, baseUrl), {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...(options.headers ?? {}) },
  });
}

const detailKeys = [
  'amount', 'category', 'category_id', 'created_at', 'currency', 'date', 'description', 'funding_source',
  'household_id', 'id', 'notes', 'personal_payer_user_id', 'recorded_by_user_id',
  'source_account_id', 'split_mode', 'splits', 'status', 'updated_at',
];

let a;
let b;
let pending;
let outsider;
try {
  a = await makeUser('a');
  b = await makeUser('b');
  pending = await makeUser('pending');
  outsider = await makeUser('outsider');

  const categoryDatabase = await connectPostgres();
  try {
    await categoryDatabase.query(`
      insert into public.categories(id, user_id, name, color, type, is_system) values
        ('${categoryIds[0]}', null, 'Vivienda', '#112233', 'expense', true),
        ('${categoryIds[1]}', '${a.user.id}', 'Privada A', '#445566', 'expense', false)
    `);
  } finally {
    categoryDatabase.close();
  }

  assert.equal((await request('/api/household/expenses/not-a-uuid')).status, 401);

  const householdResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Detail Casa ${unique}` }),
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

  const personalAccountResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({
      name: `Personal ${unique}`, type: 'checking', initial_balance: '500.00',
    }),
  }, a.cookie);
  assert.equal(personalAccountResponse.status, 201);
  const personalAccount = await personalAccountResponse.json();
  const partnerAccountResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({
      name: `Partner personal ${unique}`, type: 'checking', initial_balance: '50.00',
    }),
  }, b.cookie);
  assert.equal(partnerAccountResponse.status, 201);
  const partnerAccount = await partnerAccountResponse.json();

  const householdAccountResponse = await request('/api/household/accounts', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, name: `Comun ${unique}`, type: 'cash', initial_balance: '100.00',
    }),
  }, a.cookie);
  assert.equal(householdAccountResponse.status, 201);
  const householdAccount = await householdAccountResponse.json();

  const personalExpenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account',
      source_account_id: personalAccount.id, amount: '100.01', date: '2026-09-05',
      description: 'Cena personal', notes: 'nota privada', split_mode: 'custom',
      category_id: categoryIds[0],
      splits: [
        { user_id: a.user.id, amount: '40.00' },
        { user_id: b.user.id, amount: '60.01' },
      ],
    }),
  }, a.cookie);
  assert.equal(personalExpenseResponse.status, 201);
  const personalExpense = await personalExpenseResponse.json();

  const payerGet = await request(`/api/household/expenses/${personalExpense.id}`, {}, a.cookie);
  assert.equal(payerGet.status, 200);
  const payerDetail = await payerGet.json();
  assert.deepEqual(Object.keys(payerDetail).sort(), detailKeys);
  assert.equal(payerDetail.source_account_id, personalAccount.id);
  assert.equal(payerDetail.notes, 'nota privada');
  assert.equal(payerDetail.amount, '100.01');
  assert.equal(typeof payerDetail.amount, 'string');
  assert.equal(payerDetail.currency, 'MXN');
  assert.deepEqual(payerDetail.category, {
    id: categoryIds[0], name: 'Vivienda', color: '#112233',
  });
  assert.ok(!('user_id' in payerDetail.category));
  assert.equal(payerDetail.date, '2026-09-05');
  assert.equal(payerDetail.splits.length, 2);
  assert.ok(!('personal_transaction_id' in payerDetail));
  assert.ok(!('household_account_transaction_id' in payerDetail));

  const partnerGet = await request(`/api/household/expenses/${personalExpense.id}`, {}, b.cookie);
  assert.equal(partnerGet.status, 200);
  const partnerDetail = await partnerGet.json();
  assert.equal(partnerDetail.source_account_id, null);
  assert.equal(partnerDetail.notes, null);
  assert.equal(partnerDetail.personal_payer_user_id, a.user.id);
  assert.deepEqual(partnerDetail.category, payerDetail.category);

  const personalPatch = {
    source_account_id: personalAccount.id, amount: '100.01', date: '2026-09-05',
    description: 'Cena actualizada', notes: 'nota actualizada', split_mode: 'custom',
    splits: [
      { user_id: a.user.id, amount: '50.00' },
      { user_id: b.user.id, amount: '50.01' },
    ], status: 'posted', category_id: categoryIds[0],
  };
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify(personalPatch),
  }, b.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'DELETE',
  }, b.cookie)).status, 404);

  const payerPatch = await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify(personalPatch),
  }, a.cookie);
  assert.equal(payerPatch.status, 200);
  assert.equal((await payerPatch.json()).id, personalExpense.id);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify({ ...personalPatch, source_account_id: householdAccount.id }),
  }, a.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify({ ...personalPatch, source_account_id: partnerAccount.id }),
  }, a.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify({ ...personalPatch, category_id: categoryIds[1] }),
  }, a.cookie)).status, 400);
  assert.equal((await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account',
      source_account_id: personalAccount.id, amount: '1.00', date: '2026-09-05',
      description: 'Categoria privada', split_mode: 'equal', category_id: categoryIds[1],
    }),
  }, a.cookie)).status, 400);

  const disposableResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account',
      source_account_id: personalAccount.id, amount: '1.00', date: '2026-09-05',
      description: 'Desechable', split_mode: 'equal',
    }),
  }, a.cookie);
  assert.equal(disposableResponse.status, 201);
  const disposable = await disposableResponse.json();
  assert.equal((await request(`/api/household/expenses/${disposable.id}`, {
    method: 'DELETE',
  }, a.cookie)).status, 200);
  assert.equal((await request(`/api/household/expenses/${disposable.id}`, {}, a.cookie)).status, 404);

  const householdExpenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'household_account',
      source_account_id: householdAccount.id, amount: '20.00', date: '2026-09-06',
      description: 'Cena comun', notes: 'nota compartida', split_mode: 'equal',
    }),
  }, a.cookie);
  assert.equal(householdExpenseResponse.status, 201);
  const householdExpense = await householdExpenseResponse.json();
  for (const member of [a, b]) {
    const response = await request(`/api/household/expenses/${householdExpense.id}`, {}, member.cookie);
    assert.equal(response.status, 200);
    const detail = await response.json();
    assert.equal(detail.source_account_id, householdAccount.id);
    assert.equal(detail.personal_payer_user_id, null);
    assert.equal(detail.notes, 'nota compartida');
    assert.equal(detail.category, null);
  }
  const householdPatchBody = {
    source_account_id: householdAccount.id, amount: '20.00', date: '2026-09-06',
    description: 'Cena comun B', notes: 'compartida B', split_mode: 'equal',
    status: 'posted', category_id: null,
  };
  const householdPatch = await request(`/api/household/expenses/${householdExpense.id}`, {
    method: 'PATCH', body: JSON.stringify(householdPatchBody),
  }, b.cookie);
  assert.equal(householdPatch.status, 200);
  assert.equal((await householdPatch.json()).id, householdExpense.id);

  for (const path of [
    `/api/household/expenses?household_id=${householdId}&limit=25`,
    `/api/household/history?household_id=${householdId}&limit=25`,
  ]) {
    const response = await request(path, {}, b.cookie);
    assert.equal(response.status, 200);
    const page = await response.json();
    const categorized = page.items.find((item) => item.id === personalExpense.id);
    assert.deepEqual(categorized.category, payerDetail.category);
    assert.ok(!('user_id' in categorized.category));
  }

  const disposableHouseholdResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'household_account',
      source_account_id: householdAccount.id, amount: '1.00', date: '2026-09-06',
      description: 'Comun desechable', split_mode: 'equal',
    }),
  }, a.cookie);
  assert.equal(disposableHouseholdResponse.status, 201);
  const disposableHousehold = await disposableHouseholdResponse.json();
  assert.equal((await request(`/api/household/expenses/${disposableHousehold.id}`, {
    method: 'DELETE',
  }, b.cookie)).status, 200);

  const formingHouseholdResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Pending Casa ${unique}` }),
  }, outsider.cookie);
  assert.equal(formingHouseholdResponse.status, 201);
  const formingHouseholdId = (await formingHouseholdResponse.json()).id;
  householdIds.push(formingHouseholdId);
  const pendingInvitation = await request('/api/household/invitations', {
    method: 'POST', body: JSON.stringify({
      household_id: formingHouseholdId, invited_email: pending.user.email,
    }),
  }, outsider.cookie);
  assert.equal(pendingInvitation.status, 201);
  // A pending invitation to another Household grants no access to a known expense UUID.
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {}, pending.cookie)).status, 404);
  for (const path of [
    `/api/household/archive/${householdId}`,
    `/api/household/members?household_id=${householdId}`,
    `/api/household/balance?household_id=${householdId}`,
    `/api/household/expenses?household_id=${householdId}&limit=25`,
    `/api/household/history?household_id=${householdId}&limit=25`,
  ]) {
    assert.equal((await request(path, {}, pending.cookie)).status, 404);
  }
  const pendingInvitationBody = await pendingInvitation.json();
  assert.equal((await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: pendingInvitationBody.invitation_token }),
  }, pending.cookie)).status, 200);
  const otherAccountResponse = await request('/api/household/accounts', {
    method: 'POST', body: JSON.stringify({
      household_id: formingHouseholdId, name: `Otra comun ${unique}`, type: 'cash', initial_balance: '10.00',
    }),
  }, outsider.cookie);
  assert.equal(otherAccountResponse.status, 201);
  const otherAccount = await otherAccountResponse.json();
  assert.equal((await request(`/api/household/expenses/${householdExpense.id}`, {
    method: 'PATCH', body: JSON.stringify({ ...householdPatchBody, source_account_id: otherAccount.id }),
  }, a.cookie)).status, 404);
  const otherExpenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: formingHouseholdId, funding_source: 'household_account',
      source_account_id: otherAccount.id, amount: '1.00', date: '2026-09-06',
      description: 'Otro Household', split_mode: 'equal',
    }),
  }, outsider.cookie);
  assert.equal(otherExpenseResponse.status, 201);
  const otherExpense = await otherExpenseResponse.json();
  assert.equal((await request(`/api/household/expenses/${otherExpense.id}`, {}, a.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {}, outsider.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${crypto.randomUUID()}`, {}, a.cookie)).status, 404);
  assert.equal((await request('/api/household/expenses/not-a-uuid', {}, a.cookie)).status, 400);

  assert.equal((await request('/api/household/leave', {
    method: 'POST', body: JSON.stringify({ household_id: householdId }),
  }, b.cookie)).status, 200);
  for (const member of [a, b]) {
    for (const path of [
      `/api/household/archive/${householdId}`,
      `/api/household/members?household_id=${householdId}`,
      `/api/household/balance?household_id=${householdId}`,
      `/api/household/expenses?household_id=${householdId}&limit=25`,
      `/api/household/history?household_id=${householdId}&limit=25`,
    ]) {
      const response = await request(path, {}, member.cookie);
      assert.equal(response.status, 200, `${path} must remain readable when archived`);
    }
    for (const [rpc, args] of [
      ['get_archived_household', { p_household_id: householdId }],
      ['get_household_members', { p_household_id: householdId }],
      ['get_household_balance_between_members', { p_household_id: householdId }],
      ['get_household_expenses_page', {
        p_household_id: householdId, p_limit: 25,
        p_before_date: null, p_before_created_at: null, p_before_id: null,
      }],
      ['get_household_activity_page', {
        p_household_id: householdId, p_limit: 25,
        p_before_date: null, p_before_created_at: null, p_before_id: null,
      }],
    ]) {
      const { error } = await member.client.rpc(rpc, args);
      assert.ifError(error);
    }
  }
  const archivedPayer = await request(`/api/household/expenses/${personalExpense.id}`, {}, a.cookie);
  assert.equal(archivedPayer.status, 200);
  const archivedPayerBody = await archivedPayer.json();
  assert.equal(archivedPayerBody.source_account_id, personalAccount.id);
  assert.deepEqual(archivedPayerBody.category, payerDetail.category);
  const archivedPartner = await request(`/api/household/expenses/${personalExpense.id}`, {}, b.cookie);
  assert.equal(archivedPartner.status, 200);
  const archivedPartnerBody = await archivedPartner.json();
  assert.equal(archivedPartnerBody.source_account_id, null);
  assert.deepEqual(archivedPartnerBody.category, payerDetail.category);
  const archivedHistory = await request(
    `/api/household/history?household_id=${householdId}&limit=25`, {}, a.cookie,
  );
  assert.equal(archivedHistory.status, 200);
  assert.deepEqual(
    (await archivedHistory.json()).items.find((item) => item.id === personalExpense.id).category,
    payerDetail.category,
  );
  const currentAfterArchive = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Current after archive ${unique}` }),
  }, a.cookie);
  assert.equal(currentAfterArchive.status, 201);
  const soloHouseholdId = (await currentAfterArchive.json()).id;
  householdIds.push(soloHouseholdId);
  assert.equal((await request(`/api/household/archive/${householdId}`, {}, a.cookie)).status, 200);
  assert.equal((await request(
    `/api/household/history?household_id=${householdId}&limit=25`, {}, a.cookie,
  )).status, 200);
  assert.equal((await request('/api/household/leave', {
    method: 'POST', body: JSON.stringify({ household_id: soloHouseholdId }),
  }, a.cookie)).status, 200);
  const soloBalanceResponse = await request(
    `/api/household/balance?household_id=${soloHouseholdId}`, {}, a.cookie,
  );
  assert.equal(soloBalanceResponse.status, 200);
  const soloBalance = await soloBalanceResponse.json();
  assert.deepEqual(soloBalance.positions, [{ user_id: a.user.id, amount: '0.00' }]);
  assert.equal(soloBalance.amount, '0.00');
  assert.equal(soloBalance.owed_by_user_id, null);
  assert.equal(soloBalance.owed_to_user_id, null);
  const replacementCurrent = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Replacement current ${unique}` }),
  }, a.cookie);
  assert.equal(replacementCurrent.status, 201);
  householdIds.push((await replacementCurrent.json()).id);
  assert.equal((await request(
    `/api/household/balance?household_id=${soloHouseholdId}`, {}, a.cookie,
  )).status, 200);
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {
    method: 'PATCH', body: JSON.stringify(personalPatch),
  }, a.cookie)).status, 404);
  assert.equal((await request(`/api/household/expenses/${householdExpense.id}`, {
    method: 'DELETE',
  }, b.cookie)).status, 404);

  const admin = await connectPostgres();
  try {
    await admin.query(`
      update public.household_members
         set status = 'removed', ended_at = coalesce(ended_at, now())
       where household_id = '${householdId}' and user_id = '${b.user.id}'
    `);
  } finally {
    admin.close();
  }
  assert.equal((await request(`/api/household/expenses/${personalExpense.id}`, {}, b.cookie)).status, 404);
  for (const actor of [b, outsider]) {
    for (const path of [
      `/api/household/archive/${householdId}`,
      `/api/household/members?household_id=${householdId}`,
      `/api/household/balance?household_id=${householdId}`,
      `/api/household/expenses?household_id=${householdId}&limit=25`,
      `/api/household/history?household_id=${householdId}&limit=25`,
    ]) {
      assert.equal((await request(path, {}, actor.cookie)).status, 404);
    }
  }

  console.log('P1.4 expense detail API PASS: contextual privacy, lifecycle, mutations and strict contract.');
} finally {
  const admin = await connectPostgres();
  try {
    const userIds = fixtures.map((fixture) => fixture.user.id);
    const userIdArray = userIds.length === 0 ? 'array[]::uuid[]' :
      `array[${userIds.map((id) => `'${id}'::uuid`).join(',')}]`;
    const householdArray = householdIds.length === 0 ? 'array[]::uuid[]' :
      `array[${householdIds.map((id) => `'${id}'::uuid`).join(',')}]`;
    await admin.query(`
      begin;
      set local session_replication_role = replica;
      set constraints all deferred;
      delete from public.household_expense_splits where household_expense_id in (
        select id from public.household_expenses where household_id = any(${householdArray})
      );
      delete from public.household_expenses where household_id = any(${householdArray});
      delete from public.household_account_transactions where household_id = any(${householdArray});
      delete from public.household_accounts where household_id = any(${householdArray});
      delete from public.household_invitations where household_id = any(${householdArray});
      delete from public.household_members where household_id = any(${householdArray});
      delete from public.households where id = any(${householdArray});
      delete from public.transaction_tags where transaction_id in (
        select id from public.transactions where user_id = any(${userIdArray})
      );
      delete from public.transactions where user_id = any(${userIdArray});
      delete from public.accounts where user_id = any(${userIdArray});
      delete from public.categories where id = any(array[
        '${categoryIds[0]}'::uuid, '${categoryIds[1]}'::uuid
      ]);
      delete from public.profiles where id = any(${userIdArray});
      delete from auth.users where id = any(${userIdArray});
      commit;
    `, 20_000);
  } finally {
    admin.close();
  }
}
