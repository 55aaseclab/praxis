import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('dock switches between a clean app view and attention, clearing revoked and late items', async () => {
  const events = new Map();
  const document = { hidden: false, activeElement: null };
  function node(tag) {
    return {
      tag, children: [], dataset: {}, attributes: {}, textContent: '', hidden: false,
      setAttribute(name, value) { this.attributes[name] = value; },
      toggleAttribute(name, enabled) {
        if (enabled) this.attributes[name] = '';
        else delete this.attributes[name];
      },
      addEventListener(name, handler) { this[name] = handler; },
      append(...children) {
        for (const child of children) child.parentElement = this;
        this.children.push(...children);
      },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      contains(target) { return this === target || this.children.some(child => child.contains(target)); },
      focus() { document.activeElement = this; },
    };
  }
  const board = node('main'), attention = node('div'), dock = node('button');
  const classes = new Set();
  board.classList = { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } };
  board.append(attention);
  const appsIcon = node('svg'), attentionIcon = node('svg');
  appsIcon.dataset.viewIcon = 'apps'; attentionIcon.dataset.viewIcon = 'attention';
  dock.append(appsIcon, attentionIcon);
  dock.querySelectorAll = selector => selector === '[data-view-icon]' ? dock.children : [];
  document.getElementById = id => ({ 'attention-program': attention, 'workbench-view-switch': dock })[id];
  document.createElement = node;
  document.addEventListener = (name, handler) => events.set(name, handler);
  let identity = { username: 'synthetic-member', csrfToken: 'synthetic-session', workbench: true, apps: ['reminder'] };
  const today = new Date();
  const date = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');
  const item = { appId: 'reminder', spaceId: 'synthetic-space', resourceId: 'synthetic-reminder', title: 'Synthetic due item', date };
  let respond = async () => ({ items: [item], partial: false });
  const source = (await readFile(new URL('../public/attention.js', import.meta.url), 'utf8')).replace(/^import .+;\n/gm, '');
  runInNewContext(source, {
    document, getIdentity: () => identity, identityReady: Promise.resolve(),
    t: english => english, URLSearchParams, AbortController, setTimeout, clearTimeout,
    setInterval() {},
    window: { addEventListener() {} },
    fetch: async () => ({ ok: true, json: respond }),
  });
  await new Promise(setImmediate);
  const text = element => element.textContent + element.children.map(text).join('');
  assert.equal(dock.hidden, false);
  assert.equal(dock.dataset.view, 'apps');
  assert.equal(dock.attributes['aria-label'], 'Show For you');
  assert.equal(Object.hasOwn(attentionIcon.attributes, 'hidden'), false);
  assert.equal(Object.hasOwn(appsIcon.attributes, 'hidden'), true);
  assert.equal(attention.hidden, true);
  assert.equal(text(attention), '');

  dock.click();
  assert.equal(dock.dataset.view, 'attention');
  assert.equal(dock.attributes['aria-label'], 'Show apps');
  assert.equal(Object.hasOwn(appsIcon.attributes, 'hidden'), false);
  assert.equal(Object.hasOwn(attentionIcon.attributes, 'hidden'), true);
  assert.equal(attention.hidden, false);
  assert.equal(classes.has('show-attention'), true);
  assert.match(text(attention), /Due today.*Synthetic due item/);

  dock.click();
  assert.equal(attention.hidden, true);
  assert.equal(classes.has('show-attention'), false);
  assert.equal(text(attention), '');

  let releaseResponse;
  respond = () => new Promise(resolve => { releaseResponse = resolve; });
  const refreshing = events.get('praxis-identity-change')();
  await new Promise(setImmediate);
  dock.click();
  assert.match(text(attention), /Synthetic due item/);
  identity = null;
  await events.get('praxis-identity-change')();
  assert.equal(dock.hidden, true);
  assert.equal(attention.hidden, true);
  assert.equal(text(attention), '');
  releaseResponse({ items: [{ ...item, title: 'Late stale item' }], partial: false });
  await refreshing;
  assert.equal(dock.hidden, true);
  assert.equal(attention.hidden, true);
  assert.equal(text(attention), '');
  assert.equal(classes.has('show-attention'), false);
});
