import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { actorKeys, campaigns, draw, models } from './ai-native/campaigns.mjs';
import { Controller, metrics, privatePath, validatePacket } from './ai-native/controller.mjs';
import { Paseo } from './ai-native/adapters/paseo.mjs';
import { collect, dispatch, reconcile } from './ai-native/runner.mjs';
import { maintenancePrompt, workerPrompt } from './ai-native/prompts.mjs';
import { main } from './ai-native/cli.mjs';

const exec = promisify(execFile);
function config() {
  return { origin: 'https://public.example.test', coordinator: { workspaceId: 'main-space', cwd: '/synthetic/main' }, maintenance: { workspaceId: 'maint-space', cwd: '/synthetic/source' },
    actors: Object.fromEntries(actorKeys.map((key, i) => [key, { workspaceId: `actor-space-${i}`, cwd: `/synthetic/actor-${i}` }])) };
}
function fixture(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'praxis-ai-native-'));
  const file = join(dir, 'campaign.sqlite'), c = new Controller(file);
  c.init(options.config || config(), { seed: 'repeatable', ...options });
  t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  return { c, file, dir };
}
const technical = () => ({ component: 'synthetic-transport', repository: '/synthetic/source', baseRevision: '123456789abcdef', reproduction: 'Save synthetic X at revision 1, repeat the same key.', expected: 'One committed effect.', actual: 'Two effects.', files: ['src/example.mjs'], verification: ['node --test tests/example.test.mjs'] });
const evidence = (passed = true, version = 'test-build-1') => ({ version, reviewer: 'independent-service-verifier', assisted: false, checks: [{ kind: 'service-assertion', reference: 'private-fixture-evidence', passed, expected: 'Exactly one effect', actual: passed ? 'One effect' : 'Two effects' }], ...(!passed ? { failureCategory: 'recovery' } : {}) });
function finish(c, d) { c.acknowledge(d.id, d.agentId || `agent-${d.id}`); const agentId = c.read().dispatches[d.id].agentId; c.observeRunning(d.id, { agentId, status: 'running' }); c.settle(d.id, { agentId, status: 'idle' }); }
function failedTask(c) {
  c.round('family-travel'); c.pause(false);
  const id = c.next().id, d = c.reserve('worker', id); finish(c, d); c.verify(id, evidence(false));
  return id;
}
class FakePaseo {
  constructor() { this.agents = new Map(); this.calls = []; }
  async preflight(model) { this.calls.push(['preflight', model]); }
  async start(d, prompt) {
    this.calls.push(['start', d, prompt]);
    const id = d.agentId || `agent-${d.id}`;
    this.agents.set(id, { agentId: id, provider: d.model.provider, model: d.model.model, thinking: d.model.thinking, cwd: d.binding.cwd, mode: d.model.mode, features: d.model.features, status: 'running', dispatchId: d.id });
    if (this.loseReceipt) throw Error('Synthetic lost receipt.');
    return id;
  }
  async inspect(id) { return this.agents.get(id); }
  assertIdentity(o, d) { return Paseo.prototype.assertIdentity.call(this, o, d); }
  async locate(d) { return [...this.agents.values()].filter(a => a.dispatchId === d.id).map(a => a.agentId); }
  idle(id) { this.agents.get(id).status = 'idle'; }
}

test('campaigns retain nine actors, exact models, bilingual roles and seeded variation', () => {
  assert.equal(campaigns.length, 3); assert.equal(actorKeys.length, 9);
  assert.equal(campaigns[0].actors.length, 3); assert.equal(campaigns[1].actors.length, 5);
  assert.equal(models.coordinator.model, 'hexhive005-main/zai-org/GLM-5.3-Flash');
  assert.equal(models.worker.model, 'hexhive005-work/zai-org/GLM-5.3-Flash');
  assert.deepEqual(models.maintenance, { provider: 'codex', model: 'gpt-6.1-sol', thinking: 'ultra', mode: 'full-access' });
  for (const c of campaigns) {
    for (const a of c.actors) for (const lang of ['en', 'zh']) assert.ok(a.name[lang] && a.personality[lang]);
    for (const step of c.steps) for (const lang of ['en', 'zh']) assert.ok(step.goal[lang]);
    const first = draw('seed', c, 1, c.steps[0]);
    assert.deepEqual(first, draw('seed', c, 1, c.steps[0]));
    assert.ok(new Set(Array.from({ length: 30 }, (_, i) => draw('seed', c, i, c.steps[0]).index)).size > 1);
  }
});

