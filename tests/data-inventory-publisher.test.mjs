import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataInventory, inspectIntelligenceRuntime, main } from '../scripts/data-inventory.mjs';

const stamp = '2026-11-18T00:00:00.000Z';
const app = (id, name = id) => ({ id, name, kind: 'app', source: `third_party/${id}` });

test('publisher covers split app stores without serializing configuration secrets or payloads', () => {
  const value = createDataInventory({
    registry: ['reminder', 'knowledge', 'travel', 'projects', 'memo', 'tingproof', 'lattice-slides', 'future'].map(id => app(id)),
    sourceRoot: '/example/source', now: stamp,
    business: { database: '/example/platform/auth.db', eventsDatabase: '/example/platform/events.db', privateToken: 'DO_NOT_INCLUDE_SECRET', apps: {
      knowledge: { dataDir: '/example/data/knowledge', keyFile: '/example/secrets/key' },
      projects: { dataDir: '/example/data/projects' }, memo: { dataDir: '/example/data/memo' },
      travel: { dataDir: '/example/data/travel' }, slides: { dataDir: '/example/data/slides' },
    } },
    reminderSpaces: { spaces: { one: '/example/data/reminder/one.json', two: '/example/data/other/two.json' } },
    slidesSpaces: { spaces: { one: '/example/data/slides/one.json' } },
    storage: { appSources: [
      { id: 'reminder', source: '/example/data/reminder/one.json', kind: 'json' },
      { id: 'tingproof', source: '/example/data/audio/tingproof.db', kind: 'sqlite' },
      { id: 'slides', source: '/example/native/decks', target: 'decks', kind: 'directory' },
      { id: 'slides', source: '/example/native/.lattice', target: '.lattice', kind: 'directory' },
    ] },
    polaris: { dataRoot: '/example/data/polaris', browserProfiles: '/example/browser/state', browserCache: '/example/browser/cache', envFile: '/example/secrets/.env', codexAuthFile: '/example/secrets/auth.json' },
  });
  const find = id => value.apps.find(item => item.id === id);
  assert.equal(find('reminder').locations.length, 2);
  assert.equal(find('knowledge').locations[0].hostPath, '/example/data/knowledge/knowledge.db');
  assert.equal(find('memo').locations.filter(item => item.kind === 'browser').length, 2);
  assert.equal(find('memo').locations[0].hostPath, '/example/data/memo/memo.db');
  assert.equal(find('lattice-slides').locations.length, 4);
  assert.equal(find('tingproof').locations.find(item => item.label === '原始音频').kind, 'unknown');
  assert.equal(find('tingproof').locations.find(item => item.kind === 'browser').storageKey, 'IndexedDB: tingproof');
  assert.equal(find('future').locations[0].kind, 'unknown');
  assert.ok(find('polaris')); assert.ok(find('praxis'));
  assert.ok(!JSON.stringify(value).includes('DO_NOT_INCLUDE_SECRET'));
  assert.ok(!JSON.stringify(value).includes('/example/secrets/'));
});

