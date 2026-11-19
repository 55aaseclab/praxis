import { createServer, request as httpRequest } from 'node:http';
import { lstat, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readDeploymentState } from './state.mjs';

const hops = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
function headers(input, upgrade = false) {
  const dynamic = new Set(String(input.connection || '').toLowerCase().split(',').map(value => value.trim()));
  const result = Object.fromEntries(Object.entries(input).filter(([key]) => !hops.has(key) && !dynamic.has(key)));
  if (upgrade) { result.connection = 'Upgrade'; result.upgrade = input.upgrade; }
  return result;
}
function unavailable(response, code = 'DEPLOYMENT_UNAVAILABLE') {
  if (response.headersSent || response.destroyed) return;
  const body = JSON.stringify({ code });
  response.writeHead(503, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Retry-After': '1' }); response.end(body);
}
function socketFailure(socket, status = 503) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} Service Unavailable\r\nConnection: close\r\nRetry-After: 1\r\nContent-Length: 0\r\n\r\n`);
}
function listen(server, ...args) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(...args, () => { server.removeListener('error', reject); resolve(); }); });
}
async function socketAvailable(file) {
  const info = await lstat(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!info) return;
  if (!info.isSocket() || info.uid !== process.getuid?.()) throw new Error('The deployment control path is unsafe.');
  const live = await new Promise(resolve => {
    const probe = httpRequest({ socketPath: file, path: '/status', timeout: 500 }, response => { response.resume(); resolve(true); });
    probe.once('timeout', () => { probe.destroy(); resolve(true); });
    probe.once('error', error => resolve(!['ECONNREFUSED', 'ENOENT'].includes(error.code))); probe.end();
  });
  if (live) throw new Error('The deployment control socket is already active.');
  await unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

export function createDeploymentProxy({ channel, stateFile, socketFile, pollMs = 50, queueTimeoutMs = 30000, maxQueue = 128, upstreamTimeoutMs = 120000 } = {}) {
  if (!['web', 'core'].includes(channel) || typeof stateFile !== 'string' || !stateFile.startsWith('/') || typeof socketFile !== 'string' || !socketFile.startsWith('/') || !Number.isInteger(pollMs) || pollMs < 10 || pollMs > 100 || !Number.isInteger(maxQueue) || maxQueue < 1 || maxQueue > 128 || !Number.isFinite(queueTimeoutMs) || queueTimeoutMs < 1 || queueTimeoutMs > 30000) throw new Error('The deployment proxy configuration is invalid.');
  let state, stateError = true, polling = false, closed = false, socketInode;
  const inFlight = new Set(), queue = new Set(), clients = new Set();
  const status = () => ({ channel, generation: state?.generation ?? null, active: state?.active ?? null, writer: state?.writer ?? null, paused: state?.paused ?? true, valid: !stateError, queued: queue.size, inFlight: { normal: [...inFlight].filter(item => item.kind === 'normal').length, streams: [...inFlight].filter(item => item.kind === 'streams').length, upgrades: [...inFlight].filter(item => item.kind === 'upgrades').length } });
  function track(kind, stop) {
    const record = { kind, stop }; inFlight.add(record);
    record.done = () => inFlight.delete(record);
    return record;
  }
  function flush() {
    if (stateError || !state || state.paused || closed) return;
    for (const item of [...queue]) { queue.delete(item); clearTimeout(item.timer); item.forward(state); }
  }
  async function refresh() {
    if (polling || closed) return;
    polling = true;
    try {
      const next = await readDeploymentState(stateFile);
      if (state && (next.generation < state.generation || next.generation === state.generation && JSON.stringify(next) !== JSON.stringify(state))) throw new Error('Deployment generations must advance for state changes.');
      state = next; stateError = false; flush();
    } catch { stateError = true; }
    finally { polling = false; }
  }
  const initialized = refresh();
  const timer = setInterval(() => { void refresh(); }, pollMs); timer.unref();
  function enqueue(item) {
    if (queue.size >= maxQueue) { item.fail(); return; }
    item.timer = setTimeout(() => { queue.delete(item); item.fail(); }, queueTimeoutMs); item.timer.unref();
    queue.add(item);
    item.connection.once('close', () => { queue.delete(item); clearTimeout(item.timer); });
  }
  function forwardHttp(request, response, selected, health) {
    if (response.destroyed || request.aborted) return;
    const target = new URL(selected.slots[selected.active][channel]);
    let outgoing, incoming;
    const record = health ? null : track('normal', () => { incoming?.destroy(); outgoing?.destroy(); response.destroy(); });
    const done = () => record?.done();
    try {
      outgoing = httpRequest({ protocol: 'http:', hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, method: request.method, path: request.url, headers: headers(request.headers) }, result => {
        incoming = result; outgoing.setTimeout(0);
        if (record && request.method === 'GET' && /^text\/event-stream(?:;|$)/i.test(String(result.headers['content-type'] || ''))) record.kind = 'streams';
        result.once('end', done); result.once('close', done); result.once('error', () => { done(); response.destroy(); });
        if (response.destroyed) { result.resume(); return; }
        response.writeHead(result.statusCode, { ...headers(result.headers), 'X-Praxis-Deployment-Slot': selected.active, 'X-Praxis-Deployment-Generation': String(selected.generation) });
        result.pipe(response);
      });
      outgoing.once('error', () => { done(); if (response.headersSent) response.destroy(); else unavailable(response); });
      outgoing.setTimeout(upstreamTimeoutMs, () => outgoing.destroy(new Error('The deployment upstream timed out.')));
      request.once('aborted', () => outgoing.destroy());
      response.once('close', () => {
        if (request.method === 'GET' || request.method === 'HEAD') { incoming?.destroy(); outgoing.destroy(); done(); }
        // A disconnected mutation still drains its upstream before writer handoff.
      });
      request.resume(); request.pipe(outgoing);
    } catch { done(); outgoing?.destroy(); unavailable(response); }
  }
  async function handle(request, response) {
    await initialized;
    if (closed || stateError || !state) { request.resume(); unavailable(response); return; }
    const health = ['GET', 'HEAD'].includes(request.method) && request.url === '/health';
    if (state.paused && !health) {
      request.pause();
      enqueue({ connection: response, forward: selected => forwardHttp(request, response, selected, false), fail: () => { request.resume(); unavailable(response, 'DEPLOYMENT_PAUSED'); } });
      return;
    }
    forwardHttp(request, response, state, health);
  }
  function forwardUpgrade(request, socket, head, selected) {
    if (socket.destroyed) return;
    const target = new URL(selected.slots[selected.active][channel]);
    let upstream, upgraded;
    const record = track('upgrades', () => { upstream?.destroy(); upgraded?.destroy(); socket.destroy(); });
    const done = () => record.done();
    try {
      upstream = httpRequest({ hostname: target.hostname.replace(/^\[|\]$/g, ''), port: target.port, method: request.method, path: request.url, headers: headers(request.headers, true) });
      upstream.once('upgrade', (response, peer, extra) => {
        upgraded = peer; upstream.setTimeout(0);
        const raw = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
        for (let index = 0; index < response.rawHeaders.length; index += 2) raw.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
        socket.write(raw.join('\r\n') + '\r\n\r\n'); if (extra.length) socket.write(extra); if (head.length) peer.write(head);
        peer.once('close', done); peer.once('error', () => { done(); socket.destroy(); });
        socket.once('close', () => { peer.destroy(); done(); }); socket.once('error', () => { peer.destroy(); done(); });
        socket.pipe(peer); peer.pipe(socket); socket.resume();
      });
      upstream.once('response', response => {
        const raw = [`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}`];
        for (let index = 0; index < response.rawHeaders.length; index += 2) raw.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
        socket.write(raw.join('\r\n') + '\r\n\r\n'); response.pipe(socket); response.once('end', done); response.once('close', done);
      });
      upstream.once('error', () => { done(); socketFailure(socket); }); upstream.setTimeout(upstreamTimeoutMs, () => upstream.destroy());
      socket.once('close', () => { upstream.destroy(); done(); }); upstream.end();
    } catch { done(); upstream?.destroy(); socketFailure(socket); }
  }
  const server = createServer({ maxHeaderSize: 16384 }, (request, response) => { void handle(request, response).catch(() => unavailable(response)); });
  server.on('connection', socket => { clients.add(socket); socket.once('close', () => clients.delete(socket)); });
  server.on('upgrade', async (request, socket, head) => {
    await initialized;
    if (closed || stateError || !state) { socketFailure(socket); return; }
    if (state.paused) { socket.pause(); enqueue({ connection: socket, forward: selected => forwardUpgrade(request, socket, head, selected), fail: () => socketFailure(socket) }); }
    else forwardUpgrade(request, socket, head, state);
  });
  const control = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/close-streams') {
      for (const record of [...inFlight]) if (['streams', 'upgrades'].includes(record.kind)) record.stop();
    } else if (request.method !== 'GET' || request.url !== '/status') { response.writeHead(404).end(); return; }
    request.resume(); const body = JSON.stringify(status());
    response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }); response.end(body);
  });
  server.deployment = {
    status,
    refresh,
    async startControl() {
      const parent = await lstat(dirname(socketFile));
      if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077 || parent.uid !== process.getuid?.()) throw new Error('The deployment socket directory must be private.');
      await socketAvailable(socketFile); await listen(control, socketFile); await chmod(socketFile, 0o600); socketInode = (await lstat(socketFile)).ino;
    },
    async shutdown({ graceMs = 30000 } = {}) {
      if (closed) return; closed = true; clearInterval(timer);
      for (const item of queue) { clearTimeout(item.timer); item.fail(); } queue.clear();
      for (const record of [...inFlight]) if (['streams', 'upgrades'].includes(record.kind)) record.stop();
      const force = setTimeout(() => {
        for (const record of [...inFlight]) record.stop();
        for (const socket of clients) socket.destroy();
      }, graceMs); force.unref();
      try { await Promise.all([server, control].map(value => new Promise(resolve => value.close(() => resolve())))); }
      finally { clearTimeout(force); }
      const info = await lstat(socketFile).catch(() => null);
      if (info?.isSocket() && info.ino === socketInode) await unlink(socketFile);
    },
  };
  return server;
}
export async function startDeploymentProxy({ host = '127.0.0.1', port, ...options }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('The deployment proxy port is invalid.');
  const server = createDeploymentProxy(options);
  try { await server.deployment.startControl(); await listen(server, port, host); return server; }
  catch (error) { await server.deployment.shutdown(); throw error; }
}
