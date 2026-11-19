import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expectedTingProofSchema, inspectTingProofMetadata } from '../scripts/tingproof-schema-preflight.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-schema-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'tingproof.db');
  const source = await readFile(new URL('../third_party/tingproof/server/sqliteStore.ts', import.meta.url), 'utf8');
  const database = new DatabaseSync(file);
  database.exec(`PRAGMA journal_mode=WAL; ${/const SCHEMA = `([\s\S]*?)`;/m.exec(source)[1]}; PRAGMA user_version=4;`);
  database.close();
  return { directory, file, expected: await expectedTingProofSchema() };
}

test('immutable schema preflight verifies main-file metadata without creating WAL or SHM', async t => {
  const { directory, file, expected } = await fixture(t);
  const digest = async () => createHash('sha256').update(await readFile(file)).digest('hex');
  const before = await digest(), names = await readdir(directory);
  assert.ok(expected.tables.some(table => table.name === 'business_assignments'));
  assert.deepEqual(await inspectTingProofMetadata(file, expected), { compatible: true, missing: [] });
  assert.equal(await digest(), before);
  assert.deepEqual(await readdir(directory), names);
});

test('schema preflight reports only missing expected names and ignores business values', async t => {
  const { file, expected } = await fixture(t);
  const database = new DatabaseSync(file);
  database.exec("DROP INDEX idx_business_events_space; CREATE TABLE sensitive_records(value TEXT); INSERT INTO sensitive_records VALUES('PRIVATE_SYNTHETIC_PAYLOAD');");
  database.close();
  const result = await inspectTingProofMetadata(file, expected);
  assert.deepEqual(result, { compatible: false, missing: ['idx_business_events_space'] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SYNTHETIC_PAYLOAD|sensitive_records/);
});

test('schema preflight fails closed on a missing column or unreadable input', async t => {
  const { directory, file, expected } = await fixture(t);
  const changed = structuredClone(expected);
  changed.tables[0].columns.push({ name: 'required_missing_column', type: 'TEXT' });
  assert.ok((await inspectTingProofMetadata(file, changed)).missing.includes(`${changed.tables[0].name}.required_missing_column`));
  assert.deepEqual(await inspectTingProofMetadata(join(directory, 'absent.db'), expected), { compatible: false, missing: ['read_only_metadata_unavailable'] });
  assert.equal((await readdir(directory)).includes('absent.db'), false);
});
