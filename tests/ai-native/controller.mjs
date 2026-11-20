import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, realpathSync, existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { actorKey, actorKeys, campaignFor, campaigns, destinations, draw, models } from './campaigns.mjs';

const repoRoot = realpathSync(fileURLToPath(new URL('../../', import.meta.url)));
const active = d => ['reserved', 'running', 'uncertain'].includes(d.status);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const fail = message => { throw Error(message); };
const requireValue = (value, message) => value || fail(message);
const nonempty = value => typeof value === 'string' && value.trim() && value.length <= 16000;
const inside = (parent, child) => { const p = relative(parent, child); return p === '' || p !== '..' && !p.startsWith(`..${sep}`) && !isAbsolute(p); };
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k));

export function privatePath(file) {
  requireValue(isAbsolute(file), 'Use an absolute state path outside Git.');
  let parent = resolve(file);
  const parts = [];
  while (!existsSync(parent)) { parts.unshift(basename(parent)); parent = dirname(parent); }
  const actual = resolve(realpathSync(parent), ...parts);
  requireValue(!inside(repoRoot, actual), 'Runtime files must stay outside the repository.');
  for (let cursor = dirname(actual); ; cursor = dirname(cursor)) {
    requireValue(!existsSync(resolve(cursor, '.git')), 'Runtime files must stay outside Git repositories.');
    if (dirname(cursor) === cursor) break;
  }
  return actual;
}

function binding(value) {
  requireValue(exact(value, ['workspaceId', 'cwd', 'host']) && nonempty(value.workspaceId) && isAbsolute(value.cwd) && (!value.host || nonempty(value.host)), 'A binding needs workspaceId, absolute cwd and optional host.');
  return structuredClone(value);
}
export function validateConfig(input) {
  requireValue(exact(input, ['coordinator', 'maintenance', 'maintenanceTargets', 'actors', 'origin', 'investment']), 'Invalid campaign configuration.');
  const config = { coordinator: binding(input.coordinator), maintenance: binding(input.maintenance), actors: {} };
  requireValue(input.maintenanceTargets === undefined || Array.isArray(input.maintenanceTargets), 'maintenanceTargets must be an array of owning-repository bindings.');
  config.maintenanceTargets = (input.maintenanceTargets || []).map(binding);
  requireValue(new Set([config.maintenance, ...config.maintenanceTargets].map(b => b.cwd)).size === config.maintenanceTargets.length + 1, 'Maintenance repository paths must be unambiguous.');
  requireValue(exact(input.actors, actorKeys) && Object.keys(input.actors).length === actorKeys.length, 'Configure exactly nine actor bindings.');
  for (const key of actorKeys) config.actors[key] = binding(input.actors[key]);
  const all = [config.coordinator, config.maintenance, ...config.maintenanceTargets, ...Object.values(config.actors)];
  requireValue(new Set(all.map(v => `${v.host || 'self'}:${v.workspaceId}`)).size === all.length, 'Each role needs its own workspace.');
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if ((all[i].host || 'self') === (all[j].host || 'self')) requireValue(!inside(resolve(all[i].cwd), resolve(all[j].cwd)) && !inside(resolve(all[j].cwd), resolve(all[i].cwd)), 'Role working directories must be separate.');
  }
  if (input.origin !== undefined) {
    const origin = new URL(input.origin);
    requireValue(origin.protocol === 'https:' && !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Use a public canonical HTTPS origin without credentials.');
    config.origin = origin.origin;
  }
  if (input.investment !== undefined) {
    requireValue(exact(input.investment, ['market', 'horizon', 'asOf']) && ['market', 'horizon', 'asOf'].every(k => nonempty(input.investment[k])) && Number.isFinite(Date.parse(input.investment.asOf)), 'Investment requires market, horizon and an ISO asOf timestamp.');
    config.investment = structuredClone(input.investment);
  }
  return config;
}

