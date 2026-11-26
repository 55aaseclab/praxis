import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { exchangeAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { AuthStore, hashVerifier } from '../src/business/auth.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { createPublicMcpHandler } from '../src/public-mcp.mjs';
import { BusinessService } from '../third_party/projects/src/business.mjs';
import { createServer as createProjectsServer } from '../third_party/projects/src/server.mjs';
import { ProjectStore } from '../third_party/projects/src/store.mjs';

// Real protocol/client and signed native service; every file and identity is an
// isolated synthetic fixture. This is technical evidence, not business acceptance.
test('public guidance, designated OAuth tokens and SDK calls carry the same authorized space', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-mcp-space-chain-'));
  const keyFile = join(directory, 'adapter.key'), key = randomBytes(48), spaceId = 'synthetic-designated-space';
  await writeFile(keyFile, key, { mode: 0o600 });
  const nativeStore = new ProjectStore(join(directory, 'projects.db'));
  const native = createProjectsServer({ store: nativeStore, business: new BusinessService({ store: nativeStore, key, spaces: [spaceId] }) });
  await new Promise(resolve => native.listen(0, '127.0.0.1', resolve));
  let core, publicGuide;
  const server = createServer(async (request, response) => {
    if (!await publicGuide(request, response)) core.emit('request', request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  const clients = [], calls = [];
  publicGuide = createPublicMcpHandler({ origin });
  core = createBusinessServer({ auth, pollMs: 60000, config: {
    issuer: origin, database: auth.file, eventsDatabase: join(directory, 'events.sqlite'), observationsFile: join(directory, 'observations.sqlite'),
    allowedHosts: [new URL(origin).host], apps: { projects: { managed: true, keyFile, spaces: [spaceId, 'synthetic-unconsented-space'], url: `http://127.0.0.1:${native.address().port}/api/business` } },
  } });
  t.after(async () => {
    await Promise.allSettled(clients.map(client => client.close())); publicGuide.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await core.core.shutdown(); core.core.events.close(); core.close(() => {});
    native.closeAllConnections(); await new Promise(resolve => native.close(resolve));
    nativeStore.close();
    auth.close(); await rm(directory, { recursive: true, force: true });
  });
  const password = 'Synthetic-SDK-designation-password-2026';
  auth.createUser({ id: 'synthetic-owner', username: 'synthetic-owner', password });
  auth.createSpace({ id: spaceId, type: 'personal', ownerId: 'synthetic-owner' });
  auth.createSpace({ id: 'synthetic-unconsented-space', type: 'family', ownerId: 'synthetic-owner' });
  auth.createClient({ id: 'synthetic-sdk', name: 'Synthetic space chain SDK', redirectUris: ['https://client.example/callback'] });
  async function connect(path, token) {
    const client = new Client({ name: 'synthetic-space-chain', version: '1.0.0' }); clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(path, origin), {
      requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : {},
      fetch: (url, init) => {
        if (typeof init?.body === 'string') {
          const body = JSON.parse(init.body);
          if (body.method === 'tools/call') calls.push(body.params);
        }
        return fetch(url, init);
      },
    }));
    return client;
  }
  const guideClient = await connect('/mcp/guide');
  const guide = (await guideClient.callTool({ name: 'praxis_use_guide', arguments: { platform: 'other' } })).structuredContent;
  const guidanceText = JSON.stringify(guide);
  assert.match(guidanceText, /space_id/); assert.match(guidanceText, /spaceId/);
  assert.match(guidanceText, /praxis_refresh_capabilities/);
  const json = async (path, input, headers = {}) => fetch(origin + path, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(input) });
  const login = await json('/auth/login', { username: 'synthetic-owner', password });
  const cookie = login.headers.get('set-cookie').split(';')[0], session = await login.json();
  const verifier = 'synthetic-space-chain-pkce-'.repeat(3);
  async function consentCode() {
    const path = '/oauth/authorize?' + new URLSearchParams({ client_id: 'synthetic-sdk', redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: hashVerifier(verifier), resource: origin + '/mcp', scope: 'projects:read', state: 'synthetic-space-chain', space_id: spaceId });
    const page = await fetch(origin + path, { headers: { Cookie: cookie } });
    assert.equal(page.status, 200); const html = await page.text();
    assert.match(html, new RegExp(`<option value="${spaceId}" selected>`));
    assert.doesNotMatch(html, /<button>Choose space/);
    const consent = html.match(/name="consent" value="([^"]+)"/)[1];
    const approved = await json(path, { csrf: session.csrfToken, consent, space_id: spaceId, rule_0: '1' }, { Cookie: cookie });
    assert.equal(approved.status, 303);
    const destination = new URL(approved.headers.get('location'));
    assert.equal(destination.searchParams.get('state'), 'synthetic-space-chain');
    return destination.searchParams.get('code');
  }
  const rawResponse = await json('/oauth/token', { grant_type: 'authorization_code', code: await consentCode(), client_id: 'synthetic-sdk', redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: origin + '/mcp' });
  assert.equal(rawResponse.status, 200); const rawToken = await rawResponse.json();
  assert.equal(rawToken.space_id, spaceId);
  const rawClient = await connect('/mcp', rawToken.access_token);
  const rawRead = await rawClient.callTool({ name: 'projects_list', arguments: { spaceId: rawToken.space_id } });
  assert.notEqual(rawRead.isError, true); assert.deepEqual(rawRead.structuredContent.items, []);
  const refreshed = await json('/oauth/token', { grant_type: 'refresh_token', refresh_token: rawToken.refresh_token, client_id: 'synthetic-sdk', resource: origin + '/mcp' });
  assert.equal(refreshed.status, 200); assert.equal((await refreshed.json()).space_id, spaceId);

  const sdkToken = await exchangeAuthorization(new URL(origin), {
    metadata: { token_endpoint: origin + '/oauth/token', token_endpoint_auth_methods_supported: ['none'] },
    clientInformation: { client_id: 'synthetic-sdk', token_endpoint_auth_method: 'none' }, authorizationCode: await consentCode(),
    codeVerifier: verifier, redirectUri: 'https://client.example/callback', resource: new URL('/mcp', origin),
  });
  assert.equal(Object.hasOwn(sdkToken, 'space_id'), false, 'installed SDK strips custom token extensions');
  const sdkClient = await connect('/mcp', sdkToken.access_token);
  assert.match(sdkClient.getInstructions(), new RegExp(spaceId));
  assert.doesNotMatch(sdkClient.getInstructions(), /synthetic-unconsented-space/);
  const capabilityResult = await sdkClient.callTool({ name: 'praxis_refresh_capabilities', arguments: {} });
  assert.notEqual(capabilityResult.isError, true);
  const capabilities = capabilityResult.structuredContent;
  assert.deepEqual(capabilities.spaces, [{ spaceId, apps: [{ id: 'projects', actions: ['read'] }] }]);
  const fallbackRead = await sdkClient.callTool({ name: 'projects_list', arguments: { spaceId: capabilities.spaces[0].spaceId } });
  assert.notEqual(fallbackRead.isError, true); assert.deepEqual(fallbackRead.structuredContent.items, []);
  assert.equal((await sdkClient.callTool({ name: 'projects_list', arguments: { spaceId: 'synthetic-unconsented-space' } })).isError, true);
  assert.equal(calls.filter(call => call.name === 'projects_list' && call.arguments.spaceId === spaceId).length, 2, 'actual SDK tools/call requests carry raw and recovered IDs');

  // A legacy two-space connection remains valid when one enrollment is removed;
  // capability refresh must recompute its projection rather than keep old IDs.
  const grant = auth.createGrant({ userId: 'synthetic-owner', clientId: 'synthetic-sdk', rules: [spaceId, 'synthetic-unconsented-space'].map(id => ({ appId: 'projects', spaceId: id, actions: ['read'], resources: ['*'] })) });
  const legacy = await connect('/mcp', auth.issueToken({ grantId: grant.id }).accessToken);
  const before = await legacy.callTool({ name: 'praxis_refresh_capabilities', arguments: {} });
  assert.equal(before.structuredContent.spaces.length, 2);
  auth.setSpaceAppEnrollment({ spaceId, appId: 'projects', enabled: false });
  const after = await legacy.callTool({ name: 'praxis_refresh_capabilities', arguments: {} });
  assert.notEqual(after.isError, true);
  assert.deepEqual(after.structuredContent.spaces, [{ spaceId: 'synthetic-unconsented-space', apps: [{ id: 'projects', actions: ['read'] }] }]);
  assert.doesNotMatch(after.structuredContent.instructions, new RegExp(spaceId));
  assert.equal((await legacy.callTool({ name: 'memo_list_topics', arguments: { spaceId } })).isError, true, 'removed catalog entry cannot be used through a stale SDK connection');
});
