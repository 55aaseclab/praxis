import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

// Arguments are never shell-interpolated. CLI stderr/stdout may contain private content;
// only allowlisted receipt/status fields cross this adapter's boundary.
export class Paseo {
  constructor({ binary = 'paseo', execute = exec } = {}) { this.binary = binary; this.execute = execute; }
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
    const data = await this.call(['inspect', agentId], binding);
    const row = Array.isArray(data) ? data[0] : data;
    return { agentId: row.Id, provider: row.Provider, model: row.Model, thinking: row.Thinking, cwd: row.Cwd, status: row.Status, archived: row.Archived, mode: row.Mode };
  }
  assertIdentity(observed, dispatch) {
    if (observed.agentId !== dispatch.agentId || observed.provider !== dispatch.model.provider || observed.model !== dispatch.model.model || observed.cwd !== dispatch.binding.cwd || observed.archived || observed.mode !== dispatch.model.mode || dispatch.model.thinking && observed.thinking !== dispatch.model.thinking) throw Error('Observed Paseo identity/model/mode does not match the reserved role.');
  }
  async start(dispatch, prompt) {
    if (dispatch.agentId) {
      const observed = await this.inspect(dispatch.agentId, dispatch.binding);
      this.assertIdentity(observed, dispatch);
      if (observed.status !== 'idle') throw Error('Existing actor is not idle.');
      const reply = await this.call(['send', dispatch.agentId, '--prompt', prompt, '--behavior', 'steer', '--no-wait'], dispatch.binding);
      if (reply.agentId !== dispatch.agentId) throw Error('Uncertain Paseo send receipt.');
      return dispatch.agentId;
    }
    const model = dispatch.model;
    const reply = await this.call(['run', prompt, '--provider', model.provider, '--model', model.model, '--mode', model.mode,
      ...(model.thinking ? ['--thinking', model.thinking] : []), '--workspace', dispatch.binding.workspaceId, '--cwd', dispatch.binding.cwd,
      '--title', dispatch.kind === 'maintenance' ? 'Technical repair' : `AI-native ${dispatch.kind}`,
      '--label', `praxis.ai-native-dispatch=${dispatch.id}`, '--no-wait'], dispatch.binding);
    if (typeof reply.agentId !== 'string' || !reply.agentId) throw Error('Uncertain Paseo create receipt.');
    return reply.agentId;
  }
  async locate(dispatch) {
    if (dispatch.agentId) return [dispatch.agentId];
    const rows = await this.call(['ls', '--global', '--all', '--label', `praxis.ai-native-dispatch=${dispatch.id}`], dispatch.binding);
    return (Array.isArray(rows) ? rows : rows.agents || []).map(row => row.id || row.agentId).filter(Boolean);
  }
}
