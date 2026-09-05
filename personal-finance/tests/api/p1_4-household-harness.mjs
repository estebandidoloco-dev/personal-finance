import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export function parseEnvFile(text) {
  return Object.fromEntries(text.split(/\r?\n/u).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return [];
    const separator = trimmed.indexOf('=');
    if (separator < 1) return [];
    return [[trimmed.slice(0, separator), trimmed.slice(separator + 1)]];
  }));
}

export async function loadLocalHouseholdTestEnv({
  processEnv = process.env,
  envFileUrl = new URL('../../.env.local', import.meta.url),
  readEnvFile = readFile,
} = {}) {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: processEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: processEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    TEST_APP_URL: processEnv.TEST_APP_URL,
  };
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    try {
      const fileEnv = parseEnvFile(await readEnvFile(envFileUrl, 'utf8'));
      if (!env.NEXT_PUBLIC_SUPABASE_URL) {
        env.NEXT_PUBLIC_SUPABASE_URL = fileEnv.NEXT_PUBLIC_SUPABASE_URL;
      }
      if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY = fileEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  assert.ok(
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    'Local Supabase URL and anon key are required in process.env or .env.local.'
  );
  const supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(supabaseUrl.protocol, 'http:', 'Local Supabase must use HTTP.');
  assert.ok(['127.0.0.1', 'localhost'].includes(supabaseUrl.hostname), 'Only local Supabase is allowed.');
  assert.equal(supabaseUrl.port, '54321', 'Expected the configured local Supabase API port.');
  const baseUrl = new URL(env.TEST_APP_URL ?? 'http://127.0.0.1:3000');
  assert.equal(baseUrl.protocol, 'http:', 'Local Next.js must use HTTP.');
  assert.ok(['127.0.0.1', 'localhost'].includes(baseUrl.hostname), 'Only a local Next.js server is allowed.');
  assert.equal(baseUrl.port || '80', '3000', 'Expected the configured local Next.js port.');
  return { env, supabaseUrl, baseUrl };
}

export async function signUpTrackedFixture({ client, fixtures, credentials, storageKey }) {
  const { data, error } = await client.auth.signUp(credentials);
  let fixture;
  if (data?.user) {
    fixture = { client, user: data.user, cookie: null };
    fixtures.push(fixture);
  }
  assert.ifError(error);
  assert.ok(data?.user, 'Fixture signup did not return a user.');
  assert.ok(data.session, 'Fixture signup did not return a session.');
  fixture.cookie = `${storageKey}=base64-${Buffer.from(JSON.stringify(data.session)).toString('base64url')}`;
  return fixture;
}
