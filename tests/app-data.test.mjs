import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAppPaths, appStorageSources, assertAppBindings, validateAppPathParents } from '../src/storage/app-paths.mjs';
import { planAppData } from '../src/storage/app-data-plan.mjs';
import { relocateVerified, rollbackRelocation, validateRelocations } from '../src/storage/relocate.mjs';
const configuration = root => ({ dataRoot: root, workspaceId: '11111111-1111-4111-8111-111111111111', stateRoot: join(root, 'state'), repositories: [{ type: 'local', path: join(root, 'backups'), passwordFile: join(root, 'config/key') }], appSources: [] });
test('default and per-app roots drive all working paths without changing another app', () => {
  const c = configuration('/private/praxis'), normal = resolveAppPaths(c);
  c.workingData = { version: 1, roots: { projects: '/mnt/nas/private/projects' } };
  const changed = resolveAppPaths(c);
  assert.equal(changed.projects, '/mnt/nas/private/projects');
  assert.equal(changed.travel, normal.travel);
  assert.equal(changed.slidesState, join(normal.roots.lattice, 'native/.lattice'));
  assert.equal(appStorageSources(changed).find(item => item.id === 'projects').source, '/mnt/nas/private/projects/projects.db');
});
test('unknown, relative, overlapping, source, backup and secret roots fail closed', () => {
  for (const roots of [{ unknown: '/private/x/y' }, { projects: 'relative' }, { projects: '/private/data', travel: '/private/data/travel' }, { projects: '/private/praxis/backups/projects' }, { projects: '/private/praxis/config/projects' }, { projects: process.cwd() + '/data' }, { projects: '/tmp/a/../b' }]) {
    assert.throws(() => resolveAppPaths({ ...configuration('/private/praxis'), workingData: { version: 1, roots } }));
  }
});
test('parent validation rejects symlink aliases', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-app-path-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'real'), { mode: 0o700 }); await symlink(join(root, 'real'), join(root, 'alias'));
  await assert.rejects(validateAppPathParents({ roots: { projects: join(root, 'alias', 'data') } }));
});
test('plan preserves identifiers and maps every configured store to its app root', () => {
  const storage = configuration('/private/praxis'); storage.appSources = [{ id: 'tingproof', target: 'tingproof.db', source: '/old/ting/tingproof.db' }, { id: 'slides', target: 'decks', source: '/old/slides/decks' }, { id: 'slides', target: '.lattice', source: '/old/slides/.lattice' }];
  const business = { database: '/old/auth/auth.db', eventsDatabase: '/old/auth/events.db', observationsFile: '/old/obs/observations.db', apps: Object.fromEntries(['projects', 'slides'].map(id => [id, { dataDir: `/old/${id}` }])) };
  const plan = planAppData({ storage, business, slidesMapping: { spaces: { spaceA: '/old/slides/a.json' } }, polaris: { enabled: false } });
  assert.equal(plan.slidesMapping.spaces.spaceA, join(plan.paths.slidesBusiness, 'a.json'));
  assert.equal(plan.business.database, join(plan.paths.platform, 'auth.db'));
  assert.equal(business.database, '/old/auth/auth.db');
  assert.doesNotThrow(() => assertAppBindings(plan.storage, plan.business, { slidesSpaces: plan.slidesMapping.spaces }));
  plan.business.apps.projects.dataDir = '/old/projects'; assert.throws(() => assertAppBindings(plan.storage, plan.business));
});
test('same-device migration preserves bytes and inode, and rollback restores source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-relocate-')); t.after(() => rm(root, { recursive: true, force: true }));
  const from = join(root, 'from'), to = join(root, 'to'); await mkdir(from); await writeFile(join(from, '汉字.json'), '{"text":"业务内容"}\n');
  const inode = (await lstat(join(from, '汉字.json'))).ino;
  const [pair] = await validateRelocations([{ id: 'test', from, to }]); const moved = await relocateVerified(pair);
  assert.equal(moved.method, 'rename'); assert.equal((await lstat(join(to, '汉字.json'))).ino, inode);
  assert.equal(await readFile(join(to, '汉字.json'), 'utf8'), '{"text":"业务内容"}\n');
  await rollbackRelocation(moved); assert.equal((await lstat(join(from, '汉字.json'))).ino, inode);
});
test('migration refuses occupied and overlapping targets before changing source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-relocate-reject-')); t.after(() => rm(root, { recursive: true, force: true }));
  const from = join(root, 'from'), to = join(root, 'to'); await mkdir(from); await mkdir(to);
  await assert.rejects(validateRelocations([{ from, to }]));
  await assert.rejects(validateRelocations([{ from, to: join(from, 'nested') }]));
  assert.ok((await lstat(from)).isDirectory());
});

