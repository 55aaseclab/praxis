import { createHash } from 'node:crypto';

export const text = (en, zh) => ({ en, zh });
export const models = Object.freeze({
  coordinator: { provider: 'opencode', model: 'hexhive005-main/zai-org/GLM-5.3-Flash', mode: 'build', features: { auto_accept: true } },
  worker: { provider: 'opencode', model: 'hexhive005-work/zai-org/GLM-5.3-Flash', mode: 'build', features: { auto_accept: true } },
  maintenance: { provider: 'codex', model: 'gpt-6.1-sol', thinking: 'ultra', mode: 'full-access' },
});

const actor = (id, group, name, personality) => ({ id, group, name, personality });
const step = (id, actor, goal) => ({ id, actor, goal });
export const campaigns = [
  {
    id: 'family-travel', title: text('A family that keeps travelling', '持续旅行的家庭'),
    apps: ['travel', 'reminder'],
    actors: [
      actor('planner', 'family', text('Planner', '规划者'), text('Plans ahead and watches the budget; learns from past disagreements. A business member, never a platform administrator.', '提前规划、关注预算，从过去的分歧中学习。是业务成员，不是平台管理员。')),
      actor('explorer', 'family', text('Explorer', '探索者'), text('Likes spontaneous discoveries and a flexible itinerary; sometimes accepts the original plan.', '喜欢临时探索和灵活行程，也可能接受原计划。')),
      actor('comfort', 'family', text('Comfort-minded member', '重视舒适的成员'), text('Values rest and privacy, replies at their own pace and keeps personal preparation private.', '重视休息与隐私，按自己的节奏回复，个人准备事项保持私有。')),
    ],
    steps: [
      step('plan', 'planner', text('Propose a shared trip for this destination, respecting accumulated preferences and prior records.', '为本站提出共享旅行方案，尊重已积累的偏好和历史记录。')),
      step('suggest', 'explorer', text('Inspect the proposed trip and persist a useful suggestion, disagreement or explicit acceptance through supported product operations.', '查看旅行方案，通过产品支持的操作留下有用建议、分歧或明确接受。')),
      step('personal-boundary', 'comfort', text('Respond to the plan and arrange personal preparation without exposing private items to the family.', '回应旅行方案，安排个人准备，不向家庭泄露私有事项。')),
      step('resolve', 'planner', text('Resolve recorded feedback, revise the trip and link only actionable shared reminders. Reading is not agreement.', '处理已记录反馈，修订行程，仅关联真正需要行动的共享提醒。阅读不等于同意。')),
      step('review', 'comfort', text('Check the saved trip and reminders after changes; find duplicates, omissions and personal/shared leaks before moving on.', '在变化后检查已保存行程和提醒，找出重复、遗漏或个人/共享泄露，再进入下一站。')),
    ],
    variations: [text('A member has less available time.', '一位成员可用时间减少。'), text('The group budget changes.', '家庭预算发生变化。'), text('A late suggestion conflicts with an accepted arrangement.', '迟到的建议与已接受安排冲突。'), text('An old preference may no longer apply.', '一项历史偏好可能已不适用。')],
  },
  {
    id: 'security-research', title: text('A new paradigm for vulnerability management in the AI era', 'AI 时代的漏洞管理新范式'),
    apps: ['reminder', 'knowledge', 'lattice-slides', 'memo', 'polaris', 'calendar', 'projects', 'intelligence'],
    actors: [
      actor('mentor', 'research', text('Mentor', '导师'), text('Sets research direction, trains the student and questions unsupported conclusions; protects research quality under delivery pressure.', '确定研究方向、培养学生，质疑证据不足的结论，在交付压力下保护科研质量。')),
      actor('student', 'research', text('Student', '学生'), text('Curious and exploratory; follows original sources, can misunderstand them and revises beliefs when challenged.', '好奇、愿意探索，追查原始来源，可能误解资料，受到质疑后能修正判断。')),
      actor('engineer', 'productization', text('Engineer', '工程师'), text('Turns findings into reproducible isolated experiments and deliverables. Can reject immature handoffs; has no Praxis maintenance role.', '将成果转化为可复现的隔离实验和交付物，可以退回不成熟的交接；不承担 Praxis 维护角色。')),
      actor('marketing', 'marketing', text('Marketing', '市场人员'), text('Finds audience needs, explains value and feeds back demand; negotiates scope without promising unsupported capabilities.', '发现受众需求、解释价值并反馈，不承诺证据不支持的能力，通过协商调整范围。')),
      actor('support', 'finance-support', text('Finance and organizational support', '财务与组织支持人员'), text('Checks synthetic budgets, expenses, contract/payment paperwork and archives; asks for missing material and preserves school/company boundaries.', '检查合成预算、费用、合同回款材料与归档，追问缺失材料，保留学校/公司的主体边界。')),
    ],
    steps: [
      step('demand', 'marketing', text('Propose a synthetic audience problem about AI-era vulnerability management; record demand, scope and desired delivery without inventing real customers.', '提出 AI 时代漏洞管理的合成受众问题，记录需求、范围和期望交付，不制造真实客户。')),
      step('scope', 'mentor', text('Define a research question and review criteria, balancing scientific value, student development and the proposed demand.', '定义研究问题和评审标准，协调科研价值、学生培养与需求。')),
      step('sources', 'student', text('Track public developments in Intelligence, curate sources in Knowledge and propose an evidence-linked hypothesis. Preserve publication times and uncertainty.', '通过 Intelligence 跟踪公开变化，在 Knowledge 整理来源并提出关联证据的假设，保留发布时间和不确定性。')),
      step('experiment', 'engineer', text('Review the research handoff and test feasibility in an isolated synthetic lab using a Memo procedure; return counterexamples, limitations and reproducible results.', '审阅研究交接，依据 Memo 流程在隔离合成实验环境验证可行性，反馈反例、限制与可复现结果。')),
      step('review', 'mentor', text('Review findings, resolve or return disagreements and update project status. Use Reminder/Calendar for actual actions and review timing.', '评审成果，处理或退回分歧，更新项目状态，通过 Reminder/Calendar 安排行动与评审时间。')),
      step('delivery', 'marketing', text('Create a Lattice brief faithful to reviewed evidence, record delivery scope and feed new questions back to Research and Productization.', '制作忠于已审证据的 Lattice 简报，记录交付范围，把新问题反馈给研究与工程组。')),
      step('support', 'support', text('Check synthetic resource/expense and delivery paperwork, request missing items and archive accepted material without crossing legal-entity boundaries.', '检查合成资源费用和交付材料，要求补全缺项并归档已接受材料，不跨越法律主体边界。')),
    ],
    variations: [text('A new public source contradicts an earlier hypothesis.', '新的公开来源与先前假设矛盾。'), text('An experiment cannot reproduce the claimed result.', '实验无法复现所称结果。'), text('The desired delivery date moves forward.', '期望交付日期提前。'), text('A handoff lacks required evidence or cost material.', '交接缺少必要证据或费用材料。')],
  },
  {
    id: 'stock-investor', title: text('A full-time simulated investor', '专职模拟投资者'),
    apps: ['reminder', 'memo', 'finance', 'intelligence', 'polaris'],
    initialCapitalCny: 1000000, targetNetReturn: 0.1, requiredInputs: ['market', 'horizon', 'asOf'],
    actors: [actor('investor', 'personal', text('Investor', '投资者'), text('Diligent and evidence-oriented, but prone to confirmation bias about familiar companies. Reconsiders counterevidence and follows explicit risk rules.', '勤奋、重视证据，但容易对熟悉公司产生确认偏误；面对反例重新判断，遵守明确风险规则。'))],
    steps: [
      step('thesis', 'investor', text('Review information available as of the configured time, maintain an investment thesis and risk rules in Memo, and record uncertainty.', '只使用配置时点已公开的信息，在 Memo 维护投资假设和风险规则，记录不确定性。')),
      step('ledger', 'investor', text('Use supported Finance operations for synthetic orders, fills, positions, cash and fees. No real orders or payments. If unsupported, report the capability gap rather than keeping a substitute ledger.', '通过 Finance 支持的操作处理合成订单、成交、持仓、现金及费用，不进行真实交易或支付；能力缺失时报告，不建立替代权威账本。')),
      step('reassess', 'investor', text('Use new intelligence and reminders to reassess positions; preserve losses, costs, drawdown, evidence timestamps and a benchmark. The 10% goal never overrides risk rules or determines product acceptance.', '利用新情报和提醒重新评估持仓，保留亏损、费用、回撤、证据时间与基准；10%目标不覆盖风险规则，也不决定产品验收。')),
    ],
    variations: [text('A new announcement challenges the investment thesis.', '新公告挑战投资假设。'), text('A response is lost and an operation may already have committed.', '响应丢失，操作可能已经提交。'), text('A familiar company has contradictory evidence.', '熟悉的公司出现矛盾证据。'), text('A previously profitable position loses value.', '先前盈利的持仓出现亏损。')],
  },
];