export function validatePacket(packet) {
  const fields = ['component', 'repository', 'baseRevision', 'reproduction', 'expected', 'actual', 'files', 'verification'];
  requireValue(exact(packet, fields) && Object.keys(packet).length === fields.length, 'Only technical packet fields are allowed.');
  requireValue(fields.filter(k => !['files', 'verification'].includes(k)).every(k => nonempty(packet[k])), 'Technical packet strings are required.');
  requireValue(isAbsolute(packet.repository) && /^[a-f0-9]{7,64}$/.test(packet.baseRevision), 'Packet needs an absolute owning repository and source revision.');
  requireValue(Array.isArray(packet.files) && packet.files.length > 0 && packet.files.every(p => nonempty(p) && !isAbsolute(p) && !p.split(/[\\/]/).includes('..')), 'Packet files must be relative code paths.');
  requireValue(Array.isArray(packet.verification) && packet.verification.length > 0 && packet.verification.every(nonempty), 'A technical verification plan is required.');
  return structuredClone(packet);
}

export class Controller {
  constructor(file) {
    this.file = privatePath(file);
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.file);
    chmodSync(this.file, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS campaign_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)');
  }
  close() { this.db.close(); }
  read() { const row = this.db.prepare('SELECT json FROM campaign_state WHERE id=1').get(); return row ? JSON.parse(row.json) : fail('Initialize the campaign first.'); }
  change(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const s = this.read();
      const result = fn(s);
      this.db.prepare('UPDATE campaign_state SET json=? WHERE id=1').run(JSON.stringify(s));
      this.db.exec('COMMIT');
      return structuredClone(result ?? s);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  init(config, { locale = 'en', seed = randomUUID() } = {}) {
    requireValue(['en', 'zh'].includes(locale) && nonempty(seed), 'Use locale en or zh and a nonempty seed.');
    const s = { schema: 1, runId: randomUUID(), locale, seed, paused: true, config: validateConfig(config), rounds: {}, sessions: {}, tasks: {}, repairs: {}, dispatches: {}, exclusions: {}, events: [], coverageVersion: '1' };
    this.db.prepare('INSERT INTO campaign_state VALUES(1,?)').run(JSON.stringify(s));
    return s;
  }
  event(s, type, reference) { s.events.push({ at: new Date().toISOString(), type, reference }); }
  pause(paused) { return this.change(s => { s.paused = paused; this.event(s, paused ? 'paused' : 'resumed', s.runId); }); }
  advanceInvestment(asOf) {
    return this.change(s => {
      requireValue(s.config.investment && Number.isFinite(Date.parse(asOf)) && Date.parse(asOf) > Date.parse(s.config.investment.asOf) && Date.parse(asOf) <= Date.now(), 'Advance to a later, already elapsed information cutoff.');
      requireValue(!Object.values(s.tasks).some(t => t.campaign === 'stock-investor' && !['passed', 'not_applicable'].includes(t.status)), 'Finish the investor round before advancing its information cutoff.');
      const previous = s.config.investment.asOf;
      s.config.investment.asOf = asOf;
      this.event(s, 'investment_clock_advanced', { previous, asOf });
    });
  }
  round(campaignId, { destination } = {}) {
    return this.change(s => {
      const c = campaignFor(campaignId);
      requireValue(!Object.values(s.tasks).some(t => t.campaign === c.id && !['passed', 'not_applicable'].includes(t.status)), 'Finish or explicitly exclude the current round before adding another.');
      if (c.requiredInputs) requireValue(s.config.investment, 'Choose the investor market, horizon and asOf before starting this campaign.');
      const round = (s.rounds[c.id] || 0) + 1;
      if (c.id === 'family-travel' && round > destinations.length) requireValue(nonempty(destination), 'Supply a new destination after the initial thirty; the campaign has no fixed end.');
      const context = c.id === 'family-travel' ? { destination: destination || destinations[round - 1] } : c.id === 'stock-investor' ? { ...s.config.investment, initialCapitalCny: c.initialCapitalCny, targetNetReturn: c.targetNetReturn } : { topic: c.title };
      let previous;
      const ids = [];
      for (const step of c.steps) {
        const id = randomUUID(), key = actorKey(c.id, step.actor);
        const caseId = `${c.id}/${step.id}`, exclusionReason = s.exclusions[caseId];
        s.tasks[id] = { id, campaign: c.id, actor: key, caseId, round, goal: step.goal, context, variation: draw(s.seed, c, round, step), dependsOn: previous ? [previous] : [], status: exclusionReason ? 'not_applicable' : 'queued', ...(exclusionReason ? { exclusionReason } : {}), attempts: [], assisted: false };
        ids.push(id); previous = id;
      }
      s.rounds[c.id] = round;
      this.event(s, 'round_created', ids[0]);
      return ids;
    });
  }
  next(s = this.read()) {
    if (s.paused || Object.values(s.dispatches).some(d => active(d) && d.kind !== 'coordinator')) return null;
    return Object.values(s.tasks).filter(t => t.status === 'queued' && t.dependsOn.every(id => ['passed', 'not_applicable'].includes(s.tasks[id].status)))
      .sort((a, b) => Number(Boolean(b.repairId)) - Number(Boolean(a.repairId)) || a.attempts.length - b.attempts.length)[0] || null;
  }
  reserve(kind, id) {
    return this.change(s => {
      requireValue(!s.paused, 'Campaign is paused.');
      requireValue(['worker', 'coordinator', 'maintenance'].includes(kind), 'Unknown dispatch kind.');
      const current = Object.values(s.dispatches).filter(active);
      requireValue(!current.some(d => kind === 'coordinator' ? d.kind === kind : d.kind !== 'coordinator'), 'An execution slot is already reserved; reconcile it before continuing.');
      let subject, key, target;
      if (kind === 'worker') {
        subject = requireValue(s.tasks[id], 'Unknown task.');
        requireValue(this.next(s)?.id === id, 'Only the next ready task can dispatch.');
        key = subject.actor; target = s.config.actors[key]; subject.status = 'running';
      } else if (kind === 'maintenance') {
        subject = requireValue(s.repairs[id], 'Unknown repair.');
        requireValue(subject.status === 'approved' && subject.approval && !subject.approval.consumedAt, 'Explicit human confirmation in Paseo is required for this invocation.');
        requireValue(hash(validatePacket(subject.packet)) === subject.packetHash && subject.approval.packetHash === subject.packetHash, 'Technical packet changed after human confirmation.');
        subject.status = 'running'; subject.approval.consumedAt = new Date().toISOString();
        target = subject.binding;
      } else { key = 'coordinator'; target = s.config.coordinator; }
      const d = { id: randomUUID(), kind, subjectId: id || null, key: key || null, binding: target, model: models[kind], agentId: key ? s.sessions[key] || null : null, status: 'reserved', createdAt: new Date().toISOString() };
      s.dispatches[d.id] = d;
      if (kind === 'worker') subject.attempts.push({ dispatchId: d.id, startedAt: d.createdAt, status: 'running', variation: subject.variation, ...(subject.repairId ? { repairVersion: s.repairs[subject.repairId].release.version } : {}) });
      if (kind === 'maintenance') subject.dispatchId = d.id;
      this.event(s, 'dispatch_reserved', d.id);
      return d;
    });
  }
  acknowledge(id, agentId) {
    return this.change(s => {
      const d = requireValue(s.dispatches[id], 'Unknown dispatch.');
      requireValue(['reserved', 'uncertain'].includes(d.status) && nonempty(agentId), 'Dispatch cannot be acknowledged.');
      d.agentId = agentId; d.status = 'running';
      if (d.key) s.sessions[d.key] = agentId;
      this.event(s, 'dispatch_acknowledged', id);
      return d;
    });
  }
  observeRunning(id, observed) {
    return this.change(s => {
      const d = requireValue(s.dispatches[id], 'Unknown dispatch.');
      requireValue(d.status === 'running' && d.agentId === observed.agentId && observed.status === 'running', 'Expected the acknowledged agent in running state.');
      d.observedRunning = true; this.event(s, 'dispatch_observed_running', id);
    });
  }
  uncertain(id) { return this.change(s => { const d = requireValue(s.dispatches[id], 'Unknown dispatch.'); requireValue(active(d), 'Dispatch is already settled.'); d.status = 'uncertain'; this.event(s, 'dispatch_uncertain', id); }); }
  resolveDispatch({ resolution }) {
    return this.change(s => {
      requireValue(exact(resolution, ['runId', 'dispatchId', 'agentId', 'decision', 'evidence', 'questionId', 'replyReference', 'answer']) && Object.keys(resolution).length === 8 && resolution.runId === s.runId && ['evidence', 'questionId', 'replyReference', 'answer'].every(k => nonempty(resolution[k])), 'Record the explicit Paseo human reply and scope for this resolution.');
      const d = requireValue(s.dispatches[resolution.dispatchId], 'Unknown dispatch.');
      requireValue(['reserved', 'uncertain'].includes(d.status) || d.status === 'running' && !d.observedRunning, 'Dispatch is not unresolved.');
      if (resolution.decision === 'delivered') {
        requireValue(nonempty(resolution.agentId) && (!d.agentId || d.agentId === resolution.agentId), 'Resolution must identify the original recipient.');
        d.agentId = resolution.agentId; d.status = 'running'; d.observedRunning = true;
        if (d.key) s.sessions[d.key] = d.agentId;
      } else {
        requireValue(resolution.decision === 'not-dispatched' && resolution.agentId === null, 'Use delivered or not-dispatched.');
        d.status = 'settled';
        if (d.kind === 'maintenance') s.repairs[d.subjectId].status = 'rejected';
        if (d.kind === 'worker') {
          const t = s.tasks[d.subjectId]; t.status = 'failed';
          Object.assign(t.attempts.at(-1), { status: 'failed', evidence: { failureCategory: 'connection', operatorResolution: resolution.evidence } });
        }
      }
      d.resolution = resolution; this.event(s, 'dispatch_resolved_by_operator', d.id);
      return d;
    });
  }
  settle(id, observed) {
    return this.change(s => {
      const d = requireValue(s.dispatches[id], 'Unknown dispatch.');
      requireValue(d.status === 'running' && d.observedRunning && observed.agentId === d.agentId && ['idle', 'error'].includes(observed.status), 'Only an acknowledged turn observed running and then idle/error can release the slot.');
      d.status = 'settled'; d.observed = observed; this.event(s, 'dispatch_settled', id);
      if (d.kind === 'worker') {
        const t = s.tasks[d.subjectId]; t.status = 'awaiting_verification'; t.attempts.at(-1).status = 'awaiting_verification';
      }
      if (d.kind === 'maintenance') s.repairs[d.subjectId].status = 'awaiting_release';
      return d;
    });
  }
  verify(taskId, evidence) {
    return this.change(s => {
      const t = requireValue(s.tasks[taskId], 'Unknown task.');
      requireValue(t.status === 'awaiting_verification', 'Task is not awaiting verification.');
      requireValue(exact(evidence, ['version', 'reviewer', 'assisted', 'checks', 'failureCategory']) && nonempty(evidence.version) && nonempty(evidence.reviewer) && evidence.reviewer !== t.actor && typeof evidence.assisted === 'boolean', 'Independent verification metadata is required.');
      requireValue(Array.isArray(evidence.checks) && evidence.checks.length > 0 && evidence.checks.every(c => exact(c, ['kind', 'reference', 'passed', 'expected', 'actual']) && ['mcp-readback', 'native-view', 'service-assertion', 'denial-no-side-effects'].includes(c.kind) && ['reference', 'expected', 'actual'].every(k => nonempty(c[k])) && typeof c.passed === 'boolean'), 'Supply actual read-back or independent assertion evidence, not an agent success claim.');
      if (t.repairId) requireValue(evidence.version === s.repairs[t.repairId].release.version, 'Retest evidence must identify the running repair version.');
      const passed = evidence.checks.every(c => c.passed);
      if (!passed) requireValue(['connection', 'permission', 'capability', 'handoff', 'recovery', 'unusable-result'].includes(evidence.failureCategory), 'Classify the failure.');
      t.status = passed ? 'passed' : 'failed'; t.assisted ||= evidence.assisted;
      Object.assign(t.attempts.at(-1), { status: t.status, evidence: structuredClone(evidence), finishedAt: new Date().toISOString() });
      this.event(s, 'task_verified', t.id);
      return t;
    });
  }
  repair(taskIds, packet) {
    const safe = validatePacket(packet);
    return this.change(s => {
      const target = [s.config.maintenance, ...s.config.maintenanceTargets].find(b => b.cwd === safe.repository);
      requireValue(target, 'Repair repository must match a configured owning-repository maintenance workspace.');
      requireValue(Array.isArray(taskIds) && taskIds.length > 0 && taskIds.every(id => s.tasks[id]?.status === 'failed' && (!s.tasks[id].repairId || ['ready', 'rejected'].includes(s.repairs[s.tasks[id].repairId].status))), 'Link failed tasks without an active repair.');
      const packetHash = hash(safe);
      const existing = Object.values(s.repairs).find(r => r.packetHash === packetHash && r.status === 'pending_approval');
      const r = existing || { id: randomUUID(), packet: safe, packetHash, binding: target, taskIds: [], status: 'pending_approval' };
      for (const id of taskIds) { if (!r.taskIds.includes(id)) r.taskIds.push(id); s.tasks[id].repairId = r.id; s.tasks[id].assisted = true; }
      s.repairs[r.id] = r; this.event(s, 'repair_requested', r.id);
      return { requestId: r.id, packetHash, status: r.status };
    });
  }
  approvalRequest(id) {
    return this.change(s => {
      const r = requireValue(s.repairs[id], 'Unknown repair.');
      requireValue(r.status === 'pending_approval', 'Repair is not awaiting a human answer.');
      requireValue(hash(validatePacket(r.packet)) === r.packetHash, 'Technical packet changed; create a new repair request.');
      r.question ||= { id: randomUUID(), packetHash: r.packetHash, askedAt: new Date().toISOString() };
      return { requestId: id, questionId: r.question.id, packetHash: r.packetHash, status: 'waiting_for_human',
        question: s.locale === 'zh' ? '是否批准下方技术问题包所述的本次维护？请在 Paseo 明确批准或拒绝；未回复时不会启动 Maintenance。' : 'Approve this Maintenance invocation for the technical packet below? Answer explicitly in Paseo; no answer leaves Maintenance blocked.', packet: r.packet };
    });
  }
  confirmApproval(id, reply) {
    return this.change(s => {
      const r = requireValue(s.repairs[id], 'Unknown repair.');
      requireValue(r.status === 'pending_approval' && r.question, 'Ask the human in Paseo before recording a decision.');
      requireValue(exact(reply, ['questionId', 'replyReference', 'answer', 'decision']) && Object.keys(reply).length === 4 && ['questionId', 'replyReference', 'answer'].every(k => nonempty(reply[k])) && ['approve', 'reject'].includes(reply.decision), 'Record an explicit human approve/reject reply from Paseo; unanswered or ambiguous questions are not approval.');
      requireValue(reply.questionId === r.question.id && r.question.packetHash === r.packetHash && hash(validatePacket(r.packet)) === r.packetHash, 'Human reply scope does not match the current question and packet.');
      r.approval = { ...structuredClone(reply), packetHash: r.packetHash, recordedAt: new Date().toISOString() };
      r.status = reply.decision === 'approve' ? 'approved' : 'rejected';
      this.event(s, 'human_decision_recorded', id);
      return { requestId: id, status: r.status };
    });
  }
  reject(id, reason) {
    return this.change(s => {
      const r = requireValue(s.repairs[id], 'Unknown repair.');
      requireValue(['pending_approval', 'approved', 'awaiting_release', 'ready'].includes(r.status) && nonempty(reason), 'Cannot reject an active or unknown repair.');
      r.status = 'rejected'; r.reason = reason; this.event(s, 'repair_rejected', id);
    });
  }
  release(id, release) {
    return this.change(s => {
      const r = requireValue(s.repairs[id], 'Unknown repair.');
      requireValue(r.status === 'awaiting_release', 'Repair has not finished its invocation.');
      requireValue(exact(release, ['version', 'commit', 'verification', 'deploymentEvidence']) && ['version', 'verification', 'deploymentEvidence'].every(k => nonempty(release[k])) && /^[a-f0-9]{7,64}$/.test(release.commit), 'Supply the checked commit, running version and deployment evidence.');
      r.release = structuredClone(release); r.status = 'ready'; this.event(s, 'repair_ready', id);
    });
  }
  retry(taskId, reason) {
    return this.change(s => {
      const t = requireValue(s.tasks[taskId], 'Unknown task.');
      requireValue(t.status === 'failed' && nonempty(reason), 'Retry needs a failed task and explicit reason.');
      if (t.repairId) {
        const r = s.repairs[t.repairId];
        requireValue(r.status === 'ready' && !t.attempts.some(a => a.repairVersion === r.release.version), 'Wait for a new running repair version; do not retry the same repair repeatedly.');
      } else requireValue(t.attempts.at(-1).evidence.failureCategory === 'connection', 'Code/capability/permission failures require an approved repair or explicit human resolution.');
      t.retryReason = reason; t.status = 'queued';
      this.event(s, 'retry_queued', t.id);
    });
  }
  exclude(taskId, reason) {
    return this.change(s => {
      const t = requireValue(s.tasks[taskId], 'Unknown task.');
      requireValue(['queued', 'failed'].includes(t.status) && nonempty(reason), 'Only queued/failed cases can be excluded with an explicit reason.');
      t.status = 'not_applicable'; t.exclusionReason = reason;
      s.exclusions[t.caseId] = reason; s.coverageVersion = String(Number(s.coverageVersion) + 1);
      this.event(s, 'case_excluded', taskId);
    });
  }
}