test('deployment metadata rebase changes only typed paths and preserves unrelated environment values', async () => {
  const { rebaseDeploymentPrototype } = await import('../src/storage/app-data-plan.mjs');
  const original = { Mounts: [{ Type: 'bind', Source: '/old/obs', Destination: '/old/obs' }, { Type: 'bind', Source: '/config/private', Destination: '/config/private' }], Config: { Env: ['PRAXIS_OBSERVATIONS_FILE=/old/obs/observations.db', 'UNRELATED=/old/obs', 'SECRET=opaque'] } };
  const next = rebaseDeploymentPrototype(original, [{ from: '/old/obs', to: '/new/obs' }]);
  assert.equal(next.Mounts[0].Source, '/new/obs'); assert.equal(next.Config.Env[0], 'PRAXIS_OBSERVATIONS_FILE=/new/obs/observations.db');
  assert.equal(next.Config.Env[1], original.Config.Env[1]); assert.equal(next.Mounts[1].Source, original.Mounts[1].Source);
});

test('Polaris environment follows typed data-root binding without altering private values', async () => {
  const { rebasePolarisEnvironment } = await import('../src/storage/app-data-plan.mjs');
  assert.equal(rebasePolarisEnvironment('POLARIS_DATA_ROOT="/old/data"\nPRIVATE_VALUE=retained\n', '/old/data', '/new/data'), 'POLARIS_DATA_ROOT=/new/data\nPRIVATE_VALUE=retained\n');
  assert.throws(() => rebasePolarisEnvironment('POLARIS_DATA_ROOT=/unexpected\n', '/old/data', '/new/data'));
});

test('legacy execution-tree relocation fails before journals, physical moves or configuration writes', async t => {
  const { main } = await import('../scripts/app-data.mjs');
  const root = await mkdtemp(join(tmpdir(), 'praxis-legacy-unavailable-')); t.after(() => rm(root, { recursive: true, force: true }));
  const configRoot = join(root, 'config'); await mkdir(configRoot, { mode: 0o700 });
  const workspaceId = '11111111-1111-4111-8111-111111111111', deviceId = '22222222-2222-4222-8222-222222222222';
  const storage = { ...configuration(root), schemaVersion: 1, workspaceId, deviceId, activeWriterDeviceId: deviceId, repositories: [{ id: 'local', type: 'local', path: join(root, 'backups'), passwordFile: join(configRoot, 'key') }] };
  const business = { database: join(root, 'old/auth.db'), eventsDatabase: join(root, 'old/events.db'), observationsFile: join(root, 'old/observations.db'), apps: {} };
  const legacy = { enabled: true, dataRoot: join(root, 'legacy/data'), browserProfiles: join(root, 'legacy/browser'), browserCache: join(root, 'legacy/cache'), codexHome: join(root, 'legacy/codex') };
  await mkdir(legacy.dataRoot, { recursive: true }); const original = join(legacy.dataRoot, 'synthetic.txt'); await writeFile(original, 'Faithful synthetic archive stays in place.');
  const storageFile = join(configRoot, 'storage.json'), businessFile = join(configRoot, 'business.json'), legacyFile = join(configRoot, 'polaris.json');
  const raw = new Map([[storageFile, JSON.stringify(storage)], [businessFile, JSON.stringify(business)], [legacyFile, JSON.stringify(legacy)]]);
  await writeFile(join(configRoot, 'key'), 'Synthetic recovery key.', { mode: 0o600 });
  for (const [file, value] of raw) await writeFile(file, value, { mode: 0o600 });
  const plan = planAppData({ storage, business, polaris: legacy }); assert.equal(plan.unavailable[0].code, 'LEGACY_RELOCATION_UNAVAILABLE');
  await assert.rejects(main(['migrate', '--config', storageFile, '--business-config', businessFile, '--writers-stopped'], { print() {} }), /Legacy execution-tree relocation/);
  for (const [file, value] of raw) assert.equal(await readFile(file, 'utf8'), value);
  assert.equal(await readFile(original, 'utf8'), 'Faithful synthetic archive stays in place.');
  await assert.rejects(lstat(join(configRoot, 'data-migrations')), { code: 'ENOENT' });
});
