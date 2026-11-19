import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, rm, rename, lstat } from 'node:fs/promises';
import { dirname, join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDeploymentState } from './state.mjs';
import { AuthStore } from '../business/auth.mjs';
import { BusinessEvents } from '../business/events.mjs';
import { createBusinessServer } from '../business/server.mjs';
import packageMetadata from '../../package.json' with { type: 'json' };

function reply(request, response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 503 ? { 'Retry-After': '1' } : {}) });
  response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
}

export async function createOwnedBusinessService({ config, version }) {
  let auth, events, server;
  try {
    auth = new AuthStore({ file: config.database, issuer: config.issuer });
    events = new BusinessEvents(config.eventsDatabase);
    server = createBusinessServer({ config, auth, events, version });
    let closed = false;
    return { server, async close() { if (closed) return; await server.business.shutdown(); auth.close(); events.close(); closed = true; } };
  } catch (error) {
    await server?.business.shutdown(); auth?.close(); events?.close(); throw error;
  }
}

export function createBusinessSlotServer({ config, slot, stateFile, leaseDir = process.env.PRAXIS_DEPLOY_LEASE_DIR || join(dirname(stateFile || ''), 'writer-lease'), leaseOwner = process.env.PRAXIS_DEPLOY_LEASE_OWNER, pollMs = 50, version = packageMetadata.version, readState = readDeploymentState, serviceFactory = createOwnedBusinessService } = {}) {
  if (!config || !['blue', 'green'].includes(slot) || !isAbsolute(stateFile || '') || !isAbsolute(leaseDir || '') || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 100) throw new Error('A business slot requires a configuration, slot, absolute state/lease paths and a 10–100ms poll interval.');
  if (leaseOwner !== undefined && (typeof leaseOwner !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(leaseOwner))) throw new Error('The deployment lease owner is invalid.');
  const owner = leaseOwner || randomUUID(), instance = randomUUID(), lockDir = join(leaseDir, 'active');
  const responses = new Map();
  let role = 'standby', service = null, leaseHeld = false, stopping = false, stateValid = false, errorCode = null, generation = null, reconcileWork = null;

  async function acquireLease() {
    await mkdir(leaseDir, { recursive: true, mode: 0o700 });
    const info = await lstat(leaseDir);
    if (!info.isDirectory() || info.isSymbolicLink() || info.mode & 0o077) throw new Error('WRITER_LEASE_UNSAFE');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await mkdir(lockDir, { mode: 0o700 });
        try { await writeFile(join(lockDir, 'owner.json'), JSON.stringify({ owner, instance, slot }), { flag: 'wx', mode: 0o600 }); }
        catch (error) { await rm(lockDir, { recursive: true, force: true }); throw error; }
        leaseHeld = true; return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let prior;
        try { prior = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8')); } catch { throw new Error('WRITER_LEASE_BUSY'); }
        if (!leaseOwner || prior.owner !== owner || prior.slot !== slot) throw new Error('WRITER_LEASE_BUSY');
        // The controller supplies a unique owner per Docker container. Docker
        // restarts that container only after its prior process has exited.
        const retired = join(leaseDir, `retired-${randomUUID()}`);
        await rename(lockDir, retired); await rm(retired, { recursive: true, force: true });
      }
    }
    throw new Error('WRITER_LEASE_BUSY');
  }
  async function releaseLease() {
    if (!leaseHeld) return;
    const record = JSON.parse(await readFile(join(lockDir, 'owner.json'), 'utf8'));
    if (record.owner !== owner || record.instance !== instance || record.slot !== slot) throw new Error('WRITER_LEASE_CHANGED');
    await rm(lockDir, { recursive: true }); leaseHeld = false;
  }
  function endEventStreams() {
    for (const [response, entry] of responses) if (entry.method === 'GET' && /^text\/event-stream(?:;|$)/i.test(String(response.getHeader('content-type') || ''))) response.end();
  }
  async function drain() {
    if (!service && !leaseHeld) { role = 'standby'; return; }
    role = 'draining'; endEventStreams();
    if (service) {
      await service.server.business.quiesce();
      endEventStreams();
      await Promise.all([...responses.values()].map(entry => entry.finished));
      await service.close(); service = null;
    }
    await releaseLease(); role = 'standby';
  }
  async function reconcileOnce() {
    let state;
    try { state = await readState(stateFile); stateValid = true; generation = state.generation; }
    catch { stateValid = false; errorCode = 'DEPLOYMENT_STATE_UNAVAILABLE'; await drain(); return; }
    errorCode = null;
    if (stopping || state.writer !== slot) { await drain(); return; }
    if (service && role === 'active') return;
    role = 'activating';
    try {
      if (!leaseHeld) await acquireLease();
      if (!service) service = await serviceFactory({ config, version });
      if (!service?.server?.business?.collect || typeof service.close !== 'function') throw new Error('INVALID_BUSINESS_SERVICE');
      await service.server.business.collect();
      const latest = await readState(stateFile);
      if (stopping || latest.writer !== slot) { await drain(); return; }
      if (!service.server.business.status().healthy) { errorCode = 'BUSINESS_NOT_READY'; return; }
      role = 'active';
    } catch (error) {
      errorCode = ['WRITER_LEASE_BUSY', 'WRITER_LEASE_CHANGED', 'WRITER_LEASE_UNSAFE'].includes(error.message) ? error.message : 'BUSINESS_ACTIVATION_FAILED';
      if (!service && leaseHeld) await releaseLease();
    }
  }
  function reconcile() {
    if (!reconcileWork) reconcileWork = reconcileOnce().catch(() => { errorCode = 'BUSINESS_DRAIN_FAILED'; }).finally(() => { reconcileWork = null; });
    return reconcileWork;
  }
  const status = () => {
    const live = service?.server.business.status();
    const healthy = stateValid && !errorCode && (role === 'standby' || role === 'active' && live?.healthy);
    return { status: healthy ? 'ok' : 'degraded', role, slot, version, generation, inflight: responses.size, pendingHandlers: live?.inflight || 0, collectionHealthy: role === 'active' ? Boolean(live?.healthy) : null, ...(errorCode ? { code: errorCode } : {}) };
  };
  const server = createServer(async (request, response) => {
    if (['GET', 'HEAD'].includes(request.method) && request.url === '/health') {
      const current = status(); return reply(request, response, current.status === 'ok' ? 200 : 503, current);
    }
    let state;
    try { state = await readState(stateFile); }
    catch { void reconcile(); return reply(request, response, 503, { code: 'SERVICE_NOT_ACTIVE' }); }
    if (stopping || role !== 'active' || !service || state.writer !== slot || state.active !== slot) {
      void reconcile(); return reply(request, response, 503, { code: 'SERVICE_NOT_ACTIVE' });
    }
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const entry = { method: request.method, finished };
    responses.set(response, entry);
    const done = () => { responses.delete(response); finish(); };
    response.once('finish', done); response.once('close', done);
    service.server.emit('request', request, response);
  });
  const timer = setInterval(() => { void reconcile(); }, pollMs); timer.unref();
  void reconcile();
  let shutdownWork;
  server.deployment = {
    status, reconcile,
    shutdown() { return shutdownWork ||= (async () => { stopping = true; clearInterval(timer); await reconcile(); await reconcile(); })(); },
  };
  server.once('close', () => { void server.deployment.shutdown(); });
  return server;
}
