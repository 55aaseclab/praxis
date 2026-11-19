import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDeploymentProxy } from '../src/deployment/proxy.mjs';
import { readDeploymentState, writeDeploymentState, validateDeploymentState } from '../src/deployment/state.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 3000;
  while (!await check()) { if (Date.now() > end) throw new Error('The proxy condition did not become true.'); await sleep(10); }
}
function request(origin, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(new URL(path, origin), { method, headers }, response => {
      const parts = []; response.on('data', chunk => parts.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(parts) }));
      response.once('error', reject);
    }); outgoing.once('error', reject); outgoing.end(body);
  });
}
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-deployment-proxy-')), stateFile = join(directory, 'state.json'), socketFile = join(directory, 'web.sock');
  const received = [], held = [], streams = new Set(), peers = new Set(), servers = [], slots = {};
  for (const color of ['blue', 'green']) {
    slots[color] = {};
    for (const channel of ['web', 'core']) {
      const server = createServer(async (incoming, response) => {
        const parts = []; for await (const chunk of incoming) parts.push(chunk);
        const record = { color, channel, method: incoming.method, url: incoming.url, headers: incoming.headers, body: Buffer.concat(parts) }; received.push(record);
        if (incoming.url === '/held') { held.push({ record, response }); return; }
        if (incoming.url === '/nested' && channel === 'web') {
          held.push({ record, response, async resume() { const core = await request(slots[color].core, '/nested-core'); response.end(JSON.stringify({ web: color, core: JSON.parse(core.body).color })); } }); return;
        }
        if (incoming.url === '/stream') { streams.add(response); response.once('close', () => streams.delete(response)); response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(`data: ${color}\n\n`); return; }
        if (incoming.url.startsWith('/echo')) { response.writeHead(206, { 'Content-Type': 'application/octet-stream', ETag: '"unchanged"', 'Last-Modified': 'Mon, 16 Nov 2026 00:00:00 GMT', 'Content-Range': 'bytes 0-3/4', 'Set-Cookie': ['first=one; HttpOnly', 'second=two; Secure'] }); response.end(record.body); return; }
        response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ color, channel }));
      });
      server.on('upgrade', (incoming, socket) => {
        peers.add(socket); socket.once('close', () => peers.delete(socket));
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n'); socket.write(`hello:${color}`); socket.on('data', data => socket.write(data));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
      slots[color][channel] = `http://127.0.0.1:${server.address().port}`;
    }
  }
  let state = { version: 1, generation: 1, active: 'blue', writer: 'blue', paused: false, slots };
  await writeDeploymentState(stateFile, state);
  const proxy = createDeploymentProxy({ channel: 'web', stateFile, socketFile, ...options });
  await proxy.deployment.startControl(); await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  let core;
  if (options.withCore) {
    core = createDeploymentProxy({ channel: 'core', stateFile, socketFile: join(directory, 'core.sock') });
    await core.deployment.startControl(); await new Promise(resolve => core.listen(0, '127.0.0.1', resolve));
    await until(() => core.deployment.status().valid);
  }
  const origin = `http://127.0.0.1:${proxy.address().port}`;
  await until(() => proxy.deployment.status().valid);
  async function set(patch) { state = { ...state, ...patch, generation: state.generation + 1 }; await writeDeploymentState(stateFile, state); await until(() => proxy.deployment.status().generation === state.generation && (!core || core.deployment.status().generation === state.generation)); }
  async function control(path, method = 'GET') {
    return await new Promise((resolve, reject) => {
      const outgoing = httpRequest({ socketPath: socketFile, path, method }, response => { let body = ''; response.on('data', data => body += data); response.once('end', () => resolve({ status: response.statusCode, value: JSON.parse(body) })); }); outgoing.once('error', reject); outgoing.end();
    });
  }
  t.after(async () => {
    for (const response of streams) response.destroy(); for (const socket of peers) socket.destroy();
    for (const item of held) item.response.destroy();
    await Promise.all([proxy.deployment.shutdown(), core?.deployment.shutdown()]);
    await Promise.all(servers.map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, origin, proxy, core, stateFile, received, held, streams, set, control, get state() { return state; } };
}
function stream(origin, method = 'GET') {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(new URL('/stream', origin), { method }, response => {
      let text = '', closed = false; response.on('data', data => text += data); response.on('close', () => { closed = true; }); response.on('error', () => {});
      resolve({ outgoing, response, get text() { return text; }, get closed() { return closed; } });
    }); outgoing.on('error', reject); outgoing.end();
  });
}

test('atomic deployment state is private and rejects unsafe targets or inconsistent writers', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'deployment-state-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { version: 1, generation: 1, active: 'blue', writer: 'blue', paused: false, slots: { blue: { web: 'http://127.0.0.1:24321', core: 'http://127.0.0.1:24326' }, green: { web: 'http://127.0.0.1:34321', core: 'http://127.0.0.1:34326' } } };
  const file = join(directory, 'state.json'); await writeDeploymentState(file, state);
  assert.deepEqual(await readDeploymentState(file), state); assert.equal((await stat(file)).mode & 0o777, 0o600);
  for (const patch of [{ writer: 'green' }, { generation: 0 }, { active: 'other' }, { arbitrary: true }, { slots: { ...state.slots, green: { ...state.slots.green, web: 'https://external.invalid/' } } }]) assert.throws(() => validateDeploymentState({ ...state, ...patch }));
  assert.equal(validateDeploymentState({ ...state, writer: null, paused: true }).writer, null);
});

