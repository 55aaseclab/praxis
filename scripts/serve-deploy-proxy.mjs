import { parseArgs } from 'node:util';
import { startDeploymentProxy } from '../src/deployment/proxy.mjs';

try {
  const { values } = parseArgs({ options: { channel: { type: 'string' }, state: { type: 'string' }, socket: { type: 'string' }, host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string' } } });
  const server = await startDeploymentProxy({ channel: values.channel, stateFile: values.state, socketFile: values.socket, host: values.host, port: Number(values.port) });
  process.stdout.write(`Deployment ${values.channel} proxy listening on ${values.host}:${values.port}\n`);
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; void server.deployment.shutdown().then(() => process.exit(0)); } };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
