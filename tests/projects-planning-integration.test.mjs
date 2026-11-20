import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AuthStore } from '../src/business/auth.mjs';
import { BusinessEvents } from '../src/business/events.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

const password = 'Synthetic Projects protocol acceptance password';
const common = { spaceId: 'space-a', resourceId: 'alpha' };
const assignment = (userId, patch = {}) => ({ userId, projectDecision: false, teamDecision: [], teams: [], ...patch });
const completeChanges = name => [{ op: 'set_prd_field', field: 'problem', value: `${name} problem` }, { op: 'set_prd_field', field: 'scope', value: `${name} scope` }, { op: 'upsert_goal', item: { id: 'goal', text: `${name} goal` } }, { op: 'upsert_criterion', item: { id: 'criterion', text: `${name} criterion`, goalIds: ['goal'] } }];
const milestone = ownerUserId => ({ id: 'launch', title: 'Synthetic launch', goalIds: ['research:goal'], criterionIds: ['research:criterion'], status: 'todo', priority: 'P1', commitment: 'tentative', ownerUserId, dueDate: null, dependsOn: [], order: 0 });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'projects-oauth-sdk-')), registry = DEFAULT_APP_REGISTRY, source = resolve(registry.root, registry.getApp('projects').source);
  const [{ ProjectStore }, { BusinessService }, { createServer: createProjectsServer }] = await Promise.all(['store', 'business', 'server'].map(name => import(pathToFileURL(join(source, 'src', `${name}.mjs`)).href)));
  const key = randomBytes(48), file = join(root, 'projects.db'); let store = new ProjectStore(file), native;
  async function openNative(port = 0) { native = createProjectsServer({ store, business: new BusinessService({ store, key, spaces: ['space-a'] }) }); native.listen(port, '127.0.0.1'); await once(native, 'listening'); }
  await openNative();
  let core;
  const server = createServer((request, response) => core.emit('request', request, response)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`, auth = new AuthStore({ file: join(root, 'auth.db'), issuer: origin, registry }), events = new BusinessEvents(join(root, 'events.db')), clients = [];
  const ids = ['manager', 'lead', 'alice', 'platform-admin', 'outside', 'disabled'];
  for (const id of ids) { auth.createUser({ id, username: id, password }); auth.setWebAccess({ userId: id, apps: ['projects'], workbench: true, prds: false }); }
  auth.setPlatformAdmin({ userId: 'platform-admin', enabled: true }); auth.createSpace({ id: 'space-a', type: 'company', ownerId: 'manager' });
  for (const id of ids.filter(id => id !== 'manager')) auth.setMembership({ userId: id, spaceId: 'space-a', role: 'member' });
  const grants = {};
  for (const id of ids.filter(id => id !== 'manager')) grants[id] = auth.grantResource({ userId: id, spaceId: 'space-a', appId: 'projects', resources: [id === 'outside' ? 'beta' : 'alpha'], actions: id === 'lead' || id === 'platform-admin' ? ['read', 'update', 'accept_plan'] : ['read', 'update'] });
  auth.setUserEnabled('disabled', false);
  core = createBusinessServer({ auth, events, registry, config: { issuer: origin, database: auth.file, eventsDatabase: events.file, observationsFile: join(root, 'observations.db'), webGateway: { enabled: true }, apps: { projects: { key, url: `http://127.0.0.1:${native.address().port}/api/business`, spaces: ['space-a'] } } }, pollMs: 60000 });
  t.after(async () => { await Promise.allSettled(clients.map(client => client.close())); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await core.core.shutdown(); core.close(() => {}); native.closeAllConnections(); await new Promise(resolve => native.close(resolve)); store.close(); auth.close(); events.close(); await rm(root, { recursive: true, force: true }); });
  const json = (path, body, headers = {}) => fetch(origin + path, { redirect: 'manual', method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const registration = await json('/oauth/register', { client_name: 'Synthetic Projects SDK', redirect_uris: ['https://client.example/callback'] }); assert.equal(registration.status, 201); const clientId = (await registration.json()).client_id;
  async function oauth(userId, actions, scopes) {
    const verifier = randomBytes(48).toString('base64url'), query = new URLSearchParams({ client_id: clientId, redirect_uri: 'https://client.example/callback', response_type: 'code', code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: `${origin}/mcp`, scope: scopes.join(' '), state: 'synthetic-state' }), path = '/oauth/authorize?' + query;
    const needsLogin = await fetch(origin + path, { redirect: 'manual' }); assert.equal(needsLogin.status, 303);
    const login = await json('/auth/login', { username: userId, password }); assert.equal(login.status, 200); const session = await login.json(), cookie = login.headers.get('set-cookie').split(';')[0];
    const form = await fetch(origin + path, { headers: { Cookie: cookie } }); assert.equal(form.status, 200); assert.match(await form.text(), /Authorize external agent/);
    const consent = await json(path, { rules: [{ appId: 'projects', spaceId: 'space-a', resources: ['alpha'], actions }] }, { Cookie: cookie, 'X-CSRF-Token': session.csrfToken }); assert.equal(consent.status, 303);
    const destination = new URL(consent.headers.get('location')); assert.equal(destination.searchParams.get('state'), 'synthetic-state'); assert.equal(destination.searchParams.get('iss'), origin);
    const exchange = { grant_type: 'authorization_code', code: destination.searchParams.get('code'), client_id: clientId, redirect_uri: 'https://client.example/callback', code_verifier: verifier, resource: `${origin}/mcp` };
    const wrong = await json('/oauth/token', { ...exchange, code_verifier: 'x'.repeat(64) }); assert.equal(wrong.status, 400);
    const response = await json('/oauth/token', exchange); assert.equal(response.status, 200); const tokens = await response.json();
    const reused = await json('/oauth/token', exchange); assert.equal(reused.status, 400);
    const client = new Client({ name: 'Projects protocol fixture', version: '1.0.0' }); clients.push(client); await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { Authorization: `Bearer ${tokens.access_token}` } } }));
    return { client, tokens, grantId: auth.authenticate(tokens.access_token).grantId, cookie, csrf: session.csrfToken };
  }
  let sequence = 0;
  async function raw(actor, name, args = {}) { return actor.client.callTool({ name: 'projects_' + name, arguments: { ...common, ...args } }); }
  async function call(actor, name, args = {}) { const result = await raw(actor, name, args); if (result.isError) { const error = JSON.parse(result.content[0].text); throw Object.assign(new Error(error.code), error); } return result.structuredContent; }
  async function denied(actor, name, args, codes) { const result = await raw(actor, name, args); assert.equal(result.isError, true); let error; try { error = JSON.parse(result.content[0].text); } catch { assert.match(result.content[0].text, /MCP error .*Tool .* not found/); error = { code: 'TOOL_UNAVAILABLE' }; } assert.ok(codes.includes(error.code), `Expected ${codes.join('/')} but got ${error.code}`); return error; }
  const mutate = (actor, name, args, revision) => call(actor, name, { ...args, expectedRevision: revision, idempotencyKey: 'intent-' + ++sequence });
  return { root, auth, events, grants, oauth, json, raw, call, denied, mutate, async restart() { const port = native.address().port; native.closeAllConnections(); await new Promise(resolve => native.close(resolve)); store.close(); store = new ProjectStore(file); await openNative(port); }, get store() { return store; } };
}

