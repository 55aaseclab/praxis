import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuthStore } from '../src/business/auth.mjs';
import { BusinessEvents } from '../src/business/events.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { loadAppIntegrations } from '../src/app-integrations.mjs';
import { writeInstalledAppsFixture } from './helpers/app-manifest-fixture.mjs';

const appId = 'sample-notebook';
const declaration = `export function createIntegration({z}) {
 const invocation=z.object({appId:z.literal('sample-notebook'),operation:z.enum(['read','write']),spaceId:z.string(),resourceId:z.string(),expectedRevision:z.number().int().nonnegative().optional(),idempotencyKey:z.string().optional(),input:z.object({text:z.string().max(200)}).strict().optional()}).strict();
 return {schemaVersion:1,appId:'sample-notebook',web:{slug:'sample-notebook',policy:'grant',kind:'proxy',nativePort:45125},business:{adapterId:'sample-notebook',actions:['read','update'],scopes:{'sample-notebook:read':['read'],'sample-notebook:write':['update']},operations:{read:{action:'read',mutation:false},write:{action:'update',mutation:true}},
 tools:[{name:'sample_notebook_read',operation:'read',action:'read',description:'Read one authorized synthetic notebook.',schema:z.object({spaceId:z.string(),resourceId:z.string()}).strict()}, {name:'sample_notebook_write',operation:'write',action:'update',description:'Write one text field at its actual revision using a stable key.',schema:z.object({spaceId:z.string(),resourceId:z.string(),expectedRevision:z.number().int().nonnegative(),idempotencyKey:z.string(),text:z.string().max(200)}).strict(),input:args=>({text:args.text})}],skill:{name:'sample-notebook',path:'skills/notebook/SKILL.md'},validateInvocation(request){const value=invocation.safeParse(request);if(!value.success||request.operation==='write'&&(request.expectedRevision===undefined||!request.input))throw Object.assign(new Error('INVALID_INPUT'),{status:400,code:'INVALID_INPUT'});}}};}
`;

