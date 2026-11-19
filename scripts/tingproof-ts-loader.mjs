import { access, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'node:path';
const configuredRoot = process.env.PRAXIS_TINGPROOF_ROOT;
const appUrl = configuredRoot ? pathToFileURL(resolvePath(configuredRoot) + '/') : new URL('../third_party/tingproof/', import.meta.url);
const require = createRequire(new URL('package.json', appUrl));
const ts = require('typescript');

// The host Node build has SQLite but no native TypeScript transform.
// Use the application's existing compiler for its server modules only.
const appRoot = appUrl.href;
export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !context.parentURL?.startsWith(appRoot) || !specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
    const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL);
    if (!url.href.startsWith(appRoot)) throw error;
    try { await access(fileURLToPath(url)); } catch { throw error; }
    return { url: url.href, shortCircuit: true };
  }
}
export async function load(url, context, nextLoad) {
  if (!url.startsWith(appRoot) || !url.endsWith('.ts')) return nextLoad(url, context);
  const result = ts.transpileModule(await readFile(fileURLToPath(url), 'utf8'), {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: true },
  });
  return { format: 'module', source: result.outputText, shortCircuit: true };
}
