import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const envText = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(
  envText.split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => {
    const separator = line.indexOf('=');
    return [line.slice(0, separator), line.slice(separator + 1)];
  })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
assert.ok(url?.startsWith('http://127.0.0.1:'), 'The API test only runs against local Supabase.');

const supabase = createClient(url, anonKey);
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const { data: auth, error: authError } = await supabase.auth.signUp({
  email: `csv-${unique}@example.test`,
  password: 'Local-test-password-123!',
  options: { data: { display_name: 'CSV API Test' } },
});
assert.ifError(authError);
assert.ok(auth.session && auth.user);

const { data: account, error: accountError } = await supabase.from('accounts').insert({
  user_id: auth.user.id,
  name: 'Cuenta API CSV',
  type: 'checking',
  initial_balance: 1000,
  currency: 'MXN',
  is_shared: false,
}).select('id').single();
assert.ifError(accountError);

const fixtureBytes = await readFile(new URL('../fixtures/csv/utf8-mxn-signed.csv', import.meta.url));
const fileHash = createHash('sha256').update(fixtureBytes).digest('hex');
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
const cookieValue = `base64-${Buffer.from(JSON.stringify(auth.session), 'utf8').toString('base64url')}`;
const cookie = `${storageKey}=${cookieValue}`;
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

const pageResponse = await fetch('http://localhost:3000/dashboard/import', { headers: { cookie }, redirect: 'manual' });
assert.equal(pageResponse.status, 200);
assert.match(await pageResponse.text(), /Importar CSV/);

const previewResponse = await fetch('http://localhost:3000/api/imports/preview', {
  method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(payload),
});
assert.equal(previewResponse.status, 200);
const preview = await previewResponse.json();
assert.equal(preview.duplicate_file, false);
assert.equal(preview.rows.filter((row) => row.status === 'possible_duplicate').length, 2);

const importResponse = await fetch('http://localhost:3000/api/imports', {
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

const secondResponse = await fetch('http://localhost:3000/api/imports', {
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

console.log('API/UI shell PASS: auth, protected import page, preview, import, balance, exact-file reimport.');
