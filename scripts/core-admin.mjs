import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCoreAdmin } from './business-admin.mjs';

export { initializeBusiness as initializeCore, administerBusiness as administerCore, runCoreAdmin } from './business-admin.mjs';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runCoreAdmin();
