import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, polarisStackPlan, POLARIS_SERVICES } from '../scripts/polaris-stack.mjs';

test('Polaris stack operates only the pinned read-only viewer and its ingress', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'polaris-viewer-stack-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'viewer.env');
  await writeFile(file, [
    'PRAXIS_POLARIS_VIEWER_REVISION=' + 'a'.repeat(40),
    'PRAXIS_WORKSPACE_ID=synthetic-workspace',
    'PRAXIS_POLARIS_OBSERVATIONS_FILE=' + join(dir, 'observations.json'),
    'PRAXIS_VIEWER_UID=1000',
    'PRAXIS_VIEWER_GID=1000',
    '',
  ].join('\n'), { mode: 0o600 });
  assert.deepEqual(POLARIS_SERVICES, ['viewer', 'ingress']);
  const calls = [], execute = async args => {
    calls.push(args);
    return args.includes('ps') ? JSON.stringify(POLARIS_SERVICES.map(Service => ({ Service, State: 'running', Health: 'healthy' }))) : '';
  };
  assert.equal((await main(['validate', '--config', file], { execute, print: false })).enabled, true);
  const status = await main(['status', '--config', file], { execute, print: false });
  assert.equal(status.healthy, true);
  await main(['up', '--config', file], { execute, print: false });
  await main(['down', '--config', file], { execute, print: false });
  assert.ok(calls.every(args => args.includes('compose.polaris-viewer.yaml') || args.some(value => value.endsWith('/compose.polaris-viewer.yaml'))));
  assert.ok(calls.every(args => !args.includes('polaris-browser') && !args.includes('compose.polaris.yaml')));
  assert.ok(calls.at(-1).includes('stop'));
  assert.equal((await polarisStackPlan(join(dir, 'missing.env'))).enabled, false);
  const old = join(dir, 'old.json');
  await writeFile(old, JSON.stringify({ codexHome: '/private/legacy-session', dataRoot: '/private/legacy-data' }), { mode: 0o600 });
  await assert.rejects(polarisStackPlan(old), /read-only Polaris viewer/);
});
