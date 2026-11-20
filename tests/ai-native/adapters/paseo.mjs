import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createPaseoClient } from '@getpaseo/client';
const exec = promisify(execFile);

// Arguments are never shell-interpolated. CLI stderr/stdout may contain private content;
// only allowlisted receipt/status fields cross this adapter's boundary.
export class Paseo {
  constructor({ binary = 'paseo', execute = exec, createClient = createPaseoClient } = {}) { this.binary = binary; this.execute = execute; this.createClient = createClient; }
  async withClient(binding, action) {
    let client;
    try {
      const endpoint = binding.host || (await this.call(['daemon', 'status'], binding)).listen;
      if (typeof endpoint !== 'string' || !/^(?:wss?:\/\/|tcp:\/\/|[^/:]+:\d+$|\[[^\]]+\]:\d+$)/.test(endpoint)) throw Error('Use a reachable public Paseo WebSocket or host:port endpoint.');
      const url = new URL(endpoint.startsWith('tcp://') ? endpoint.replace('tcp://', 'ws://') : /^wss?:\/\//.test(endpoint) ? endpoint : `ws://${endpoint}`);
      if (url.username || url.password || url.search || url.hash) throw Error('Do not embed credentials in the Paseo endpoint.');
      url.pathname = '/ws';
      client = this.createClient({ url: url.href, connectTimeoutMs: 15000, reconnect: { enabled: false } });
      await client.connect();
      return await action(client);
    } catch { throw Error('Public Paseo SDK request failed or has an uncertain outcome; reconcile before retrying.'); }
    finally { if (client) await client.close(); }
  }
  async call(args, binding = {}) {
    try {
      const { stdout } = await this.execute(this.binary, [...args, ...(binding.host ? ['--host', binding.host] : []), '--json'], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout);
    } catch { throw Error('Paseo command failed or returned an uncertain receipt; inspect it in the operator session.'); }
  }
  async preflight(model, binding) {
    const result = await this.call(['provider', 'models', model.provider, '--thinking'], binding);
    const row = (Array.isArray(result) ? result : result.models || []).find(row => row.id === model.model);
    if (!row || model.thinking && !(row.thinkingOptionIds || row.thinkingOptions?.map(o => o.id) || []).includes(model.thinking)) throw Error('The exact requested provider model/thinking option is unavailable.');
  }
  async inspect(agentId, binding) {
    return this.withClient(binding, async client => {
      const refreshed = await client.agents.ref(agentId).refresh();
      const row = refreshed?.agent;
      if (!row) throw Error('Agent not found.');
      return { agentId: row.id, provider: row.provider, model: row.runtimeInfo?.model || row.model, thinking: row.effectiveThinkingOptionId, cwd: row.cwd, status: row.status, archived: Boolean(row.archivedAt), mode: row.currentModeId,
        features: Object.fromEntries((row.features || []).map(f => [f.id, f.value])) };
    });
  }
  async send(agentId, message, binding) {
    const messageId = randomUUID();
    await this.withClient(binding, client => client.agents.ref(agentId).send(message, {
      messageId, activeTurnBehavior: 'steer', ...(process.env.PASEO_AGENT_ID && !binding.host ? { sourceAgentId: process.env.PASEO_AGENT_ID } : {}),
    }));
    return { agentId, messageId };
  }
  assertIdentity(observed, dispatch) {
    if (observed.agentId !== dispatch.agentId || observed.provider !== dispatch.model.provider || observed.model !== dispatch.model.model || observed.cwd !== dispatch.binding.cwd || observed.archived || observed.mode !== dispatch.model.mode || dispatch.model.thinking && observed.thinking !== dispatch.model.thinking || Object.entries(dispatch.model.features || {}).some(([k, v]) => observed.features?.[k] !== v)) throw Error('Observed Paseo identity/model/mode/features do not match the reserved role.');
  }
  async start(dispatch, prompt) {
    if (dispatch.agentId) {
      const observed = await this.inspect(dispatch.agentId, dispatch.binding);
      this.assertIdentity(observed, dispatch);
      if (observed.status !== 'idle') throw Error('Existing actor is not idle.');
      await this.send(dispatch.agentId, prompt, dispatch.binding);
      return dispatch.agentId;
    }
    const model = dispatch.model;
    return this.withClient(dispatch.binding, async client => {
      const agent = await client.workspaces.ref(dispatch.binding.workspaceId).agents.create({
        config: { provider: `${model.provider}/${model.model}`, modeId: model.mode,
          ...(model.thinking ? { thinkingOptionId: model.thinking } : {}), ...(model.features ? { featureValues: model.features } : {}) },
        title: dispatch.kind === 'maintenance' ? 'Technical repair' : `AI-native ${dispatch.kind}`,
        ...(process.env.PASEO_AGENT_ID && !dispatch.binding.host ? { parent: process.env.PASEO_AGENT_ID } : {}),
        labels: { 'praxis.ai-native-dispatch': dispatch.id },
      });
      if (!agent?.id) throw Error('Uncertain Paseo create receipt.');
      await client.agents.ref(agent.id).send(prompt, { messageId: dispatch.id, activeTurnBehavior: 'steer',
        ...(process.env.PASEO_AGENT_ID && !dispatch.binding.host ? { sourceAgentId: process.env.PASEO_AGENT_ID } : {}) });
      return agent.id;
    });
  }
  async locate(dispatch) {
    if (dispatch.agentId) return [dispatch.agentId];
    const rows = await this.call(['ls', '--global', '--all', '--label', `praxis.ai-native-dispatch=${dispatch.id}`], dispatch.binding);
    return (Array.isArray(rows) ? rows : rows.agents || []).map(row => row.id || row.agentId).filter(Boolean);
  }
}