test('sensitive files cannot be reclassified as app data through configuration fields', () => {
  const value = createDataInventory({ registry: [app('reminder')], reminderSpaces: { spaces: { one: '/example/.codex/auth.json', two: '/example/secrets/provider.json', three: '/example/private.key' } }, now: stamp });
  assert.equal(value.apps[0].locations[0].kind, 'unknown');
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'data-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'source'), home = join(root, 'home'), base = join(home, '.config/praxis');
  await mkdir(join(sourceRoot, 'config'), { recursive: true }); await mkdir(base, { recursive: true, mode: 0o700 });
  const save = async (path, value, mode = 0o600) => { await writeFile(path, JSON.stringify(value), { mode }); return path; };
  await writeInstalledAppsFixture(sourceRoot, [app('reminder'), app('memo')]);
  const spacesFile = await save(join(base, 'spaces.json'), { spaces: { one: join(root, 'nonexistent-records/one.json') } });
  const businessFile = await save(join(base, 'business.json'), { apps: { reminder: { spacesFile }, memo: { dataDir: join(root, 'nonexistent-memo') } } });
  const storageFile = await save(join(base, 'storage.json'), { workspaceId: 'example', appSources: [] });
  const outputFile = join(base, 'data-inventory/locations.json');
  return { root, sourceRoot, home, base, businessFile, storageFile, outputFile, options: { sourceRoot, home, now: stamp, runDocker: async () => '', print: () => {} } };
}

test('CLI publishes bounded private metadata without opening any configured business records', async t => {
  const f = await fixture(t);
  const result = await main(['publish'], f.options);
  assert.equal(result.published, true); assert.equal(result.apps, 3);
  const value = JSON.parse(await readFile(f.outputFile, 'utf8'));
  assert.equal(value.apps[0].locations[0].hostPath, join(f.root, 'nonexistent-records/one.json'));
  assert.equal((await lstat(f.outputFile)).mode & 0o777, 0o600);
  assert.equal((await lstat(join(f.base, 'data-inventory'))).mode & 0o777, 0o700);
  await main(['publish'], f.options);
  assert.equal(JSON.parse(await readFile(f.outputFile, 'utf8')).generatedAt, stamp);
});

test('CLI rejects destinations inside source, private credentials, live data or input files', async t => {
  const f = await fixture(t);
  const config = JSON.parse(await readFile(f.businessFile, 'utf8'));
  const mapping = join(f.base, 'another-app/config.json');
  config.apps.travel = { businessConfigFile: mapping };
  await writeFile(f.businessFile, JSON.stringify(config), { mode: 0o600 });
  const original = await readFile(f.businessFile, 'utf8');
  for (const output of [join(f.sourceRoot, 'inventory.json'), join(f.home, '.codex/auth.json'), f.businessFile, mapping, join(f.root, 'nonexistent-memo/inventory.json')]) {
    await assert.rejects(main(['publish', '--output', output], f.options));
  }
  assert.equal(await readFile(f.businessFile, 'utf8'), original);
  await mkdir(join(f.base, 'data-inventory'), { mode: 0o700 });
  await symlink(f.businessFile, f.outputFile);
  await assert.rejects(main(['publish'], f.options));
  assert.equal(await readFile(f.businessFile, 'utf8'), original);
});

test('unregistered optional app configurations produce explicit unknown locations', async t => {
  const f = await fixture(t);
  await rm(f.businessFile); await rm(f.storageFile);
  await main(['publish'], f.options);
  const value = JSON.parse(await readFile(f.outputFile, 'utf8'));
  assert.equal(value.apps.find(item => item.id === 'reminder').locations[0].kind, 'unknown');
});


test('workspace prefix comes from authoritative configuration without shortening stored paths', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const dataRoot = '/example/private/praxis', workspaceRoot = join(dataRoot, 'workspaces', workspaceId);
  const hostPath = join(workspaceRoot, 'apps/memo/memo.db');
  const value = createDataInventory({ registry: [app('memo')], storage: { dataRoot, workspaceId }, business: { apps: { memo: { dataDir: join(workspaceRoot, 'apps/memo') } } }, now: stamp });
  assert.equal(value.workspaceRoot, workspaceRoot);
  assert.equal(value.apps[0].locations[0].hostPath, hostPath);
  for (const storage of [{ dataRoot, workspaceId: '../other' }, { dataRoot: '../relative', workspaceId }, { dataRoot: '/example/secrets/private', workspaceId }, { workspaceId }]) {
    assert.equal(createDataInventory({ registry: [app('memo')], storage, now: stamp }).workspaceRoot, undefined);
  }
});


test('Intelligence inventory distinguishes explicit preview from verified readonly working data', () => {
  const common = { registry: [app('intelligence')], sourceRoot: '/example/source', now: stamp };
  const preview = createDataInventory({ ...common, intelligenceRuntime: { preview: true } }).apps[0].locations;
  assert.equal(preview.length, 1); assert.equal(preview[0].kind, 'source');
  assert.equal(preview[0].hostPath, '/example/source/third_party/intelligence/fixtures/preview.json');
  const working = createDataInventory({ ...common, intelligenceRuntime: { preview: false, hostPath: '/example/private/intelligence' } }).apps[0].locations;
  assert.equal(working[0].hostPath, '/example/private/intelligence/intelligence.db');
  assert.equal(working[0].containerPath, '/data/intelligence/intelligence.db');
  assert.equal(createDataInventory(common).apps[0].locations[0].kind, 'unknown');
});
test('Intelligence runtime discovery is bounded to one trusted service and readonly mount metadata', async () => {
  const calls = [];
  const runtime = async metadata => inspectIntelligenceRuntime({ workspaceId: 'example' }, async args => {
    calls.push(args); return args[0] === 'ps' ? 'abc123abc123' : JSON.stringify(metadata);
  });
  assert.deepEqual(await runtime({ environment: ['INTELLIGENCE_PREVIEW=1', 'UNRELATED=not-exported'], mounts: [] }), { preview: true });
  assert.ok(calls[0].includes('label=com.docker.compose.service=intelligence'));
  const metadata = { environment: ['INTELLIGENCE_PREVIEW=0'], mounts: [{ Type: 'bind', Source: '/example/private/intelligence', Destination: '/data/intelligence', RW: false }] };
  assert.deepEqual(await runtime(metadata), { preview: false, hostPath: '/example/private/intelligence' });
  metadata.mounts[0].RW = true; assert.equal(await runtime(metadata), undefined);
  assert.equal(await inspectIntelligenceRuntime({ workspaceId: 'example' }, async () => { throw new Error('Synthetic failure'); }), undefined);
});
