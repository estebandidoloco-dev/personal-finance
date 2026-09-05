import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';
import { loadLocalHouseholdTestEnv, signUpTrackedFixture } from './p1_4-household-harness.mjs';

const { env, supabaseUrl, baseUrl } = await loadLocalHouseholdTestEnv();

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtures = [];
let householdId;

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return signUpTrackedFixture({
    client,
    fixtures,
    storageKey: `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`,
    credentials: {
      email: `p14-api-${label}-${unique}@example.test`,
      password: 'Local-test-password-123!',
      options: { data: { display_name: `P14 API ${label}` } },
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
let outsider;

try {
  a = await makeUser('a');
  b = await makeUser('b');
  outsider = await makeUser('outsider');
  const unauthenticated = await request('/api/household');
  assert.equal(unauthenticated.status, 401);

  const create = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Casa ${unique}` }),
  }, a.cookie);
  assert.equal(create.status, 201);
  householdId = (await create.json()).id;
  assert.match(householdId, /^[0-9a-f-]{36}$/u);

  const forbiddenHouseholdField = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: 'Otra', currency: 'USD' }),
  }, a.cookie);
  assert.equal(forbiddenHouseholdField.status, 400);

  const invitationResponse = await request('/api/household/invitations', {
    method: 'POST', body: JSON.stringify({ household_id: householdId, invited_email: b.user.email.toUpperCase() }),
  }, a.cookie);
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  assert.match(invitation.invitation_token, /^[0-9a-f]{64}$/u);

  const wrongEmail = await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: invitation.invitation_token }),
  }, outsider.cookie);
  assert.equal(wrongEmail.status, 404);

  const accepted = await request('/api/household/invitations/accept', {
    method: 'POST', body: JSON.stringify({ token: invitation.invitation_token }),
  }, b.cookie);
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).household_id, householdId);

  const accountResponse = await request('/api/household/accounts', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, name: 'Común', type: 'cash', initial_balance: '100.00',
    }),
  }, a.cookie);
  assert.equal(accountResponse.status, 201);
  const householdAccount = await accountResponse.json();
  assert.equal(householdAccount.balance, '100.00');
  assert.equal(typeof householdAccount.balance, 'string');
  assert.equal(householdAccount.currency, 'MXN');

  for (const invalidBody of [
    { household_id: householdId, name: 'Number', type: 'cash', initial_balance: 0 },
    { household_id: householdId, name: 'USD', type: 'cash', initial_balance: '0.00', currency: 'USD' },
  ]) {
    const response = await request('/api/household/accounts', {
      method: 'POST', body: JSON.stringify(invalidBody),
    }, a.cookie);
    assert.equal(response.status, 400);
  }

  const { data: personalAccount, error: personalAccountError } = await a.client.from('accounts').insert({
    user_id: a.user.id, name: `Personal ${unique}`, type: 'checking', initial_balance: 500,
  }).select('id').single();
  assert.ifError(personalAccountError);

  const forgedPayer = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account', source_account_id: personalAccount.id,
      amount: '100.00', date: '2026-09-05', description: 'Forjada', split_mode: 'equal',
      personal_payer_user_id: b.user.id,
    }),
  }, a.cookie);
  assert.equal(forgedPayer.status, 400);

  const expenseResponse = await request('/api/household/expenses', {
    method: 'POST', body: JSON.stringify({
      household_id: householdId, funding_source: 'personal_account', source_account_id: personalAccount.id,
      amount: '100.00', date: '2026-09-05', description: 'Cena', split_mode: 'equal', notes: 'privada',
    }),
  }, a.cookie);
  assert.equal(expenseResponse.status, 201);
  const expense = await expenseResponse.json();
  assert.equal(expense.personal_payer_user_id, a.user.id);
  assert.equal(expense.recorded_by_user_id, a.user.id);
  assert.equal(expense.amount, '100.00');

  const laterStandalone = await request('/api/household/accounts/income', {
    method: 'POST', body: JSON.stringify({
      account_id: householdAccount.id, amount: '1.00', date: '2026-09-06', description: 'MÃ¡s reciente',
    }),
  }, b.cookie);
  assert.equal(laterStandalone.status, 201);

  const balanceResponse = await request(`/api/household/balance?household_id=${householdId}`, {}, b.cookie);
  assert.equal(balanceResponse.status, 200);
  const balance = await balanceResponse.json();
  assert.equal(balance.amount, '50.00');
  assert.equal(balance.owed_by_user_id, b.user.id);
  assert.equal(typeof balance.positions[0].amount, 'string');

  const outsiderBalance = await request(`/api/household/balance?household_id=${householdId}`, {}, outsider.cookie);
  assert.equal(outsiderBalance.status, 404);

  const partnerMutation = await request(`/api/household/expenses/${expense.id}`, {
    method: 'PATCH', body: JSON.stringify({
      source_account_id: personalAccount.id, amount: '100.00', date: '2026-09-05',
      description: 'Ajena', split_mode: 'equal', status: 'cancelled',
    }),
  }, b.cookie);
  assert.equal(partnerMutation.status, 404);

  const expenseList = await request(`/api/household/expenses?household_id=${householdId}&limit=1`, {}, b.cookie);
  assert.equal(expenseList.status, 200);
  const listed = await expenseList.json();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].account_id, null);
  assert.equal(listed[0].notes, null);
  assert.equal(listed[0].amount, '100.00');

  const cancelled = await request(`/api/household/expenses/${expense.id}`, {
    method: 'PATCH', body: JSON.stringify({
      source_account_id: personalAccount.id, amount: '100.00', date: '2026-09-05',
      description: 'Cancelada', split_mode: 'equal', status: 'cancelled',
    }),
  }, a.cookie);
  assert.equal(cancelled.status, 200);
  const zeroBalance = await request(`/api/household/balance?household_id=${householdId}`, {}, a.cookie);
  assert.equal(zeroBalance.status, 200);
  assert.equal((await zeroBalance.json()).amount, '0.00');

  const { data: overflowPersonalAccount, error: overflowAccountError } = await a.client.from('accounts').insert({
    user_id: a.user.id, name: `Overflow ${unique}`, type: 'checking', initial_balance: 0,
  }).select('id').single();
  assert.ifError(overflowAccountError);

  const overflowDatabase = await connectPostgres();
  try {
    await overflowDatabase.query(`
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${a.user.id}', false);
      do $large_balance$
      declare iteration integer;
      begin
        for iteration in 1..1001 loop
          perform public.create_financial_transaction(
            p_account_id := '${overflowPersonalAccount.id}',
            p_kind := 'income', p_amount := 999999999999.99, p_currency := 'MXN',
            p_date := '2026-09-06', p_description := 'HTTP overflow funding'
          );
          perform public.create_shared_expense(
            p_household_id := '${householdId}', p_funding_source := 'personal_account',
            p_source_account_id := '${overflowPersonalAccount.id}', p_amount := '999999999999.99',
            p_date := '2026-09-06', p_description := 'HTTP overflow expense',
            p_split_mode := 'custom', p_splits := jsonb_build_array(
              jsonb_build_object('user_id', '${a.user.id}', 'amount', '0.00'),
              jsonb_build_object('user_id', '${b.user.id}', 'amount', '999999999999.99')
            )
          );
        end loop;
      end
      $large_balance$;
    `, 180_000);
  } finally {
    overflowDatabase.close();
  }
  const overflowHttp = await request(`/api/household/balance?household_id=${householdId}`, {}, b.cookie);
  assert.equal(overflowHttp.status, 200);
  const overflowBody = await overflowHttp.json();
  const expectedOverflow = '1000999999999989.99';
  assert.equal(overflowBody.amount, expectedOverflow);
  assert.equal(typeof overflowBody.amount, 'string');
  assert.equal(overflowBody.positions.find((position) => position.user_id === a.user.id).amount, expectedOverflow);
  assert.equal(overflowBody.positions.find((position) => position.user_id === b.user.id).amount, `-${expectedOverflow}`);
  assert.doesNotMatch(
    overflowBody.positions.map((position) => position.amount).concat(overflowBody.amount).join(''),
    /[#eE,\s]/u
  );

  const leave = await request('/api/household/leave', {
    method: 'POST', body: JSON.stringify({ household_id: householdId }),
  }, b.cookie);
  assert.equal(leave.status, 200);
  const archivedRead = await request(`/api/household/accounts?household_id=${householdId}`, {}, a.cookie);
  assert.equal(archivedRead.status, 200);
  assert.equal((await archivedRead.json()).length, 1);
  const closedWrite = await request('/api/household/accounts/income', {
    method: 'POST', body: JSON.stringify({
      account_id: householdAccount.id, amount: '1.00', date: '2026-09-05', description: 'No',
    }),
  }, a.cookie);
  assert.equal(closedWrite.status, 404);

  console.log('P1.4 API PASS: auth, lifecycle, strict contracts, exact money, isolation, debt and archive.');
} finally {
  const admin = await connectPostgres();
  try {
    const userIds = fixtures.map((fixture) => fixture.user.id);
    const userIdArray = userIds.length === 0 ? 'array[]::uuid[]' :
      `array[${userIds.map((id) => `'${id}'::uuid`).join(',')}]`;
    const householdSql = householdId ? `'${householdId}'::uuid` : 'null::uuid';
    await admin.query(`
      begin;
      set local session_replication_role = replica;
      set constraints all deferred;
      delete from public.household_expense_splits where household_expense_id in (
        select id from public.household_expenses where household_id = ${householdSql}
      );
      delete from public.household_expenses where household_id = ${householdSql};
      delete from public.household_account_transactions where household_id = ${householdSql};
      delete from public.household_accounts where household_id = ${householdSql};
      delete from public.household_invitations where household_id = ${householdSql};
      delete from public.household_members where household_id = ${householdSql};
      delete from public.households where id = ${householdSql};
      delete from public.transaction_tags where transaction_id in (
        select id from public.transactions where user_id = any(${userIdArray})
      );
      delete from public.transactions where user_id = any(${userIdArray});
      delete from public.accounts where user_id = any(${userIdArray});
      delete from public.profiles where id = any(${userIdArray});
      delete from auth.users where id = any(${userIdArray});
      commit;
    `, 20_000);
  } finally {
    admin.close();
  }
}
