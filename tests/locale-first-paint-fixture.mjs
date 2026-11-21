import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStore, SESSION_COOKIE } from '../src/business/auth.mjs';
import { createBusinessServer } from '../src/business/server.mjs';
import { createPraxisServer } from '../src/server.mjs';

// Every identity and store is local to this fixture. No installation config,
// app data directory, adapter credential or running service is consulted.
export async function localeFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'praxis-locale-first-paint-'));
  const services = [];
  let web;
  async function listen(server) {
    services.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${server.address().port}`;
  }
  const origin = await listen(createServer((request, response) => web.emit('request', request, response)));
  const auth = new AuthStore({ file: join(directory, 'auth.sqlite'), issuer: origin });
  const password = 'Synthetic-locale-only-password-2026';
  auth.createUser({ id: 'synthetic-locale-admin', username: 'synthetic-locale-admin', password });
  auth.setPlatformAdmin({ userId: 'synthetic-locale-admin', enabled: true });
  auth.setWebAccess({ userId: 'synthetic-locale-admin', apps: [], workbench: true, prds: true });
  const config = {
    issuer: origin, database: auth.file, eventsDatabase: join(directory, 'events.sqlite'),
    observationsFile: null, apps: {}, allowedHosts: [], webGateway: { enabled: true },
  };
  const core = createBusinessServer({
    config, auth, pollMs: 60000,
    fetchImpl: async () => { throw new Error('Synthetic locale fixture has no app adapters.'); },
    consoleFetchImpl: async () => { throw new Error('Synthetic locale fixture has no service probes.'); },
  });
  const coreOrigin = await listen(core);
  config.allowedHosts.push(new URL(coreOrigin).host);
  web = createPraxisServer({
    publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null,
    webGateway: { enabled: true, canonicalUrl: origin, coreUrl: coreOrigin, appTargets: {} },
  });
  const standalone = createPraxisServer({ publicUrlsFile: null, observationsFile: null, businessUrl: null, consoleUpstream: null });
  const standaloneOrigin = await listen(standalone);
  const session = auth.login({ username: 'synthetic-locale-admin', password }).sessionToken;
  let directCore;
  const directCoreOrigin = await listen(createServer((request, response) => directCore.emit('request', request, response)));
  const directAuth = new AuthStore({ file: join(directory, 'direct-auth.sqlite'), issuer: directCoreOrigin });
  directAuth.createUser({ id: 'synthetic-direct-admin', username: 'synthetic-direct-admin', password });
  directAuth.createUser({ id: 'synthetic-direct-member', username: 'synthetic-direct-member', password });
  directAuth.setPlatformAdmin({ userId: 'synthetic-direct-admin', enabled: true });
  directCore = createBusinessServer({
    config: { issuer: directCoreOrigin, database: directAuth.file, eventsDatabase: join(directory, 'direct-events.sqlite'), observationsFile: null, apps: {} },
    auth: directAuth, pollMs: 60000,
    fetchImpl: async () => { throw new Error('Synthetic locale fixture has no app adapters.'); },
    consoleFetchImpl: async () => { throw new Error('Synthetic locale fixture has no service probes.'); },
  });
  const directSession = directAuth.login({ username: 'synthetic-direct-admin', password }).sessionToken;
  const delegateSession = directAuth.login({ username: 'synthetic-direct-member', password }).sessionToken;
  t.after(async () => {
    web.close();
    for (const service of services.reverse()) {
      service.closeAllConnections();
      await new Promise(resolve => service.close(resolve));
    }
    await core.business.shutdown();
    core.business.events.close();
    directCore.close();
    await directCore.business.shutdown();
    directCore.business.events.close();
    directAuth.close();
    auth.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    origin, directCoreOrigin, standaloneOrigin, password,
    sessionCookie: { name: SESSION_COOKIE, value: session, url: origin },
    directSessionCookie: { name: SESSION_COOKIE, value: directSession, url: directCoreOrigin },
    delegateSessionCookie: { name: SESSION_COOKIE, value: delegateSession, url: directCoreOrigin },
  };
}
