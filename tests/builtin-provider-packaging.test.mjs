import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
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
import { readApps } from '../src/apps.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const read = path => readFile(join(root, path), 'utf8');

test('platform image receives all seven installed provider modules through its reviewed build context', async () => {
  const catalog = (await readApps(root, { publicUrlsFile: null })).filter(app => app.builtin && app.kind === 'app');
  const dockerfile = await read('Dockerfile'), ignore = await read('.dockerignore');
  assert.equal(catalog.length, 7);
  assert.match(dockerfile, /^COPY --chown=node:node third_party\/ \.\/third_party\/$/m);
  assert.ok(ignore.includes('!config/installed-apps.json'));
  for (const app of catalog) for (const filename of ['praxis-app.json', 'praxis-provider.mjs', 'apps.example.json', 'package.json', 'package-lock.json', '**/*.md']) assert.ok(ignore.includes('!' + app.source + '/' + filename));
  for (const app of catalog) {
    assert.ok((await lstat(join(root, app.source, 'praxis-provider.mjs'))).isFile(), app.id);
    assert.ok((await lstat(join(root, app.source, 'praxis-app.json'))).isFile(), app.id);
  }
});

// Opt in only after the release image exists; no production volumes or networks are used.
if (process.env.PRAXIS_TEST_IMAGE) test('the built release image contains the complete app-owned catalog, providers and PRDs', { timeout: 60_000 }, async () => {
  const image = process.env.PRAXIS_TEST_IMAGE;
  assert.match(image, /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/);
  const script = `
    import assert from 'node:assert/strict';
    import { readFile, lstat } from 'node:fs/promises';
    import { resolve, dirname, relative } from 'node:path';
    import { readApps, resolveAppIcon } from './src/apps.mjs';
    import { AppProviderRegistry } from './src/business/app-providers.mjs';
    import { loadPrd } from './src/prd-catalog.mjs';
    const root = process.cwd(), apps = await readApps(root, { publicUrlsFile: null });
    assert.equal(apps.length, 7); assert.equal(new Set(apps.map(app => app.id)).size, 7);
    for (const app of apps) {
      assert.match(app.version, /^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/);
      const icon = await resolveAppIcon(root, app.icon, { apps });
      assert.ok(icon?.info.isFile(), app.id); assert.ok(icon.content.length, app.id);
      for (const locale of ['en', 'zh']) {
        const prd = await loadPrd(app.id, { root, locale });
        assert.equal(prd?.status, 'ready', app.id + ':' + locale); assert.equal(prd.appVersion, app.version);
      }
    }
    const providers = await new AppProviderRegistry({ root }).providers();
    assert.equal(providers.length, 7); assert.ok(providers.every(provider => !provider.error));
    assert.equal(providers.filter(provider => provider.descriptor.cards.supported).length, 6);
    assert.equal(providers.find(provider => provider.app.id === 'polaris').descriptor.cards.supported, false);
    console.log(JSON.stringify({ apps: apps.length, providers: providers.length, cardProviders: 13, icons: apps.length, prdEditions: apps.length * 2 }));
  `;
  const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
  const command = ['docker', 'run', '--rm', '--pull=never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--entrypoint', 'node', image, '--input-type=module', '-e', script].map(quote).join(' ');
  const { stdout } = await execute('sg', ['docker', '-c', command], { maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout.trim());
  assert.deepEqual(result, { apps: 7, providers: 7, cardProviders: 6, icons: 7, prdEditions: 14 });
});
test('native images use their app-owned Dockerfiles and preserve video engine availability', async () => {
  const nativeApps = DEFAULT_APP_REGISTRY.apps.filter(app => app.integration.deployment?.native);
  assert.equal(nativeApps.length, 5);
  for (const app of nativeApps) {
    const dockerfile = await readFile(join(DEFAULT_APP_REGISTRY.root, app.source, app.integration.deployment.native.dockerfile), 'utf8');
    assert.ok(dockerfile.includes('praxis-provider.mjs'), app.id);
    assert.ok(!dockerfile.includes('--from=platform'), app.id);
    assert.ok(!dockerfile.includes('Dockerfile.builtins'), app.id);
  }
  const owner = DEFAULT_APP_REGISTRY.apps.find(app => app.integration.deployment?.resolveModelCaches);
  const lattice = await readFile(join(DEFAULT_APP_REGISTRY.root, owner.source, owner.integration.deployment.native.dockerfile), 'utf8');
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
  const { stdout } = await execute(process.execPath, [join(DEFAULT_APP_REGISTRY.root, DEFAULT_APP_REGISTRY.apps.find(app => app.integration.deployment?.resolveModelCaches).source, 'praxis/packaging/prune-video-engines.mjs'), directory]);
  assert.equal(JSON.parse(stdout).videoEnginesUnavailable, true);
  for (const path of Object.keys(declarations)) assert.equal(await readFile(join(directory, path), 'utf8'), originals[path]);
  for (const name of ['remotion', 'hyperframes', '@remotion/cli', '.bin/remotion']) await assert.rejects(lstat(join(directory, 'node_modules', name)), { code: 'ENOENT' });
  assert.ok((await lstat(join(directory, 'node_modules/unrelated-runtime/index.js'))).isFile());
});
test('fresh provider defaults expose configured paths while excluding keys and avoiding fabricated physical mounts', async () => {
  const registry = new AppProviderRegistry(), providers = await registry.providers();
  const runtime = {
    projects: { PROJECTS_DATA_DIR: '/synthetic/projects' },
    tingproof: { TINGPROOF_DATA_DIR: '/synthetic/tingproof' }, slides: { SLIDES_BUSINESS_SPACES_FILE: '/synthetic/config/slides-spaces.json' },
    intelligence: { INTELLIGENCE_DATA_DIR: '/synthetic/intelligence' },
    polaris: { POLARIS_OBSERVATIONS_FILE: '/synthetic/polaris/observations.json' },
    letters: { PRAXIS_LETTERS_DIR: '/synthetic/letters/documents' }, profiles: { PRAXIS_PROFILES_DIR: '/synthetic/profiles/documents' },
  };
  const spaceMaps = { slides: { spaces: { synthetic: '/synthetic/slides/slides.json' } } };
  const appProviders = builtinProviderDefaults({ providers, runtime, spaceMaps, workingDirectories: Object.fromEntries(Object.keys(runtime).map(app => [app, '/app'])) });
  assert.equal(appProviders.intelligence.url, 'http://127.0.0.1:4330');
  const serialized = JSON.stringify(appProviders); assert.ok(!serialized.includes('BUSINESS_KEY_FILE')); assert.ok(!serialized.includes('/synthetic/private/key'));
  assert.ok(!serialized.includes('hostPath')); assert.ok(!serialized.includes('volumeName')); assert.ok(!serialized.includes('containerPath'));
  const config = { appProviders, apps: {} }, resolver = createDataSourceResolver({ config, root: registry.root });
  const inventory = await registry.inventory({ bindings: { apps: [] }, resolveDataSource: resolver });
  assert.equal(inventory.apps.length, 7);
  for (const [appId, sourceId, expected] of [
    ['intelligence', 'observations', '/synthetic/intelligence/intelligence.db'],
    ['lattice-slides', 'managed-decks:0', '/synthetic/slides/slides.json'],
  ]) {
    const locations = inventory.apps.find(app => app.id === appId).locations;
    const source = locations.find(location => location.id === sourceId || location.id?.startsWith(sourceId.split(':')[0] + ':'));
    assert.ok(source, appId); assert.equal(source.applicationPath, expected, appId); assert.equal(source.hostPath, undefined); assert.equal(source.containerPath, undefined);
  }
});
test('fresh defaults reject a provider attempting to describe a credential variable', () => {
  assert.throws(() => builtinProviderDefaults({ providers: [{ app: { id: 'synthetic' }, descriptor: { dataSources: [{ location: { env: 'SYNTHETIC_SECRET_KEY' } }] } }], runtime: { synthetic: { SYNTHETIC_SECRET_KEY: '/private/key' } } }), /unsafe data-location/);
});
