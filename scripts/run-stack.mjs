import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { assertAppBindings } from '../src/storage/app-paths.mjs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { main as stack, SERVICES } from './stack.mjs';
import { main as bootstrap } from './storage-bootstrap.mjs';
import { main as worker } from './storage-worker.mjs';
import { businessStackPlan, runBusinessStack } from './business-stack.mjs';
import { DEFAULT_BUSINESS_CONFIG } from '../src/business/config.mjs';
import { deploymentOverrides } from '../src/deployment/integration.mjs';
import { main as polaris, POLARIS_SERVICES } from './polaris-stack.mjs';
import { main as dataInventory } from './data-inventory.mjs';

export async function validateWorkingData({ storageConfig, businessConfig, polarisConfig }) {
  const json = async file => JSON.parse(await readFile(file, 'utf8'));
  const storage = await json(storageConfig || process.env.PRAXIS_STORAGE_CONFIG || join(homedir(), '.config/praxis/storage.json'));
  if (!storage.workingData) return;
  const business = await json(businessConfig);
  const reminder = await json(business.apps.reminder.spacesFile), slides = await json(business.apps.slides.spacesFile);
  const polaris = await json(polarisConfig || process.env.PRAXIS_POLARIS_CONFIG || join(homedir(), '.config/praxis/polaris.json'));
  return assertAppBindings(storage, business, { reminderSpaces: reminder.spaces, slidesSpaces: slides.spaces, polaris });
}

