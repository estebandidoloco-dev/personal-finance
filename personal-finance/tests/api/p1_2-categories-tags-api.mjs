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
    email: `p12-${label}-${unique}@example.test`, password: 'Local-test-password-123!',
    options: { data: { display_name: `P12 ${label}` } },
  });
  assert.ifError(error);
  assert.ok(data.session && data.user);
  const storageKey = `sb-${new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  return { client, user: data.user, cookie: `${storageKey}=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}` };
}

async function request(path, options = {}, cookie) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', cookie, ...(options.headers ?? {}) },
  });
}

const a = await makeUser('a');
const b = await makeUser('b');
const categoriesA = await (await request('/api/categories', {}, a.cookie)).json();
assert.ok(categoriesA.some((category) => category.user_id === null));
const global = categoriesA.find((category) => category.user_id === null);

const bCategoryResponse = await request('/api/categories', {
  method: 'POST', body: JSON.stringify({ name: `B ${unique}`, type: 'expense' }),
}, b.cookie);
assert.equal(bCategoryResponse.status, 201);
const bCategory = await bCategoryResponse.json();

const createCategoryResponse = await request('/api/categories', {
  method: 'POST', body: JSON.stringify({ name: `A ${unique}`, type: 'expense', parent_id: global.id, color: '#123456' }),
}, a.cookie);
assert.equal(createCategoryResponse.status, 201);
const category = await createCategoryResponse.json();
const patchCategoryResponse = await request(`/api/categories/${category.id}`, {
  method: 'PATCH', body: JSON.stringify({ name: `A updated ${unique}` }),
}, a.cookie);
assert.equal(patchCategoryResponse.status, 200);
assert.equal((await patchCategoryResponse.json()).name, `A updated ${unique}`);

for (const method of ['PATCH', 'DELETE']) {
  const response = await request(`/api/categories/${bCategory.id}`, {
    method, ...(method === 'PATCH' ? { body: JSON.stringify({ name: 'Nope' }) } : {}),
  }, a.cookie);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, 'category_not_found');
}
const globalPatch = await request(`/api/categories/${global.id}`, {
  method: 'PATCH', body: JSON.stringify({ name: 'Nope' }),
}, a.cookie);
assert.equal(globalPatch.status, 403);
assert.equal((await globalPatch.json()).code, 'category_read_only');

const account = (await (await a.client.from('accounts').insert({ user_id: a.user.id, name: `P12 ${unique}`, type: 'checking', initial_balance: 1000, currency: 'MXN' }).select('id').single()).data);
const transaction = (await a.client.rpc('create_financial_transaction', {
  p_account_id: account.id, p_kind: 'expense', p_amount: 100, p_currency: 'MXN', p_date: '2026-09-02',
  p_description: 'category delete', p_category_id: category.id, p_tag_ids: [], p_source: 'manual',
})).data;
const budget = (await a.client.from('budgets').insert({ user_id: a.user.id, category_id: category.id, month: '2026-09-01', amount: 200 }).select('id').single()).data;
assert.ok(budget);
const blocked = await request(`/api/categories/${category.id}`, { method: 'DELETE' }, a.cookie);
assert.equal(blocked.status, 409);
assert.equal((await blocked.json()).code, 'category_in_use');
await a.client.from('budgets').delete().eq('id', budget.id);
const before = (await a.client.from('accounts').select('balance').eq('id', account.id).single()).data.balance;
const deleted = await request(`/api/categories/${category.id}`, { method: 'DELETE' }, a.cookie);
assert.equal(deleted.status, 204);
const after = (await a.client.from('accounts').select('balance').eq('id', account.id).single()).data.balance;
assert.equal(after, before);
assert.equal((await a.client.from('transactions').select('category_id').eq('id', transaction.id).single()).data.category_id, null);

const tagResponse = await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: `tag-${unique}`, color: '#abcdef' }) }, a.cookie);
assert.equal(tagResponse.status, 201);
const tag = await tagResponse.json();
const duplicateTag = await request('/api/tags', { method: 'POST', body: JSON.stringify({ name: `tag-${unique}` }) }, a.cookie);
assert.equal(duplicateTag.status, 409);
assert.equal((await duplicateTag.json()).code, 'tag_already_exists');
const foreignTag = await request(`/api/tags/${tag.id}`, { method: 'DELETE' }, b.cookie);
assert.equal(foreignTag.status, 404);
const deletedTag = await request(`/api/tags/${tag.id}`, { method: 'DELETE' }, a.cookie);
assert.equal(deletedTag.status, 204);

console.log('P1.2 API PASS: category scope, read-only globals, foreign 404, budget 409, SET NULL balance, tag duplicate/delete.');