test('initialization and reports never dispatch; investor prerequisites remain explicit in both languages', async t => {
  const { c, file } = fixture(t);
  assert.equal(c.read().paused, true);
  assert.equal(c.read().config.fullAccess, true);
  assert.equal(c.read().config.communication, 'paseo-send-message');
  assert.equal(c.next(), null);
  assert.throws(() => c.round('stock-investor'), /market, horizon/);
  assert.deepEqual(c.read().dispatches, {});
  assert.equal(metrics(c.read()).acceptance, null);
  assert.match(await main(['report', '--state', file, '--lang', 'en']), /Behavior coverage/);
  assert.match(await main(['report', '--state', file, '--lang', 'zh']), /行为覆盖率/);
  assert.equal((await main(['catalog'])).campaigns.length, 3);
  assert.match(await main(['help', '--lang', 'zh']), /人工/);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.throws(() => privatePath(join(process.cwd(), 'campaign.sqlite')), /outside/);
});

test('global worker reservation is atomic across two actual controller processes', async t => {
  const { c, file } = fixture(t); c.round('family-travel'); c.round('security-research'); c.pause(false);
  const id = c.next().id, url = new URL('./ai-native/controller.mjs', import.meta.url).href;
  const script = `import {Controller} from ${JSON.stringify(url)}; const c=new Controller(process.argv[1]); try{c.reserve('worker',process.argv[2]);console.log('reserved')}catch{process.exitCode=3}finally{c.close()}`;
  const results = await Promise.allSettled([1, 2].map(() => exec(process.execPath, ['--input-type=module', '-e', script, file, id])));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(Object.values(c.read().dispatches).filter(d => d.status === 'reserved').length, 1);
  const reopened = new Controller(file); t.after(() => reopened.close());
  assert.equal(reopened.next(), null);
  reopened.pause(true); reopened.pause(false);
  assert.equal(reopened.next(), null);
});

test('dispatch/collect preserve sessions and require independent outcome evidence', async t => {
  const { c } = fixture(t, { locale: 'zh' }); c.round('family-travel'); c.pause(false);
  const paseo = new FakePaseo(), id = c.next().id;
  const result = await dispatch(c, paseo, 'worker', id);
  assert.equal((await collect(c, paseo, result.dispatchId)).status, 'running');
  paseo.idle(result.agentId); await collect(c, paseo, result.dispatchId);
  assert.equal(c.read().tasks[id].status, 'awaiting_verification');
  assert.throws(() => c.verify(id, { ...evidence(), reviewer: c.read().tasks[id].actor }), /Independent/);
  assert.throws(() => c.verify(id, { ...evidence(), checks: [] }), /actual read-back/);
  c.verify(id, evidence());
  assert.equal(metrics(c.read()).passed, 1);
  assert.equal(c.read().sessions['family-travel/planner'], result.agentId);
  assert.ok(c.next());
  const d = c.read().dispatches[result.dispatchId];
  assert.match(workerPrompt(c.read(), d), /你是持久业务角色/);
  assert.doesNotMatch(workerPrompt(c.read(), d), /喜欢临时探索和灵活行程/);
});

test('lost create receipt holds the slot through restart until exact Paseo reconciliation', async t => {
  const { c, file } = fixture(t); c.round('family-travel'); c.pause(false);
  const paseo = new FakePaseo(); paseo.loseReceipt = true;
  await assert.rejects(dispatch(c, paseo, 'worker', c.next().id), /lost receipt/);
  const d = Object.values(c.read().dispatches)[0];
  assert.equal(d.status, 'uncertain'); assert.equal(c.next(), null);
  const reopened = new Controller(file); t.after(() => reopened.close());
  assert.throws(() => reopened.settle(d.id, { agentId: 'unknown', status: 'idle' }), /acknowledged/);
  const adopted = await reconcile(reopened, paseo, d.id);
  assert.equal(adopted.status, 'running'); assert.equal(paseo.calls.filter(x => x[0] === 'start').length, 1);
  paseo.idle(adopted.agentId); await collect(reopened, paseo, d.id);
  assert.equal(reopened.read().tasks[d.subjectId].status, 'awaiting_verification');
});

