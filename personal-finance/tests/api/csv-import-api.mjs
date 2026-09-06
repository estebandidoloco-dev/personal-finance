import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { connect as connectPostgres } from '../concurrency/mxn-only-migration-concurrency.mjs';

let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  try {
    const envText = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
    const fileEnv = Object.fromEntries(
      envText.split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      })
    );
    url ??= fileEnv.NEXT_PUBLIC_SUPABASE_URL;
    anonKey ??= fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
assert.ok(url && anonKey, 'Local Supabase URL and anon key are required in process.env or .env.local.');
const supabaseUrl = new URL(url);
assert.equal(supabaseUrl.protocol, 'http:', 'Local Supabase must use HTTP.');
assert.ok(['127.0.0.1', 'localhost'].includes(supabaseUrl.hostname), 'The API test only runs against local Supabase.');
assert.equal(supabaseUrl.port, '54321', 'Expected the configured local Supabase API port.');
const baseUrl = new URL(process.env.TEST_APP_URL ?? 'http://localhost:3000');
assert.equal(baseUrl.protocol, 'http:', 'The local Next.js server must use HTTP.');
assert.ok(['127.0.0.1', 'localhost'].includes(baseUrl.hostname), 'The API test only runs against a local Next.js server.');
assert.equal(baseUrl.port, '3000', 'Expected the local Next.js test port.');

const supabase = createClient(url, anonKey);
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const { data: auth, error: authError } = await supabase.auth.signUp({
  email: `csv-${unique}@example.test`,
  password: 'Local-test-password-123!',
  options: { data: { display_name: 'CSV API Test' } },
});
assert.ifError(authError);
assert.ok(auth.session && auth.user);
const storageKey = `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`;
const cookieValue = `base64-${Buffer.from(JSON.stringify(auth.session), 'utf8').toString('base64url')}`;
const cookie = `${storageKey}=${cookieValue}`;

try {
const accountResponse = await fetch(new URL('/api/accounts', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify({ name: 'Cuenta API CSV', type: 'checking', initial_balance: '1000.00', is_shared: false }),
});
assert.equal(accountResponse.status, 201);
const account = await accountResponse.json();
assert.equal(account.currency, 'MXN');

const fixtureBytes = await readFile(new URL('../fixtures/csv/utf8-mxn-signed.csv', import.meta.url));
const fileHash = createHash('sha256').update(fixtureBytes).digest('hex');
const payload = {
  account_id: account.id,
  category_id: null,
  file_name: 'api-identical.csv',
  file_hash: fileHash,
  source_provider: 'api-bank',
  options: { amount_mode: 'signed', date_format: 'iso', number_format: 'decimal_dot' },
  rows: [
    { row_number: 2, date: '2026-09-01', description: 'Cargo legítimo igual', amount: '-100.00' },
    { row_number: 3, date: '2026-09-01', description: 'Cargo legítimo igual', amount: '-100.00' },
  ],
  import_possible_duplicate_rows: [2, 3],
};

const pageResponse = await fetch(new URL('/dashboard/import', baseUrl), { headers: { cookie }, redirect: 'manual' });
assert.equal(pageResponse.status, 200);
assert.match(await pageResponse.text(), /Importar CSV/);

const previewResponse = await fetch(new URL('/api/imports/preview', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(payload),
});
assert.equal(previewResponse.status, 200);
const preview = await previewResponse.json();
assert.equal(preview.duplicate_file, false);
assert.equal(preview.rows.filter((row) => row.status === 'possible_duplicate').length, 2);

const importResponse = await fetch(new URL('/api/imports', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(payload),
});
assert.equal(importResponse.status, 200);
const imported = await importResponse.json();
assert.equal(imported.summary.imported, 2);
assert.equal(imported.summary.failed, 0);

const { data: storedAccount, error: storedAccountError } = await supabase
  .from('accounts').select('balance').eq('id', account.id).single();
assert.ifError(storedAccountError);
assert.equal(storedAccount.balance, 800);

const secondResponse = await fetch(new URL('/api/imports', baseUrl), {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(payload),
});
assert.equal(secondResponse.status, 200);
const second = await secondResponse.json();
assert.equal(second.duplicate_file, true);
assert.equal(second.summary.imported, 0);

const { count, error: countError } = await supabase
  .from('transactions').select('*', { count: 'exact', head: true }).eq('account_id', account.id);
assert.ifError(countError);
assert.equal(count, 2);
const { data: importedTransactions, error: transactionCurrencyError } = await supabase
  .from('transactions').select('currency').eq('account_id', account.id);
assert.ifError(transactionCurrencyError);
assert.ok(importedTransactions.every((transaction) => transaction.currency === 'MXN'));

console.log('API/UI shell PASS: auth, protected import page, preview, import, balance, exact-file reimport.');
} finally {
  // Test-only privileged cleanup: ledger rows are removed before their accounts,
  // avoiding the account-delete cascade ordering hazard in historical triggers.
  const cleanup = await connectPostgres();
  try {
    await cleanup.query(`
      begin;
      delete from public.transactions where user_id = '${auth.user.id}';
      delete from public.csv_imports where user_id = '${auth.user.id}';
      delete from public.accounts where user_id = '${auth.user.id}';
      delete from auth.users where id = '${auth.user.id}';
      commit;
    `);
  } catch (error) {
    try { await cleanup.query('rollback'); } catch {}
    throw error;
  } finally {
    cleanup.close();
  }
}
