import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import net from 'node:net';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const connectionUrl = new URL(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
assert.ok(['127.0.0.1', 'localhost'].includes(connectionUrl.hostname), 'Only local PostgreSQL is allowed.');
assert.equal(connectionUrl.port, '54322', 'Expected the configured local PostgreSQL port.');

const migrationText = await readFile(
  new URL('../../supabase/migrations/20260902190000_dashboard_summary_mxn_only.sql', import.meta.url),
  'utf8'
);
const criticalMatch = migrationText.match(
  /-- BEGIN MXN_ONLY_CRITICAL_SECTION([\s\S]*?)-- END MXN_ONLY_CRITICAL_SECTION/u
);
assert.ok(criticalMatch, 'The migration critical section markers are required.');
const criticalSql = criticalMatch[1].trim();
const lockMatch = criticalSql.match(/^[\s\S]*?lock table public\.accounts in share row exclusive mode;/iu);
assert.ok(lockMatch, 'The real critical section must start with the approved accounts lock.');
const lockSql = lockMatch[0];
const afterLockSql = criticalSql.slice(lockMatch[0].length);
assert.doesNotMatch(lockSql, /select[\s\S]+from public\.accounts/iu, 'No account inspection may precede the lock.');

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value);
  return buffer;
}

function frame(type, payload) {
  return Buffer.concat([Buffer.from(type), int32(payload.length + 4), payload]);
}

function parseError(payload) {
  const fields = {};
  let offset = 0;
  while (payload[offset] !== 0) {
    const code = String.fromCharCode(payload[offset]);
    const end = payload.indexOf(0, offset + 1);
    fields[code] = payload.toString('utf8', offset + 1, end);
    offset = end + 1;
  }
  const error = new Error(fields.M ?? 'PostgreSQL error');
  error.code = fields.C;
  error.detail = fields.D;
  error.position = fields.P;
  error.where = fields.W;
  return error;
}

