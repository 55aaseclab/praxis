import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';
// HTTP wiring fixtures only: native app behavior is verified in each owning repo.
// Never contact installed native services, including a default Memo port.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AuthStore, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { createPraxisServer } from '../src/server.mjs';

const networkFetch = globalThis.fetch;
const ambientRequests = [];
globalThis.fetch = async input => { ambientRequests.push(String(input?.url || input)); throw new Error('Ambient network is forbidden in synthetic provider wiring tests.'); };
after(() => { globalThis.fetch = networkFetch; });
const password = 'Synthetic native account password 2026';
const cardPath = '/api/business/workbench/attention';
const preferencePath = '/api/business/workbench/preferences';
const dataPath = '/api/business/console/data';
const nativeRecord = { resourceId: 'allowed-record', text: 'Synthetic source note', date: '2026-11-20', done: false };
function deferred() { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; }
function syntheticProvider(appId, { label = 'Synthetic data location', broken = false, browser = false } = {}) {
  const descriptor = { version: 1, appId, name: appId, cards: { supported: true, ...(browser && { execution: 'browser' }) }, ...(appId !== 'reminder' && !browser && { resourceMode: 'native-view', nativeResourceId: 'overview', nativeReads: ['/api/data'] }), readOperations: appId === 'reminder' ? ['list'] : [], dataSources: [{ id: 'browser', label, kind: 'browser', location: { kind: 'browser', storageKey: `synthetic.${appId}` } }] };
  return `const descriptor=${JSON.stringify(descriptor)};
export function describe(){return structuredClone(descriptor)}
function card(resourceId,title,date){return{id:${JSON.stringify(appId + ':sample:')}+resourceId,appId:${JSON.stringify(appId)},spaceId:'synthetic-space',resourceId,revision:'1',kind:'result',title,reason:{en:'A synthetic source result.',zh:'合成来源结果。'},source:{name:${JSON.stringify(appId)}},...(date?{date}:{}),primaryAction:{label:{en:'Open result',zh:'打开结果'},href:'/apps/${appId}/#record='+encodeURIComponent(resourceId)},evidence:[]}}
export async function getCards(context){${browser ? "return{status:'empty',items:[]}" : appId === 'reminder' ? "const value=await context.invoke({spaceId:'synthetic-space',operation:'list',input:{}});return{status:'ready',items:value.items.map(row=>card(row.resourceId,row.item.text,row.item.date))}" : "const value=await context.readNative({path:'/api/data',resourceId:'overview'});return{status:'ready',items:[card('overview',value.title)]}"}}
export async function getDataInventory(context){${broken ? "throw Error('Synthetic private implementation details')" : "const source=descriptor.dataSources[0],location=await context.resolveDataSource(structuredClone(source));return{status:'ready',items:[{label:source.label,kind:source.kind,...location}]}"}}
`;
}
async function fixture(t, { nativeIntelligence = false, privateReaders = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-provider-http-'));
  const state = join(root, 'state'); await mkdir(join(root, 'config')); await mkdir(state, { mode: 0o700 });
  const catalog = ['reminder', 'intelligence', 'calendar', ...(privateReaders ? ['matrix-reader', 'letters', 'profiles'] : [])].map(id => ({ id, kind: 'app', builtin: true, name: id, source: `third_party/${id}`, path: '/', icon: `/${id}-icon.svg`, ...(['letters', 'profiles'].includes(id) && { adminOnly: true }) }));
  async function saveCatalog() { await writeInstalledAppsFixture(root, catalog); }
  async function writeProvider(id, options = {}) { await mkdir(join(root, `third_party/${id}`), { recursive: true }); await writeFile(join(root, `third_party/${id}/praxis-provider.mjs`), syntheticProvider(id, { browser: ['calendar', 'matrix-reader', 'letters', 'profiles'].includes(id), ...options })); }
  await saveCatalog(); for (const { id } of catalog) await writeProvider(id);
  const reserved = createServer(); reserved.listen(0, '127.0.0.1'); await once(reserved, 'listening'); const webPort = reserved.address().port; await new Promise(resolve => reserved.close(resolve));
  const issuer = `http://127.0.0.1:${webPort}`;
  const config = { issuer, providerRoot: root, database: join(state, 'auth.sqlite'), eventsDatabase: join(state, 'events.sqlite'), observationsFile: null, webGateway: { enabled: true }, allowedHosts: [], allowedOrigins: [], apps: { reminder: { url: 'https://synthetic-adapter.example.test/api/business', key: Buffer.alloc(32, 7), spaces: ['synthetic-space'] } }, appProviders: { ...(nativeIntelligence && { intelligence: { url: 'https://synthetic-native.example.test/' } }), ...(privateReaders && { letters: { ownerId: 'administrator' }, profiles: { ownerId: 'administrator' } }) } };
  let auth = new AuthStore({ file: config.database, issuer }), core, web, coreOrigin;
  const sourceCalls = [], releases = new Set(); let respond;
  const sourceFetch = async (input, options = {}) => {
    const url = new URL(input); assert.ok(['https://synthetic-adapter.example.test', 'https://synthetic-native.example.test'].includes(url.origin), 'Only explicit synthetic sources may be called.');
    const body = options.body ? JSON.parse(options.body) : null;
    sourceCalls.push({ url: url.href, method: options.method || 'GET', body });
    if (respond) return respond(url, options, body);
    if (url.origin === 'https://synthetic-native.example.test') return new Response(JSON.stringify({ title: 'Synthetic native Intelligence result' }), { headers: { 'Content-Type': 'application/json' } });
    assert.equal(body.operation, 'list');
    return new Response(JSON.stringify({ spaceId: 'synthetic-space', revision: 'snapshot-one', items: [nativeRecord, { resourceId: 'denied-record', text: 'Synthetic denied source note', date: '2026-11-21', done: false }].map(item => ({ resourceId: item.resourceId, revision: '1', collection: 'plans', item: { text: item.text, date: item.date, done: item.done } })) }), { headers: { 'Content-Type': 'application/json' } });
  };
  const users = {};
  for (const id of ['owner-a', 'owner-b', 'administrator']) users[id] = auth.createUser({ id, username: `synthetic-${id}`, password });
  auth.setPlatformAdmin({ userId: 'administrator', enabled: true });
  for (const id of ['owner-a', 'owner-b']) auth.setWebAccess({ userId: id, apps: ['reminder', 'intelligence', 'calendar'], workbench: true, prds: false });
  auth.createSpace({ id: 'synthetic-space', type: 'company', ownerId: 'administrator' });
  auth.setMembership({ spaceId: 'synthetic-space', userId: 'owner-a', role: 'member' });
  const permission = auth.grantResource({ userId: 'owner-a', spaceId: 'synthetic-space', appId: 'reminder', resources: ['allowed-record'], actions: ['read'] });
  const sessions = Object.fromEntries(Object.entries(users).map(([id, user]) => [id, auth.login({ username: user.username, password }).sessionToken]));
  async function openCore(port = 0) {
    core = createBusinessServer({ auth, config, fetchImpl: sourceFetch, consoleFetchImpl: async () => { throw new Error('No default service probes permitted.'); }, pollMs: 60000 });
    core.listen(port, '127.0.0.1'); await once(core, 'listening'); coreOrigin = `http://127.0.0.1:${core.address().port}`;
    config.allowedHosts = [new URL(coreOrigin).host];
  }
  async function closeCore() { if (!core) return; await core.core.shutdown(); core.closeAllConnections(); await new Promise(resolve => core.close(resolve)); core.core.events.close(); core = null; }
  await openCore();
  const request = (path, { user = 'owner-a', csrf, ...options } = {}) => networkFetch(coreOrigin + path, { redirect: 'manual', ...options, headers: { Host: new URL(issuer).host, Connection: 'close', ...(user && { Cookie: `${SESSION_COOKIE}=${sessions[user]}` }), ...(csrf && { 'X-CSRF-Token': csrf }), ...options.headers } });
  const csrf = async user => (await (await request('/api/business/account/session', { user })).json()).csrfToken;
  const f = { root, config, catalog, sessions, issuer, webPort, request, csrf, sourceCalls, permission, writeProvider, saveCatalog, users, get auth() { return auth; }, get core() { return core; }, get coreOrigin() { return coreOrigin; }, set respond(value) { respond = value; }, hold() { const gate = deferred(); releases.add(gate.release); return gate; }, async reopen() { const port = core.address().port; await closeCore(); auth.close(); auth = new AuthStore({ file: config.database, issuer }); await openCore(port); }, async openWeb({ privateDocumentOwnerId } = {}) { web = createPraxisServer({ root, publicDir: resolve('public'), observationsFile: null, publicUrlsFile: null, businessUrl: null, consoleUpstream: null, webGateway: { enabled: true, canonicalUrl: issuer, coreUrl: coreOrigin, privateDocumentOwnerId } }); web.listen(webPort, '127.0.0.1'); await once(web, 'listening'); return (path, user = 'owner-a', headers = {}) => networkFetch(issuer + path, { redirect: 'manual', headers: { ...(user && { Cookie: `${SESSION_COOKIE}=${sessions[user]}` }), ...headers } }); } };
  t.after(async () => { for (const release of releases) release(); if (web) { web.closeAllConnections(); await new Promise(resolve => web.close(resolve)); } await closeCore(); auth.close(); await rm(root, { recursive: true, force: true }); });
  return f;
}

test('HTTP cards require a native session, filter entries/resources, and never probe an unconfigured Intelligence origin', { timeout: 15000 }, async t => {
  const f = await fixture(t), before = ambientRequests.length;
  assert.equal((await f.request(cardPath, { user: null })).status, 401);
  assert.equal((await f.request(cardPath, { user: null, headers: { Authorization: 'Bearer synthetic-unrelated' } })).status, 401);
  const response = await f.request(cardPath); assert.equal(response.status, 200);
  const value = await response.json(); assert.equal(value.items.length, 1); assert.equal(value.items[0].resourceId, 'allowed-record');
  assert.ok(!JSON.stringify(value).includes('Synthetic denied source note'));
  assert.equal(value.sources.find(source => source.appId === 'intelligence').status, 'unavailable');
  assert.equal(value.sources.find(source => source.appId === 'calendar').status, 'browser');
  assert.ok(f.sourceCalls.every(call => call.url.startsWith('https://synthetic-adapter.example.test/')));
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['calendar'], workbench: true, prds: false });
  assert.deepEqual((await (await f.request(cardPath)).json()).items, []);
  assert.equal(ambientRequests.length, before, 'No implicit/default host may be contacted.');
});

