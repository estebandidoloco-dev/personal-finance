import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { connect } from './concurrency/mxn-only-migration-concurrency.mjs';

const sqlRoot = resolve('tests', 'sql');
const target = resolve(process.argv[2] ?? '');
assert.ok(target.startsWith(`${sqlRoot}${sep}`), 'SQL test must be inside tests/sql.');
assert.ok(target.endsWith('.sql'), 'SQL test must use the .sql extension.');

const database = await connect();
try {
  const sql = (await readFile(target, 'utf8'))
    .split(/\r?\n/u)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
  const result = await database.query(sql, 180_000);
  if (result.rows?.length) console.table(result.rows);
} finally {
  database.close();
}