test('an additional source-owned app executes real signed SDK writes and readback with no Core app registration', { timeout: 15000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'praxis-extra-app-http-'));
  await writeInstalledAppsFixture(root, [{ id: appId, name: 'Sample notebook' }]);
  const appRoot = join(root, 'third_party', appId);
  await writeFile(join(appRoot, 'praxis-integration.mjs'), declaration);
  await mkdir(join(appRoot, 'skills/notebook'), { recursive: true });
  await writeFile(join(appRoot, 'skills/notebook/SKILL.md'), '---\nname: sample-notebook\ndescription: Synthetic notebook operations.\n---\nUse `sample_notebook_read` before `sample_notebook_write`, then read back.\n## 简体中文\n先用 `sample_notebook_read` 回读，再以 `sample_notebook_write` 保存并核对。\n');
  const registry = await loadAppIntegrations(root), key = Buffer.alloc(32, 23), value = { revision: 0, text: '' }, ledger = new Map();
  let nativeCalls = 0;
  const native = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const part of request) chunks.push(part); const raw = Buffer.concat(chunks);
      const [payload, signature] = String(request.headers['x-praxis-assertion']).split('.');
      const actual = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', key).update(payload).digest();
      assert.equal(actual.length, expected.length); assert.equal(timingSafeEqual(actual, expected), true);
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()), input = JSON.parse(raw);
      assert.equal(claims.bodyHash, createHash('sha256').update(raw).digest('hex'));
      assert.equal(claims.appId, appId); assert.equal(claims.method, 'POST'); assert.equal(claims.path, '/api/business'); assert.ok(claims.expiresAt > Date.now());
      assert.ok(claims.resources.includes(input.resourceId)); nativeCalls++;
      let result = { revision: value.revision, text: value.text };
      if (input.operation === 'write') {
        assert.equal(claims.action, 'update'); const fingerprint = JSON.stringify(input);
        if (ledger.has(input.idempotencyKey)) { assert.equal(ledger.get(input.idempotencyKey).fingerprint, fingerprint); result = ledger.get(input.idempotencyKey).result; }
        else if (input.expectedRevision !== value.revision) { response.writeHead(409, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'REVISION_CONFLICT' })); return; }
        else { value.text = input.input.text; value.revision++; result = { revision: value.revision, text: value.text }; ledger.set(input.idempotencyKey, { fingerprint, result }); }
      } else assert.equal(claims.action, 'read');
      response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result));
    } catch { response.writeHead(401, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ code: 'INVALID_ASSERTION' })); }
  });
  native.listen(0, '127.0.0.1'); await once(native, 'listening');
  let core;
  const server = createServer((request, response) => core.emit('request', request, response));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, auth = new AuthStore({ file: join(root, 'auth.db'), issuer: origin, registry }), events = new BusinessEvents(join(root, 'events.db'));
  for (const id of ['owner', 'member']) auth.createUser({ id, username: id, password: 'Synthetic notebook password' });
  auth.createSpace({ id: 'space-a', type: 'company', ownerId: 'owner' }); auth.setMembership({ userId: 'member', spaceId: 'space-a', role: 'member' });
  assert.deepEqual(auth.userPermissions('member', 'space-a', appId, 'read'), []);
  auth.grantResource({ userId: 'member', spaceId: 'space-a', appId, actions: ['read', 'update'], resources: ['object-a'] });
  auth.createClient({ id: 'notebook-client', name: 'Synthetic SDK client', redirectUris: ['https://client.example/callback'] });
  const grant = auth.createGrant({ userId: 'member', clientId: 'notebook-client', rules: [{ appId, spaceId: 'space-a', actions: ['read', 'update'], resources: ['object-a'] }] });
  const token = auth.issueToken({ grantId: grant.id }).accessToken;
  core = createBusinessServer({ auth, events, registry, config: { issuer: origin, database: auth.file, eventsDatabase: events.file, observationsFile: join(root, 'observations.db'), apps: { [appId]: { key, url: `http://127.0.0.1:${native.address().port}/api/business`, spaces: ['space-a'] } } }, pollMs: 60000 });
  const client = new Client({ name: 'extra-app-proof', version: '1.0.0' });
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await core.core.shutdown(); core.close(() => {}); native.closeAllConnections(); await new Promise(resolve => native.close(resolve)); auth.close(); events.close(); await rm(root, { recursive: true, force: true }); });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const tools = await client.listTools(); assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['praxis_refresh_capabilities', 'sample_notebook_read', 'sample_notebook_write']);
  const skill = await client.readResource({ uri: 'praxis://skills/sample-notebook' }); assert.match(skill.contents[0].text, /sample_notebook_write/);
  const write = { spaceId: 'space-a', resourceId: 'object-a', expectedRevision: 0, idempotencyKey: 'intent-a', text: 'Synthetic source-owned result' };
  const first = await client.callTool({ name: 'sample_notebook_write', arguments: write }); assert.equal(first.isError, undefined); assert.equal(first.structuredContent.revision, 1);
  const repeated = await client.callTool({ name: 'sample_notebook_write', arguments: write }); assert.equal(repeated.structuredContent.revision, 1); assert.equal(value.revision, 1);
  const readback = await client.callTool({ name: 'sample_notebook_read', arguments: { spaceId: 'space-a', resourceId: 'object-a' } }); assert.equal(readback.structuredContent.text, write.text); assert.equal(readback.structuredContent.revision, 1);
  const conflict = await client.callTool({ name: 'sample_notebook_write', arguments: { ...write, idempotencyKey: 'intent-b' } }); assert.equal(conflict.isError, true); assert.match(conflict.content[0].text, /REVISION_CONFLICT/);
  const count = nativeCalls;
  const denied = await client.callTool({ name: 'sample_notebook_read', arguments: { spaceId: 'space-a', resourceId: 'object-b' } }); assert.equal(denied.isError, true); assert.equal(nativeCalls, count);
  const report = events.tracePage({ source: 'mcp' }); assert.ok(report.items.every(item => item.appId === appId)); assert.ok(report.items.some(item => item.outcome === 'denied')); assert.ok(!JSON.stringify(report).includes(write.text));
  auth.revokeGrant(grant.id);
  await assert.rejects(client.callTool({ name: 'sample_notebook_read', arguments: { spaceId: 'space-a', resourceId: 'object-a' } })); assert.equal(nativeCalls, count);
});
