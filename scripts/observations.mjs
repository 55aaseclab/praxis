#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { ObservationStore } from '../src/observability.mjs';

export function main(args = process.argv.slice(2), { output = console.log } = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { file: { type: 'string' }, window: { type: 'string', default: 'day' }, json: { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) { output('Usage: node scripts/observations.mjs report [--file PATH] [--window day|week] [--json]'); return; }
  if (positionals.length > 1 || positionals.length === 1 && positionals[0] !== 'report') throw new Error('Only the report command is supported.');
  const store = new ObservationStore({ file: values.file || process.env.PRAXIS_OBSERVATIONS_FILE, readOnly: true });
  try {
    const result = store.report(values.window);
    if (values.json) output(JSON.stringify(result));
    else {
      output(`Observation report: ${result.status} (${result.window})`);
      for (const section of ['http', 'protocol', 'business', 'adapters', 'browser']) {
        output(`${section}${section === 'browser' ? ' (untrusted client reports)' : ''}:`);
        for (const group of result[section]) output(`  ${group.route_id} / ${group.app_id} / ${group.capability}: samples=${group.samples} outcomes=${JSON.stringify(group.outcomes)} slow=${group.slow_samples} p50=${group.p50_ms ?? 'n/a'}ms p95=${group.p95_ms ?? 'n/a'}ms`);
      }
      output(`Capability candidates requiring review: ${JSON.stringify(result.capability_candidates)}`);
      output(`Excluded system events: ${result.excluded_system_events}`);
      output('Logs are evidence for review, not automatic product or permission decisions.');
    }
    return result;
  } finally { store.close(); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = main(); if (result?.status === 'unavailable') process.exitCode = 1; }
  catch { console.error('Observation report failed. Use --help for supported options.'); process.exitCode = 1; }
}
