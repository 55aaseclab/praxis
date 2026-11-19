import { parseArgs } from 'node:util';
import { loadBusinessConfig } from '../src/business/config.mjs';
import { createBusinessSlotServer } from '../src/deployment/business-slot.mjs';

const { values } = parseArgs({ options: { config: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string' }, slot: { type: 'string' }, state: { type: 'string' }, 'lease-dir': { type: 'string' } } });
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('A valid business slot port is required.');
const config = await loadBusinessConfig(values.config);
const server = createBusinessSlotServer({ config, slot: values.slot, stateFile: values.state, ...(values['lease-dir'] ? { leaseDir: values['lease-dir'] } : {}) });
server.on('error', error => { console.error(`Business slot failed: ${error.code || 'START_FAILED'}`); process.exitCode = 1; });
server.listen(port, values.host, () => console.log(`Praxis ${values.slot} business slot listening on port ${port}`));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
  if (stopping) return; stopping = true;
  try { await server.deployment.shutdown(); server.close(() => process.exit(0)); server.closeIdleConnections(); }
  catch { console.error('Business slot could not complete its drain.'); process.exitCode = 1; }
});
