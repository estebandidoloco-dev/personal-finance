import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';

let env = { ...process.env };
try {
  const envText = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
  env = {
    ...env,
    ...Object.fromEntries(
      envText
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    ),
  };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(supabaseUrl.hostname), 'Only local Supabase is allowed.');
assert.equal(supabaseUrl.port, '54321', 'Expected the configured local Supabase API port.');

const baseUrl = new URL(process.env.TEST_APP_URL ?? 'http://localhost:3000');
assert.ok(['127.0.0.1', 'localhost'].includes(baseUrl.hostname), 'Only a local Next.js server is allowed.');
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const createdUsers = [];

function localToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts();
  const part = (type) => parts.find((item) => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signUp({
    email: `dashboard-${label}-${unique}@example.test`,
    password: 'Local-test-password-123!',
    options: { data: { display_name: `Dashboard ${label}` } },
  });
  assert.ifError(error);
  assert.ok(data.session && data.user);
  const storageKey = `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`;
  const fixture = {
    client,
    user: data.user,
    cookie: `${storageKey}=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`,
  };
  createdUsers.push(fixture);
  return fixture;
}

async function getDashboard(cookie, period) {
  const url = new URL('/api/dashboard', baseUrl);
  if (period !== undefined) url.searchParams.set('period', period);
  return fetch(url, { headers: { cookie } });
}

function assertMoneyStrings(value) {
  if (Array.isArray(value)) {
    value.forEach(assertMoneyStrings);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['balance', 'total_balance', 'income', 'expense', 'net', 'amount'].includes(key)) {
      assert.equal(typeof child, 'string', `${key} must be a string`);
      assert.match(child, /^-?(?:0|[1-9]\d*)\.\d{2}$/u);
      assert.notEqual(child, '-0.00');
    } else {
      assertMoneyStrings(child);
    }
  }
}

function assertCompleteCalendar(dashboard) {
  const points = dashboard.time_series.points;
  assert.ok(points.length > 0);
  assert.equal(points[0].date, dashboard.period.start_date);
  assert.equal(points.at(-1).date < dashboard.period.end_date_exclusive, true);
  assert.equal(new Set(points.map((point) => point.date)).size, points.length);
  assert.deepEqual([...points].sort((a, b) => a.date.localeCompare(b.date)), points);
}

const unauthenticated = await getDashboard('', 'this_month');
assert.equal(unauthenticated.status, 401);
assert.equal((await unauthenticated.json()).code, 'unauthorized');

const empty = await makeUser('empty');
const emptyResponse = await getDashboard(empty.cookie);
assert.equal(emptyResponse.status, 200);
const emptyDashboard = await emptyResponse.json();
assert.equal(emptyDashboard.period.key, 'this_month');
assert.deepEqual(emptyDashboard.accounts, []);
assert.deepEqual(emptyDashboard.expenses_by_category, []);
assert.deepEqual(emptyDashboard.recent_transactions, []);
assert.deepEqual(emptyDashboard.totals, {
  total_balance: '0.00', income: '0.00', expense: '0.00', net: '0.00',
});
assertCompleteCalendar(emptyDashboard);
assert.ok(emptyDashboard.time_series.points.every((point) =>
  point.income === '0.00' && point.expense === '0.00' && point.net === '0.00'));

const invalid = await getDashboard(empty.cookie, 'not_a_period');
assert.equal(invalid.status, 400);
assert.equal((await invalid.json()).code, 'invalid_period');

const a = await makeUser('a');
const b = await makeUser('b');
const { data: accountA, error: accountError } = await a.client
  .from('accounts')
  .insert({ user_id: a.user.id, name: `MXN ${unique}`, type: 'checking', initial_balance: 1000 })
  .select('id,currency')
  .single();
assert.ifError(accountError);
assert.equal(accountA.currency, 'MXN');
const today = localToday();
for (const input of [
  { kind: 'income', amount: 100, description: 'API income', status: 'posted' },
  { kind: 'expense', amount: 100.01, description: 'API expense', status: 'posted' },
  { kind: 'income', amount: 999, description: 'API pending', status: 'pending' },
]) {
  const { error } = await a.client.rpc('create_financial_transaction', {
    p_account_id: accountA.id,
    p_kind: input.kind,
    p_amount: input.amount,
    p_currency: 'MXN',
    p_date: today,
    p_description: input.description,
    p_status: input.status,
    p_tag_ids: [],
    p_source: 'manual',
  });
  assert.ifError(error);
}

