import test from 'node:test';
import assert from 'node:assert/strict';
import { appFact, appName, appRoutePrefixes, clearAppFacts, collectionEntries, entryApps, grantApps, loadAppFacts, setAppFacts } from '../public/app-registry.js';
import { nativeHref, providerReadHref, readBrowserProviders, validateCard } from '../public/app-providers.js';
const origin = 'https://fixture.example.test';
const fact = () => ({ id: 'field-notes', name: 'Field notes', icon: '/app-icons/field-notes.svg', labels: { zh: { name: '现场笔记' } }, entry: { nativePath: '/apps/field-journal/', policy: 'grant', kind: 'proxy', adapterId: 'field-data', legacyPaths: ['/business/field-records/'], workbenchDirectory: { path: '/api/business/workbench/field-notes', title: { en: 'Field records', zh: '现场记录' } } } });
const card = () => ({ id: 'field-notes:demo:one', appId: 'field-notes', resourceId: 'one', revision: '1', kind: 'result', title: 'A fictional source result', reason: 'A saved result', source: { name: 'Field notes' }, primaryAction: { label: 'Open result', href: '/apps/field-journal/#record=one' }, evidence: [] });

test('a new app supplies its own name, business alias and native/legacy card routes without a root table', () => {
  setAppFacts([fact()]); assert.equal(appName('field-data'), 'Field notes'); assert.deepEqual(appRoutePrefixes('field-notes'), ['/apps/field-journal/', '/business/field-records/']);
  assert.equal(nativeHref('/business/field-records/?record=one', 'field-notes', origin), '/business/field-records/?record=one');
  assert.equal(providerReadHref('/api/cards', 'field-notes', origin), origin + '/apps/field-journal/api/cards');
  assert.equal(validateCard(card(), origin).appId, 'field-notes');
  for (const path of ['/apps/other/', '/apps/field-journal/../other/', '/apps/field-journal/%2e%2e/', 'https://other.example.test/apps/field-journal/']) assert.throws(() => nativeHref(path, 'field-notes', origin));
  assert.throws(() => providerReadHref('/business/field-records/api/cards', 'field-notes', origin));
  setAppFacts([{ ...fact(), cardsSupported: false }]); assert.throws(() => validateCard(card(), origin));
  clearAppFacts(); assert.throws(() => validateCard(card(), origin)); assert.equal(appFact('field-notes'), undefined);
});

test('app facts distinguish grantable entries from administrator/private boundaries and reject unsafe declarations', () => {
  setAppFacts([fact(), { id: 'private-reader', name: 'Private reader', entry: { nativePath: '/apps/private-reader/', policy: 'document-owner' } }, { id: 'runtime', name: 'Runtime', entry: { nativePath: '/apps/runtime/', policy: 'platform-admin' } }]);
  assert.deepEqual(grantApps().map(app => app.id), ['field-notes']); assert.equal(entryApps().length, 3);
  for (const patch of [{ entry: { nativePath: '//other.example.test/' } }, { entry: { nativePath: '/apps/../../admin/' } }, { entry: { legacyPaths: 'not-an-array' } }, { entry: { policy: 'owner-by-name' } }]) assert.throws(() => setAppFacts([{ ...fact(), ...patch }]));
});

test('late registry reads cannot repopulate facts after an identity boundary clears them', async () => {
  clearAppFacts(); let release; const held = new Promise(resolve => { release = resolve; });
  const reading = loadAppFacts({ fetchImpl: async () => { await held; return { ok: true, json: async () => ({ apps: [fact()] }) }; } });
  clearAppFacts(); release(); await assert.rejects(reading, /identity changed/); assert.equal(entryApps().length, 0);
});

test('app-owned collections provide exact native links and artwork while duplicate/cross-app/private payloads fail closed', () => {
  const app = fact(), entry = { id: 'demo:one', appId: app.id, resourceId: 'one', kind: 'note', name: 'Fictional field record', description: 'Keep the original language.', href: '/apps/field-journal/#record=one' };
  const envelope = entries => ({ schemaVersion: 1, appId: app.id, entries, partial: false });
  const result = collectionEntries(envelope([entry]), app, origin); assert.equal(result.entries[0].icon, app.icon); assert.equal(result.entries[0].url, origin + entry.href); assert.equal(result.entries[0].name, entry.name);
  for (const entries of [[entry, entry], [{ ...entry, appId: 'private-reader' }], [{ ...entry, href: '/apps/private-reader/' }], [{ ...entry, body: 'Do not pass raw records into a launcher' }], [{ ...entry, resourceId: '../other' }]]) assert.throws(() => collectionEntries(envelope(entries), app, origin));
});

test('a reviewed extra browser provider is loaded from declared routes and receives no web credentials', async () => {
  clearAppFacts(); const app = fact(), calls = [];
  const results = await readBrowserProviders({ kind: 'cards', origin, identity: { userId: 'synthetic-user', username: 'Synthetic', csrfToken: 'not-for-provider' }, fetchImpl: async (path, init) => {
    calls.push({ path, init });
    if (path === '/api/workbench/providers') return { ok: true, json: async () => ({ schemaVersion: 1, apps: [app], providers: [{ appId: app.id, moduleUrl: '/app-providers/field-notes.mjs?v=abcdef123456' }] }) };
    assert.equal(path, origin + '/apps/field-journal/api/cards'); return { ok: true, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => ({ items: [] }) };
  }, importModule: async url => {
    assert.equal(url, origin + '/app-providers/field-notes.mjs?v=abcdef123456'); return { describe: () => ({ version: 1, appId: app.id, cards: { supported: true, execution: 'browser' } }), getCards: async context => { assert.deepEqual(context.identity, { userId: 'synthetic-user', username: 'Synthetic' }); await context.read('/api/cards'); return { status: 'ready', items: [card()] }; } };
  } });
  assert.equal(results[0].items[0].appId, app.id); assert.equal(calls[1].init.method, 'GET'); assert.equal(calls[1].init.redirect, 'error'); assert.equal(calls[1].init.headers, undefined);
});
