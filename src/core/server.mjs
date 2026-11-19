import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startCoreServer } from '../business/server.mjs';

export { createCoreServer, startCoreServer } from '../business/server.mjs';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await startCoreServer();
