import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppProviderRegistry, normalizeProviderCard, normalizeProviderLocation, providerHref, validateProviderResult } from '../src/business/app-providers.mjs';
import { AppCards } from '../src/business/app-cards.mjs';
import { CardPreferences } from '../src/business/card-preferences.mjs';

const instant = Date.parse('2026-11-19T12:00:00.000Z');
function card(appId = 'projects', overrides = {}) {
  return { id: 'synthetic-object', appId, spaceId: 'synthetic-space', resourceId: 'record-1', revision: '3:7', kind: 'result', title: 'Fictional source result',
    preview: 'The observation is recorded in the fictional source.', reason: 'Saved result', source: { name: 'Synthetic app' },
    primaryAction: { label: 'Open original', href: `/apps/${appId}/?item=record-1` },
    evidence: [{ label: 'Source passage', excerpt: 'A fictional observation.', revision: '7', href: `/apps/${appId}/?item=record-1` }], ...overrides };
}
const rejectsProvider = action => assert.throws(action, { code: 'INVALID_APP_PROVIDER' });

test('card DTO preserves a real opaque revision, native action and bilingual reason', () => {
  const output = normalizeProviderCard('projects', card('projects', { labels: { zh: { reason: '已保存的结果' } }, primaryAction: { label: 'Open original', labels: { zh: '打开原文' }, href: '/apps/projects/#project=fictional&item=record-1' } }));
  assert.equal(output.id, 'projects:synthetic-object'); assert.equal(output.revision, '3:7');
  assert.deepEqual(output.reason, { en: 'Saved result', zh: '已保存的结果' });
  assert.deepEqual(output.primaryAction.label, { en: 'Open original', zh: '打开原文' });
  assert.equal(output.evidence[0].excerpt, 'A fictional observation.');
});
test('card DTO requires nonempty resource identity and reason with a source-identity fallback', () => {
  for (const value of [undefined, '', null]) {
    rejectsProvider(() => normalizeProviderCard('projects', card('projects', { resourceId: value })));
    rejectsProvider(() => normalizeProviderCard('projects', card('projects', { reason: value })));
  }
  const output = normalizeProviderCard('projects', card('projects', { resourceId: undefined, spaceId: undefined, source: { name: 'Synthetic app', resourceId: 'source-record', spaceId: 'source-space' } }));
  assert.equal(output.resourceId, 'source-record'); assert.equal(output.spaceId, 'source-space');
});
test('card DTO rejects cross-app identity, oversized fields and malformed versions', () => {
  for (const patch of [
    { appId: 'tingproof' }, { revision: 3 }, { revision: '' }, { revision: null }, { revision: 'x'.repeat(257) },
    { title: 'x'.repeat(1001) }, { preview: 'x'.repeat(8001) }, { resourceId: 'x'.repeat(513) },
    { kind: 'manager-score' }, { reason: { en: 'Source', zh: '' } }, { evidence: Array.from({ length: 25 }, () => ({ label: 'Too many' })) },
  ]) rejectsProvider(() => normalizeProviderCard('projects', card('projects', patch)));
});
test('primary actions stay inside the owning native app and reject dangerous paths', () => {
  assert.equal(providerHref('lattice-slides', '/apps/slides/?deck=synthetic'), '/apps/slides/?deck=synthetic');
  for (const href of ['https://source.example/document', '//source.example/document', '/apps/memo/', '/auth/logout', 'javascript:alert(1)', '/apps/projects/%2fprivate', '/apps/projects/a/%2e%2e/']) {
    rejectsProvider(() => normalizeProviderCard('projects', card('projects', { primaryAction: { label: 'Open', href } })));
  }
});
test('evidence retains cross-app and HTTPS source links without granting or fetching the target', () => {
  const evidence = [
    { label: 'Referenced source', href: '/apps/tingproof/a/synthetic/assignment/note/', revision: '2' },
    { label: 'Original publication', href: 'https://source.example/document#section', excerpt: 'Stored source excerpt.' },
  ];
  assert.deepEqual(normalizeProviderCard('projects', card('projects', { evidence })).evidence, evidence);
  for (const href of ['javascript:alert(1)', 'data:text/html,example', 'file:///synthetic/private', '//source.example/document', 'https://user:password@source.example/document', '/apps/travel/a/%2e%2e/', '/auth/session']) {
    rejectsProvider(() => normalizeProviderCard('projects', card('projects', { evidence: [{ label: 'Invalid source', href }] })));
  }
});
test('dueDate aliases normalize without changing the source record or date precision', () => {
  for (const date of ['2026', '2026-11', '2026-11-20', '2026-11-20T09:30:00.000Z']) {
    const source = Object.freeze(card('projects', { dueDate: date }));
    const output = normalizeProviderCard('projects', source);
    assert.equal(output.date, date); assert.equal(source.dueDate, date); assert.equal(source.date, undefined);
  }
  rejectsProvider(() => normalizeProviderCard('projects', card('projects', { dueDate: 'not-a-calendar-date' })));
});
test('provider result and inventory DTOs distinguish unsupported, empty and failure safely', () => {
  for (const status of ['ready', 'empty', 'partial', 'unsupported', 'unavailable']) assert.equal(validateProviderResult({ status, items: [] }).status, status);
  rejectsProvider(() => validateProviderResult({ status: 'pretend-success', items: [] }));
  rejectsProvider(() => validateProviderResult({ status: 'ready', items: new Array(1001) }));
  rejectsProvider(() => normalizeProviderLocation({ label: 'Browser data', kind: 'browser', hostPath: '/synthetic/private' }));
  assert.deepEqual(normalizeProviderLocation({ label: 'Device data', kind: 'browser', storageKey: 'synthetic.records', secret: 'excluded' }), { label: 'Device data', kind: 'browser', storageKey: 'synthetic.records' });
});

