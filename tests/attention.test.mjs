import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedText, nativeHref, providerReadHref, validateCard, validateCardEnvelope, validatePreferences, personalCardState, laterTime, readBrowserProviders } from '../public/app-providers.js';
import { setAppFacts } from '../public/app-registry.js';
import { mergeBrowserInventory, validateDataManagement } from '../public/admin-data.js';

const origin = 'https://workbench.example.test';
const registeredFacts = ['reminder', 'projects', 'lattice-slides', 'memo', 'field-notes'].map(id => ({ id, name: id, entry: { nativePath: '/apps/' + (id === 'lattice-slides' ? 'slides' : id) + '/', policy: 'grant', legacyPaths: id === 'reminder' ? ['/business/reminder/'] : [] } }));
setAppFacts(registeredFacts);
const card = (overrides = {}) => ({ id: 'reminder:sample:record-a', appId: 'reminder', spaceId: 'sample', resourceId: 'record-a', revision: '7', kind: 'reminder', title: 'Keep this original title', preview: 'Source-authored <script>text</script>', reason: { en: 'A reminder you set.', zh: '你设置的提醒。' }, source: { name: 'Reminder' }, primaryAction: { label: { en: 'Open reminder', zh: '打开提醒' }, href: '/business/reminder/?space=sample&item=record-a' }, evidence: [{ label: 'Original note', excerpt: 'Keep the author’s language.', href: '/business/reminder/?space=sample&item=record-a', revision: '7' }], ...overrides });
const envelope = items => ({ schemaVersion: 1, items, sources: [{ appId: 'reminder', status: 'ready' }], partial: false, generatedAt: '2026-11-19T12:00:00.000Z' });
const reply = value => ({ ok: true, json: async () => value });

test('card projections preserve authored content while localizing only declared labels', () => {
  const checked = validateCardEnvelope(envelope([card()]), origin).items[0];
  assert.equal(checked.title, 'Keep this original title');
  assert.equal(checked.preview, 'Source-authored <script>text</script>');
  assert.equal(localizedText(checked.reason, 'zh'), '你设置的提醒。');
  assert.equal(localizedText(checked.evidence[0].excerpt, 'zh'), 'Keep the author’s language.');
  assert.throws(() => validateCardEnvelope(envelope([card(), card()]), origin), /Duplicate/);
});

test('native actions stay in their app while evidence supports safe original sources', () => {
  for (const href of ['https://other.example.test/apps/reminder/', '/apps/projects/', '/api/business/admin/users', 'javascript:alert(1)', '//other.example.test/apps/reminder/', '/apps/reminder/../../admin/']) {
    assert.throws(() => nativeHref(href, 'reminder', origin), undefined, href);
  }
  for (const href of ['/api/business/admin/users', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,example', '//other.example.test/apps/reminder/', '/apps/reminder/a/%2e%2e/', '/apps/reminder/../../admin/']) {
    assert.throws(() => validateCard(card({ evidence: [{ label: 'Source', href }] }), origin), undefined, href);
  }
  for (const href of ['https://other.example.test/source', '/apps/projects/']) assert.equal(validateCard(card({ evidence: [{ label: 'Source', href }] }), origin).evidence[0].href, href);
  assert.equal(nativeHref('/apps/slides/#deck=example', 'lattice-slides', origin), '/apps/slides/#deck=example');
  assert.throws(() => validateCard(card({ appId: 'polaris' }), origin));
});

test('personal Later survives source updates, Hide applies to one version, and neither edits the business date', () => {
  const item = card({ date: '2026-11-20' });
  const now = Date.parse('2026-11-19T12:00:00Z');
  const later = validatePreferences({ revision: 2, items: [{ cardId: item.id, cardRevision: '6', state: 'later', until: '2026-11-20T09:00:00Z' }] });
  assert.equal(personalCardState(item, later, now), 'later');
  assert.equal(personalCardState(item, later, Date.parse('2026-11-20T10:00:00Z')), 'visible');
  const hidden = validatePreferences({ revision: 3, items: [{ cardId: item.id, cardRevision: '7', state: 'hidden' }] });
  assert.equal(personalCardState(item, hidden, now), 'hidden');
  assert.equal(personalCardState({ ...item, revision: '8' }, hidden, now), 'visible');
  assert.equal(item.date, '2026-11-20');
  assert.throws(() => validatePreferences({ revision: '3', items: [] }));
  assert.throws(() => validatePreferences({ revision: -1, items: [] }));
  assert.throws(() => validatePreferences({ revision: 4, items: [{ cardId: item.id, cardRevision: '7', state: 'later', until: 'invalid' }] }));
});

test('personal review times use explicit local slots without changing a source deadline', () => {
  const morning = new Date(2026, 10, 19, 10, 0);
  assert.equal(new Date(laterTime('today', morning)).getHours(), 18);
  const late = new Date(laterTime('today', new Date(2026, 10, 19, 20, 0)));
  assert.equal(late.getDate(), 19); assert.equal(late.getHours(), 23);
  const tomorrow = new Date(laterTime('tomorrow', morning));
  assert.equal(tomorrow.getDate(), 20); assert.equal(tomorrow.getHours(), 9);
});

test('browser callbacks receive no session secrets and read only their own native route', async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    if (url === '/api/workbench/providers') return reply({ schemaVersion: 1, providers: [{ appId: 'memo', moduleUrl: '/app-providers/memo.mjs' }] });
    return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ records: [] }) };
  };
  const result = await readBrowserProviders({ kind: 'cards', origin, identity: { userId: 'synthetic-user', username: 'sample', csrfToken: 'do-not-pass', secret: 'do-not-pass' }, fetchImpl, importModule: async url => {
    assert.equal(url, origin + '/app-providers/memo.mjs');
    return {
      describe: () => ({ version: 1, appId: 'memo', cards: { supported: true, execution: 'browser' }, dataSources: [] }),
      getCards: async context => {
        assert.deepEqual(context.identity, { userId: 'synthetic-user', username: 'sample' });
        await assert.rejects(context.read('/apps/projects/api/project'));
        await assert.rejects(context.read('https://other.example.test/'));
        await context.read('/api/records');
        return { status: 'empty', items: [] };
      },
    };
  } });
  assert.equal(result[0].status, 'empty');
  assert.equal(requests[1].url, origin + '/apps/memo/api/records');
  assert.equal(requests[1].init.method, 'GET'); assert.equal(requests[1].init.redirect, 'error');
  assert.equal(requests[1].init.headers, undefined);
  assert.throws(() => providerReadHref('//other.example.test/', 'memo', origin));
});

