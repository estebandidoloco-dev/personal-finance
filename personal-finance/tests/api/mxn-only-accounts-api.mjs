import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const envText = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/u).filter((line) => line && !line.startsWith('#')).map((line) => {
  const separator = line.indexOf('=');
  return [line.slice(0, separator), line.slice(separator + 1)];
}));
assert.ok(env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http://127.0.0.1:'), 'Only local Supabase is allowed.');

const baseUrl = 'http://localhost:3000';
const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

async function makeUser(label) {
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signUp({
    email: `mxn-${label}-${unique}@example.test`,
    password: 'Local-test-password-123!',
    options: { data: { display_name: `MXN ${label}` } },
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

async function request(path, options, cookie) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...(options.headers ?? {}) },
  });
}

const a = await makeUser('a');
const b = await makeUser('b');
const createPayload = {
  name: `Cuenta MXN ${unique}`,
  type: 'checking',
  initial_balance: 5000,
  institution: 'Banco',
};
const createdResponse = await request('/api/accounts', {
  method: 'POST', body: JSON.stringify(createPayload),
}, a.cookie);
assert.equal(createdResponse.status, 201);
const account = await createdResponse.json();
assert.equal(account.currency, 'MXN');

for (const currency of ['MXN', 'USD']) {
  const response = await request('/api/accounts', {
    method: 'POST', body: JSON.stringify({ ...createPayload, name: `${currency} ${unique}`, currency }),
  }, a.cookie);
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'Datos inválidos');
  assert.ok(body.issues.some((issue) => issue.path === ''));

  const patch = await request(`/api/accounts/${account.id}`, {
    method: 'PATCH', body: JSON.stringify({ currency }),
  }, a.cookie);
  assert.equal(patch.status, 400);
  assert.equal((await patch.json()).error, 'Datos inválidos');
}

const validPatch = await request(`/api/accounts/${account.id}`, {
  method: 'PATCH', body: JSON.stringify({ name: `Actualizada ${unique}`, institution: null, is_shared: true }),
}, a.cookie);
assert.equal(validPatch.status, 200);
assert.equal((await validPatch.json()).name, `Actualizada ${unique}`);

const foreignPatch = await request(`/api/accounts/${account.id}`, {
  method: 'PATCH', body: JSON.stringify({ name: 'No autorizada' }),
}, b.cookie);
assert.equal(foreignPatch.status, 404);

console.log('Accounts MXN API PASS: default MXN, explicit currency rejected, approved fields and ownership.');