test('HTTP card aggregation rechecks native entry and resource authority after asynchronous reads', { timeout: 15000 }, async t => {
  const f = await fixture(t, { nativeIntelligence: true }), gate = f.hold(), entered = deferred();
  f.respond = async url => { assert.equal(url.origin, 'https://synthetic-native.example.test'); entered.release(); await gate.promise; return new Response(JSON.stringify({ title: 'Synthetic withheld Intelligence result' })); };
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['intelligence'], workbench: true, prds: false });
  const pending = f.request(cardPath); await entered.promise;
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['calendar'], workbench: true, prds: false }); gate.release();
  const value = await (await pending).json(); assert.deepEqual(value.items, []); assert.ok(!JSON.stringify(value).includes('withheld'));
  const resourceGate = f.hold(), resourceEntered = deferred();
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['reminder'], workbench: true, prds: false });
  f.respond = async () => { resourceEntered.release(); await resourceGate.promise; return new Response(JSON.stringify({ spaceId: 'synthetic-space', revision: '1', items: [{ resourceId: 'allowed-record', revision: '1', collection: 'plans', item: { text: 'Synthetic revoked resource', date: '2026-11-20', done: false } }] })); };
  const resourcePending = f.request(cardPath); await resourceEntered.promise; f.auth.revokeResource(f.permission.id); resourceGate.release();
  const revoked = await (await resourcePending).json(); assert.deepEqual(revoked.items, []); assert.ok(!JSON.stringify(revoked).includes('Synthetic revoked resource'));
});

