import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLocalHouseholdTestEnv, signUpTrackedFixture } from './p1_4-household-harness.mjs';

test('process.env wins while .env.local only fills missing variables', async () => {
  const loaded = await loadLocalHouseholdTestEnv({
    processEnv: {
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      TEST_APP_URL: 'http://localhost:3000',
    },
    readEnvFile: async () => [
      'NEXT_PUBLIC_SUPABASE_URL=http://remote.example:54321',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY=file-key',
    ].join('\n'),
  });
  assert.equal(loaded.env.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:54321');
  assert.equal(loaded.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'file-key');
});

test('users created before a second or third signup failure are cleanup-visible', async () => {
  for (const failureAt of [2, 3]) {
    const fixtures = [];
    const storedUsers = new Set();
    try {
      for (let index = 1; index <= 3; index += 1) {
        const user = { id: `65000000-0000-4000-8000-${String(failureAt * 10 + index).padStart(12, '0')}` };
        const client = { auth: { signUp: async () => {
          storedUsers.add(user.id);
          return { data: { user, session: index === failureAt ? null : {} }, error: null };
        } } };
        await signUpTrackedFixture({ client, fixtures, credentials: {}, storageKey: 'local' });
      }
      assert.fail(`Signup ${failureAt} should fail.`);
    } catch (error) {
      assert.match(error.message, /did not return a session/u);
    } finally {
      for (const fixture of fixtures) storedUsers.delete(fixture.user.id);
    }
    assert.equal(storedUsers.size, 0, `Signup ${failureAt} left an orphan fixture.`);
  }
});

test('missing .env.local is tolerated and missing variables fail clearly', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  await assert.rejects(loadLocalHouseholdTestEnv({
    processEnv: {},
    readEnvFile: async () => { throw missing; },
  }), /required in process\.env or \.env\.local/u);
});

test('remote Supabase and application URLs are rejected', async () => {
  await assert.rejects(loadLocalHouseholdTestEnv({ processEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'not-a-secret-test-value',
  } }), /Local Supabase must use HTTP|Only local Supabase/u);
  await assert.rejects(loadLocalHouseholdTestEnv({ processEnv: {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'not-a-secret-test-value',
    TEST_APP_URL: 'https://example.com',
  } }), /Local Next\.js must use HTTP|Only a local Next\.js server/u);
});
