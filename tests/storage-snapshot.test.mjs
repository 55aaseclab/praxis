import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { createSnapshot, verifySnapshot } from '../src/storage/snapshot.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-snapshot-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const data = join(root, 'input'); await mkdir(data);
  const json = join(data, 'checklist.json');
  await writeFile(json, JSON.stringify({ format: 'memo-backup', schemaVersion: 1, appVersion: '1.0.0', exportedAt: '2026-11-25T00:00:00.000Z', data: { records: [{ id: '汉字', text: '北京午饭', tags: [] }], prefs: {}, flow: null } }));
  const config = { workspaceId: randomUUID(), deviceId: randomUUID(), dataRoot: join(root, 'storage'), appSources: [{ id: 'memo', kind: 'json', source: json, target: 'checklist.json', schema: 'memo-backup-v1' }] };
  config.activeWriterDeviceId = config.deviceId;
  return { root, data, json, config };
}
test('snapshot preserves JSON and Chinese paths, excludes locks and verifies every byte', async t => {
  const f = await fixture(t), slides = join(f.data, 'decks'); await mkdir(slides);
  await writeFile(join(slides, '雪景.md'), '# 四川'); await writeFile(join(slides, 'writer.lock'), 'not data');
  f.config.appSources.push({ id: 'slides', kind: 'directory', source: slides, target: 'decks' });
  f.config.coverage = { omitted: ['Browser media requires an explicit export'] };
  const first = await createSnapshot(f.config);
  assert.equal((await verifySnapshot(first.directory)).snapshotId, first.manifest.snapshotId);
  assert.equal(first.manifest.files.length, 2);
  assert.equal(await readFile(join(first.directory, 'apps/slides/decks/雪景.md'), 'utf8'), '# 四川');
  assert.deepEqual(first.manifest.coverage.omitted, f.config.coverage.omitted);
  f.config.parentSnapshotId = first.manifest.snapshotId;
  const second = await createSnapshot(f.config);
  assert.equal(second.manifest.parentSnapshotId, first.manifest.snapshotId);
  await writeFile(join(first.directory, 'apps/memo/checklist.json'), '{}');
  await assert.rejects(verifySnapshot(first.directory), /verification failed/);
});
test('SQLite online backup includes committed WAL and leaves the source unchanged', async t => {
  const f = await fixture(t), file = join(f.data, 'tingproof.db');
  const db = new DatabaseSync(file); t.after(() => db.close());
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA user_version=3; CREATE TABLE records (id INTEGER, text TEXT)');
  db.prepare('INSERT INTO records VALUES (?, ?)').run(1, '中文音轨');
  assert.ok((await readdir(f.data)).includes('tingproof.db-wal'));
  f.config.appSources.push({ id: 'tingproof', kind: 'sqlite', source: file, target: 'tingproof.db' });
  const before = await readFile(file), { directory, manifest } = await createSnapshot(f.config);
  assert.deepEqual(await readFile(file), before);
  const restored = new DatabaseSync(join(directory, 'apps/tingproof/tingproof.db'), { readOnly: true });
  try { assert.equal(restored.prepare('SELECT text FROM records').get().text, '中文音轨'); } finally { restored.close(); }
  assert.equal(manifest.apps[1].schemaVersion, 3);
});
test('SQLite closed WAL-mode database can be snapshotted from a read-only directory', { skip: process.getuid?.() === 0 }, async t => {
  const f = await fixture(t), source = join(f.data, 'closed.db');
  const writer = new DatabaseSync(source);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA user_version=3; CREATE TABLE records(text); INSERT INTO records VALUES (\'中文记录\')');
  writer.close();
  assert.ok(!(await readdir(f.data)).includes('closed.db-wal'));
  const before = await readFile(source);
  f.config.appSources = [{ id: 'tingproof', kind: 'sqlite', source, target: 'tingproof.db' }];
  await chmod(source, 0o400); await chmod(f.data, 0o500);
  try {
    const snapshot = await createSnapshot(f.config);
    await verifySnapshot(snapshot.directory);
    assert.deepEqual(await readFile(source), before);
    const restored = new DatabaseSync(join(snapshot.directory, 'apps/tingproof/tingproof.db'), { readOnly: true });
    try { assert.equal(restored.prepare('SELECT text FROM records').get().text, '中文记录'); }
    finally { restored.close(); }
  } finally { await chmod(f.data, 0o700); await chmod(source, 0o600); }
});
test('SQLite read-only fallback refuses a nonempty WAL without its shared-memory file', { skip: process.getuid?.() === 0 }, async t => {
  const f = await fixture(t), source = join(f.data, 'live.db');
  const writer = new DatabaseSync(source);
  writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE records(text); INSERT INTO records VALUES (\'已提交记录\')');
  await rm(`${source}-shm`);
  f.config.appSources = [{ id: 'tingproof', kind: 'sqlite', source, target: 'tingproof.db' }];
  await chmod(source, 0o400); await chmod(`${source}-wal`, 0o400); await chmod(f.data, 0o500);
  try {
    const script = `import{readFileSync}from'node:fs';import{createSnapshot}from${JSON.stringify(new URL('../src/storage/snapshot.mjs', import.meta.url).href)};try{await createSnapshot(JSON.parse(readFileSync(0,'utf8')))}catch(error){process.stdout.write(error.message);process.exitCode=1}`;
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], { input: JSON.stringify(f.config), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }), error => /nonempty SQLite WAL/.test(error.stdout));
  }
  finally { await chmod(f.data, 0o700); await chmod(source, 0o600); await chmod(`${source}-wal`, 0o600); writer.close(); }
});
test('SQLite fallback rejects corrupt main files and nonempty rollback journals', async t => {
  const f = await fixture(t), source = join(f.data, 'corrupt.db');
  await writeFile(source, 'This is not a SQLite database');
  f.config.appSources = [{ id: 'tingproof', kind: 'sqlite', source, target: 'tingproof.db' }];
  await assert.rejects(createSnapshot(f.config), /not a database|file is encrypted/);
  await writeFile(`${source}-journal`, 'A nonempty transaction journal');
  await assert.rejects(createSnapshot(f.config), /nonempty SQLite rollback journal/);
});
test('snapshot refuses non-writers, invalid schema, overlap, empty sources and escaping symlinks', async t => {
  const f = await fixture(t);
  await assert.rejects(createSnapshot({ ...f.config, activeWriterDeviceId: randomUUID() }), /active writer/);
  await assert.rejects(createSnapshot({ ...f.config, appSources: [] }), /empty backup/);
  await assert.rejects(createSnapshot({ ...f.config, appSources: [...f.config.appSources, ...f.config.appSources] }), /Overlapping/);
  await assert.rejects(createSnapshot({ ...f.config, appSources: [{ ...f.config.appSources[0], target: '../../escape' }] }), /Unsafe/);
  await writeFile(f.json, '{}');
  await assert.rejects(createSnapshot(f.config), /schema version/);
  await symlink('/etc/passwd', join(f.data, 'escape'));
  await assert.rejects(createSnapshot({ ...f.config, appSources: [{ id: 'media', kind: 'directory', source: f.data, target: 'files' }] }), /regular files/);
});
test('restore verification rejects extra files and malicious manifest paths', async t => {
  const f = await fixture(t), result = await createSnapshot(f.config);
  await writeFile(join(result.directory, 'extra'), 'not listed');
  await assert.rejects(verifySnapshot(result.directory), /unlisted/);
  await rm(join(result.directory, 'extra'));
  result.manifest.files[0].path = '../escape';
  await writeFile(join(result.directory, 'manifest.json'), JSON.stringify(result.manifest));
  await assert.rejects(verifySnapshot(result.directory), /Unsafe/);
});
test('source backup preserves unpushed commits and tracked and untracked edits without ignored secrets', async t => {
  const f = await fixture(t), repo = join(f.root, 'source'); await mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Snapshot Test'); git('config', 'user.email', 'snapshot@example.invalid');
  await writeFile(join(repo, 'code.mjs'), 'export const value = 1;\n');
  await writeFile(join(repo, '.gitignore'), 'private.json\n'); git('add', '.'); git('commit', '-qm', 'local commit');
  const head = git('rev-parse', 'HEAD').trim();
  await writeFile(join(repo, 'code.mjs'), 'export const value = 2;\n');
  await writeFile(join(repo, 'new.mjs'), 'export const value = 3;\n');
  await writeFile(join(repo, 'private.json'), 'must not be exported');
  f.config.sourceRepos = [{ id: 'app', path: repo }];
  const result = await createSnapshot(f.config), saved = join(result.directory, 'source/app');
  assert.equal(result.manifest.sourceVersion[0].commit, head);
  assert.match(await readFile(join(saved, 'working.patch'), 'utf8'), /value = 2/);
  assert.ok(result.manifest.files.some(file => file.path === 'source/app/untracked/new.mjs'));
  assert.ok(!result.manifest.files.some(file => file.path.includes('private.json')));
  const restored = join(f.root, 'cloned'); execFileSync('git', ['clone', '-q', join(saved, 'repository.bundle'), restored]);
  assert.equal(await readFile(join(restored, 'code.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('snapshot verification requires declared empty directories and matching schema versions', async t => {
  const f = await fixture(t), empty = join(f.data, 'empty'); await mkdir(empty);
  f.config.appSources.push({ id: 'slides', kind: 'directory', source: empty, target: 'decks' });
  const snapshot = await createSnapshot(f.config);
  await rm(join(snapshot.directory, 'apps/slides/decks'), { recursive: true });
  await assert.rejects(verifySnapshot(snapshot.directory), /ENOENT/);
  await mkdir(join(snapshot.directory, 'apps/slides/decks'));
  snapshot.manifest.apps[0].schemaVersion = 999;
  await writeFile(join(snapshot.directory, 'manifest.json'), JSON.stringify(snapshot.manifest));
  await assert.rejects(verifySnapshot(snapshot.directory), /schema version/);
});

test('source backup rejects untracked files changed after they were copied', async t => {
  const f = await fixture(t), repo = join(f.root, 'source'); await mkdir(repo);
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const git = (...args) => execFileSync(realGit, args, { cwd: repo, stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q'); git('config', 'user.name', 'Snapshot Test'); git('config', 'user.email', 'snapshot@example.invalid');
  await writeFile(join(repo, 'tracked.mjs'), 'export const value = 1;\n'); git('add', '.'); git('commit', '-qm', 'local');
  const untracked = join(repo, 'new.mjs'); await writeFile(untracked, 'export const value = 2;\n');
  const wrapperDir = join(f.root, 'tools'); await mkdir(wrapperDir);
  const wrapper = join(wrapperDir, 'git');
  const counter = join(f.root, 'git-count');
  await writeFile(wrapper, `#!${process.execPath}\nimport{execFileSync}from'node:child_process';import{existsSync,readFileSync,writeFileSync}from'node:fs';const args=process.argv.slice(2);if(args[0]==='diff'){const count=existsSync(${JSON.stringify(counter)})?Number(readFileSync(${JSON.stringify(counter)},'utf8')):0;writeFileSync(${JSON.stringify(counter)},String(count+1));if(count===1)writeFileSync(${JSON.stringify(untracked)},'export const value = 3;\\n');}process.stdout.write(execFileSync(${JSON.stringify(realGit)},args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH; process.env.PATH = `${wrapperDir}:${oldPath}`;
  f.config.sourceRepos = [{ id: 'app', path: repo }];
  try { await assert.rejects(createSnapshot(f.config), /Source changed during export/); }
  finally { process.env.PATH = oldPath; }
});