export function metrics(s) {
  const cells = campaigns.flatMap(c => c.steps.map(step => {
    const id = `${c.id}/${step.id}`, tasks = Object.values(s.tasks).filter(t => t.caseId === id);
    const attempts = tasks.flatMap(t => t.attempts), latest = attempts.at(-1);
    const excluded = s.exclusions[id];
    return { id, campaign: c.id, applicable: !excluded, reason: excluded || null, attempted: attempts.length > 0, status: excluded ? 'not_applicable' : latest?.status || 'not_run', attempts: attempts.length };
  }));
  const applicable = cells.filter(c => c.applicable), attempted = applicable.filter(c => c.attempted);
  const tasks = Object.values(s.tasks), passed = tasks.filter(t => t.status === 'passed');
  const repaired = tasks.filter(t => t.repairId), recovered = repaired.filter(t => t.status === 'passed');
  const rate = (n, d) => d ? n / d : null;
  return { coverageVersion: s.coverageVersion, cells, applicable: applicable.length, attempted: attempted.length, passed: applicable.filter(c => c.status === 'passed').length, failed: applicable.filter(c => c.status === 'failed').length, pending: applicable.filter(c => ['running', 'awaiting_verification'].includes(c.status)).length,
    coverage: rate(attempted.length, applicable.length), acceptance: rate(applicable.filter(c => c.status === 'passed').length, attempted.length),
    autonomousCompletion: rate(passed.filter(t => !t.assisted).length, tasks.filter(t => t.attempts.length > 0).length), repairRecovery: rate(recovered.length, repaired.length),
    loadAcceptance: 'pending', businessAcceptance: 'not_inferred_from_controller_checks' };
}
