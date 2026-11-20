import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const preload = fileURLToPath(new URL('../scripts/demo-workbench.mjs', import.meta.url));
const example = `
  const http = require('node:http');
  const server = http.createServer((request, response) => response.end('synthetic app'));
  server.listen(Number(process.argv[1]), '127.0.0.1');
`;

function startDemo(port) {
  return spawn(process.execPath, ['--import', preload, '-e', example, String(port)], {
    env: { PRAXIS_DEMO_APP: 'finance', ...(process.env.PRAXIS_APP_SOURCE_ROOT ? { PRAXIS_APP_SOURCE_ROOT: process.env.PRAXIS_APP_SOURCE_ROOT } : {}) },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

test('demo workbench links the app served by its own process', { timeout: 10000 }, async t => {
  const child = startDemo(0);
  t.after(() => child.kill());
  const output = createInterface({ input: child.stdout });
  const [line] = await Promise.race([
    once(output, 'line'),
    once(child, 'close').then(([code]) => { throw new Error(`The isolated demo exited before announcing its workbench (exit ${code}).`); }),
  ]);
  const origin = new URL(line.replace(/^Demo workbench: /, ''));
  assert.equal(origin.hostname, '127.0.0.1');
  const { apps } = await (await fetch(new URL('/api/apps', origin))).json();
  const finance = apps.find(app => app.id === 'finance');
  assert.equal(finance.launcher, true);
  assert.equal(await (await fetch(finance.url)).text(), 'synthetic app');
  assert.equal(apps.find(app => app.id === 'memo').unavailable, 'managed');
  assert.ok(!apps.some(app => ['letters', 'profiles', 'polaris'].includes(app.id)));
});

test('an occupied demo port cannot add an existing service to a workbench', async t => {
  const existing = createServer();
  existing.listen(0, '127.0.0.1');
  await once(existing, 'listening');
  t.after(() => existing.close());
  const child = startDemo(existing.address().port);
  t.after(() => child.kill());
  let message = '';
  child.stdout.setEncoding('utf8').on('data', part => { message += part; });
  const [code] = await once(child, 'close');
  assert.notEqual(code, 0);
  assert.doesNotMatch(message, /Demo workbench/);
});
