import test from 'node:test';
import assert from 'node:assert/strict';
import { setAppFacts, clearAppFacts } from '../public/app-registry.js';
import { reportExperience } from '../public/experience.js';

test('experience reporting recognizes loaded app identities and keeps its original small allowlisted payload', async t => {
  const previous = globalThis.fetch, calls = []; globalThis.fetch = async (path, init) => { calls.push({ path, init, body: JSON.parse(init.body) }); return { ok: true }; }; t.after(() => { globalThis.fetch = previous; clearAppFacts(); });
  setAppFacts([{ id: 'field-notes', name: 'Field notes', entry: { nativePath: '/apps/field-journal/', policy: 'grant' } }]);
  assert.equal(await reportExperience('app_open', { appId: 'field-notes', durationMs: 12.4, privateBody: 'Never include source content' }), true);
  assert.equal(calls[0].path, '/api/observations'); assert.deepEqual(calls[0].body, { event_name: 'app_open', app_id: 'field-notes', duration_ms: 12 });
  assert.equal(calls[0].init.credentials, 'same-origin'); assert.equal(calls[0].init.redirect, 'error'); assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  for (const appId of ['not-registered', 'private-user-input', '../admin', '', 12]) assert.equal(await reportExperience('app_open', { appId }), false);
  assert.equal(await reportExperience('arbitrary_private_event', { appId: 'field-notes' }), false); assert.equal(calls.length, 1);
  clearAppFacts(); assert.equal(await reportExperience('app_open', { appId: 'field-notes' }), false); assert.equal(calls.length, 1);
});
