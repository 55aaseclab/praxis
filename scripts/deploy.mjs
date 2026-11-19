import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DeploymentController } from '../src/deployment/controller.mjs';

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { image: { type: 'string' }, 'state-dir': { type: 'string' } } });
  const command = positionals[0] || 'status';
  if (positionals.length > 1 || !['init','deploy','rebind','rollback','status','up','down'].includes(command) || values.image && !['init','deploy','rebind'].includes(command)) throw new Error('Usage: deploy.mjs init|deploy|rebind|rollback|status|up|down [--image IMAGE] [--state-dir PATH]');
  const controller = dependencies.controller || new DeploymentController({ root: values['state-dir'] });
  const result = await controller[command]({ image: values.image });
  if (dependencies.print !== false) (dependencies.print || console.log)(JSON.stringify(result));
  return result;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(`Deployment failed: ${error.code || 'DEPLOYMENT_FAILED'}`); process.exitCode = 1; });
