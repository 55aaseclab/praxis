#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { actorKeys, campaigns, models } from './campaigns.mjs';
import { Controller, metrics, privatePath } from './controller.mjs';
import { Paseo } from './adapters/paseo.mjs';
import { collect, dispatch, reconcile } from './runner.mjs';

const labels = {
  en: { paused: 'Paused', active: 'Active', coverage: 'Behavior coverage', acceptance: 'Acceptance rate', autonomous: 'Autonomous completion', recovery: 'Repair recovery', approval: 'Waiting for human approval', load: 'Multi-user load: pending', empty: 'No eligible task', unresolved: 'Unresolved dispatches' },
  zh: { paused: '已暂停', active: '运行中', coverage: '行为覆盖率', acceptance: '验收通过率', autonomous: '自主完成率', recovery: '修复恢复率', approval: '等待人工确认', load: '多用户负载：待定', empty: '暂无可执行任务', unresolved: '未完成派发' },
};
const help = {
  en: `AI-native testing (opt-in; ordinary npm test never starts agents)
node tests/ai-native/cli.mjs COMMAND --state /private/campaign.sqlite [options]

catalog | config-example | help [--lang en|zh]
init --input CONFIG.json [--lang en|zh] [--seed TEXT]
round --campaign ID [--destination TEXT]
advance-investment --as-of ISO
status | report [--lang en|zh] | next | pause | resume
configure-runtime
dispatch --task ID | coordinator
collect --dispatch ID | reconcile --dispatch ID
resolve --input PASEO-RESOLUTION.json
verify --task ID --input EVIDENCE.json
repair --tasks ID,ID --input TECHNICAL.json
approval-request --request ID [--out REVIEW.json]
approve --request ID --input PASEO-REPLY.json
maintenance --request ID
release --request ID --input RELEASE.json
retry --task ID --reason TEXT | exclude --task ID --reason TEXT
reject --request ID --reason TEXT

Ask the human through the normal question tool in Paseo, or its conversation.
Wait for an explicit reply; then record its reference with approve. No keys required.
See README.md for schemas, credentials, workspaces and ambiguous outcomes.`,
  zh: `AI-native 测试（显式启动；普通 npm test 不启动 agent）
node tests/ai-native/cli.mjs 命令 --state /私有目录/campaign.sqlite [选项]

catalog | config-example | help [--lang en|zh]
init --input 配置.json [--lang en|zh] [--seed 文本]
round --campaign 场景ID [--destination 目的地]
advance-investment --as-of ISO
status | report [--lang en|zh] | next | pause | resume
configure-runtime
dispatch --task ID | coordinator
collect --dispatch ID | reconcile --dispatch ID
resolve --input Paseo人工核对结果.json
verify --task ID --input 验收证据.json
repair --tasks ID,ID --input 合成技术问题包.json
approval-request --request ID [--out 待审阅.json]
approve --request ID --input Paseo人工回复.json
maintenance --request ID
release --request ID --input 发布证据.json
retry --task ID --reason 原因 | exclude --task ID --reason 原因
reject --request ID --reason 原因

通过正常提问工具或 Paseo 会话向人工提问，等待明确回复，
再用 approve 记录其引用；不需要密钥。未回复或含糊回复不算批准。
格式、凭据、工作区及不明派发处理见 README.zh-CN.md。`,
};
const readJson = file => JSON.parse(readFileSync(privatePath(file), 'utf8'));
const writePrivate = (file, object) => writeFileSync(privatePath(file), `${JSON.stringify(object, null, 2)}\n`, { mode: 0o600, flag: 'wx' });

