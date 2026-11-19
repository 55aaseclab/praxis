import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManagedInstallation, installationCommand, installationOperation, installationStatus } from '../scripts/managed-installation.mjs';

test('restored commands retain explicit installation scope and stop without deleting its data', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'managed-installation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'installation.json');
  const config = { version: 1, projects: { apps: { name: 'synthetic-existing', files: [join(dir, 'apps.yaml')], services: ['knowledge', 'slides-public'] } } };
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  const loaded = await readManagedInstallation(file);
  const up = installationCommand(loaded, 'apps', 'up');
  assert.ok(up.includes('--no-build'));
  assert.ok(up.includes('--pull'));
  assert.ok(up.includes('never'));
  const down = installationCommand(loaded, 'apps', 'down');
  assert.ok(down.includes('stop'));
  assert.ok(!down.includes('down') && !down.includes('-v'));
  assert.throws(() => installationCommand(loaded, 'apps', 'up', ['other-app']), /outside/);
  const calls = [];
  await installationOperation(loaded, 'apps', 'up', { services: ['knowledge'], execute: async args => { calls.push(args); return ''; } });
  assert.equal(calls[0].at(-1), 'knowledge');
  const status = installationStatus(JSON.stringify([{ Service: 'knowledge', State: 'running', Health: 'healthy' }, { Service: 'slides-public', State: 'running', Health: 'healthy' }]), config.projects.apps);
  assert.equal(status.healthy, true);
  await chmod(file, 0o644);
  await assert.rejects(readManagedInstallation(file), /private installation descriptor/);
});


test('installation commands accept core aliases without changing legacy service or data identity', () => {
  const config = { version: 1, projects: { business: { name: 'unchanged-installed-project', files: ['/synthetic/core.yml'], services: ['business', 'reminder'] } } };
  const up = installationCommand(config, 'core', 'up', ['core']);
  assert.equal(up.at(-1), 'business');
  assert.ok(up.includes('unchanged-installed-project'));
  assert.ok(!up.includes('--remove-orphans'));
});
