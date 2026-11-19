import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, rm, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AppProviderRegistry } from '../src/business/app-providers.mjs';
import { createDataSourceResolver } from '../src/business/provider-data.mjs';
import { builtinProviderDefaults } from '../scripts/builtin-install.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const read = path => readFile(join(root, path), 'utf8');

test('platform image receives all fourteen installed provider modules through its reviewed build context', async () => {
  const catalog = JSON.parse(await read('config/apps.json')).filter(app => app.builtin && app.kind === 'app');
  const dockerfile = await read('Dockerfile'), ignore = await read('.dockerignore');
  assert.equal(catalog.length, 14); assert.match(ignore, /^!third_party\/\*\/praxis-provider\.mjs$/m);
  for (const app of catalog) {
    assert.ok((await lstat(join(root, app.source, 'praxis-provider.mjs'))).isFile(), app.id);
    const moduleCopied = dockerfile.includes(`${app.source}/praxis-provider.mjs ./${app.source}/`);
    const appCopied = dockerfile.includes(`${app.source} ./${app.source}/`);
    assert.ok(moduleCopied || appCopied, `${app.id} provider must reach the platform image`);
  }
});
test('native image targets copy their own module after dependency installation and keep video pruning', async () => {
  const dockerfile = await read('Dockerfile.builtins');
  for (const target of ['reminder', 'knowledge', 'projects', 'finance', 'memo', 'intelligence', 'travel', 'tingproof', 'lattice']) {
    const stage = dockerfile.split(`FROM base AS ${target}\n`)[1]?.split('\nFROM ')[0];
    assert.ok(stage, target); const provider = stage.indexOf('COPY --chown=node:node praxis-provider.mjs ./');
    assert.ok(provider >= 0, target); assert.ok(provider > stage.indexOf('npm ci'), `${target} provider changes must not invalidate dependency installation`);
  }
  const lattice = dockerfile.split('FROM base AS lattice\n')[1].split('\nFROM ')[0];
  assert.match(lattice, /npm ci[^\n]*\\\n\s+&& node \/opt\/praxis\/scripts\/prune-video-engines\.mjs \/app/);
  assert.ok(lattice.lastIndexOf('RUN node /opt/praxis/scripts/prune-video-engines.mjs /app') > lattice.indexOf('RUN node /opt/praxis/scripts/build-slides-public.mjs'));
});
test('image video pruning removes only engine installations and preserves all declarations byte-for-byte', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-video-packaging-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const declarations = {
    'package.json': { name: 'lattice', type: 'module' }, 'package-lock.json': { name: 'lattice', lockfileVersion: 3 },
    'packages/cli/package.json': { name: 'synthetic-cli', devDependencies: { remotion: '0.0.0', hyperframes: '0.0.0' } },
    'packages/runtime/package.json': { name: 'synthetic-runtime' },
  };
  const originals = {};
  for (const [path, value] of Object.entries(declarations)) { await mkdir(join(directory, path, '..'), { recursive: true }); const bytes = JSON.stringify(value); await writeFile(join(directory, path), bytes); originals[path] = bytes; }
  for (const name of ['remotion', 'hyperframes', '@remotion/cli', 'unrelated-runtime']) {
    const folder = join(directory, 'node_modules', name); await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'package.json'), JSON.stringify({ name, main: 'index.js' })); await writeFile(join(folder, 'index.js'), 'throw new Error("Must never execute an engine");');
  }
  await mkdir(join(directory, 'node_modules/.bin')); await symlink('../remotion/index.js', join(directory, 'node_modules/.bin/remotion'));
  const { stdout } = await execute(process.execPath, [join(root, 'packaging/builtins/prune-video-engines.mjs'), directory]);
  assert.equal(JSON.parse(stdout).videoEnginesUnavailable, true);
  for (const path of Object.keys(declarations)) assert.equal(await readFile(join(directory, path), 'utf8'), originals[path]);
  for (const name of ['remotion', 'hyperframes', '@remotion/cli', '.bin/remotion']) await assert.rejects(lstat(join(directory, 'node_modules', name)), { code: 'ENOENT' });
  assert.ok((await lstat(join(directory, 'node_modules/unrelated-runtime/index.js'))).isFile());
});
test('fresh provider defaults expose configured paths while excluding keys and avoiding fabricated physical mounts', async () => {
  const registry = new AppProviderRegistry(), providers = await registry.providers();
  const runtime = {
    reminder: { REMINDER_BUSINESS_SPACES_FILE: '/synthetic/config/reminder-spaces.json', REMINDER_BUSINESS_KEY_FILE: '/synthetic/private/key' },
    knowledge: { KNOWLEDGE_DATA_DIR: '/synthetic/knowledge', KNOWLEDGE_INBOX_ROOT: '/synthetic/knowledge/inbox' },
    travel: { TRAVEL_DATA_DIR: '/synthetic/travel' }, projects: { PROJECTS_DATA_DIR: '/synthetic/projects' }, memo: { MEMO_DATA_DIR: '/synthetic/memo' },
    tingproof: { TINGPROOF_DATA_DIR: '/synthetic/tingproof' }, slides: { SLIDES_BUSINESS_SPACES_FILE: '/synthetic/config/slides-spaces.json' },
    finance: { FINANCE_DATA: '/synthetic/finance/finance.json' }, intelligence: { INTELLIGENCE_DATA_DIR: '/synthetic/intelligence' },
    polaris: { POLARIS_OBSERVATIONS_FILE: '/synthetic/polaris/observations.json' },
    letters: { PRAXIS_LETTERS_DIR: '/synthetic/letters/documents' }, profiles: { PRAXIS_PROFILES_DIR: '/synthetic/profiles/documents' },
  };
  const spaceMaps = { reminder: { spaces: { synthetic: '/synthetic/reminder/checklist.json' } }, slides: { spaces: { synthetic: '/synthetic/slides/slides.json' } } };
  const appProviders = builtinProviderDefaults({ providers, runtime, spaceMaps, workingDirectories: Object.fromEntries(Object.keys(runtime).map(app => [app, '/app'])) });
  assert.equal(appProviders.finance.url, 'http://127.0.0.1:4329'); assert.equal(appProviders.intelligence.url, 'http://127.0.0.1:4330');
  assert.deepEqual(appProviders.reminder.runtime.pathMaps.REMINDER_BUSINESS_SPACES_FILE, spaceMaps.reminder.spaces);
  const serialized = JSON.stringify(appProviders); assert.ok(!serialized.includes('BUSINESS_KEY_FILE')); assert.ok(!serialized.includes('/synthetic/private/key'));
  assert.ok(!serialized.includes('hostPath')); assert.ok(!serialized.includes('volumeName')); assert.ok(!serialized.includes('containerPath'));
  const config = { appProviders, apps: {} }, resolver = createDataSourceResolver({ config, root: registry.root });
  const inventory = await registry.inventory({ bindings: { apps: [] }, resolveDataSource: resolver });
  assert.equal(inventory.apps.length, 14);
  for (const [appId, sourceId, expected] of [
    ['finance', 'ledger', '/synthetic/finance/finance.json'], ['intelligence', 'observations', '/synthetic/intelligence/data.json'],
    ['reminder', 'managed-records:0', '/synthetic/reminder/checklist.json'], ['lattice-slides', 'managed-decks:0', '/synthetic/slides/slides.json'],
  ]) {
    const locations = inventory.apps.find(app => app.id === appId).locations;
    const source = locations.find(location => location.id === sourceId || location.id?.startsWith(sourceId.split(':')[0] + ':'));
    assert.ok(source, appId); assert.equal(source.applicationPath, expected, appId); assert.equal(source.hostPath, undefined); assert.equal(source.containerPath, undefined);
  }
});
test('fresh defaults reject a provider attempting to describe a credential variable', () => {
  assert.throws(() => builtinProviderDefaults({ providers: [{ app: { id: 'synthetic' }, descriptor: { dataSources: [{ location: { env: 'SYNTHETIC_SECRET_KEY' } }] } }], runtime: { synthetic: { SYNTHETIC_SECRET_KEY: '/private/key' } } }), /unsafe data-location/);
});
