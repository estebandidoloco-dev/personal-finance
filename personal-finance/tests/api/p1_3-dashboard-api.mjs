import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const envText = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http://127.0.0.1:'), 'Only local Supabase is allowed.');
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signUp({
    email: `dashboard-${label}-${unique}@example.test`, password: 'Local-test-password-123!',
    options: { data: { display_name: `Dashboard ${label}` } },
  });
  assert.ifError(error);
  assert.ok(data.session && data.user);
  const storageKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  return {
    client,
    user: data.user,
    cookie: `${storageKey}=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`,
  };
}

async function getDashboard(cookie, period) {
  const query = period ? `?period=${period}` : '';
  return fetch(`http://localhost:3000/api/dashboard${query}`, { headers: { cookie } });
}

const unauthenticated = await getDashboard('', 'this_month');
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).code, 'unauthorized');

const empty = await makeUser('empty');
const emptyResponse = await getDashboard(empty.cookie, 'this_month');
assert.equal(emptyResponse.status, 200);
const emptyDashboard = await emptyResponse.json();
assert.deepEqual(emptyDashboard.accounts, []);
assert.deepEqual(emptyDashboard.balances_by_currency, []);
assert.equal(emptyDashboard.totals.total_balance, 0);

const a = await makeUser('a');
const b = await makeUser('b');
const accountA = (await a.client.from('accounts').insert({ user_id: a.user.id, name: `MXN ${unique}`, type: 'checking', initial_balance: 1000, currency: 'MXN' }).select('id').single()).data;
const accountUsd = (await a.client.from('accounts').insert({ user_id: a.user.id, name: `USD ${unique}`, type: 'savings', initial_balance: 200, currency: 'USD' }).select('id').single()).data;
assert.ok(accountA && accountUsd);
await a.client.rpc('create_financial_transaction', {
  p_account_id: accountA.id, p_kind: 'income', p_amount: 100, p_currency: 'MXN', p_date: '2026-09-02', p_description: 'API income', p_tag_ids: [], p_source: 'manual',
});
await a.client.rpc('create_financial_transaction', {
  p_account_id: accountUsd.id, p_kind: 'expense', p_amount: 10, p_currency: 'USD', p_date: '2026-09-02', p_description: 'API USD', p_tag_ids: [], p_source: 'manual',
});

const invalid = await getDashboard(a.cookie, 'not_a_period');
assert.equal(invalid.status, 400);
assert.equal((await invalid.json()).code, 'invalid_period');
for (const period of ['this_month', 'previous_month', 'last_30_days']) {
  const response = await getDashboard(a.cookie, period);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.period.key, period);
  assert.equal(dashboard.period.timezone, 'America/Mexico_City');
  assert.equal(dashboard.accounts.length, 2);
  assert.equal(dashboard.totals.total_balance, null);
  assert.equal(dashboard.totals.currency, null);
  assert.equal(dashboard.balances_by_currency.length, 2);
}

const ownership = await getDashboard(b.cookie, 'this_month');
assert.equal(ownership.status, 200);
const bDashboard = await ownership.json();
assert.deepEqual(bDashboard.accounts, []);
assert.deepEqual(bDashboard.recent_transactions, []);

console.log('P1.3 API PASS: 401, invalid period, empty state, all periods, ownership and multicurrency.');