test('switching drains a held POST once and routes queued mutations only to the committed slot', async t => {
  const f = await fixture(t);
  const pending = request(f.origin, '/held', { method: 'POST', body: 'original-body' });
  await until(() => f.held.length === 1);
  await f.set({ paused: true });
  const queued = request(f.origin, '/echo?raw=%2Fkeep', { method: 'POST', headers: { Host: 'polaris.synthetic.test', Cookie: 'session=private', Authorization: 'Bearer synthetic-token', Origin: 'https://polaris.synthetic.test', Range: 'bytes=0-3' }, body: Buffer.from([0, 1, 200, 255]) });
  await until(() => f.proxy.deployment.status().queued === 1);
  assert.equal((await request(f.origin, '/health')).status, 200);
  assert.equal((await f.control('/status')).value.inFlight.normal, 1);
  f.held[0].response.end('blue-committed'); assert.equal((await pending).body.toString(), 'blue-committed');
  await until(() => f.proxy.deployment.status().inFlight.normal === 0);
  await f.set({ active: 'green', writer: 'green', paused: false });
  const result = await queued; assert.equal(result.status, 206); assert.deepEqual(result.body, Buffer.from([0, 1, 200, 255]));
  assert.equal(result.headers.etag, '"unchanged"'); assert.equal(result.headers['content-range'], 'bytes 0-3/4'); assert.equal(result.headers['last-modified'], 'Mon, 16 Nov 2026 00:00:00 GMT'); assert.equal(result.headers['set-cookie'].length, 2);
  const forwarded = f.received.find(item => item.url.startsWith('/echo'));
  assert.equal(forwarded.color, 'green'); assert.equal(forwarded.headers.host, 'polaris.synthetic.test'); assert.equal(forwarded.headers.cookie, 'session=private'); assert.equal(forwarded.headers.authorization, 'Bearer synthetic-token'); assert.equal(forwarded.headers.origin, 'https://polaris.synthetic.test'); assert.equal(forwarded.headers.range, 'bytes=0-3'); assert.equal(forwarded.url, '/echo?raw=%2Fkeep');
  assert.equal(f.received.filter(item => item.url === '/held').length, 1); assert.equal(f.received.filter(item => item.url.startsWith('/echo')).length, 1);
});

test('pause queues are bounded and timed out requests never reach an upstream', async t => {
  const f = await fixture(t, { maxQueue: 2, queueTimeoutMs: 250 }); await f.set({ paused: true });
  const one = request(f.origin, '/first', { method: 'POST', body: 'one' }), two = request(f.origin, '/second', { method: 'POST', body: 'two' });
  await until(() => f.proxy.deployment.status().queued === 2);
  const overflow = await request(f.origin, '/overflow', { method: 'POST' }); assert.equal(overflow.status, 503); assert.equal(overflow.headers['retry-after'], '1');
  assert.equal((await one).status, 503); assert.equal((await two).status, 503); assert.equal(f.received.length, 0);
});

test('a pinned web request can finish through its own core while both stable facades are paused', async t => {
  const f = await fixture(t, { withCore: true });
  const web = request(f.origin, '/nested', { method: 'POST', body: 'one-intent' });
  await until(() => f.held.length === 1); await f.set({ paused: true });
  const coreOrigin = `http://127.0.0.1:${f.core.address().port}`;
  const queued = request(coreOrigin, '/direct-mutation', { method: 'POST', body: 'later-intent' });
  await until(() => f.core.deployment.status().queued === 1);
  await f.held[0].resume();
  assert.deepEqual(JSON.parse((await web).body), { web: 'blue', core: 'blue' });
  await until(() => f.proxy.deployment.status().inFlight.normal === 0);
  assert.equal(f.received.filter(value => value.url === '/nested-core').length, 1);
  assert.equal(f.received.filter(value => value.url === '/direct-mutation').length, 0);
  await f.set({ active: 'green', writer: 'green', paused: false });
  assert.deepEqual(JSON.parse((await queued).body), { color: 'green', channel: 'core' });
});

test('GET SSE and WebSocket streams drain without closing a POST SSE mutation', async t => {
  const f = await fixture(t), get = await stream(f.origin), post = await stream(f.origin, 'POST');
  const peer = await new Promise((resolve, reject) => {
    const outgoing = httpRequest(f.origin, { headers: { Upgrade: 'websocket', Connection: 'Upgrade', Host: 'polaris.synthetic.test', Origin: 'https://polaris.synthetic.test' } });
    outgoing.once('upgrade', (_, socket, head) => { socket.on('error', () => {}); resolve({ socket, head }); }); outgoing.once('error', reject); outgoing.end();
  });
  await until(() => { const counts = f.proxy.deployment.status().inFlight; return counts.normal === 1 && counts.streams === 1 && counts.upgrades === 1; });
  await f.control('/close-streams', 'POST');
  await until(() => get.closed && peer.socket.destroyed);
  assert.equal(post.closed, false); assert.equal(f.proxy.deployment.status().inFlight.normal, 1);
  for (const response of f.streams) response.end();
  await until(() => f.proxy.deployment.status().inFlight.normal === 0);
});

test('invalid on-disk state fails closed then recovers only through a valid advancing generation', async t => {
  const f = await fixture(t);
  await writeFile(f.stateFile, '{"invalid":true}', { mode: 0o600 });
  await until(() => !f.proxy.deployment.status().valid);
  const result = await request(f.origin, '/private', { method: 'POST', body: 'never-forward' }); assert.equal(result.status, 503);
  assert.equal((await request(f.origin, '/health')).status, 503); assert.equal(f.received.length, 0);
  await f.set({}); assert.equal((await request(f.origin, '/health')).status, 200);
});