test('actual OAuth/PKCE and SDK preserve Projects planning authority through P0 and P1', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  const manager = await f.oauth('manager', ['read', 'create', 'update', 'accept_plan', 'manage_planning_roles'], ['projects:read', 'projects:write', 'projects:accept', 'projects:roles']);
  const lead = await f.oauth('lead', ['read', 'update', 'accept_plan'], ['projects:read', 'projects:write', 'projects:accept']);
  const alice = await f.oauth('alice', ['read', 'update'], ['projects:read', 'projects:write']);
  const limitedLead = await f.oauth('lead', ['read', 'update'], ['projects:read', 'projects:write']);
  const administrator = await f.oauth('platform-admin', ['read', 'update', 'accept_plan'], ['projects:read', 'projects:write', 'projects:accept']);
  const metadata = await (await fetch(f.auth.issuer + '/.well-known/oauth-authorization-server')).json(); assert.ok(metadata.scopes_supported.includes('projects:accept')); assert.ok(metadata.scopes_supported.includes('projects:roles'));
  const created = await f.call(manager, 'create', { name: 'Synthetic planning project', goal: 'Preserve execution facts', owner: 'platform-admin', idempotencyKey: 'create-alpha' }); assert.equal(created.project.id, 'alpha');
  const legacy = (await f.call(manager, 'read')).project;
  const view = actor => f.call(actor, 'read_planning');
  let state = await view(manager); assert.equal(state.branches.length, 5); assert.ok(state.branches.every(branch => !branch.adopted && branch.headRevision === '0')); assert.equal(state.rolesRevision, '0');
  // A platform role and a legacy display label cannot stand in for the designated business role.
  await f.denied(administrator, 'adopt_plan', { branchId: 'project', changes: completeChanges('Denied'), reason: 'No designated decision role', expectedRevision: '0', idempotencyKey: 'admin-no-fallback' }, ['ROLE_REQUIRED']);
  await f.denied(manager, 'adopt_plan', { branchId: 'project', changes: completeChanges('Denied'), reason: 'No designated decision role', expectedRevision: '0', idempotencyKey: 'manager-no-fallback' }, ['ROLE_REQUIRED']);
  for (const userId of ['missing', 'disabled', 'outside']) {
    await f.denied(manager, 'set_planning_roles', { assignments: [assignment(userId, { teams: ['research'] })], removeUserIds: [], expectedRevision: state.rolesRevision, idempotencyKey: 'invalid-subject-' + userId }, ['INVALID_SUBJECT']);
    assert.equal((await view(manager)).rolesRevision, state.rolesRevision);
  }
  await f.mutate(manager, 'set_planning_roles', { assignments: [assignment('lead', { projectDecision: true, teamDecision: ['research'], teams: ['research'] }), assignment('alice', { teams: ['research'] })], removeUserIds: [] }, state.rolesRevision);
  const roleAudit = (await f.call(manager, 'read_plan_history')).items.find(item => item.kind === 'set_planning_roles');
  assert.deepEqual(roleAudit.roleChanges.assignments.map(value => value.userId).sort(), ['alice', 'lead']); assert.equal(roleAudit.actor.userId, 'manager'); assert.equal(roleAudit.actor.grantId, manager.grantId);
  assert.ok((await f.call(alice, 'read_plan_history')).items.every(item => !Object.hasOwn(item, 'roleChanges')));
  const limitedTools = await limitedLead.client.listTools(); assert.ok(!limitedTools.tools.some(tool => tool.name === 'projects_adopt_plan'));
  await f.denied(limitedLead, 'adopt_plan', { branchId: 'project', changes: completeChanges('Denied'), reason: 'Missing delegated acceptance', expectedRevision: '0', idempotencyKey: 'narrow-no-accept' }, ['FORBIDDEN', 'TOOL_UNAVAILABLE']);
  const projectAdoption = await f.mutate(lead, 'adopt_plan', { branchId: 'project', changes: completeChanges('Project P0'), reason: 'Designated project decision' }, '0');
  const teamAdoption = await f.mutate(lead, 'adopt_plan', { branchId: 'team:research', changes: completeChanges('Research P0'), reason: 'Designated team decision' }, '0');
  assert.equal((await f.call(lead, 'read_plan_version', { versionId: projectAdoption.versionId })).version.plan.prd.scope, 'Project P0 scope');
  assert.equal((await f.call(lead, 'read_plan_version', { versionId: teamAdoption.versionId })).version.plan.prd.scope, 'Research P0 scope');
  state = await view(alice); const team = state.branches.find(branch => branch.id === 'team:research');
  const personal = await f.mutate(alice, 'create_personal_branch', { teamId: 'research' }, team.headRevision); const branchId = personal.branchId;
  let personalState = (await view(alice)).branches.find(branch => branch.id === branchId);
  const initialPersonalRevision = personalState.headRevision;
  await f.denied(alice, 'save_plan', { branchId, changes: [{ op: 'upsert_milestone', item: milestone('outside') }], expectedRevision: initialPersonalRevision, idempotencyKey: 'invalid-assignee' }, ['INVALID_SUBJECT']);
  assert.equal((await view(alice)).branches.find(branch => branch.id === branchId).headRevision, initialPersonalRevision);
  const saved = await f.mutate(alice, 'save_plan', { branchId, changes: [{ op: 'upsert_milestone', item: milestone('alice') }] }, initialPersonalRevision);
  assert.equal((await f.call(alice, 'read_plan_version', { versionId: saved.versionId })).version.plan.roadmap.milestones[0].ownerUserId, 'alice');
  let current = await view(alice), proposal = await f.mutate(alice, 'submit_proposal', { sourceBranchId: branchId, targetBranchId: 'team:research', targetRevision: current.branches.find(branch => branch.id === 'team:research').headRevision, purpose: 'Synthetic bounded milestone', impact: 'One tentative milestone for review', evidence: [] }, saved.versionId);
  const decide = async id => { const p = (await view(lead)).proposals.find(value => value.id === id); return f.mutate(lead, 'decide_proposal', { proposalId: id, decision: 'accept', reason: 'Designated acceptance after readback', sourceRevision: p.sourceRevision, targetRevision: p.targetRevision }, p.revision); };
  await decide(proposal.proposalId);
  current = await view(lead); const acceptedTeam = current.branches.find(branch => branch.id === 'team:research'); assert.equal(acceptedTeam.plan.roadmap.milestones[0].id, 'research:launch');
  const comparison = await f.call(lead, 'compare_plan', { sourceBranchId: 'team:research', targetBranchId: 'project' });
  proposal = await f.mutate(lead, 'submit_proposal', { sourceBranchId: 'team:research', targetBranchId: 'project', targetRevision: current.branches.find(branch => branch.id === 'project').headRevision, changes: comparison.changes.map(change => change.change), purpose: 'Reviewed research contribution', impact: 'Keep project meaning and add qualified items', evidence: [] }, acceptedTeam.headRevision);
  await decide(proposal.proposalId);
  const p0 = (await view(lead)).branches.find(branch => branch.id === 'project'); assert.equal(p0.plan.prd.scope, 'Project P0 scope'); assert.equal(p0.plan.roadmap.milestones[0].id, 'research:launch');
  // A restore creates another version and uses the same compare/proposal/decision path.
  personalState = (await view(alice)).branches.find(branch => branch.id === branchId);
  const restoreKey = 'restore-synthetic-history', restoreArgs = { branchId, versionId: teamAdoption.versionId, reason: 'Reconsider the earlier team snapshot', expectedRevision: personalState.headRevision, idempotencyKey: restoreKey };
  const restored = await f.call(alice, 'restore_plan', restoreArgs); assert.notEqual(restored.versionId, teamAdoption.versionId);
  assert.equal((await f.call(alice, 'restore_plan', restoreArgs)).versionId, restored.versionId);
  assert.equal((await f.call(alice, 'read_plan_version', { versionId: restored.versionId })).version.plan.roadmap.milestones.length, 0);
  assert.equal((await view(lead)).branches.find(branch => branch.id === 'team:research').headRevision, acceptedTeam.headRevision);
  const receipt = await f.call(alice, 'read_planning_receipt', { key: restoreKey }); assert.equal(receipt.found, true); assert.equal(receipt.receipt.versionId, restored.versionId); assert.equal((await f.call(lead, 'read_planning_receipt', { key: restoreKey })).found, false);
  await f.restart(); assert.equal((await f.call(alice, 'read_plan_version', { versionId: restored.versionId })).version.plan.roadmap.milestones.length, 0);
  current = await view(alice); proposal = await f.mutate(alice, 'submit_proposal', { sourceBranchId: branchId, targetBranchId: 'team:research', targetRevision: current.branches.find(branch => branch.id === 'team:research').headRevision, purpose: 'Review restored candidate', impact: 'Remove the tentative milestone through ordinary review', evidence: [] }, restored.versionId);
  await decide(proposal.proposalId);
  assert.equal((await view(lead)).branches.find(branch => branch.id === 'team:research').plan.roadmap.milestones.length, 0);
  assert.deepEqual((await f.call(manager, 'read')).project, legacy);
  // Revoke the designated role and then the delegation, preserving the committed versions.
  state = await view(manager); await f.mutate(manager, 'set_planning_roles', { assignments: [], removeUserIds: ['lead'] }, state.rolesRevision);
  assert.deepEqual((await f.call(manager, 'read_plan_history')).items.find(item => item.kind === 'set_planning_roles').roleChanges.removedUserIds, ['lead']);
  const committed = (await view(manager)).branches.find(branch => branch.id === 'project').headRevision;
  await f.denied(lead, 'adopt_plan', { branchId: 'project', changes: completeChanges('Denied'), reason: 'Role revoked', expectedRevision: committed, idempotencyKey: 'revoked-role' }, ['ROLE_REQUIRED']);
  assert.equal((await view(manager)).branches.find(branch => branch.id === 'project').headRevision, committed);
  const ownRevision = (await view(alice)).branches.find(branch => branch.id === branchId).headRevision;
  const versions = () => f.store.db.prepare('SELECT COUNT(*) AS n FROM planning_versions').get().n;
  const beforeRevoke = versions(), deniedWrite = { branchId, changes: [{ op: 'set_prd_field', field: 'scope', value: 'Must not be committed' }], expectedRevision: ownRevision, idempotencyKey: 'revoked-resource-write' };
  f.auth.revokeResource(f.grants.alice.id);
  try { await f.denied(alice, 'save_plan', deniedWrite, ['FORBIDDEN', 'TOOL_UNAVAILABLE']); }
  catch (error) { assert.ok([401, 403].includes(error.code), 'Revoked effective resource rules reject the transport.'); }
  assert.equal(versions(), beforeRevoke);
  const revoke = await f.json('/oauth/revoke', { token: alice.tokens.refresh_token, client_id: f.auth.authenticate(manager.tokens.access_token).clientId }); assert.equal(revoke.status, 200);
  await assert.rejects(f.raw(alice, 'read_planning'));
  await assert.rejects(f.raw(alice, 'save_plan', { ...deniedWrite, idempotencyKey: 'revoked-delegation-write' })); assert.equal(versions(), beforeRevoke);
  assert.ok(!JSON.stringify(f.events.tracePage({ source: 'mcp', window: 'week' })).includes('Project P0 problem'));
});