async function providerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-provider-contract-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'config'));
  const apps = [];
  async function catalog() { await writeInstalledAppsFixture(root, apps); }
  async function add(id, { name = id, version = 1, label = `${id} owned records`, env = `${id.toUpperCase()}_DATA`, altered = false } = {}) {
    const app = { id, name, builtin: true, kind: 'app', source: `third_party/${id}` }; apps.push(app);
    const directory = join(root, app.source); await mkdir(directory, { recursive: true });
    const descriptor = { version, appId: id, cards: { supported: true }, dataSources: [{ id: 'records', label, kind: 'json', location: { env } }] };
    const requested = altered ? { ...descriptor.dataSources[0], location: { env: 'UNDECLARED_DATA' } } : descriptor.dataSources[0];
    await writeFile(join(directory, 'praxis-provider.mjs'), `
      const descriptor = ${JSON.stringify(descriptor)};
      export const describe = () => structuredClone(descriptor);
      export const getCards = async () => ({status:'empty',items:[]});
      export async function getDataInventory(context) {
        const value = await context.resolveDataSource(${JSON.stringify(requested)});
        return {status:'ready',items:[{id:'records',label:descriptor.dataSources[0].label,kind:'json',...value}]};
      }
    `);
    await catalog(); return app;
  }
  return { root, apps, add, catalog, registry: new AppProviderRegistry({ root }) };
}
test('registry follows catalog additions and removals while isolating one missing provider', async t => {
  const fixture = await providerFixture(t); await fixture.add('acorn');
  assert.deepEqual((await fixture.registry.providers()).map(value => value.app.id), ['acorn']);
  await fixture.add('birch'); fixture.apps.push({ id: 'missing', name: 'Unavailable app', builtin: true, kind: 'app', source: 'third_party/missing' }); await fixture.catalog();
  const providers = await fixture.registry.providers();
  assert.deepEqual(providers.map(value => value.app.id), ['acorn', 'birch', 'missing']); assert.equal(providers[2].error, 'PROVIDER_UNAVAILABLE');
  fixture.apps.splice(0, 1); await fixture.catalog();
  assert.deepEqual((await fixture.registry.providers()).map(value => value.app.id), ['birch', 'missing']);
});
test('cached provider modules do not retain stale catalog names', async t => {
  const fixture = await providerFixture(t); await fixture.add('acorn', { name: 'Original name' }); await fixture.registry.providers();
  fixture.apps[0].name = 'Renamed native app'; await fixture.catalog();
  assert.equal((await fixture.registry.providers())[0].app.name, 'Renamed native app');
});
test('unsupported provider contract versions fail only their own catalog entry', async t => {
  const fixture = await providerFixture(t); await fixture.add('acorn');
  for (const [index, version] of [0, 2, '1', null].entries()) await fixture.add(`future${index}`, { version });
  const providers = await fixture.registry.providers();
  assert.equal(providers[0].descriptor.version, 1);
  assert.ok(providers.slice(1).every(provider => provider.error === 'PROVIDER_UNAVAILABLE'));
});
test('data inventory comes from dynamic app descriptors rather than a fixed application table', async t => {
  const fixture = await providerFixture(t); await fixture.add('acorn', { label: 'Acorn-owned evidence' }); await fixture.add('birch', { label: 'Birch-owned archive' });
  const calls = [];
  const inventory = await fixture.registry.inventory({ clock: () => instant, resolveDataSource: async (source, context) => {
    calls.push({ appId: context.app.id, source }); return { hostPath: `/synthetic/${context.app.id}/records.json`, status: 'ready' };
  } });
  assert.deepEqual(inventory.apps.map(value => value.id), ['acorn', 'birch']);
  assert.deepEqual(inventory.apps.map(value => value.locations[0].label), ['Acorn-owned evidence', 'Birch-owned archive']);
  assert.deepEqual(calls.map(value => value.source.location.env), ['ACORN_DATA', 'BIRCH_DATA']); assert.equal(inventory.partial, false);
});
test('a provider cannot request undeclared data-source metadata or hide its failure', async t => {
  const fixture = await providerFixture(t); await fixture.add('acorn'); await fixture.add('tampered', { altered: true }); let resolutions = 0;
  const inventory = await fixture.registry.inventory({ resolveDataSource: async () => { resolutions++; return { status: 'ready' }; } });
  assert.equal(resolutions, 1); assert.equal(inventory.partial, true);
  assert.equal(inventory.sources.find(value => value.appId === 'acorn').status, 'ready'); assert.equal(inventory.sources.find(value => value.appId === 'tampered').status, 'unavailable');
  assert.deepEqual(inventory.apps.find(value => value.id === 'tampered').locations, []);
});