test('an idle queued recipient cannot release the global slot before this turn has run', async t => {
  const { c } = fixture(t); c.round('family-travel'); c.pause(false);
  const paseo = new FakePaseo(), id = c.next().id, d = c.reserve('worker', id);
  c.acknowledge(d.id, 'queued-recipient');
  paseo.agents.set('queued-recipient', { agentId: 'queued-recipient', provider: d.model.provider, model: d.model.model, mode: d.model.mode, features: d.model.features, cwd: d.binding.cwd, status: 'idle' });
  assert.equal((await collect(c, paseo, d.id)).status, 'awaiting_start_evidence');
  assert.equal(c.next(), null);
  paseo.agents.get('queued-recipient').status = 'running';
  await collect(c, paseo, d.id);
  paseo.idle('queued-recipient'); await collect(c, paseo, d.id);
  assert.equal(c.read().tasks[id].status, 'awaiting_verification');
});

test('investor time advances explicitly between completed rounds without resetting identity or capital', t => {
  const dir = mkdtempSync(join(tmpdir(), 'praxis-investor-clock-')), c = new Controller(join(dir, 'campaign.sqlite'));
  const cfg = config(); cfg.investment = { market: 'synthetic-market', horizon: 'explicit synthetic period', asOf: '2025-01-01T00:00:00Z' };
  c.init(cfg); t.after(() => { c.close(); rmSync(dir, { recursive: true, force: true }); });
  assert.throws(() => c.advanceInvestment('2024-01-01T00:00:00Z'), /later/);
  assert.throws(() => c.advanceInvestment('2999-01-01T00:00:00Z'), /elapsed/);
  c.round('stock-investor'); c.pause(false);
  assert.throws(() => c.advanceInvestment('2025-01-02T00:00:00Z'), /Finish/);
  while (c.next()) { const id = c.next().id; finish(c, c.reserve('worker', id)); c.verify(id, evidence()); }
  const original = c.read().sessions['stock-investor/investor'];
  c.advanceInvestment('2025-01-02T00:00:00Z'); c.round('stock-investor');
  const d = c.reserve('worker', c.next().id);
  assert.equal(d.agentId, original);
  assert.equal(c.read().tasks[d.subjectId].context.initialCapitalCny, 1000000);
  assert.equal(c.read().tasks[d.subjectId].context.asOf, '2025-01-02T00:00:00Z');
});

function approve(c, id) {
  const q = c.approvalRequest(id);
  return c.confirmApproval(id, { questionId: q.questionId, replyReference: 'paseo:user-message:synthetic', answer: '批准本次维护', decision: 'approve' });
}

test('each Maintenance invocation waits for an explicit scoped human reply in Paseo', t => {
  const { c } = fixture(t), taskId = failedTask(c), r = c.repair([taskId], technical());
  assert.throws(() => c.reserve('maintenance', r.requestId), /human confirmation/);
  assert.throws(() => c.confirmApproval(r.requestId, {}), /Ask the human/);
  const q = c.approvalRequest(r.requestId);
  assert.throws(() => c.reserve('maintenance', r.requestId), /human confirmation/);
  assert.throws(() => c.confirmApproval(r.requestId, { questionId: q.questionId, replyReference: 'paseo:user-message:question', answer: '什么意思', decision: 'question' }), /explicit human/);
  assert.throws(() => c.confirmApproval(r.requestId, { questionId: 'wrong-question', replyReference: 'paseo:user-message:test', answer: '批准', decision: 'approve' }), /scope/);
  c.confirmApproval(r.requestId, { questionId: q.questionId, replyReference: 'paseo:user-message:deny', answer: '暂不维护', decision: 'reject' });
  assert.throws(() => c.reserve('maintenance', r.requestId), /human confirmation/);
  const next = c.repair([taskId], technical()); approve(c, next.requestId);
  const d = c.reserve('maintenance', next.requestId);
  assert.ok(c.read().repairs[next.requestId].approval.consumedAt);
  assert.equal(c.next(), null); c.uncertain(d.id);
  assert.throws(() => c.reserve('maintenance', next.requestId), /slot/);
  c.acknowledge(d.id, 'maintenance-1'); c.observeRunning(d.id, { agentId: 'maintenance-1', status: 'running' }); c.settle(d.id, { agentId: 'maintenance-1', status: 'idle' });
  assert.throws(() => c.reserve('maintenance', next.requestId), /human confirmation/);
});