export class PgConnection {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.waiters = [];
  }

  async connect() {
    this.socket = net.createConnection({
      host: connectionUrl.hostname,
      port: Number(connectionUrl.port),
    });
    this.socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flushWaiters();
    });
    await new Promise((resolve, reject) => {
      this.socket.once('connect', resolve);
      this.socket.once('error', reject);
    });
    const parameters = Buffer.from(
      `user\0${decodeURIComponent(connectionUrl.username)}\0database\0${connectionUrl.pathname.slice(1)}\0client_encoding\0UTF8\0\0`
    );
    this.socket.write(Buffer.concat([int32(parameters.length + 8), int32(196608), parameters]));
    await this.authenticate();
    return this;
  }

  flushWaiters() {
    while (this.waiters.length > 0 && this.buffer.length >= 5) {
      const length = this.buffer.readInt32BE(1);
      if (this.buffer.length < length + 1) return;
      const message = { type: this.buffer.toString('ascii', 0, 1), payload: this.buffer.subarray(5, length + 1) };
      this.buffer = this.buffer.subarray(length + 1);
      this.waiters.shift()(message);
    }
  }

  readMessage() {
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      this.flushWaiters();
    });
  }

  async authenticate() {
    const user = decodeURIComponent(connectionUrl.username);
    const password = decodeURIComponent(connectionUrl.password);
    let scram;
    while (true) {
      const message = await this.readMessage();
      if (message.type === 'R') {
        const method = message.payload.readInt32BE(0);
        if (method === 0) continue;
        if (method === 3) {
          this.socket.write(frame('p', Buffer.from(`${password}\0`)));
          continue;
        }
        if (method === 5) {
          const inner = crypto.createHash('md5').update(password + user).digest('hex');
          const digest = crypto.createHash('md5').update(Buffer.concat([Buffer.from(inner), message.payload.subarray(4, 8)])).digest('hex');
          this.socket.write(frame('p', Buffer.from(`md5${digest}\0`)));
          continue;
        }
        if (method === 10) {
          const nonce = crypto.randomBytes(18).toString('base64');
          const clientFirstBare = `n=${user.replaceAll('=', '=3D').replaceAll(',', '=2C')},r=${nonce}`;
          const clientFirst = `n,,${clientFirstBare}`;
          const mechanism = Buffer.from('SCRAM-SHA-256\0');
          const first = Buffer.from(clientFirst);
          scram = { clientFirstBare, nonce };
          this.socket.write(frame('p', Buffer.concat([mechanism, int32(first.length), first])));
          continue;
        }
        if (method === 11) {
          assert.ok(scram, 'Unexpected SCRAM continuation.');
          const serverFirst = message.payload.subarray(4).toString();
          const attributes = Object.fromEntries(serverFirst.split(',').map((part) => [part[0], part.slice(2)]));
          assert.ok(attributes.r?.startsWith(scram.nonce), 'Server SCRAM nonce does not extend client nonce.');
          const channel = 'biws';
          const clientFinalWithoutProof = `c=${channel},r=${attributes.r}`;
          const authMessage = `${scram.clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;
          const salted = crypto.pbkdf2Sync(password, Buffer.from(attributes.s, 'base64'), Number(attributes.i), 32, 'sha256');
          const clientKey = crypto.createHmac('sha256', salted).update('Client Key').digest();
          const storedKey = crypto.createHash('sha256').update(clientKey).digest();
          const signature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
          const proof = Buffer.alloc(clientKey.length);
          for (let index = 0; index < proof.length; index += 1) proof[index] = clientKey[index] ^ signature[index];
          this.socket.write(frame('p', Buffer.from(`${clientFinalWithoutProof},p=${proof.toString('base64')}`)));
          continue;
        }
        if (method === 12) continue;
        throw new Error(`Unsupported PostgreSQL authentication method ${method}.`);
      }
      if (message.type === 'E') throw parseError(message.payload);
      if (message.type === 'Z') return;
    }
  }

  async query(sql, timeoutMs = 5000) {
    const operation = (async () => {
      this.socket.write(frame('Q', Buffer.from(`${sql}\0`)));
      const rows = [];
      let columns = [];
      let queryError;
      while (true) {
        const message = await this.readMessage();
        if (message.type === 'T') {
          columns = [];
          const count = message.payload.readInt16BE(0);
          let offset = 2;
          for (let index = 0; index < count; index += 1) {
            const end = message.payload.indexOf(0, offset);
            columns.push(message.payload.toString('utf8', offset, end));
            offset = end + 19;
          }
        } else if (message.type === 'D') {
          const count = message.payload.readInt16BE(0);
          const row = {};
          let offset = 2;
          for (let index = 0; index < count; index += 1) {
            const length = message.payload.readInt32BE(offset);
            offset += 4;
            row[columns[index]] = length === -1 ? null : message.payload.toString('utf8', offset, offset + length);
            if (length !== -1) offset += length;
          }
          rows.push(row);
        } else if (message.type === 'E') {
          queryError = parseError(message.payload);
        } else if (message.type === 'Z') {
          if (queryError) throw queryError;
          return rows;
        }
      }
    })();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Client timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
      return await Promise.race([operation, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(frame('X', Buffer.alloc(0)));
      this.socket.end();
    }
  }
}

export async function connect() {
  return new PgConnection().connect();
}

async function accountsAcl(database) {
  return database.query(`
    select class.relacl::text as table_acl,
           (select coalesce(jsonb_agg(jsonb_build_array(attribute.attname, attribute.attacl::text)
                     order by attribute.attnum), '[]'::jsonb)::text
              from pg_catalog.pg_attribute attribute
             where attribute.attrelid = class.oid and attribute.attacl is not null) as column_acls
      from pg_catalog.pg_class class
     where class.oid = 'public.accounts'::regclass
  `);
}

async function waitForLock(observer, predicate, label) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await observer.query(`
      select pid::text, mode, granted::text
        from pg_catalog.pg_locks
       where relation = 'public.accounts'::regclass
    `);
    if (rows.some(predicate)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for explicit pg_locks evidence: ${label}`);
}

export async function runConcurrencyTest() {
  const fixtureId = '55555555-5555-4555-8555-555555555555';
  const accountId = '55555555-5555-4555-8555-555555555556';
  const admin = await connect();
  const writer = await connect();
  const migration = await connect();
  const observer = await connect();
  const aclBefore = await accountsAcl(admin);

  try {
  await admin.query(`
    delete from auth.users where id = '${fixtureId}';
    insert into auth.users(id, aud, role, email, raw_user_meta_data, created_at, updated_at)
    values ('${fixtureId}', 'authenticated', 'authenticated', 'mxn-concurrency@example.test', '{"display_name":"Concurrency"}', now(), now());
    insert into public.accounts(id, user_id, name, type, initial_balance)
    values ('${accountId}', '${fixtureId}', 'Concurrency account', 'checking', 0);
  `);

  // Scenario A: a prior privileged writer commits incompatible state. The real
  // critical block waits, then rejects that committed state with the MXN error.
  const migrationPidA = Number((await migration.query('select pg_backend_pid() as pid'))[0].pid);
  await writer.query('begin');
  await writer.query(`update public.accounts set currency = 'USD' where id = '${accountId}'`);
  const blockedMigration = migration.query(criticalSql, 8000);
  await waitForLock(
    observer,
    (row) => Number(row.pid) === migrationPidA && row.mode === 'ShareRowExclusiveLock' && row.granted === 'false',
    'migration waiting behind prior writer'
  );
  await writer.query('commit');
  await assert.rejects(blockedMigration, (error) => {
    assert.equal(error.code, 'P0001');
    assert.match(error.message, /contains NULL or non-MXN currency values/u);
    assert.doesNotMatch(error.message, /timeout|connection|syntax/iu);
    return true;
  });
  assert.equal((await admin.query(`select currency from public.accounts where id = '${accountId}'`))[0].currency, 'USD');
  await admin.query(`update public.accounts set currency = 'MXN' where id = '${accountId}'`);

  // Scenario B: the migration owns the real lock first. A later writer is
  // demonstrably queued while the extracted real validation/grant block runs.
  const migrationPidB = Number((await migration.query('select pg_backend_pid() as pid'))[0].pid);
  const writerPidB = Number((await writer.query('select pg_backend_pid() as pid'))[0].pid);
  await migration.query('begin');
  await migration.query(lockSql);
  await waitForLock(
    observer,
    (row) => Number(row.pid) === migrationPidB && row.mode === 'ShareRowExclusiveLock' && row.granted === 'true',
    'migration lock granted before inspection'
  );
  await writer.query("begin; set local lock_timeout = '3s'");
  const blockedWriter = writer.query(`update public.accounts set name = 'Writer completed' where id = '${accountId}'`, 5000);
  await waitForLock(
    observer,
    (row) => Number(row.pid) === writerPidB && row.mode === 'RowExclusiveLock' && row.granted === 'false',
    'later writer blocked by migration'
  );
  await migration.query(afterLockSql);
  await migration.query(`set local role authenticated; select set_config('request.jwt.claim.sub', '${fixtureId}', true)`);
  assert.equal((await migration.query(`select currency from public.accounts where id = '${accountId}'`))[0].currency, 'MXN');
  const inserted = await migration.query(`
      insert into public.accounts(user_id, name, type, initial_balance)
      values (auth.uid(), 'Authenticated default', 'cash', 1)
      returning id::text, currency
  `);
  assert.equal(inserted[0].currency, 'MXN');
  await migration.query('savepoint forbidden_insert');
  await assert.rejects(
    migration.query(`insert into public.accounts(user_id, name, type, initial_balance, currency) values (auth.uid(), 'Forbidden', 'cash', 0, 'MXN')`),
    (error) => error.code === '42501'
  );
  await migration.query('rollback to savepoint forbidden_insert');
  await migration.query('savepoint forbidden_update');
  await assert.rejects(
    migration.query(`update public.accounts set currency = 'USD' where id = '${accountId}'`),
    (error) => error.code === '42501'
  );
  await migration.query('rollback to savepoint forbidden_update');
  await migration.query('reset role; rollback');
  await blockedWriter;
  await writer.query('commit');

  const privileges = (await admin.query(`
    select
      has_column_privilege('authenticated', 'public.accounts', 'currency', 'SELECT')::text as can_select,
      has_column_privilege('authenticated', 'public.accounts', 'currency', 'INSERT')::text as can_insert,
      has_column_privilege('authenticated', 'public.accounts', 'currency', 'UPDATE')::text as can_update
  `))[0];
  assert.deepEqual(privileges, { can_select: 'true', can_insert: 'false', can_update: 'false' });
  assert.deepEqual(await accountsAcl(admin), aclBefore, 'The concurrency harness must restore the accounts ACL exactly.');
  console.log('MXN migration concurrency PASS: writer-first abort and migration-first exclusion use the real critical block.');
  } finally {
    for (const connection of [writer, migration]) {
      try { await connection.query('rollback', 1000); } catch {}
    }
    try { await admin.query(`delete from auth.users where id = '${fixtureId}'`); } catch {}
    admin.close();
    writer.close();
    migration.close();
    observer.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runConcurrencyTest();
}
