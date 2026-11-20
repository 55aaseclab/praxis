import test from 'node:test';
import assert from 'node:assert/strict';
import { populateContexts } from '../public/app-transport.js';

test('the common transport uses generic scope labels and accepts app-owned labels without changing authored names', t => {
  const previous = globalThis.document, options = [], picker = { hidden: false }, select = { replaceChildren() { options.length = 0; }, append(value) { options.push(value); } };
  globalThis.document = { querySelector: id => id === '#space' ? select : picker, createElement: () => ({}) }; t.after(() => { globalThis.document = previous; });
  populateContexts([{ id: 'personal', type: 'personal' }, { id: 'unknown', type: 'other' }]);
  assert.deepEqual(options.map(value => value.textContent), ['Personal tasks', 'Task scope']);
  for (const labels of [{ types: { personal: 'Personal reminders' }, fallback: 'Reminder lists' }, { types: { personal: '个人提醒' }, fallback: '提醒列表' }]) {
    populateContexts([{ id: 'personal', type: 'personal' }, { id: 'named', type: 'family', name: 'Source-authored title' }, { id: 'other', type: 'other' }], labels);
    assert.deepEqual(options.map(value => value.textContent), [labels.types.personal, 'Source-authored title', labels.fallback]); assert.equal(picker.hidden, false);
  }
  populateContexts([], { types: {} }); assert.equal(picker.hidden, true); assert.deepEqual(options, []);
});