function projectionFixture(module, { readOperations = ['list'], permitted = ['record-1'] } = {}) {
  let allowed = ['tingproof'], calls = 0;
  const auth = {
    requireNativeSession: token => { assert.equal(token, 'synthetic-native'); return { user: { id: 'alice', username: 'alice' } }; },
    getWebAccess: () => ({ workbench: true, apps: [...allowed] }), userPermissions: () => permitted,
    authorize: (_token, request) => { if (!permitted.includes(request.resourceId)) throw Object.assign(new Error('denied'), { status: 403 }); },
  };
  const descriptor = { version: 1, appId: 'tingproof', cards: { supported: true }, readOperations, dataSources: [] };
  const registry = { providers: async () => [{ app: { id: 'tingproof' }, module, descriptor }] };
  const bridge = { invokeProjection: async () => { calls++; return { items: [] }; } };
  return { api: new AppCards({ auth, bridge, registry, config: { apps: { tingproof: { spaces: ['synthetic-space'] } } }, clock: () => instant }), bridge,
    calls: () => calls, withdraw: () => { allowed = []; } };
}
test('card aggregation rechecks resource permissions and cannot reveal an ungranted record', async () => {
  const fixture = projectionFixture({ getCards: async () => ({ status: 'ready', items: [card('tingproof'), card('tingproof', { id: 'secret', resourceId: 'ungranted', title: 'Other user confidential title' })] }) });
  const value = await fixture.api.get('synthetic-native'); assert.equal(value.items.length, 1);
  assert.ok(!JSON.stringify(value).includes('Other user confidential title'));
});
test('an installed source without an adapter reports unavailable rather than a genuine empty store', async () => {
  let reads = 0;
  const fixture = projectionFixture({ getCards: async () => { reads++; return { status: 'empty', items: [] }; } });
  fixture.api.config.apps = {};
  const output = await fixture.api.get('synthetic-native');
  assert.equal(reads, 0); assert.deepEqual(output.items, []);
  assert.equal(output.sources[0].status, 'unavailable');
  assert.equal(output.sources[0].code, 'APP_SOURCE_NOT_CONFIGURED');
});
test('provider read callbacks cannot invoke a mutation even if a provider declares it', async () => {
  const fixture = projectionFixture({ getCards: async context => {
    await context.invoke({ spaceId: 'synthetic-space', operation: 'update', resourceId: 'record-1', input: { text: 'Must not execute' } });
    return { status: 'empty', items: [] };
  } }, { readOperations: ['list', 'update'] });
  const output = await fixture.api.get('synthetic-native'); assert.equal(fixture.calls(), 0); assert.deepEqual(output.items, []); assert.equal(output.sources[0].status, 'denied');
});
test('withdrawal while a source read is in flight removes its titles, evidence and counts', async () => {
  const fixture = projectionFixture({ getCards: async context => {
    await context.invoke({ spaceId: 'synthetic-space', operation: 'list_assignments', input: {} });
    return { status: 'ready', items: [card('tingproof', { title: 'Revoked source title' })] };
  } }, { readOperations: ['list_assignments'] });
  fixture.bridge.invokeProjection = async () => { fixture.withdraw(); return { items: [] }; };
  const output = await fixture.api.get('synthetic-native'); assert.deepEqual(output.items, []); assert.deepEqual(output.sources, []); assert.ok(!JSON.stringify(output).includes('Revoked source title'));
});