test('HTTP personal preferences enforce CSRF, owners, revisions and idempotency, persist on reopen and create no business Trace', { timeout: 15000 }, async t => {
  const f = await fixture(t), token = await f.csrf('owner-a');
  const initialBusiness = (await (await f.request(cardPath)).json()).items[0];
  const traceCount = () => f.core.core.events.db.prepare('SELECT COUNT(*) AS n FROM business_traces').get().n;
  const beforeTrace = traceCount();
  assert.deepEqual(await (await f.request(preferencePath)).json(), { revision: 0, items: [] });
  const body = { cardId: 'reminder:sample:allowed-record', cardRevision: '1', state: 'later', until: new Date(Date.now() + 3600000).toISOString(), expectedRevision: 0, idempotencyKey: 'synthetic-private-choice' };
  const post = (input, options = {}) => f.request(preferencePath, { method: 'POST', csrf: token, body: JSON.stringify(input), headers: { 'Content-Type': 'application/json', Origin: f.issuer }, ...options });
  assert.equal((await post(body, { csrf: undefined })).status, 403);
  assert.equal((await post(body, { headers: { 'Content-Type': 'application/json', Origin: 'https://other.example.test' } })).status, 403);
  assert.equal((await f.request(preferencePath + '?userId=owner-a', { user: 'owner-b' })).status, 400);
  assert.equal((await post({ ...body, userId: 'owner-b' })).status, 400);
  const savedResponse = await post(body), saved = await savedResponse.json(); assert.equal(savedResponse.status, 200, JSON.stringify(saved)); assert.equal(saved.revision, 1); assert.equal(saved.items[0].state, 'later');
  assert.deepEqual(await (await f.request(preferencePath, { user: 'owner-b' })).json(), { revision: 0, items: [] });
  assert.deepEqual(await (await post(body)).json(), saved, 'Identical retry must not create another revision.');
  const stale = await post({ ...body, state: 'hidden', until: undefined, idempotencyKey: 'synthetic-stale-choice' }); assert.equal(stale.status, 409); assert.deepEqual((await stale.json()).current, saved);
  assert.equal((await post({ ...body, cardRevision: '2' })).status, 409);
  const afterBusiness = (await (await f.request(cardPath)).json()).items[0]; assert.equal(afterBusiness.date, initialBusiness.date); assert.equal(afterBusiness.title, initialBusiness.title); assert.equal(traceCount(), beforeTrace);
  await f.reopen(); assert.deepEqual(await (await f.request(preferencePath)).json(), saved);
  const csrf = await f.csrf('owner-a'); const restored = await post({ cardId: body.cardId, cardRevision: '1', state: 'visible', expectedRevision: 1, idempotencyKey: 'synthetic-restore-choice' }, { csrf }); assert.equal(restored.status, 200); assert.deepEqual((await restored.json()).items, []); assert.equal(traceCount(), beforeTrace);
});