test('changed technical packets and unallowlisted business fields cannot pass the approval gate', t => {
  const { c } = fixture(t), id = failedTask(c), r = c.repair([id], technical());
  assert.throws(() => validatePacket({ ...technical(), businessContent: 'private' }), /Only technical/);
  approve(c, r.requestId);
  c.change(s => { s.repairs[r.requestId].packet.actual = 'changed after human review'; });
  assert.throws(() => c.reserve('maintenance', r.requestId), /changed after human confirmation/);
  for (const lang of ['en', 'zh']) {
    const prompt = maintenancePrompt(technical(), lang);
    assert.doesNotMatch(prompt, /AI 时代的漏洞管理新范式|1000000|family-travel|stock-investor/);
    assert.ok(prompt.includes('synthetic-transport'));
  }
});

test('app repairs dispatch to the explicitly configured owning repository without replacing business sessions', async t => {
  const cfg = config(); cfg.maintenanceTargets = [{ workspaceId: 'owning-app-source', cwd: '/synthetic/owning-app', host: 'app-maintenance-host' }];
  const { c } = fixture(t, { config: cfg }), taskId = failedTask(c);
  assert.throws(() => c.repair([taskId], { ...technical(), repository: '/unconfigured/repository' }), /configured owning-repository/);
  const r = c.repair([taskId], { ...technical(), repository: '/synthetic/owning-app' }), before = c.read().sessions;
  const paseo = new FakePaseo(); approve(c, r.requestId);
  const result = await dispatch(c, paseo, 'maintenance', r.requestId);
  const d = c.read().dispatches[result.dispatchId];
  assert.equal(d.binding.workspaceId, 'owning-app-source');
  assert.equal(d.binding.host, 'app-maintenance-host');
  assert.equal(d.model.model, 'gpt-6.1-sol');
  assert.deepEqual(c.read().sessions, before);
});

test('repair retries require release evidence, original actor and a new repair after another failure', async t => {
  const { c } = fixture(t), id = failedTask(c), actor = c.read().tasks[id].actor, originalAgent = c.read().sessions[actor];
  c.round('security-research');
  const r = c.repair([id], technical());
  assert.throws(() => c.retry(id, 'repair'), /Wait for a new/);
  approve(c, r.requestId);
  const d = c.reserve('maintenance', r.requestId);
  finish(c, d);
  assert.throws(() => c.release(r.requestId, { version: 'fixed-2' }), /checked commit/);
  c.release(r.requestId, { version: 'fixed-2', commit: 'abcdef1234567', verification: 'synthetic-check', deploymentEvidence: 'isolated-running-entry-readback' });
  c.retry(id, 'verified repair deployed');
  assert.equal(c.next().id, id);
  const retry = c.reserve('worker', id);
  assert.equal(retry.agentId, originalAgent); assert.equal(retry.key, actor);
  finish(c, retry);
  assert.throws(() => c.verify(id, evidence(true, 'old-build')), /running repair version/);
  c.verify(id, evidence(false, 'fixed-2'));
  assert.equal(c.read().tasks[id].attempts.length, 2);
  assert.throws(() => c.retry(id, 'again'), /same repair repeatedly/);
  const newer = c.repair([id], { ...technical(), actual: 'Remaining technical invariant violation' });
  assert.notEqual(newer.requestId, r.requestId);
});

test('Paseo human resolution recovers ambiguous sends without inferred execution or approval reuse', t => {
  const { c } = fixture(t); c.round('family-travel'); c.pause(false);
  const id = c.next().id, d = c.reserve('worker', id); c.uncertain(d.id);
  const resolution = { runId: c.read().runId, dispatchId: d.id, agentId: null, decision: 'not-dispatched', evidence: 'operator checked actual queue and transport receipts', questionId: 'paseo-question', replyReference: 'paseo:user-message:resolution', answer: 'Confirmed no dispatch'  };
  assert.throws(() => c.resolveDispatch({ resolution: { ...resolution, answer: '' } }), /human reply/);
  c.resolveDispatch({ resolution });
  assert.equal(c.read().tasks[id].status, 'failed');
  assert.throws(() => c.resolveDispatch({ resolution }), /not unresolved/);
  c.retry(id, 'operator proved request was never dispatched');
  assert.equal(c.next().id, id);
});