async function preferenceFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-card-preferences-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'preferences.sqlite'); let db = new DatabaseSync(file), now = instant;
  const create = database => new CardPreferences({ db: database, clock: () => now }); let preferences = create(db);
  t.after(() => db.close());
  return { get preferences() { return preferences; }, get db() { return db; }, file, clock: value => { now = value; }, create,
    reopen() { db.close(); db = new DatabaseSync(file); preferences = create(db); return preferences; } };
}
const preference = overrides => ({ cardId: 'projects:synthetic-space:record-1', cardRevision: '3:7', state: 'hidden', expectedRevision: 0, idempotencyKey: 'synthetic-key', ...overrides });
test('card preferences isolate owners including identical card IDs and retry keys', async t => {
  const fixture = await preferenceFixture(t), store = fixture.preferences;
  store.set('alice', preference()); assert.deepEqual(store.get('bob'), { revision: 0, items: [] });
  store.set('bob', preference()); store.set('alice', preference({ state: 'visible', expectedRevision: 1, idempotencyKey: 'alice-visible' }));
  assert.deepEqual(store.get('alice'), { revision: 2, items: [] }); assert.equal(store.get('bob').items[0].state, 'hidden');
});
test('Later and Hide persist across reopen while expired deferrals disappear only from personal presentation', async t => {
  const fixture = await preferenceFixture(t), until = new Date(instant + 3600000).toISOString();
  fixture.preferences.set('alice', preference({ state: 'later', until }));
  const before = fixture.preferences.get('alice'); assert.equal(before.items[0].until, until);
  assert.deepEqual(fixture.reopen().get('alice'), before);
  fixture.clock(instant + 3600000); assert.deepEqual(fixture.preferences.get('alice'), { revision: 1, items: [] });
  fixture.preferences.set('alice', preference({ state: 'hidden', expectedRevision: 1, idempotencyKey: 'hide-after-later' }));
  assert.equal(fixture.reopen().get('alice').items[0].state, 'hidden');
});
test('two preference writers reject a stale revision with 409 and retain the committed choice', async t => {
  const fixture = await preferenceFixture(t), secondDb = new DatabaseSync(fixture.file); t.after(() => secondDb.close()); const second = fixture.create(secondDb);
  assert.equal(second.get('alice').revision, 0); fixture.preferences.set('alice', preference());
  let conflict;
  try { second.set('alice', preference({ state: 'visible', idempotencyKey: 'stale-writer' })); } catch (error) { conflict = error; }
  assert.equal(conflict?.status, 409); assert.equal(conflict?.code, 'PREFERENCE_REVISION_CONFLICT'); assert.equal(conflict.current.revision, 1);
  assert.equal(fixture.preferences.get('alice').items[0].state, 'hidden');
});
test('idempotent preference retry has one effect and changed-input key reuse is rejected', async t => {
  const fixture = await preferenceFixture(t), request = preference();
  const first = fixture.preferences.set('alice', request); assert.deepEqual(fixture.preferences.set('alice', request), first); assert.equal(first.revision, 1);
  assert.throws(() => fixture.preferences.set('alice', { ...request, state: 'visible' }), { status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(fixture.preferences.get('alice'), first);
});
test('caller-selected owners and business mutations are not accepted as preference fields', async t => {
  const fixture = await preferenceFixture(t);
  for (const extra of [{ userId: 'bob' }, { ownerId: 'bob' }, { date: '2027-01-01' }, { done: true }, { resourceId: 'other-resource' }]) {
    assert.throws(() => fixture.preferences.set('alice', preference(extra)), { status: 400, code: 'INVALID_PREFERENCE' });
  }
  assert.throws(() => fixture.preferences.set('', preference()), { status: 401 }); assert.deepEqual(fixture.preferences.get('bob'), { revision: 0, items: [] });
});
test('deferral time validation and undo never change source deadline, assignment or completion', async t => {
  const fixture = await preferenceFixture(t);
  fixture.db.exec('CREATE TABLE synthetic_business_record(id TEXT PRIMARY KEY,date TEXT,owner TEXT,done INTEGER)');
  fixture.db.prepare('INSERT INTO synthetic_business_record VALUES(?,?,?,?)').run('record-1', '2026-11-20', 'alice', 0);
  const before = fixture.db.prepare('SELECT * FROM synthetic_business_record').all();
  for (const until of ['not-a-date', new Date(instant).toISOString(), new Date(instant + 367 * 86400000).toISOString()]) {
    assert.throws(() => fixture.preferences.set('alice', preference({ state: 'later', until })), { status: 400, code: 'INVALID_PREFERENCE_TIME' });
  }
  const until = new Date(instant + 3600000).toISOString(); fixture.preferences.set('alice', preference({ state: 'later', until }));
  fixture.preferences.set('alice', preference({ state: 'visible', expectedRevision: 1, idempotencyKey: 'undo-deferral' }));
  assert.deepEqual(fixture.db.prepare('SELECT * FROM synthetic_business_record').all(), before); assert.deepEqual(fixture.preferences.get('alice').items, []);
});
