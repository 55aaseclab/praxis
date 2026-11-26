import test from 'node:test';
import assert from 'node:assert/strict';
import { validIdentityApps } from '../public/identity.js';

test('browser identity accepts backend-authorized app IDs without a second app catalog', () => {
  assert.equal(validIdentityApps(['projects', 'lab-notes', 'another-reviewed-app']), true);
  assert.equal(validIdentityApps([]), true);
  for (const value of [null, ['lab-notes', 'lab-notes'], ['../secret'], ['bad/app'], [1], Array.from({ length: 129 }, (_, i) => `app-${i}`)]) assert.equal(validIdentityApps(value), false);
});
