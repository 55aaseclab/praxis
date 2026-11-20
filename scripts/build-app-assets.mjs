import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { DEFAULT_APP_REGISTRY } from '../src/default-app-registry.mjs';

// Build instructions are reviewed code from the same pinned app source as its integration.
// This runs only in a source build, never for an HTTP request or against business data.
for (const app of DEFAULT_APP_REGISTRY.apps) {
  const steps = app.integration.deployment?.platformBuild;
  if (!steps) continue;
  if (!Array.isArray(steps) || steps.length > 8) throw new Error('Invalid app asset build declaration.');
  const cwd = resolve(DEFAULT_APP_REGISTRY.root, app.source);
  for (const step of steps) {
    if (!step || step.command !== 'npm' || !Array.isArray(step.args) || !step.args.length || step.args.some(arg => typeof arg !== 'string' || /[\0\r\n]/.test(arg))) throw new Error('Invalid app asset build step.');
    await new Promise((complete, reject) => {
      const child = spawn(step.command, step.args, { cwd, stdio: 'inherit', shell: false, env: { ...process.env, NODE_ENV: 'development' } });
      child.once('error', reject); child.once('close', code => code === 0 ? complete() : reject(new Error('App asset build failed.')));
    });
  }
  await rm(resolve(cwd, 'node_modules'), { recursive: true, force: true });
}
