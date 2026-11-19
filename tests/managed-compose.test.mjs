import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { composeArgs } from '../scripts/managed-compose.mjs';
import { DockerDeploymentOps } from '../src/deployment/controller.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const files = ['/synthetic/apps.yml', '/synthetic/private.yml'];
const config = { version: 1, projects: { apps: { name: 'synthetic-existing', files, envFile: '/synthetic/apps.env', services: ['notes', 'reader'] } } };

test('managed recreation keeps the project identity and selects only its named services', () => {
  const args = composeArgs(config, ['recreate', 'apps', 'notes']);
  assert.deepEqual(args, ['compose', '--project-directory', workspace, '--project-name', 'synthetic-existing', '--file', files[0], '--file', files[1],
    '--env-file', '/synthetic/apps.env', 'up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', '--wait', 'notes']);
  assert.deepEqual(composeArgs(config, ['stop', 'apps']).slice(-3), ['stop', 'notes', 'reader']);
  assert.throws(() => composeArgs(config, ['up', 'apps', 'wrong-group']), /outside/);
  assert.throws(() => composeArgs(config, ['up', 'toString']), /Unknown/);
});

test('deployment facade retains new checkout directory when all compose files live outside it', async () => {
  let observed;
  const ops = new DockerDeploymentOps({}, { run: async (args, options) => { observed = { args, options }; } });
  const labels = { 'com.docker.compose.project': 'synthetic-existing', 'com.docker.compose.project.working_dir': workspace,
    'com.docker.compose.project.config_files': files.join(','), 'com.docker.compose.service': 'praxis-public' };
  await ops.applyFacade({ Config: { Labels: labels } }, '/synthetic/facade.yml');
  assert.deepEqual(observed.args.slice(0, 5), ['compose', '--project-directory', workspace, '--project-name', 'synthetic-existing']);
  assert.equal(observed.options.cwd, workspace);
});


test('core group and facade aliases preserve the installed Compose project namespace', () => {
  for (const [group, service] of [['business', 'business'], ['business', 'core'], ['core', 'core']]) {
    const config = { version: 1, projects: { [group]: { name: 'unchanged-installed-project', files, services: [service, 'reminder'] } } };
    const args = composeArgs(config, ['recreate', 'core', 'core']);
    assert.equal(args.at(-1), service);
    assert.ok(args.includes('unchanged-installed-project'));
  }
});
