import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppIntegrations } from '../src/app-integrations.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';

const moduleSource = ({ id = 'fixture-app', slug = id, adapterId = id, tool = 'fixture_read', scope = `${adapterId}:read`, mutation = false } = {}) => `
export function createIntegration({ z }) { return {
 schemaVersion:1,appId:${JSON.stringify(id)},web:{slug:${JSON.stringify(slug)},policy:'grant',kind:'proxy',nativePort:45123},
 business:{adapterId:${JSON.stringify(adapterId)},actions:['read'],scopes:{${JSON.stringify(scope)}:['read']},operations:{read:{action:'read',mutation:${mutation}}},
 tools:[{name:${JSON.stringify(tool)},operation:'read',action:'read',description:'Read the separately authorized synthetic object.',schema:z.object({spaceId:z.string(),resourceId:z.string()}).strict()}],
 skill:{name:'fixture-app-skill',path:'skills/fixture/SKILL.md'},validateInvocation(request){if(!request.resourceId)throw Object.assign(new Error('RESOURCE_REQUIRED'),{status:400,code:'RESOURCE_REQUIRED'});},
 } }; }
`;
async function fixture(t, apps = [{ id: 'fixture-app', name: 'Fixture app' }]) {
  const root = await mkdtemp(join(tmpdir(), 'praxis-integration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeInstalledAppsFixture(root, apps);
  const put = async (app, source = moduleSource({ id: app.id })) => {
    const directory = join(root, app.source || `third_party/${app.id}`);
    await writeFile(join(directory, 'praxis-integration.mjs'), source);
    await mkdir(join(directory, 'skills/fixture'), { recursive: true });
    await writeFile(join(directory, 'skills/fixture/SKILL.md'), '---\nname: fixture-app-skill\ndescription: Synthetic app guidance.\n---\n\nUse `fixture_read` only with current resource authorization.\n');
    return directory;
  };
  for (const app of apps) await put(app);
  return { root, put };
}

test('a separately installed synthetic app supplies routes, typed tools, scopes and skill without a Core app case', async t => {
  const f = await fixture(t), registry = await loadAppIntegrations(f.root);
  assert.deepEqual(registry.webAppIds, ['fixture-app']);
  assert.equal(registry.getWeb('fixture-app').slug, 'fixture-app');
  assert.equal(registry.operations['fixture-app'].read, 'read');
  assert.deepEqual(registry.scopes['fixture-app:read'], { appId: 'fixture-app', actions: ['read'] });
  assert.equal(registry.tools[0].readOnly, true);
  assert.equal(registry.tools[0].schema.safeParse({ spaceId: 'space-a', resourceId: 'object-a', rawBody: 'forbidden' }).success, false);
  assert.match(registry.skills['fixture-app'].content, /`fixture_read`/);
  assert.equal(registry.publicFacts()[0].entry.nativePath, '/apps/fixture-app/');
  assert.equal(JSON.stringify(registry.publicFacts()).includes(f.root), false);
  assert.equal(Object.isFrozen(registry.operations['fixture-app']), true);
  assert.equal(Object.isFrozen(registry.tools), true);
});

test('authorization action and actual mutation are separate app declarations', async t => {
  const f = await fixture(t); await f.put({ id: 'fixture-app' }, moduleSource({ mutation: true }));
  const registry = await loadAppIntegrations(f.root);
  assert.equal(registry.tools[0].action, 'read');
  assert.equal(registry.tools[0].readOnly, false);
  assert.equal(registry.operationDefinitions['fixture-app'].read.mutation, true);
});

test('missing integration declarations never fall back to a built-in capability table', async t => {
  const f = await fixture(t); await rm(join(f.root, 'third_party/fixture-app/praxis-integration.mjs'));
  await assert.rejects(loadAppIntegrations(f.root), { code: 'ENOENT' });
});

test('integration module and skill symlinks cannot expose files outside the installed source', async t => {
  for (const name of ['praxis-integration.mjs', 'skills/fixture/SKILL.md']) {
    const f = await fixture(t), target = join(f.root, 'third_party/fixture-app', name), outside = join(f.root, 'outside-public-fixture');
    await writeFile(outside, name.endsWith('.mjs') ? moduleSource() : 'Synthetic content');
    await rm(target); await symlink(outside, target);
    await assert.rejects(loadAppIntegrations(f.root), /symbolic links/);
  }
});

test('duplicate routes, tool names and adapter identities fail closed', async t => {
  const apps = [{ id: 'fixture-app' }, { id: 'second-app' }];
  for (const patch of [{ slug: 'fixture-app' }, { adapterId: 'fixture-app' }, { tool: 'fixture_read' }]) {
    const f = await fixture(t, apps);
    await f.put(apps[1], moduleSource({ id: 'second-app', slug: 'second-app', adapterId: 'second-app', tool: 'second_read', ...patch }));
    await writeFile(join(f.root, 'third_party/second-app/skills/fixture/SKILL.md'), '---\nname: fixture-app-skill\ndescription: Synthetic guidance.\n---\n`fixture_read` and `second_read`.\n');
    await assert.rejects(loadAppIntegrations(f.root), /Duplicate/);
  }
});

test('platform namespaces, foreign scopes, invalid native paths and reserved assertion claims are rejected', async t => {
  const invalid = [
    moduleSource({ adapterId: 'spaces' }), moduleSource({ scope: 'foreign:read' }), moduleSource({ tool: 'praxis_refresh_capabilities' }),
    moduleSource().replace("kind:'proxy'", "kind:'static',directory:'../private'"),
    moduleSource().replace("actions:['read']", "assertionFields:['userId'],actions:['read']"),
    moduleSource().replace("kind:'proxy'", "kind:'proxy',corePrefixes:['/api/business/admin']"),
    moduleSource().replace("kind:'proxy'", "kind:'proxy',forwardHeaders:['authorization']"),
    moduleSource().replace("kind:'proxy'", "kind:'proxy',forwardHeaders:['cookie']"),
    moduleSource().replace("kind:'proxy'", "kind:'proxy',forwardHeaders:['host']"),
    moduleSource().replace("kind:'proxy'", `kind:'proxy',forwardHeaders:${JSON.stringify(Array.from({ length: 65 }, (_, index) => `x-safe-${index}`))}`),
    moduleSource().replace("kind:'proxy'", "kind:'proxy',headers:['accept']"),
  ];
  for (const source of invalid) { const f = await fixture(t); await f.put({ id: 'fixture-app' }, source); await assert.rejects(loadAppIntegrations(f.root), { code: 'INVALID_APP_INTEGRATION' }); }
});

test('installation describes capabilities without granting them and removal preserves saved policy', async t => {
  const { AuthStore } = await import('../src/business/auth.mjs');
  const f = await fixture(t), registry = await loadAppIntegrations(f.root), database = join(f.root, 'synthetic-auth.sqlite');
  let auth = new AuthStore({ file: database, issuer: 'https://integration.example.test', registry });
  t.after(() => auth.close());
  for (const user of ['owner', 'member']) auth.createUser({ id: user, username: user, password: 'Synthetic integration password' });
  auth.createSpace({ id: 'space-a', type: 'company', ownerId: 'owner' });
  auth.setMembership({ spaceId: 'space-a', userId: 'member', role: 'member' });
  auth.setWebAccess({ userId: 'member', apps: ['fixture-app'], workbench: true, prds: false });
  auth.configureWebAccessBoundary({ enabled: true, apps: { 'fixture-app': { spaces: ['space-a'] } } });
  assert.deepEqual(auth.userPermissions('member', 'space-a', 'fixture-app', 'read'), []);
  auth.grantResource({ userId: 'member', spaceId: 'space-a', appId: 'fixture-app', resources: ['object-a'], actions: ['read'] });
  auth.createClient({ id: 'fixture-client', name: 'Synthetic integration client', redirectUris: ['https://client.example/callback'] });
  const grant = auth.createGrant({ userId: 'member', clientId: 'fixture-client', rules: [{ appId: 'fixture-app', spaceId: 'space-a', resources: ['object-a'], actions: ['read'] }] });
  const token = auth.issueToken({ grantId: grant.id }).accessToken;
  assert.deepEqual(auth.authorize(token, { appId: 'fixture-app', spaceId: 'space-a', resourceId: 'object-a', action: 'read' }).resources, ['object-a']);
  assert.throws(() => auth.authorize(token, { appId: 'fixture-app', spaceId: 'space-a', resourceId: 'object-b', action: 'read' }), { code: 'FORBIDDEN' });
  const policy = auth.db.prepare('SELECT apps FROM auth_web_access WHERE user_id=?').get('member').apps;
  auth.close();
  await writeFile(join(f.root, 'config/installed-apps.json'), JSON.stringify({ schemaVersion: 1, apps: [] }));
  const removed = await loadAppIntegrations(f.root);
  auth = new AuthStore({ file: database, issuer: 'https://integration.example.test', registry: removed });
  assert.deepEqual(auth.getWebEntryPolicy('member').apps, []);
  assert.equal(auth.db.prepare('SELECT apps FROM auth_web_access WHERE user_id=?').get('member').apps, policy);
  assert.equal(auth.getGrant(grant.id).id, grant.id);
  assert.throws(() => auth.authorize(token, { appId: 'fixture-app', spaceId: 'space-a', resourceId: 'object-a', action: 'read' }), { code: 'FORBIDDEN' });
});

test('explicitly inactive retained app configuration does not prevent active Core startup', async t => {
  const { loadBusinessConfig } = await import('../src/business/config.mjs');
  const f = await fixture(t), registry = await loadAppIntegrations(f.root);
  const keyFile = join(f.root, 'active.key'), configFile = join(f.root, 'core.json');
  await writeFile(keyFile, 'Synthetic active adapter signing key material', { mode: 0o600 });
  const config = { issuer: 'https://integration.example.test', database: join(f.root, 'auth.db'), eventsDatabase: join(f.root, 'events.db'), apps: {
    'fixture-app': { url: 'http://127.0.0.1:17800/api/business', keyFile, spaces: ['space-a'] },
    retired: { url: 'http://127.0.0.1:17801/api/business', keyFile: join(f.root, 'retained-but-offline.key'), spaces: ['space-a'] },
  }, inactiveApps: ['retired'] };
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const before = await readFile(configFile, 'utf8'), loaded = await loadBusinessConfig(configFile, { registry });
  assert.deepEqual(Object.keys(loaded.apps), ['fixture-app']);
  assert.deepEqual(loaded.inactiveAppConfigurations.retired, config.apps.retired);
  assert.equal(await readFile(configFile, 'utf8'), before);
  assert.ok(!JSON.stringify(loaded).includes('retained-but-offline.key'));
  delete config.inactiveApps; await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await assert.rejects(loadBusinessConfig(configFile, { registry }), { code: 'INVALID_ADAPTER' });
});
