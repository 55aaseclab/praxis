import { fileURLToPath } from 'node:url';
import { models } from './campaigns.mjs';
import { coordinatorPrompt, maintenancePrompt, workerPrompt } from './prompts.mjs';

export async function dispatch(controller, paseo, kind, subjectId) {
  if (kind === 'coordinator') {
    const previous = Object.values(controller.read().dispatches).find(d => d.kind === kind && d.status === 'running');
    if (previous) await collect(controller, paseo, previous.id);
  }
  const initial = controller.read();
  const binding = kind === 'worker' ? initial.config.actors[initial.tasks[subjectId]?.actor] : kind === 'maintenance' ? initial.repairs[subjectId]?.binding : initial.config[kind];
  if (!binding || !models[kind]) throw Error('Unknown dispatch target.');
  // Discovery is read-only. Reserve durably before any external creation/send.
  await paseo.preflight(models[kind], binding);
  const d = controller.reserve(kind, subjectId);
  const s = controller.read();
  const prompt = kind === 'worker' ? workerPrompt(s, d) : kind === 'maintenance' ? maintenancePrompt(s.repairs[subjectId].packet, s.locale)
    : coordinatorPrompt({ stateFile: controller.file, cliFile: fileURLToPath(new URL('./cli.mjs', import.meta.url)), skillFile: fileURLToPath(new URL('../../skills/ai-native-testing/SKILL.md', import.meta.url)), locale: s.locale, state: s });
  try {
    const agentId = await paseo.start(d, prompt);
    controller.acknowledge(d.id, agentId);
    const observed = await paseo.inspect(agentId, d.binding);
    paseo.assertIdentity(observed, { ...d, agentId });
    if (observed.status === 'running') controller.observeRunning(d.id, observed);
    return { dispatchId: d.id, agentId };
  } catch (error) { controller.uncertain(d.id); throw error; }
}

export async function collect(controller, paseo, dispatchId) {
  const d = controller.read().dispatches[dispatchId];
  if (!d || d.status !== 'running') throw Error('Only acknowledged dispatches can be collected.');
  const observed = await paseo.inspect(d.agentId, d.binding);
  paseo.assertIdentity(observed, d);
  if (observed.status === 'running') controller.observeRunning(dispatchId, observed);
  if (!['idle', 'error'].includes(observed.status)) return { dispatchId, status: observed.status };
  if (!d.observedRunning) return { dispatchId, status: 'awaiting_start_evidence' };
  return controller.settle(dispatchId, observed);
}

export async function reconcile(controller, paseo, dispatchId) {
  const d = controller.read().dispatches[dispatchId];
  if (!d || !['reserved', 'uncertain'].includes(d.status)) throw Error('Only unresolved dispatches need reconciliation.');
  // A queued send can be invisible while the recipient is idle. Never infer
  // nonexecution or successful delivery from status alone in that case.
  if (d.agentId) return { dispatchId, status: 'operator_evidence_required', agentId: d.agentId };
  const ids = await paseo.locate(d);
  if (ids.length !== 1) return { dispatchId, status: 'operator_evidence_required', matches: ids.length };
  const observed = await paseo.inspect(ids[0], d.binding);
  paseo.assertIdentity(observed, { ...d, agentId: ids[0] });
  const adopted = controller.acknowledge(dispatchId, ids[0]);
  if (observed.status === 'running') controller.observeRunning(dispatchId, observed);
  return adopted;
}
