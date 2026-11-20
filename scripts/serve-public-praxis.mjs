import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';
import { access } from 'node:fs/promises';
import { createPraxisServer } from '../src/server.mjs';

const managed = process.env.PRAXIS_WEB_GATEWAY === 'true';
const publicUrlsFile = managed ? null : process.env.PRAXIS_PUBLIC_URLS_FILE;
if (publicUrlsFile) await access(publicUrlsFile);
const port = Number(process.env.PORT || 14321);
const host = process.env.HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
const server = createPraxisServer({
  publicUrlsFile,
  webGateway: {
    privateDocumentOwnerId: process.env.PRAXIS_DOCUMENT_OWNER_ID,
    privateDocumentRoots: Object.fromEntries(DEFAULT_APP_REGISTRY.apps.filter(app => app.integration.web.kind === 'private-documents').map(app => [app.id, process.env[app.integration.web.directoryEnv]])),
    enabled: managed,
    canonicalUrl: process.env.PRAXIS_CANONICAL_URL,
    coreUrl: process.env.PRAXIS_WEB_CORE_URL || 'http://127.0.0.1:4326',
    originHost: process.env.PRAXIS_ORIGIN_HOST || 'localhost',
    ...Object.fromEntries(DEFAULT_APP_REGISTRY.apps.filter(app => app.integration.web.share?.configurationEnv).map(app => { const share = app.integration.web.share; return [share.configurationKey, process.env[share.configurationEnv]]; })),
  },
});
server.on('error', error => { console.error(`Praxis public profile failed: ${error.message}`); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Praxis public profile listening on ${host}:${port}`));