const snapshots = [];
for (const period of ['this_month', 'previous_month', 'last_30_days']) {
  const response = await getDashboard(a.cookie, period);
  assert.equal(response.status, 200);
  const dashboard = await response.json();
  assert.equal(dashboard.period.key, period);
  assert.equal(dashboard.period.timezone, 'America/Mexico_City');
  assert.equal(dashboard.currency, 'MXN');
  assert.equal('balances_by_currency' in dashboard, false);
  assert.equal('period_totals_by_currency' in dashboard, false);
  assert.equal('selected_currency' in dashboard, false);
  assertCompleteCalendar(dashboard);
  assertMoneyStrings(dashboard);
  if (period === 'last_30_days') assert.equal(dashboard.time_series.points.length, 30);
  snapshots.push(dashboard);
}
assert.equal(new Set(snapshots.map((item) => item.totals.total_balance)).size, 1);
assert.equal(new Set(snapshots.map((item) => JSON.stringify(item.recent_transactions))).size, 1);
assert.ok(snapshots[0].recent_transactions.every((transaction) => transaction.description !== 'API pending'));
assert.ok(snapshots[0].time_series.points.some((point) => point.net === '-0.01'));

const admin = await connectPostgres();
try {
  await admin.query(`update public.accounts set balance = 'NaN'::numeric where id = '${accountA.id}'`);
  const invalidContractResponse = await getDashboard(a.cookie, 'this_month');
  assert.equal(invalidContractResponse.status, 500);
  assert.deepEqual(await invalidContractResponse.json(), {
    code: 'invalid_dashboard_response',
    message: 'La respuesta del dashboard no cumple el contrato esperado.',
  });
} finally {
  await admin.query(`update public.accounts set balance = 999.99 where id = '${accountA.id}'`);
  admin.close();
}

const ownership = await getDashboard(b.cookie, 'this_month');
assert.equal(ownership.status, 200);
const bDashboard = await ownership.json();
assert.deepEqual(bDashboard.accounts, []);
assert.deepEqual(bDashboard.recent_transactions, []);

async function assertLargeTotal(label, balances, expected) {
  const fixture = await makeUser(label);
  const rows = balances.map((initial_balance, index) => ({
    user_id: fixture.user.id,
    name: `${label}-${index}-${unique}`,
    type: 'checking',
    initial_balance,
  }));
  const { error } = await fixture.client.from('accounts').insert(rows);
  assert.ifError(error);
  const response = await getDashboard(fixture.cookie, 'this_month');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.totals.total_balance, expected);
  assert.equal(typeof body.totals.total_balance, 'string');
  assert.doesNotMatch(body.totals.total_balance, /e/iu);
}

await assertLargeTotal('large-1200', ['600000000000.00', '600000000000.00'], '1200000000000.00');
await assertLargeTotal(
  'large-safe-cents',
  [...Array.from({ length: 100 }, () => '999999999999.99'), '0.99'],
  '99999999999999.99'
);
// 9,999,999,999,999,999 cents exceeds Number.MAX_SAFE_INTEGER; the exact characters above must survive.

for (const fixture of createdUsers) {
  const { data: transactions, error: transactionReadError } = await fixture.client
    .from('transactions')
    .select('id')
    .eq('user_id', fixture.user.id);
  assert.ifError(transactionReadError);
  for (const transaction of transactions) {
    const { error } = await fixture.client.rpc('delete_financial_transaction', { p_id: transaction.id });
    assert.ifError(error);
  }
  const { error: accountDeleteError } = await fixture.client
    .from('accounts')
    .delete()
    .eq('user_id', fixture.user.id);
  assert.ifError(accountDeleteError);
}
const cleanup = await connectPostgres();
try {
  const userIds = createdUsers.map((fixture) => `'${fixture.user.id}'`).join(',');
  await cleanup.query(`delete from auth.users where id in (${userIds})`);
} finally {
  cleanup.close();
}

console.log('P1.3 API PASS: auth, periods, empty calendar, MXN-only exact aggregates, isolation and invalid RPC contract fail-closed.');
