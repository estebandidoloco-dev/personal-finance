import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';
import { loadLocalHouseholdTestEnv, signUpTrackedFixture } from './p1_4-household-harness.mjs';

const { env, supabaseUrl, baseUrl } = await loadLocalHouseholdTestEnv();

const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const fixtures = [];
const householdIds = [];
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

async function readAllPages(path, cookie) {
  const items = [];
  let cursor;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const response = await request(`${path}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ''}`, {}, cookie);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.ok(Array.isArray(page.items));
    items.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor !== null);
  assert.equal(new Set(items.map((item) => item.id)).size, items.length);
  for (let index = 1; index < items.length; index += 1) {
    const previous = items[index - 1];
    const current = items[index];
    assert.ok(
      previous.date > current.date
      || (previous.date === current.date && previous.created_at > current.created_at)
      || (previous.date === current.date && previous.created_at === current.created_at && previous.id > current.id),
      'Household page order must be date DESC, created_at DESC, id DESC.'
    );
  }
  return items;
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
  householdIds.push(householdId);
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

  const personalAccountResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({
      name: `Personal ${unique}`, type: 'checking', initial_balance: '500.00',
    }),
  }, a.cookie);
  assert.equal(personalAccountResponse.status, 201);
  const personalAccount = await personalAccountResponse.json();

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
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].account_id, null);
  assert.equal(listed.items[0].notes, null);
  assert.equal(listed.items[0].amount, '100.00');

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

  const overflowPersonalAccountResponse = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({
      name: `Overflow ${unique}`, type: 'checking', initial_balance: '0.00',
    }),
  }, a.cookie);
  assert.equal(overflowPersonalAccountResponse.status, 201);
  const overflowPersonalAccount = await overflowPersonalAccountResponse.json();

  const overflowDatabase = await connectPostgres();
  try {
    await overflowDatabase.query(`
      set role authenticated;
      select set_config('request.jwt.claim.sub', '${a.user.id}', false);
      do $large_balance$
      declare iteration integer;
      begin
        for iteration in 1..1001 loop
          perform public.create_personal_transaction_exact(
            p_account_id := '${overflowPersonalAccount.id}',
            p_kind := 'income', p_amount := '999999999999.99',
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
      reset role;
      update public.household_expenses
         set created_at = '2026-09-05 12:00:00+00'
       where household_id = '${householdId}';
      update public.household_account_transactions
         set created_at = '2026-09-05 12:00:00+00'
       where household_id = '${householdId}';
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

  const activeArchive = await request('/api/household/archive', {}, a.cookie);
  assert.equal(activeArchive.status, 200);
  assert.equal((await activeArchive.json()).households.length, 0);

  const invalidCursor = await request(
    `/api/household/expenses?household_id=${householdId}&cursor=not-a-valid-cursor`, {}, a.cookie
  );
  assert.equal(invalidCursor.status, 400);
  const outsiderHistory = await request(`/api/household/history?household_id=${householdId}`, {}, outsider.cookie);
  assert.equal(outsiderHistory.status, 404);

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

  const archivedList = await request('/api/household/archive', {}, a.cookie);
  assert.equal(archivedList.status, 200);
  const archivedHouseholds = (await archivedList.json()).households;
  assert.equal(archivedHouseholds.length, 1);
  assert.equal(archivedHouseholds[0].id, householdId);
  assert.equal(archivedHouseholds[0].status, 'closed');
  assert.equal(archivedHouseholds[0].currency, 'MXN');
  const archivedDetail = await request(`/api/household/archive/${householdId}`, {}, a.cookie);
  assert.equal(archivedDetail.status, 200);
  assert.equal((await archivedDetail.json()).id, householdId);
  assert.equal((await request(`/api/household/archive/${householdId}`, {}, outsider.cookie)).status, 404);
  assert.equal((await request('/api/household/archive', {}, outsider.cookie)).status, 200);
  assert.equal((await (await request('/api/household/archive', {}, outsider.cookie)).json()).households.length, 0);

  const archivedExpenses = await readAllPages(
    `/api/household/expenses?household_id=${householdId}&limit=100`, a.cookie
  );
  assert.equal(archivedExpenses.length, 1002);
  const archivedHistory = await readAllPages(
    `/api/household/history?household_id=${householdId}&limit=100`, a.cookie
  );
  assert.equal(archivedHistory.length, 1003);
  assert.equal(archivedHistory.filter((item) => item.entry_type === 'household_transaction').length, 1);

  const currentResponse = await request('/api/household', {
    method: 'POST', body: JSON.stringify({ name: `Casa actual ${unique}` }),
  }, a.cookie);
  assert.equal(currentResponse.status, 201);
  const currentHouseholdId = (await currentResponse.json()).id;
  householdIds.push(currentHouseholdId);
  const archiveWithCurrent = await request('/api/household/archive', {}, a.cookie);
  const archiveWithCurrentItems = (await archiveWithCurrent.json()).households;
  assert.equal(archiveWithCurrentItems.length, 1);
  assert.equal(archiveWithCurrentItems[0].id, householdId);
  assert.ok(!archiveWithCurrentItems.some((item) => item.id === currentHouseholdId));

  const removalDatabase = await connectPostgres();
  try {
    await removalDatabase.query(`
      update public.household_members
         set status = 'removed', ended_at = coalesce(ended_at, now())
       where household_id = '${householdId}' and user_id = '${b.user.id}'
    `);
  } finally {
    removalDatabase.close();
  }
  const removedArchive = await request('/api/household/archive', {}, b.cookie);
  assert.equal(removedArchive.status, 200);
  assert.equal((await removedArchive.json()).households.length, 0);
  assert.equal((await request(`/api/household/archive/${householdId}`, {}, b.cookie)).status, 404);
  assert.equal((await request(`/api/household/history?household_id=${householdId}`, {}, b.cookie)).status, 404);

  console.log('P1.4 API PASS: auth, lifecycle, strict contracts, exact money, isolation, debt and archive.');
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
      delete from public.profiles where id = any(${userIdArray});
      delete from auth.users where id = any(${userIdArray});
      commit;
    `, 20_000);
  } finally {
    admin.close();
  }
}
