#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, lstat, rm, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadConfig, DEFAULT_CONFIG_FILE } from '../src/storage/config.mjs';

const runFile = promisify(execFile);
export async function expectedTingProofSchema() {
  const source = await readFile(new URL('../third_party/tingproof/server/sqliteStore.ts', import.meta.url), 'utf8');
  const sql = /const SCHEMA = `([\s\S]*?)`;/m.exec(source)?.[1];
  if (!sql || sql.includes('${')) throw new Error('Expected schema source is unavailable.');
  const database = new DatabaseSync(':memory:');
  try {
    database.exec(sql);
    return {
      version: Number(/export const SCHEMA_VERSION = (\d+)/.exec(source)?.[1]),
      tables: database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => ({ name, columns: database.prepare(`PRAGMA table_info("${name}")`).all().map(column => ({ name: column.name, type: column.type })) })),
      indexes: database.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => ({ name, columns: database.prepare(`PRAGMA index_info("${name}")`).all().map(column => column.name) })),
    };
  } finally { database.close(); }
}

export async function inspectTingProofMetadata(file, expected) {
  const { DatabaseSync } = await import('node:sqlite');
  const { pathToFileURL } = await import('node:url');
  let database;
  try {
    // Immutable inspection reads only the main database and never creates WAL/SHM files.
    // A newer schema present only in WAL may conservatively fail this preflight.
    const location = pathToFileURL(file);
    location.search = '?mode=ro&immutable=1';
    database = new DatabaseSync(location, { readOnly: true });
    database.exec('PRAGMA query_only=ON');
    const missing = [];
    if (Number(database.prepare('PRAGMA user_version').get().user_version) !== expected.version) missing.push('user_version');
    for (const table of expected.tables) {
      if (!/^[A-Za-z0-9_]+$/.test(table.name)) throw new Error('Invalid expected metadata.');
      if (!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table.name)) { missing.push(table.name); continue; }
      const columns = database.prepare(`PRAGMA table_info("${table.name}")`).all();
      for (const column of table.columns) if (!columns.some(actual => actual.name === column.name && actual.type === column.type)) missing.push(`${table.name}.${column.name}`);
    }
    for (const index of expected.indexes) {
      if (!/^[A-Za-z0-9_]+$/.test(index.name)) throw new Error('Invalid expected metadata.');
      if (!database.prepare("SELECT 1 FROM sqlite_schema WHERE type='index' AND name=?").get(index.name) || JSON.stringify(database.prepare(`PRAGMA index_info("${index.name}")`).all().map(column => column.name)) !== JSON.stringify(index.columns)) missing.push(index.name);
    }
    return { compatible: missing.length === 0, missing };
  } catch { return { compatible: false, missing: ['read_only_metadata_unavailable'] }; }
  finally { database?.close(); }
}

export async function preflightTingProof({ configFile = process.env.PRAXIS_STORAGE_CONFIG || DEFAULT_CONFIG_FILE, image = 'praxis-business/server:local', execute = runFile } = {}) {
  const config = await loadConfig(configFile);
  const sources = config.appSources.filter(source => source.id === 'tingproof' && source.kind === 'sqlite' && source.target === 'tingproof.db');
  if (sources.length !== 1) throw new Error('A unique registered TingProof database is required.');
  const file = sources[0].source;
  if (resolve(file) !== file || await realpath(file) !== file || !(await lstat(file)).isFile() || await realpath(dirname(file)) !== dirname(file)) throw new Error('Canonical database metadata is required.');
  const directory = await mkdtemp(resolve(tmpdir(), 'praxis-tp-schema-'));
  try {
    await mkdir(resolve(directory, 'fixture'), { mode: 0o700 });
    const expectedFile = resolve(directory, 'fixture/expected.json'), scriptFile = resolve(directory, 'fixture/check.mjs');
    await writeFile(expectedFile, JSON.stringify(await expectedTingProofSchema()), { mode: 0o600 });
    const program = `import {readFile} from 'node:fs/promises';const inspect=${inspectTingProofMetadata.toString()};const result=await inspect(process.argv[2],JSON.parse(await readFile('/fixture/expected.json','utf8')));console.log(JSON.stringify(result));if(!result.compatible)process.exitCode=1;`;
    await writeFile(scriptFile, program, { mode: 0o600 });
    const args = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, '--mount', `type=bind,source=${dirname(file)},target=/source,readonly`, '--mount', `type=bind,source=${resolve(directory, 'fixture')},target=/fixture,readonly`, '--entrypoint', 'node', image, '/fixture/check.mjs', `/source/${basename(file)}`];
    try { return JSON.parse((await execute('docker', args, { maxBuffer: 65536 })).stdout); }
    catch (error) { if (error.stdout) return JSON.parse(error.stdout); throw error; }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { values } = parseArgs({ options: { config: { type: 'string' }, image: { type: 'string' } } });
  try {
    const result = await preflightTingProof({ configFile: values.config, image: values.image });
    console.log(JSON.stringify(result)); if (!result.compatible) process.exitCode = 1;
  } catch { console.log(JSON.stringify({ compatible: false, missing: ['preflight_unavailable'] })); process.exitCode = 1; }
}