export async function businessOperation(args) {
  const [command, ...options] = args;
  const configFile = options[0] === '--config' ? options[1] : process.env.PRAXIS_BUSINESS_CONFIG || DEFAULT_BUSINESS_CONFIG;
  const plan = await businessStackPlan(configFile);
  if (!plan.override.services.reminder) throw new Error('The unified stack requires explicitly managed Reminder in the business project.');
  if (command === 'validate') return { services: plan.services };
  const output = await runBusinessStack(command, { configFile, deferDeploymentFacade: options.includes('--defer-deployment-facade') });
  if (command !== 'status') return output;
  let rows; try { const value = JSON.parse(output || '[]'); rows = Array.isArray(value) ? value : [value]; } catch { rows = String(output).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  const services = plan.services.map(name => { const row = rows.find(value => value.Service === name); return { name, ...(name === 'storage-status' ? {} : { port: { business: 4326, reminder: 4322, projects: 4327, 'slides-business': 4328 }[name] }), state: row?.State || 'absent', health: row?.Health || 'unknown' }; });
  return { healthy: services.every(service => service.state === 'running' && service.health === 'healthy'), expectedServices: plan.services, services };
}

export async function deploymentOperation(args) {
  const [command, , configFile] = args;
  const configuration = await deploymentOverrides(configFile);
  if (!configuration) return { enabled: false, healthy: true };
  if (command === 'enabled') return { enabled: true };
  const { main } = await import('./deploy.mjs');
  return main([command, '--state-dir', configuration.root], { print: false });
}

export async function main(args = process.argv.slice(2), operations = { stack: args => stack(args, { print: () => {} }), bootstrap, worker: args => worker(args, { print: false }), business: businessOperation, deployment: deploymentOperation, polaris: args => polaris(args, { print: false }), inventory: args => dataInventory(args, { print: () => {} }), validateWorkingData, print: console.log }) {
  const [command = 'up', ...options] = args;
  let polarisConfig, storageConfig, businessConfig = process.env.PRAXIS_BUSINESS_CONFIG || DEFAULT_BUSINESS_CONFIG;
  for (let index = 0; index < options.length; index += 2) {
    if (!['--config', '--business-config', '--polaris-config'].includes(options[index]) || !options[index + 1]) throw new Error('Only --config PATH, --business-config PATH and --polaris-config PATH are accepted');
    if (options[index] === '--config') storageConfig = options[index + 1]; else if (options[index] === '--polaris-config') polarisConfig = options[index + 1]; else businessConfig = options[index + 1];
  }
  const storageOptions = storageConfig ? ['--config', storageConfig] : [];
  const businessOptions = ['--config', businessConfig];
  const polarisOptions = polarisConfig ? ['--config', polarisConfig] : [];
  const bindingOptions = ['--source-mode', 'registered', '--without-reminder', ...storageOptions];
  const deploymentEnabled = operations.deployment && (await operations.deployment(['enabled', ...businessOptions]))?.enabled;
  const deferred = deploymentEnabled ? ['--defer-deployment-facade'] : [];
  let businessInventory;
  async function status() {
    const result = { sourceMode: 'registered', groups: {}, services: [], healthy: true };
    for (const [name, operation, parameters] of [['apps', operations.stack, ['status', '--json', ...bindingOptions]], ['business', operations.business, ['status', ...businessOptions]], ['storage', operations.worker, ['status', ...storageOptions]]]) {
      try {
        const group = await operation(parameters);
        result.groups[name] = group ?? { healthy: false };
        result.services.push(...(group?.services || []));
        const expected = name === 'apps' ? Object.keys(SERVICES).filter(service => service !== 'reminder') : name === 'business' ? businessInventory || group?.expectedServices || ['business', 'reminder'] : ['storage'];
        if (name === 'business' && (!Array.isArray(expected) || ![2, 3, 4, 5].includes(expected.length) || !expected.includes('business') || !expected.includes('reminder') || expected.some(service => !['business', 'reminder', 'projects', 'slides-business', 'storage-status'].includes(service)) || new Set(expected).size !== expected.length)) { result.healthy = false; continue; }
        const actual = group?.services?.map(service => service.name).sort() || [];
        if (!group?.healthy || JSON.stringify(actual) !== JSON.stringify(expected.sort())) result.healthy = false;
      } catch (error) { result.groups[name] = { healthy: false, error: error.code || 'UNAVAILABLE' }; result.healthy = false; }
    }
    if (operations.polaris) {
      try {
        const group = await operations.polaris(['status', ...polarisOptions]);
        if (group?.enabled !== false) {
          result.groups.polaris = group ?? { healthy: false }; result.services.push(...(group?.services || []));
          const actual = group?.services?.map(service => service.name).sort() || [];
          if (!group?.healthy || JSON.stringify(actual) !== JSON.stringify([...POLARIS_SERVICES].sort())) result.healthy = false;
        }
      } catch (error) { result.groups.polaris = { healthy: false, error: error.code || 'UNAVAILABLE' }; result.healthy = false; }
    }
    if (deploymentEnabled) {
      try { result.groups.deployment = await operations.deployment(['status', ...businessOptions]); if (!result.groups.deployment?.healthy) result.healthy = false; }
      catch (error) { result.groups.deployment = { healthy: false, error: error.code || 'UNAVAILABLE' }; result.healthy = false; }
    }
    (operations.print || (() => {}))(JSON.stringify(result));
    return result;
  }
  if (command === 'up') {
    if (operations.validateWorkingData) await operations.validateWorkingData({ storageConfig, businessConfig, polarisConfig });
    businessInventory = (await operations.business(['validate', ...businessOptions]))?.services;
    if (operations.polaris) await operations.polaris(['validate', ...polarisOptions]);
    await operations.stack(['up', ...bindingOptions, ...deferred]);
    await operations.business(['up', ...businessOptions, ...deferred]);
    if (deploymentEnabled) await operations.deployment(['up', ...businessOptions]);
    if (deploymentEnabled) await operations.stack(['activate', ...bindingOptions]);
    if (operations.polaris) await operations.polaris(['up', ...polarisOptions]);
    await operations.bootstrap(['activate-bind', ...storageOptions, '--business-config', businessConfig]);
    await operations.worker(['up', ...storageOptions]);
    const result = await status();
    if (!result.healthy) throw new Error('The unified stack has missing or unhealthy services; inspect its grouped status.');
    if (operations.inventory) await operations.inventory(['publish', '--config', businessConfig, ...(storageConfig ? ['--storage-config', storageConfig] : []), ...(polarisConfig ? ['--polaris-config', polarisConfig] : [])]);
    return result;
  } else if (command === 'down') {
    const errors = [];
    for (const [operation, parameters] of [[operations.worker, ['down', ...storageOptions]], ...(operations.polaris ? [[operations.polaris, ['down', ...polarisOptions]]] : []), ...(deploymentEnabled ? [[operations.deployment, ['down', ...businessOptions]]] : []), [operations.business, ['down', ...businessOptions]], [operations.stack, ['down', ...bindingOptions]]]) {
      try { await operation(parameters); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw errors[0];
  } else if (command === 'status') {
    return status();
  } else throw new Error('Usage: run-stack.mjs up|down|status [--config PATH] [--business-config PATH] [--polaris-config PATH]');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().then(result => { if (result && !result.healthy) process.exitCode = 1; }).catch(error => {
  console.error(`Stack orchestration failed: ${error.code || error.message}`);
  process.exitCode = 1;
});