test('HTTP administrator inventory follows changed catalog/provider metadata and isolates a failed source', { timeout: 15000 }, async t => {
  const f = await fixture(t);
  assert.equal((await f.request(dataPath, { user: null })).status, 401); assert.equal((await f.request(dataPath)).status, 403);
  const first = await (await f.request(dataPath, { user: 'administrator' })).json(); assert.equal(first.apps.length, 3);
  await f.writeProvider('calendar', { label: 'Changed synthetic browser location label' });
  const changed = await (await f.request(dataPath, { user: 'administrator' })).json(); assert.equal(changed.apps.find(app => app.id === 'calendar').locations[0].label, 'Changed synthetic browser location label');
  f.catalog.push({ id: 'memo', kind: 'app', builtin: true, name: 'Synthetic Memo', source: 'third_party/memo', path: '/', icon: '/memo-icon.svg' }); await f.writeProvider('memo'); await f.saveCatalog();
  const expanded = await (await f.request(dataPath, { user: 'administrator' })).json(); assert.equal(expanded.apps.length, 4); assert.ok(expanded.apps.some(app => app.id === 'memo'));
  await f.writeProvider('intelligence', { broken: true });
  const response = await f.request(dataPath, { user: 'administrator' }); assert.equal(response.status, 200); const partial = await response.json(); assert.equal(partial.sources.find(source => source.appId === 'intelligence').status, 'unavailable'); assert.ok(partial.apps.find(app => app.id === 'reminder').locations.length); assert.ok(!JSON.stringify(partial).includes('private implementation details'));
});

test('HTTP browser manifests/modules require current entry access, use code hashes and never select arbitrary module URLs', { timeout: 15000 }, async t => {
  const f = await fixture(t), web = await f.openWeb();
  assert.equal((await web('/api/workbench/providers', null)).status, 401);
  const first = await (await web('/api/workbench/providers')).json(); assert.equal(first.providers.length, 1); assert.equal(first.providers[0].appId, 'calendar'); assert.match(first.providers[0].moduleUrl, /^\/app-providers\/calendar\.mjs\?v=[0-9a-f]{20}$/); assert.equal(first.providers[0].dataExecution, 'server');
  assert.equal((await web(first.providers[0].moduleUrl)).status, 200);
  await f.writeProvider('calendar', { label: 'A distinct synthetic module version for cache validation' });
  const next = await (await web('/api/workbench/providers')).json(); assert.notEqual(next.providers[0].moduleUrl, first.providers[0].moduleUrl);
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['reminder'], workbench: true, prds: false }); assert.deepEqual((await (await web('/api/workbench/providers')).json()).providers, []); assert.equal((await web(next.providers[0].moduleUrl)).status, 403);
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['calendar'], workbench: true, prds: false }); f.catalog.find(app => app.id === 'calendar').source = 'https://outside.example.test/module.mjs'; await f.saveCatalog();
  assert.equal((await web('/api/workbench/providers')).status, 500); assert.equal(ambientRequests.length, 0);
});