test('unreviewed modules are refused and one broken provider cannot hide other app results', async () => {
  await assert.rejects(readBrowserProviders({ kind: 'cards', origin, fetchImpl: async () => reply({ schemaVersion: 1, providers: [{ appId: 'memo', moduleUrl: 'https://other.example.test/code.mjs' }] }), importModule: () => assert.fail('Must not import remote code') }));
  const result = await readBrowserProviders({ kind: 'cards', origin, fetchImpl: async () => reply({ schemaVersion: 1, providers: ['memo', 'field-notes'].map(appId => ({ appId, moduleUrl: `/app-providers/${appId}.mjs` })) }), importModule: async url => {
    const appId = url.includes('/memo.') ? 'memo' : 'field-notes';
    return { describe: () => ({ version: 1, appId, cards: { supported: true, execution: 'browser' } }), getCards: () => appId === 'memo' ? Promise.reject(new Error('Private implementation detail')) : { status: 'ready', items: [card({ id: 'field-notes:sample:date', appId: 'field-notes', kind: 'result', primaryAction: { label: 'Open date', href: '/apps/field-notes/' }, evidence: [] })] } };
  } });
  assert.equal(result[0].status, 'unavailable'); assert.ok(!JSON.stringify(result[0]).includes('Private implementation detail'));
  assert.equal(result[1].items[0].appId, 'field-notes');
});

test('data location sources remain factual and browser failures do not retain stale paths', () => {
  const value = { schemaVersion: 1, generatedAt: '2026-11-19T12:00:00.000Z', apps: [{ id: 'reminder', name: 'Reminder', locations: [{ label: 'Task store', kind: 'json', hostPath: '/synthetic/data/tasks.json' }] }, { id: 'memo', name: 'Memo', locations: [{ label: 'Old browser key', kind: 'browser', storageKey: 'sample.old' }] }] };
  const merged = mergeBrowserInventory(value, [{ appId: 'memo', status: 'unavailable', items: [] }]);
  assert.equal(merged.apps[0].locations[0].hostPath, '/synthetic/data/tasks.json');
  assert.deepEqual(merged.apps[1].locations, []); assert.equal(merged.apps[1].status, 'unavailable');
  validateDataManagement({ ...value, apps: [{ id: 'field-notes', name: 'Field notes', locations: [{ label: 'Derived projection', kind: 'derived' }, { label: 'External archive', kind: 'external', description: 'Owned by the connected service.' }] }] });
  assert.equal(value.apps[1].locations[0].storageKey, 'sample.old');
});