test('coverage records failed attempts, pending verification and explicit N/A denominator changes', t => {
  const { c } = fixture(t); const id = failedTask(c);
  let m = metrics(c.read());
  assert.equal(m.attempted, 1); assert.equal(m.failed, 1); assert.equal(m.passed, 0);
  const total = campaigns.reduce((n, c) => n + c.steps.length, 0);
  assert.equal(m.coverage, 1 / total); assert.equal(m.acceptance, 0);
  const tasks = Object.values(c.read().tasks), untouched = tasks.find(t => t.status === 'queued');
  c.exclude(untouched.id, 'Explicit synthetic scenario prerequisite is not applicable.');
  m = metrics(c.read()); assert.equal(m.coverageVersion, '2'); assert.equal(m.applicable, total - 1);
  assert.equal(c.read().tasks[id].attempts[0].status, 'failed');
  assert.equal(m.loadAcceptance, 'pending');
});

test('public Paseo SDK applies full access before the first prompt and sends literal messages with steer', async () => {
  const calls = [], d = { id: 'opaque-dispatch', kind: 'worker', binding: { workspaceId: 'space-id', cwd: '/synthetic/client', host: 'ws://operator-host:6767' }, model: models.worker, agentId: null };
  const observed = { id: 'new-agent', provider: 'opencode', runtimeInfo: { model: models.worker.model }, currentModeId: 'build', cwd: d.binding.cwd, status: 'idle', features: [{ id: 'auto_accept', value: true }] };
  const client = {
    connect: async () => calls.push(['connect']), close: async () => calls.push(['close']),
    workspaces: { ref: id => ({ agents: { create: async options => { calls.push(['create', id, options]); return { id: 'new-agent' }; } } }) },
    agents: { ref: id => ({ refresh: async () => ({ agent: observed, project: null }), send: async (body, options) => calls.push(['send', id, body, options]) }) },
  };
  const p = new Paseo({ createClient: options => { calls.push(['client', options]); return client; }, execute: async () => ({ stdout: JSON.stringify([{ id: models.worker.model }]) }) });
  await p.preflight(d.model, d.binding);
  const literal = 'literal $(not-a-shell) `payload`';
  assert.equal(await p.start(d, literal), 'new-agent');
  const create = calls.find(c => c[0] === 'create');
  assert.equal(create[1], 'space-id'); assert.equal(create[2].prompt, undefined);
  assert.equal(calls.find(c => c[0] === 'send')[2], literal);
  assert.deepEqual(create[2].config.featureValues, { auto_accept: true });
  assert.equal(create[2].config.modeId, 'build');
  assert.equal(create[2].config.options, undefined);
  const snapshot = await p.inspect('new-agent', d.binding);
  p.assertIdentity(snapshot, { ...d, agentId: 'new-agent' });
  assert.throws(() => p.assertIdentity({ ...snapshot, features: { auto_accept: false } }, { ...d, agentId: 'new-agent' }), /features/);
  await p.start({ ...d, agentId: 'new-agent' }, literal);
  const send = calls.filter(c => c[0] === 'send').at(-1);
  assert.equal(send[1], 'new-agent'); assert.equal(send[2], literal); assert.equal(send[3].activeTurnBehavior, 'steer'); assert.ok(send[3].messageId);
  await p.start({ ...d, kind: 'maintenance', model: models.maintenance }, 'Technical reproduction only.');
  const maintenance = calls.filter(c => c[0] === 'create').at(-1)[2];
  assert.equal(maintenance.config.modeId, 'full-access'); assert.equal(maintenance.config.thinkingOptionId, 'ultra');
  assert.equal(maintenance.config.options, undefined);
  assert.equal(calls.filter(c => c[0] === 'connect').length, calls.filter(c => c[0] === 'close').length);
  const bad = new Paseo({ execute: async () => { throw Error('private-business-body and credential'); } });
  await assert.rejects(bad.preflight(d.model, d.binding), e => !/private-business-body|credential/.test(e.message));
});

test('CLI exports a Paseo question and records the actual user reply without any key setup', async t => {
  const { c, file, dir } = fixture(t), id = failedTask(c), r = c.repair([id], technical());
  const out = join(dir, 'question.json'), reply = join(dir, 'reply.json');
  const q = await main(['approval-request', '--state', file, '--request', r.requestId, '--out', out]);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.equal(c.read().repairs[r.requestId].status, 'pending_approval');
  writeFileSync(reply, JSON.stringify({ questionId: q.questionId, replyReference: 'paseo:user-message:confirmed', answer: '批准本次维护', decision: 'approve' }));
  await main(['approve', '--state', file, '--request', r.requestId, '--input', reply]);
  assert.equal(c.read().repairs[r.requestId].status, 'approved');
  c.reserve('maintenance', r.requestId);
});
