import assert from 'node:assert/strict';
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
      email: `personal-exact-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `Personal Exact ${label}` } },
    },
  });
}

async function request(path, options = {}, cookie = '') {
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

  const accountResponse = await request('/api/accounts', {
    method: 'POST',
    body: JSON.stringify({ name: `Grande ${unique}`, type: 'checking', initial_balance: '999999999999.99' }),
  }, a.cookie);
  assert.equal(accountResponse.status, 201);
  const account = await accountResponse.json();
  assert.equal(account.initial_balance, '999999999999.99');
  assert.equal(account.balance, '999999999999.99');
  assert.equal(account.currency, 'MXN');

  for (const initial_balance of [100, '100', '1.235', '1e2']) {
    const rejected = await request('/api/accounts', {
      method: 'POST', body: JSON.stringify({ name: 'Inválida', type: 'cash', initial_balance }),
    }, a.cookie);
    assert.equal(rejected.status, 400);
  }
  const currencyAccount = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: 'USD', type: 'cash', initial_balance: '0.00', currency: 'USD' }),
  }, a.cookie);
  assert.equal(currencyAccount.status, 400);
  const { error: directInsertError } = await a.client.from('accounts').insert({
    user_id: a.user.id, name: 'Direct rounded', type: 'checking', initial_balance: 1.235,
  });
  assert.equal(directInsertError?.code, '42501');
  const { error: legacyCreateError } = await a.client.rpc('create_financial_transaction', {
    p_account_id: account.id, p_kind: 'expense', p_amount: 1.235, p_currency: 'MXN',
    p_date: '2026-09-05', p_description: 'Legacy attack',
  });
  assert.equal(legacyCreateError?.code, '42501');
  const { error: numericExactError } = await a.client.rpc('create_personal_transaction_exact', {
    p_account_id: account.id, p_kind: 'expense', p_amount: 1.235,
    p_date: '2026-09-05', p_description: 'Numeric exact attack',
  });
  assert.ok(numericExactError);

  const transactionBody = {
    account_id: account.id, kind: 'expense', amount: '999999999999.99', date: '2026-09-05',
    description: `Pendiente exacta ${unique}`, status: 'pending',
  };
  const transactionResponse = await request('/api/transactions', {
    method: 'POST', body: JSON.stringify(transactionBody),
  }, a.cookie);
  assert.equal(transactionResponse.status, 201);
  const transaction = await transactionResponse.json();
  assert.equal(transaction.amount, '999999999999.99');
  assert.equal(typeof transaction.amount, 'string');
  assert.doesNotMatch(transaction.amount, /[eE,\s]/u);

  for (const amount of [100, '100', '1.235', '1e2']) {
    const rejected = await request('/api/transactions', {
      method: 'POST', body: JSON.stringify({ ...transactionBody, amount }),
    }, a.cookie);
    assert.equal(rejected.status, 400);
  }
  const currencyTransaction = await request('/api/transactions', {
    method: 'POST', body: JSON.stringify({ ...transactionBody, currency: 'MXN' }),
  }, a.cookie);
  assert.equal(currencyTransaction.status, 400);

  const listResponse = await request(`/api/transactions?account_id=${account.id}`, {}, a.cookie);
  assert.equal(listResponse.status, 200);
  const list = await listResponse.json();
  assert.equal(list.length, 1);
  assert.equal(list[0].amount, '999999999999.99');
  const detailResponse = await request(`/api/transactions/${transaction.id}`, {}, a.cookie);
  assert.equal(detailResponse.status, 200);
  assert.equal((await detailResponse.json()).amount, '999999999999.99');

  const createHousehold = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Exact household ${unique}` }),
  }, a.cookie);
  assert.equal(createHousehold.status, 201);
  const householdId = (await createHousehold.json()).id;
  householdIds.push(householdId);
  const inviteResponse = await request('/api/household/invitations', {
    method: 'POST', body: JSON.stringify({ household_id: householdId, invited_email: b.user.email }),
  }, a.cookie);
  assert.equal(inviteResponse.status, 201);
  const token = (await inviteResponse.json()).invitation_token;
  const acceptResponse = await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token }),
  }, b.cookie);
  assert.equal(acceptResponse.status, 200);

  const sourceAccountResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ name: `Linked ${unique}`, type: 'checking', initial_balance: '100.00' }),
  }, a.cookie);
  assert.equal(sourceAccountResponse.status, 201);
  const sourceAccount = await sourceAccountResponse.json();
  const sharedExpenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account', source_account_id: sourceAccount.id,
      amount: '40.00', date: '2026-09-05', description: 'Linked exact guard', split_mode: 'equal',
    }),
  }, a.cookie);
  assert.equal(sharedExpenseResponse.status, 201);
  const sharedExpense = await sharedExpenseResponse.json();
  const linkedMutation = {
    account_id: sourceAccount.id, kind: 'expense', amount: '50.00', date: '2026-09-05',
    description: 'Forbidden personal update', is_shared: true,
  };
  const linkedUpdate = await request(`/api/transactions/${sharedExpense.personal_transaction_id}`, {
    method: 'PATCH', body: JSON.stringify(linkedMutation),
  }, a.cookie);
  assert.equal(linkedUpdate.status, 400);
  const linkedDelete = await request(`/api/transactions/${sharedExpense.personal_transaction_id}`, {
    method: 'DELETE',
  }, a.cookie);
  assert.equal(linkedDelete.status, 400);
  const sourceAfterAttacks = await request(`/api/accounts/${sourceAccount.id}`, {}, a.cookie);
  assert.equal((await sourceAfterAttacks.json()).balance, '60.00');
  const coordinatedUpdate = await request(`/api/household/expenses/${sharedExpense.id}`, {
    method: 'PATCH', body: JSON.stringify({
      source_account_id: sourceAccount.id, amount: '50.00', date: '2026-09-05',
      description: 'Coordinated update', split_mode: 'equal', status: 'posted',
    }),
  }, a.cookie);
  assert.equal(coordinatedUpdate.status, 200);
  assert.equal((await coordinatedUpdate.json()).amount, '50.00');
  const coordinatedDelete = await request(`/api/household/expenses/${sharedExpense.id}`, {
    method: 'DELETE',
  }, a.cookie);
  assert.equal(coordinatedDelete.status, 200);
  const sourceAfterDelete = await request(`/api/accounts/${sourceAccount.id}`, {}, a.cookie);
  assert.equal((await sourceAfterDelete.json()).balance, '100.00');

  for (const path of [`/api/accounts/${account.id}`, `/api/transactions/${transaction.id}`]) {
    const foreign = await request(path, {}, b.cookie);
    assert.equal(foreign.status, 404);
  }
  const leaveResponse = await request('/api/household/leave', {
    method: 'POST', body: JSON.stringify({ household_id: householdId }),
  }, b.cookie);
  assert.equal(leaveResponse.status, 200);
  for (const path of [`/api/accounts/${account.id}`, `/api/transactions/${transaction.id}`]) {
    const archivedForeign = await request(path, {}, b.cookie);
    assert.equal(archivedForeign.status, 404);
  }

  console.log('Personal exact-money API PASS: canonical strings, large precision, MXN-only, and isolation.');
} finally {
  const admin = await connectPostgres();
  try {
    const userIds = fixtures.map((fixture) => fixture.user.id);
    const users = userIds.length ? `array[${userIds.map((id) => `'${id}'::uuid`).join(',')}]` : 'array[]::uuid[]';
    const households = householdIds.length ? `array[${householdIds.map((id) => `'${id}'::uuid`).join(',')}]` : 'array[]::uuid[]';
    await admin.query(`
      begin;
      set local session_replication_role = replica;
      delete from public.household_invitations where household_id = any(${households});
      delete from public.household_members where household_id = any(${households});
      delete from public.households where id = any(${households});
      delete from public.transaction_tags where transaction_id in (select id from public.transactions where user_id = any(${users}));
      delete from public.transactions where user_id = any(${users});
      delete from public.accounts where user_id = any(${users});
      delete from public.profiles where id = any(${users});
      delete from auth.users where id = any(${users});
      commit;
    `);
  } finally {
    admin.close();
  }
}