// Onboarding and denials are observable business cases, not inferred from
// preconfigured workspaces or from the controller's own synthetic checks.
for (const campaign of campaigns) {
  const onboarding = campaign.actors.map(a => step(`onboard-${a.id}`, a.id, text(
    'Using your own business identity, connect/reconnect through the normal product OAuth/MCP flow, discover actual permitted tools and inspect your authorized app entry. Report missing consent or capabilities; configured client settings alone are not proof of access.',
    '以自己的业务身份通过正常产品 OAuth/MCP 流程连接或重连，发现实际获准工具并检查授权应用入口。缺少同意或能力时报告；已有客户端配置不等于实际接入成功。')));
  campaign.steps = [...onboarding, ...campaign.steps, step('scope-denial', campaign.actors[0].id, text(
    'With designated opaque negative-control references supplied by the authorized coordinator, verify that another team and another member’s private resources cannot be read or changed. Never search their private client files or use their credentials. Obtain independent denial/no-side-effect evidence; if controls are unavailable, remain blocked rather than claiming isolation.',
    '使用获授权主控提供的指定不透明负向控制引用，验证不能读取或修改其他团队及其他成员私有资源。不得搜索其私有客户端文件或使用其凭据。取得独立的拒绝/无副作用证据；控制资源缺失时保持阻塞，不宣称已隔离。'))];
}

export const destinations = ['Hangzhou', 'Chengdu', 'Beijing', 'Hong Kong', 'Tokyo', 'Kyoto', 'Seoul', 'Singapore', 'Bangkok', 'Hanoi', 'Kathmandu', 'Delhi', 'Sydney', 'Auckland', 'Dubai', 'Istanbul', 'Cairo', 'Cape Town', 'Rome', 'Paris', 'Barcelona', 'London', 'Reykjavik', 'New York', 'Vancouver', 'San Francisco', 'Mexico City', 'Lima', 'Rio de Janeiro', 'Buenos Aires'];
export const actorKey = (campaign, actor) => `${campaign}/${actor}`;
export const actorKeys = campaigns.flatMap(c => c.actors.map(a => actorKey(c.id, a.id)));
export function campaignFor(id) {
  const campaign = campaigns.find(c => c.id === id);
  if (!campaign) throw Error('Unknown campaign.');
  return campaign;
}
export function draw(seed, campaign, round, step) {
  const digest = createHash('sha256').update(JSON.stringify([seed, campaign.id, round, step.id])).digest('hex');
  const index = Number.parseInt(digest.slice(0, 8), 16) % campaign.variations.length;
  return { seed: digest, index, event: campaign.variations[index] };
}
