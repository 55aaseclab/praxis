import test from 'node:test';
import assert from 'node:assert/strict';
import { composeInstallation, renderCompose, renderDockerContext } from '../scripts/generate-compose.mjs';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

test('Compose snapshot is assembled from app-owned recipes and preserves isolated native volumes', async () => {
  const compose = await composeInstallation();
  assert.equal(DEFAULT_APP_REGISTRY.apps.length, 11);
  assert.equal(Object.keys(compose.services).length, 13);
  for (const app of DEFAULT_APP_REGISTRY.apps) {
    const recipe = app.integration.deployment.localCompose;
    assert.ok(recipe, app.id);
    for (const [name, service] of Object.entries(recipe.services)) {
      assert.deepEqual(compose.services[name], service);
      assert.equal(service.build.context, './' + app.source);
      assert.equal(service.build.dockerfile, app.integration.deployment.native.dockerfile);
      for (const volume of service.volumes || []) if (volume.type === 'volume') assert.ok(Object.hasOwn(compose.volumes, volume.source));
      assert.equal(compose.services.praxis.depends_on[name].condition, 'service_healthy');
    }
  }
  assert.ok(renderCompose(compose).startsWith('# Generated'));
});

test('extra app contributes an installation service without a parent service case', async () => {
  const source = 'third_party/field-notes';
  const extra = { id: 'field-notes', source, integration: { deployment: {
    native: { dockerfile: 'Dockerfile.praxis' }, localCompose: {
      services: { 'field-notes': { build: { context: './' + source, dockerfile: 'Dockerfile.praxis' }, volumes: [{ type: 'volume', source: 'field-notes-data', target: '/data' }] } },
      volumes: { 'field-notes-data': {} }, initializeVolumes: [], webVolumes: [],
    },
  } } };
  const result = await composeInstallation({ registry: { apps: [...DEFAULT_APP_REGISTRY.apps, extra] } });
  assert.ok(result.services['field-notes']);
  assert.deepEqual(result.volumes['field-notes-data'], {});
  await assert.rejects(composeInstallation({ registry: { apps: [...DEFAULT_APP_REGISTRY.apps, extra, extra] } }), /Duplicate/);
});

test('a new static app supplies its complete source context without a platform path case', () => {
  const app = { id: 'field-journal', source: 'third_party/field-journal', iconPath: 'art/logo.svg', integration: { web: { kind: 'static', directory: 'client', assets: ['/app.js', '/app.css'] }, deployment: {} } };
  const context = renderDockerContext('**\n!package.json\n', { apps: [app] });
  for (const path of ['client/index.html', 'client/app.js', 'client/app.css', 'art/logo.svg', 'praxis-integration.mjs', 'praxis-provider.mjs']) assert.ok(context.includes('!third_party/field-journal/' + path), path);
  assert.ok(context.endsWith('**/.git/**\n'));
  assert.throws(() => renderDockerContext('**', { apps: [{ ...app, iconPath: '../private.svg' }] }), /Invalid app build-context/);
});