export async function main(argv = process.argv.slice(2)) {
  const { positionals, values: v } = parseArgs({ args: argv, allowPositionals: true, options: Object.fromEntries(['state', 'input', 'lang', 'seed', 'campaign', 'destination', 'task', 'tasks', 'dispatch', 'request', 'out', 'reason', 'as-of'].map(k => [k, { type: 'string' }])) });
  const [command = 'help'] = positionals;
  if (positionals.length > 1 || v.lang && !['en', 'zh'].includes(v.lang)) throw Error('Invalid arguments; use help --lang en or zh.');
  const lang = v.lang || 'en';
  if (command === 'help') return help[lang];
  if (command === 'catalog') return { models, campaigns };
  if (command === 'config-example') return {
    fullAccess: true,
    communication: 'paseo-send-message',
    origin: 'https://your-public-praxis.example',
    coordinator: { workspaceId: '<coordinator workspace>', cwd: '/private/coordinator' },
    maintenance: { workspaceId: '<maintenance source workspace>', cwd: '/source/praxis' },
    actors: Object.fromEntries(actorKeys.map((key, i) => [key, { workspaceId: `<actor workspace ${i + 1}>`, cwd: `/private/actors/actor-${i + 1}` }])),
    investment: { market: '<choose explicitly>', horizon: '<choose explicitly>', asOf: '<ISO timestamp>' },
  };
  if (!v.state) throw Error('Specify --state with a private absolute path outside Git.');
  const c = new Controller(v.state);
  try {
    if (command === 'init') { const s = c.init(readJson(v.input), { locale: lang, ...(v.seed ? { seed: v.seed } : {}) }); return { runId: s.runId, paused: s.paused }; }
    switch (command) {
      case 'status': return c.read();
      case 'configure-runtime': return c.configureRuntime();
      case 'round': return c.round(v.campaign, { destination: v.destination });
      case 'advance-investment': c.advanceInvestment(v['as-of']); return { asOf: v['as-of'] };
      case 'next': return c.next() || labels[v.lang || c.read().locale].empty;
      case 'pause': c.pause(true); return { paused: true };
      case 'resume': c.pause(false); return { paused: false };
      case 'dispatch': return await dispatch(c, new Paseo(), 'worker', v.task);
      case 'coordinator': return await dispatch(c, new Paseo(), 'coordinator');
      case 'collect': return await collect(c, new Paseo(), v.dispatch);
      case 'reconcile': return await reconcile(c, new Paseo(), v.dispatch);
      case 'resolve': return c.resolveDispatch(readJson(privatePath(v.input)));
      case 'verify': return c.verify(v.task, readJson(v.input));
      case 'repair': return c.repair((v.tasks || '').split(','), readJson(v.input));
      case 'approval-request': {
        const review = c.approvalRequest(v.request);
        if (v.out) writePrivate(v.out, review);
        return review;
      }
      case 'approve': return c.confirmApproval(v.request, readJson(v.input));
      case 'maintenance': return await dispatch(c, new Paseo(), 'maintenance', v.request);
      case 'release': c.release(v.request, readJson(v.input)); return { requestId: v.request, status: 'ready' };
      case 'retry': c.retry(v.task, v.reason); return { taskId: v.task, status: 'queued' };
      case 'exclude': c.exclude(v.task, v.reason); return { taskId: v.task, status: 'not_applicable' };
      case 'reject': c.reject(v.request, v.reason); return { requestId: v.request, status: 'rejected' };
      case 'report': {
        const s = c.read(), m = metrics(s), l = labels[v.lang || s.locale];
        const percentage = value => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
        return [`${s.runId} · ${s.paused ? l.paused : l.active}`, `${l.coverage}: ${m.attempted}/${m.applicable} (${percentage(m.coverage)})`, `${l.acceptance}: ${percentage(m.acceptance)}`, `${l.autonomous}: ${percentage(m.autonomousCompletion)}`, `${l.recovery}: ${percentage(m.repairRecovery)}`, `${l.approval}: ${Object.values(s.repairs).filter(r => r.status === 'pending_approval').length}`, `${l.unresolved}: ${Object.values(s.dispatches).filter(d => ['reserved', 'running', 'uncertain'].includes(d.status)).length}`, l.load, JSON.stringify(m, null, 2)].join('\n');
      }
      default: throw Error('Unknown command; use help.');
    }
  } finally { c.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { const result = await main(); console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