test('HTTP private reader cards/modules and Later use the configured native administrator owner rather than ordinary apps membership', { timeout: 15000 }, async t => {
  const f = await fixture(t, { privateReaders: true });
  f.auth.setPlatformAdmin({ userId: 'owner-b', enabled: true });
  f.auth.setWebAccess({ userId: 'owner-a', apps: ['calendar', 'matrix-reader'], workbench: true, prds: false });
  const web = await f.openWeb({ privateDocumentOwnerId: 'administrator' });
  const owner = await (await web('/api/workbench/providers', 'administrator')).json();
  assert.deepEqual(owner.providers.map(provider => provider.appId).sort(), ['calendar', 'letters', 'matrix-reader', 'profiles']);
  const otherAdmin = await (await web('/api/workbench/providers', 'owner-b')).json();
  assert.deepEqual(otherAdmin.providers.map(provider => provider.appId).sort(), ['calendar', 'matrix-reader']);
  const member = await (await web('/api/workbench/providers', 'owner-a')).json();
  assert.deepEqual(member.providers.map(provider => provider.appId).sort(), ['calendar', 'matrix-reader']);
  for (const appId of ['letters', 'profiles']) {
    const module = owner.providers.find(provider => provider.appId === appId).moduleUrl;
    assert.equal((await web(module, 'administrator')).status, 200);
    assert.equal((await web(module, 'owner-b')).status, 403);
    assert.equal((await web(module, 'owner-a')).status, 403);
    const iconPath = `/app-icons/${appId}.svg`, icon = await web(iconPath, 'administrator'); assert.equal(icon.status, 200); const etag = icon.headers.get('etag'); assert.ok(etag);
    assert.equal((await web(iconPath, 'administrator', { 'If-None-Match': etag })).status, 304);
    assert.equal((await web(iconPath, 'owner-b', { 'If-None-Match': etag })).status, 403);
    assert.equal((await web(iconPath, 'owner-a')).status, 403); assert.equal((await web(iconPath, null)).status, 401);
    assert.equal((await web(`/${appId}-icon.svg`, 'administrator')).status, 200);
    assert.equal((await web(`/${appId}-icon.svg`, 'owner-b')).status, 403);
  }
  f.catalog.push({ id: 'polaris', kind: 'app', builtin: true, name: 'Runtime', source: 'third_party/polaris', path: '/', icon: '/polaris-icon.svg', adminOnly: true }); await f.writeProvider('polaris'); await f.saveCatalog();
  assert.equal((await web('/app-icons/polaris.svg', 'owner-b')).status, 200);
  assert.equal((await web('/app-icons/polaris.svg', 'owner-a')).status, 403);
  assert.equal((await web('/app-icons/polaris.svg', null)).status, 401);
  const ownerCards = await (await f.request(cardPath, { user: 'administrator' })).json();
  assert.ok(ownerCards.sources.some(source => source.appId === 'letters' && source.status === 'browser'));
  assert.ok(ownerCards.sources.some(source => source.appId === 'profiles' && source.status === 'browser'));
  const nonownerCards = await (await f.request(cardPath, { user: 'owner-b' })).json();
  assert.ok(!nonownerCards.sources.some(source => ['letters', 'profiles'].includes(source.appId)));
  const csrf = await f.csrf('administrator');
  let revision = 0;
  for (const appId of ['letters', 'profiles']) {
    const body = { cardId: `${appId}:synthetic-document`, cardRevision: 'synthetic-version', state: 'later', until: new Date(Date.now() + 3600000).toISOString(), expectedRevision: revision, idempotencyKey: `synthetic-private-reader-${appId}` };
    const response = await f.request(preferencePath, { user: 'administrator', csrf, method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.issuer }, body: JSON.stringify(body) });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    const saved = await response.json(); revision = saved.revision;
    assert.ok(saved.items.some(item => item.cardId === body.cardId && item.state === 'later'));
    const otherCsrf = await f.csrf('owner-b');
    assert.equal((await f.request(preferencePath, { user: 'owner-b', csrf: otherCsrf, method: 'POST', headers: { 'Content-Type': 'application/json', Origin: f.issuer }, body: JSON.stringify({ ...body, expectedRevision: 0, idempotencyKey: `synthetic-nonowner-${appId}` }) })).status, 403);
  }
  assert.deepEqual((await (await f.request(preferencePath, { user: 'administrator' })).json()).items.map(item => item.cardId).sort(), ['letters:synthetic-document', 'profiles:synthetic-document']);
  assert.deepEqual(await (await f.request(preferencePath, { user: 'owner-b' })).json(), { revision: 0, items: [] });
  assert.equal(ambientRequests.length, 0);
});
