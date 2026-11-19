import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../scripts/run-stack.mjs';
import { SERVICES } from '../scripts/stack.mjs';

const appServiceCount = Object.keys(SERVICES).filter(name => name !== 'reminder').length;
const names = { stack: Object.keys(SERVICES).filter(name => name !== 'reminder'), business: ['business', 'reminder'], worker: ['storage'] };
function harness() {
  const calls = [];
  const operations = Object.fromEntries(['stack', 'bootstrap', 'worker', 'business'].map(name => [name, async args => {
    calls.push([name, args]);
    if (args[0] === 'status') return { healthy: true, services: names[name].map(name => ({ name, state: 'running', health: 'healthy' })) };
  }]));
  return { calls, operations };
}

test('one-shot startup verifies both application projects before activating unchanged sources and starting the consumer', async () => {
  const { calls, operations } = harness();
  const result = await main(['up', '--config', '/private/storage.json', '--business-config', '/private/business.json'], operations);
  assert.equal(result.healthy, true);
  assert.equal(result.services.length, appServiceCount + 3);
  assert.deepEqual(calls.slice(0, 5), [
    ['business', ['validate', '--config', '/private/business.json']],
    ['stack', ['up', '--source-mode', 'registered', '--without-reminder', '--config', '/private/storage.json']],
    ['business', ['up', '--config', '/private/business.json']],
    ['bootstrap', ['activate-bind', '--config', '/private/storage.json', '--business-config', '/private/business.json']],
    ['worker', ['up', '--config', '/private/storage.json']],
  ]);
  assert.ok(!JSON.stringify(calls).includes('prepare-docker'));
  assert.ok(!JSON.stringify(calls).includes('activate-docker'));
});

test('shutdown attempts both application projects even when the storage consumer is unavailable', async () => {
  const { calls, operations } = harness();
  operations.worker = async () => { throw new Error('Worker absent'); };
  await assert.rejects(main(['down'], operations), /Worker absent/);
  assert.deepEqual(calls.map(([name]) => name), ['business', 'stack']);
  assert.equal(calls[1][1][0], 'down');
  assert.ok(calls[1][1].includes('--without-reminder'));
});

test('activation failure prevents the consumer without copying or redirecting registered sources', async () => {
  const { calls, operations } = harness();
  operations.bootstrap = async () => { throw new Error('Synthetic activation failure'); };
  await assert.rejects(main(['up'], operations), /activation failure/);
  assert.deepEqual(calls.map(([name]) => name), ['business', 'stack', 'business']);
});

test('aggregate status rejects missing business services and the old eleven-service inventory', async () => {
  const { operations } = harness();
  operations.stack = async () => ({ healthy: true, services: Object.keys(SERVICES).map(name => ({ name })) });
  assert.equal((await main(['status'], operations)).healthy, false);
  operations.stack = async () => ({ healthy: true, services: names.stack.map(name => ({ name })) });
  operations.business = async () => { throw Object.assign(new Error('Unavailable'), { code: 'UNAVAILABLE' }); };
  const result = await main(['status'], operations);
  assert.equal(result.healthy, false);
  assert.equal(result.groups.core.error, 'UNAVAILABLE');
  assert.equal(result.groups.storage.healthy, true);
});

test('optional storage metadata publisher extends the exact unified inventory', async () => {
  const { operations } = harness(), expectedServices = ['business', 'reminder', 'storage-status'];
  operations.business = async args => args[0] === 'validate' ? { services: expectedServices } : { healthy: true, expectedServices, services: expectedServices.map(name => ({ name, state: 'running', health: 'healthy' })) };
  const result = await main(['status'], operations);
  assert.equal(result.healthy, true);
  assert.equal(result.services.length, appServiceCount + 4);
  assert.equal((await main(['up'], operations)).services.length, appServiceCount + 4);
  operations.business = async () => ({ healthy: true, expectedServices, services: expectedServices.slice(0, 2).map(name => ({ name })) });
  assert.equal((await main(['status'], operations)).healthy, false);
});

test('dynamic inventory cannot redefine away required services or add unrelated containers', async () => {
  const { operations } = harness();
  for (const expectedServices of [['business'], ['business', 'reminder', 'unrelated'], ['business', 'reminder', 'reminder']]) {
    operations.business = async () => ({ healthy: true, expectedServices, services: expectedServices.map(name => ({ name })) });
    assert.equal((await main(['status'], operations)).healthy, false);
  }
});

test('one Projects service extends the inventory without creating a service per business project', async () => {
  const { operations } = harness(), expectedServices = ['business', 'reminder', 'projects', 'storage-status'];
  operations.business = async args => args[0] === 'validate' ? { services: expectedServices } : { healthy: true, expectedServices, services: expectedServices.map(name => ({ name, state: 'running', health: 'healthy' })) };
  const result = await main(['status'], operations);
  assert.equal(result.healthy, true); assert.equal(result.services.length, appServiceCount + 5);
  operations.business = async () => ({ healthy: true, expectedServices, services: expectedServices.filter(name => name !== 'projects').map(name => ({ name })) });
  assert.equal((await main(['status'], operations)).healthy, false);
});

