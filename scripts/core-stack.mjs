#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from './business-stack.mjs';
export { main, businessStackPlan as coreStackPlan, runBusinessStack as runCoreStack, coreInstallation, coreConfigFile } from './business-stack.mjs';
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
