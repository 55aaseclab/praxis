import { fileURLToPath } from 'node:url';
import { resolve, isAbsolute } from 'node:path';
import { loadAppIntegrations } from './app-integrations.mjs';

const selectedRoot = process.env.PRAXIS_APP_SOURCE_ROOT || fileURLToPath(new URL('../', import.meta.url));
if (!isAbsolute(selectedRoot) || resolve(selectedRoot) !== selectedRoot.replace(/\/$/, '')) throw new Error('The app source root must be an absolute canonical path.');
export const DEFAULT_APP_REGISTRY = await loadAppIntegrations(selectedRoot);