test('blue-green startup restores singletons before slots and finalizes the unchanged canonical bindings', async () => {
  const { calls, operations } = harness();
  operations.deployment = async args => {
    calls.push(['deployment', args]);
    return { enabled: true, healthy: true, active: 'green' };
  };
  const result = await main(['up', '--config', '/private/storage.json', '--business-config', '/private/business.json'], operations);
  assert.equal(result.healthy, true);
  assert.equal(result.groups.deployment.active, 'green');
  const starts = calls.filter(([, args]) => args[0] === 'up');
  assert.deepEqual(starts.map(([name]) => name), ['stack', 'business', 'deployment', 'worker']);
  assert.ok(starts.slice(0, 2).every(([, args]) => args.includes('--defer-deployment-facade')));
  const restore = calls.findIndex(([name, args]) => name === 'deployment' && args[0] === 'up');
  const finalize = calls.findIndex(([name, args]) => name === 'stack' && args[0] === 'activate');
  const binding = calls.findIndex(([name]) => name === 'bootstrap');
  assert.ok(restore < finalize && finalize < binding);
  assert.equal(result.services.length, appServiceCount + 3);
});

test('blue-green shutdown drains core slots before stopping the original Compose services', async () => {
  const { calls, operations } = harness();
  operations.deployment = async args => { calls.push(['deployment', args]); return { enabled: true, healthy: true }; };
  await main(['down'], operations);
  assert.deepEqual(calls.filter(([, args]) => args[0] === 'down').map(([name]) => name), ['worker', 'deployment', 'business', 'stack']);
});

test('configured Polaris is controlled by the existing root lifecycle and participates in exact health', async () => {
  const { calls, operations } = harness();
  const services = ['viewer', 'ingress'].map(name => ({ name, state: 'running', health: 'healthy' }));
  operations.polaris = async args => { calls.push(['polaris', args]); return { enabled: true, healthy: true, services }; };
  const result = await main(['up', '--polaris-config', '/private/polaris.json'], operations);
  assert.equal(result.healthy, true); assert.equal(result.services.length, appServiceCount + 5);
  assert.deepEqual(calls.find(([name, args]) => name === 'polaris' && args[0] === 'up'), ['polaris', ['up', '--config', '/private/polaris.json']]);
  assert.ok(calls.findIndex(([name, args]) => name === 'polaris' && args[0] === 'up') < calls.findIndex(([name]) => name === 'bootstrap'));
  operations.polaris = async () => ({ enabled: true, healthy: true, services: services.slice(0, 1) });
  assert.equal((await main(['status'], operations)).healthy, false);
  operations.polaris = async () => ({ enabled: false, healthy: true, services: [] });
  assert.equal((await main(['status'], operations)).services.length, appServiceCount + 3);
});

test('root shutdown also stops Polaris when another group fails', async () => {
  const { calls, operations } = harness();
  operations.worker = async () => { throw new Error('Worker absent'); };
  operations.polaris = async args => { calls.push(['polaris', args]); };
  await assert.rejects(main(['down'], operations), /Worker absent/);
  assert.deepEqual(calls.map(([name]) => name), ['polaris', 'business', 'stack']);
});


test('data locations publish only after a healthy start and use explicit configuration paths', async () => {
  const { calls, operations } = harness();
  operations.inventory = async args => { calls.push(['inventory', args]); };
  await main(['up', '--config', '/private/storage.json', '--business-config', '/private/business.json', '--polaris-config', '/private/polaris.json'], operations);
  assert.deepEqual(calls.at(-1), ['inventory', ['publish', '--config', '/private/business.json', '--storage-config', '/private/storage.json', '--polaris-config', '/private/polaris.json']]);
  calls.length = 0;
  operations.stack = async args => args[0] === 'status' ? { healthy: false, services: [] } : undefined;
  await assert.rejects(main(['up'], operations), /missing or unhealthy/);
  assert.equal(calls.some(([name]) => name === 'inventory'), false);
});


test('core operation and config are canonical while legacy facade inventories stay valid', async () => {
  const { calls, operations } = harness();
  operations.core = async args => {
    calls.push(['core', args]);
    return args[0] === 'validate' ? { services: ['core', 'reminder'] } : { healthy: true, expectedServices: ['core', 'reminder'], services: ['core', 'reminder'].map(name => ({ name, state: 'running', health: 'healthy' })) };
  };
  const result = await main(['up', '--core-config', '/private/core.json'], operations);
  assert.equal(result.healthy, true);
  assert.ok(result.groups.core);
  assert.equal(result.groups.business, undefined);
  assert.ok(!calls.some(([name]) => name === 'business'));
  assert.deepEqual(calls.find(([name]) => name === 'core'), ['core', ['validate', '--config', '/private/core.json']]);
  operations.core = async () => ({ healthy: true, expectedServices: ['core', 'business', 'reminder'], services: ['core', 'business', 'reminder'].map(name => ({ name })) });
  assert.equal((await main(['status'], operations)).healthy, false);
});
