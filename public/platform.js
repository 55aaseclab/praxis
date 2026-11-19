import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
import { drawBarChart } from './platform-charts.js';

const appNames = { reminder: 'Reminder', knowledge: 'Knowledge', 'lattice-slides': 'Slides', travel: 'Travel', tingproof: t("TingProof", "听校"), memo: 'Memo', projects: 'Projects', finance: 'Finance', intelligence: 'Intelligence', polaris: 'Polaris', calendar: 'Calendar', 'matrix-reader': 'Matrix Reader' };
const capabilityNames = { read: t("Read", "读取"), create: t("Create", "新增"), update: t("Update", "修改"), complete: t("Complete", "完成"), delete: t("Delete", "删除"), record: t("Record activity", "记录执行"), stats: t("Statistics", "统计"), assign: t("Assignment", "任务分配"), submit: t("Submit", "提交"), search: t("Search", "搜索"), share: t("Share", "分享"), import: t("Import", "导入"), export: t("Export", "导出"), schedule: t("Schedule", "计划安排"), other: t("Other capability", "其他能力") };
const eventNames = { http_request: t("Page and API requests", "页面与接口请求"), business_action: t("Business operations", "业务操作"), adapter_request: t("App adapter requests", "应用适配请求"), mcp_protocol: t("Tool protocol", "工具协议"), page_load: t("Workbench load", "工作台加载"), registry_load: t("App registry load", "应用目录加载"), app_open: t("App icon click", "应用图标点击"), page_error: t("Client-side error", "客户端页面异常") };
const routeNames = { home: t("Workbench", "工作台"), registry: t("App registry", "应用目录"), prd_catalog: t("Document directory", "需求文档目录"), prd_document: t("Product document", "需求文档"), legacy_redirect: t("Legacy redirect", "旧入口跳转"), static: t("Page asset", "页面资源"), other: t("Other entry", "其他入口"), business_ui: t("App page", "应用界面"), business_static: t("App asset", "应用资源"), business_invoke: t("Business operations", "业务操作"), business_catalog: t("Business capability catalog", "业务能力目录"), business_events: t("Business update", "业务更新"), mcp: t("Agent tools", "智能体工具"), auth: t("Account login and authorization", "账号登录与授权"), oauth: t("External agent authorization", "外部智能体授权"), health: t("Service check", "服务检查"), browser_ingress: t("Experience report", "体验上报"), platform_status: t("Management overview", "管理概览") };
const outcomes = { ok: t("Success", "成功"), invalid: t("Invalid request", "请求无效"), unsupported: t("Unsupported capability", "能力未支持"), unauthenticated: t("Signed out", "未登录"), forbidden: t("Permission denied", "权限拒绝"), conflict: t("Data conflict", "数据冲突"), unavailable: t("Service unavailable", "服务不可用"), outcome_unknown: t("Outcome unknown", "结果未知"), cancelled: t("Canceled", "已取消") };
const reportScopes = { http: t("Pages and APIs", "页面与接口"), protocol: t("Tool protocol", "工具协议"), business: t("Business operations", "业务操作"), adapters: t("App adapters", "应用适配"), browser: t("Workbench experience", "工作台体验") };
const dateFormat = new Intl.DateTimeFormat(language, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const charts = new Map();
let started = false;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const latency = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const quantity = value => count(value) === null ? t("Unconfirmed", "待确认") : String(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : t("No records", "暂无记录");
const duration = value => latency(value) === null ? t("No timing samples", "暂无耗时样本") : t("{0} ms", "{0}毫秒", Math.round(value));
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };

export function freshUntil(section) {
  const observed = Date.parse(section?.observedAt || section?.generatedAt || '');
  if (!Number.isFinite(observed) || observed > Date.now() + 5000) return 0;
  const expiry = Date.parse(section?.freshUntil || '');
  return Math.min(Number.isFinite(expiry) ? expiry : observed + 90000, observed + 90000);
}
function clearNode(node) {
  for (const [container, chart] of charts) if (node === container || node.contains(container)) { chart.destroy(); charts.delete(container); }
  delete node.dataset.freshUntil;
  node.replaceChildren();
}
function table(parent, scope, caption, columns, rows, empty = t("No records", "暂无记录")) {
  const wrapper = element('div', 'overview-table-scroll'); wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', caption);
  const node = element('table', 'overview-table'); node.dataset.scope = scope; node.id = scope === 'state' ? `${parent.id}-table-state` : `platform-table-${scope}`;
  node.append(element('caption', '', caption));
  const head = element('thead'), header = element('tr');
  for (const column of columns) { const th = element('th', '', column); th.scope = 'col'; header.append(th); }
  head.append(header); node.append(head);
  const body = element('tbody');
  for (const row of rows) { const tr = element('tr'); for (const value of row) tr.append(element('td', '', value === null || value === undefined ? t("Unconfirmed", "待确认") : String(value))); body.append(tr); }
  if (!rows.length) { const tr = element('tr'), cell = element('td', 'table-empty', empty); cell.colSpan = columns.length; tr.append(cell); body.append(tr); }
  node.append(body); wrapper.append(node); parent.append(wrapper);
  const chartId = { permissions: 'permission-counts', coverage: 'app-coverage', business: 'business-latency', browser: 'browser-latency' }[scope];
  if (chartId) parent.querySelector(`.overview-chart[data-chart="${chartId}"] canvas`)?.setAttribute('aria-describedby', node.id);
  return node;
}
function chart(parent, id, title, labels, series, unit = t("Count", "数量")) {
  const figure = element('figure', 'overview-figure');
  figure.append(element('figcaption', '', title));
  const scroll = element('div', 'overview-chart-scroll'), plot = element('div', 'overview-chart'); plot.dataset.chart = id;
  plot.style.height = `${Math.max(200, labels.length * 32 + 56)}px`;
  scroll.append(plot); figure.append(scroll); parent.append(figure);
  const handle = drawBarChart(plot, { title, labels, series, unit, horizontal: true });
  charts.set(plot, handle);
  if (!handle.rendered) {
    scroll.hidden = true;
    figure.append(element('div', 'chart-status', series.some(item => item.values.some(value => value !== null)) ? t("Chart unavailable. See the table below.", "图表暂不可用，下表仍可查看。") : t("No data to plot. See the table below.", "暂无可绘制数据，请查看下表。")));
  }
}
function group(node, title, label, tone = 'muted', source) {
  clearNode(node); delete node.dataset.freshUntil;
  if (source && freshUntil(source)) node.dataset.freshUntil = String(freshUntil(source));
  const heading = element('div', 'overview-group-heading'); heading.append(element('h3', '', title), element('span', `overview-state state-${tone}`, label)); node.append(heading);
}
const stale = section => freshUntil(section) <= Date.now();
function unknown(node, title, label = t("Unable to confirm", "暂时无法确认"), source) {
  group(node, title, label);
  table(node, 'state', t("{0} status", "{0}状态", title), [t("Item", "项目"), t("Status", "状态")], [[t("Current state", "当前状态"), label], [t("Last read", "最近读取"), time(source?.observedAt || source?.generatedAt)], [t("Action", "处理方式"), label === t("Status has expired", "状态已过期") ? t("Refresh to see current status.", "请刷新以读取当前状态。") : t("Other sections are available independently.", "其他分组仍可独立查看。")]]);
}
function permissions(node, value) {
  if (value?.state !== 'ready' || value.platformAdmin !== true) return unknown(node, t("Permissions", "权限控制"), t("Unable to confirm", "暂时无法确认"), value);
  if (stale(value)) return unknown(node, t("Permissions", "权限控制"), t("Status has expired", "状态已过期"), value);
  group(node, t("Permissions", "权限控制"), t("Platform administrator", "平台管理员"), 'ok', value);
  const metrics = [[t("Spaces joined", "参与空间"), count(value.spaces)], [t("Active resource grants", "有效资源授权"), count(value.resourcePermissions)], [t("Unexpired delegations", "未到期委托"), count(value.activeGrants)], [t("Revoked delegations", "已撤销委托"), count(value.revokedGrants)]];
  const metricsPair = element('div', 'overview-chart-table'); node.append(metricsPair);
  chart(metricsPair, 'permission-counts', t("Permission metrics for this account", "当前账号的权限指标"), metrics.map(row => row[0]), [{ label: t("Count", "数量"), values: metrics.map(row => row[1]) }]);
  table(metricsPair, 'permissions', t("Permission metrics", "权限指标"), [t("Metric", "指标"), t("Count", "数量"), t("Scope", "范围")], metrics.map(([name, number]) => [name, quantity(number), t("Current account", "当前账号")]));
  const coverage = [[t("Managed apps", "已受管应用"), count(value.managedApps)], [t("Unmanaged apps", "尚未受管应用"), count(value.unmanagedApps)]];
  const coveragePair = element('div', 'overview-chart-table'); node.append(coveragePair);
  chart(coveragePair, 'app-coverage', t("Business permission coverage", "业务权限接入覆盖"), coverage.map(row => row[0]), [{ label: t("App count", "应用数"), values: coverage.map(row => row[1]) }]);
  table(coveragePair, 'coverage', t("Business permission coverage", "业务权限覆盖"), [t("Metric", "指标"), t("App count", "应用数")], coverage.map(([name, number]) => [name, quantity(number)]));
  table(node, 'permission-scope', t("Permission definitions", "权限范围与口径"), [t("Item", "项目"), t("Details", "说明")], [
    [t("Viewing identity", "查看身份"), t("Platform administrator", "平台管理员")], [t("Resource grants", "资源授权"), t("Counts currently effective explicit grants for this account.", "仅统计当前账号当前有效的显式授权。")], [t("Unexpired delegations", "未到期委托"), t("Unrevoked and unexpired. Each operation is subject to current permissions.", "未撤销且未到期；每次业务操作仍核对当前权限。")], [t("App entries", "应用入口"), t("Account entry permissions control navigation. Resource authorization is checked separately.", "按账号入口范围控制，不等于业务资源授权。")], [t("Coverage", "覆盖范围"), t("Managed and unmanaged apps share the same denominator.", "已受管与尚未受管应用使用同一应用分母。")], [t("Read time", "读取时间"), time(value.observedAt)], [t("Unknown values", "未知值"), t("Unknown counts are excluded from charts. Zero means a confirmed zero.", "未知数量不绘入图表；0表示已确认的零值。")],
  ]);
}
function connections(node, value) {
  if (!['ready', 'mixed'].includes(value?.state) || !Array.isArray(value.apps)) return unknown(node, t("Connections", "连接情况"), t("Unable to confirm", "暂时无法确认"), value);
  if (stale(value)) return unknown(node, t("Connections", "连接情况"), t("Status has expired", "状态已过期"), value);
  const apps = value.apps.filter(app => Object.hasOwn(appNames, app?.id));
  const checked = app => freshUntil({ observedAt: app.service?.checkedAt }) > Date.now();
  const reachable = app => checked(app) && ['reachable', 'restricted'].includes(app.service?.state);
  const available = apps.filter(reachable).length;
  group(node, t("Connections", "连接情况"), apps.length && available === apps.length ? t("Local services responding", "本机服务有响应") : t("Some connections unconfirmed", "部分连接待确认"), apps.length && available === apps.length ? 'ok' : 'attention', value);
  const knownCount = (known, matching) => apps.length && apps.every(known) ? String(apps.filter(matching).length) : t("Unconfirmed", "待确认");
  table(node, 'connection-summary', t("Connection overview", "连接概况"), [t("Metric", "指标"), t("Confirmed count", "已确认数量"), t("Apps checked", "检查应用数")], [
    [t("Local services responding", "本机服务有响应"), knownCount(app => checked(app) && ['reachable', 'restricted', 'unavailable'].includes(app.service?.state), reachable), apps.length || t("Unconfirmed", "待确认")],
    [t("Business API connected", "业务接口已接入"), knownCount(app => ['configured', 'not_configured'].includes(app.business?.state), app => app.business.state === 'configured'), apps.length || t("Unconfirmed", "待确认")],
    [t("Recent successful agent calls", "近期 Agent 成功调用"), knownCount(app => ['observed', 'not_observed'].includes(app.mcp?.activity), app => app.mcp.activity === 'observed'), apps.length || t("Unconfirmed", "待确认")],
  ]);
  table(node, 'connections', t("App connections", "应用连接"), [t("App", "应用"), t("Service state", "服务状态"), t("Check time", "检查时间"), t("Business API", "业务接口"), t("API mode", "接口模式"), t("Agent tools", "Agent 工具"), t("Actual calls", "实际调用"), t("Last successful call", "最近成功调用")], apps.map(app => [
    appNames[app.id], !checked(app) ? app.service?.checkedAt ? t("Service check expired", "服务检查已过期") : t("Unconfirmed", "待确认") : ({ reachable: t("Reachable", "服务可达"), restricted: t("Responding with access restrictions", "服务有响应，访问受限"), unavailable: t("Unreachable", "服务不可达"), unknown: t("Unconfirmed", "待确认") })[app.service?.state] || t("Unconfirmed", "待确认"),
    time(app.service?.checkedAt), ({ configured: t("Connected", "已接入"), not_configured: t("Not connected", "未接入") })[app.business?.state] || t("Unconfirmed", "待确认"), ({ managed: t("Managed", "受管"), standalone: t("Independent", "独立") })[app.business?.mode] || t("Unconfirmed", "待确认"),
    ({ configured: t("Configured", "已配置"), not_configured: t("Not connected", "未接入") })[app.mcp?.state] || t("Unconfirmed", "待确认"), ({ observed: t("Recent success", "近期有成功记录"), not_observed: t("No recent success", "近期暂无成功记录"), unknown: t("Call state unconfirmed", "调用情况待确认") })[app.mcp?.activity] || t("Call state unconfirmed", "调用情况待确认"), time(app.mcp?.lastObservedAt),
  ]), t("No app check results", "暂无应用检查结果"));
  table(node, 'connection-scope', t("Connection definitions", "连接口径"), [t("Item", "项目"), t("Details", "说明")], [[t("Service check", "服务检查"), t("Service responsiveness alone does not verify the full workflow.", "服务有响应不等于完整业务流程通过。")], [t("Business API", "业务接口"), t("API configuration and reachability are verified separately.", "接口配置与服务可达分别确认。")], [t("Agent tools", "Agent 工具"), t("Configuration alone does not establish tool usage.", "工具已配置不代表发生过真实调用。")], [t("Read time", "读取时间"), time(value.observedAt)]]);
}
function targetName(target, index = 0) { return target.provider === 'jianguoyun' ? t("Nutstore", "坚果云") : target.kind === 'local' ? t("Local replica {0}", "本地副本{0}", index || '') : t("Other cloud replica", "其他云副本"); }
const targetState = target => ({ synced: t("Last sync complete", "上次同步已完成"), pending: t("Awaiting sync", "等待同步"), failed: t("Sync failed; retry pending", "同步失败，等待重试"), unknown: t("State unconfirmed", "当前状态待确认") })[target.state] || t("State unconfirmed", "当前状态待确认");
const recordedState = value => ({ success: t("Success", "成功"), pending: t("In progress", "处理中"), failed: t("Failed", "失败"), unconfigured: t("Unconfigured at that time", "当时未配置"), unknown: t("Unconfirmed", "待确认") })[value] || t("Unconfirmed", "待确认");
function storage(node, value) {
  if (!value || value.state === 'unknown' || !value.local || !Array.isArray(value.targets)) return unknown(node, t("Business storage", "业务数据存储"), t("Unable to confirm", "暂时无法确认"), value);
  if (value.state === 'stale' || stale(value)) return unknown(node, t("Business storage", "业务数据存储"), t("Status has expired", "状态已过期"), value);
  const queue = value.queue?.state, processing = ['processing', 'pending'].includes(queue);
  const attention = queue === 'retry' || value.targets.some(target => target.state === 'failed') || ['stale', 'stopped'].includes(value.worker?.state) || value.worker?.configCurrent === false;
  const label = processing ? t("Backup in progress", "备份处理中") : attention ? t("Replica needs attention", "副本需要关注") : value.targets.length && value.targets.every(target => target.state === 'synced') && value.local.state === 'available' ? t("Last sync complete", "上次同步已完成") : t("Some statuses unconfirmed", "部分状态待确认");
  group(node, t("Business storage", "业务数据存储"), label, attention ? 'attention' : 'muted', value);
  const worker = value.worker || {}, working = value.working?.configuredSources || {};
  table(node, 'storage', t("Working data and sync", "工作数据与同步"), [t("Item", "项目"), t("Status or count", "状态或数量"), t("Latest time", "最近时间")], [
    [t("Working data", "工作数据"), value.working?.mode === 'local' ? t("Stored locally", "保存在本机") : t("Location unconfirmed", "位置待确认"), '—'], [t("Device role", "当前设备职责"), ({ active: t("Backup publisher", "负责发布备份"), standby: t("Standby device", "备用设备，不发布新备份") })[value.writer] || t("Unconfirmed", "待确认"), '—'],
    [t("Local backup", "本地备份"), ({ available: t("Recent snapshot available", "最近快照可用"), none: t("No successful snapshot yet", "尚无成功快照"), unknown: t("Unconfirmed", "待确认") })[value.local.state] || t("Unconfirmed", "待确认"), time(value.local.lastSuccessAt)], [t("Local snapshot verification", "本地快照核验"), t("Last verification", "最近核验时间"), time(value.local.lastVerifiedAt)],
    [t("Structured file sources", "结构化文件来源"), quantity(working.json), '—'], [t("Database sources", "数据库来源"), quantity(working.sqlite), '—'], [t("Directory sources", "文件目录来源"), quantity(working.directory), '—'],
    [t("Backup queue", "备份队列"), ({ processing: t("In progress", "处理中"), pending: t("Pending", "等待处理"), retry: t("Retry pending", "等待重试"), synced: t("Last run complete", "上次处理完成"), idle: t("Idle", "空闲"), unknown: t("Unconfirmed", "待确认") })[queue] || t("Unconfirmed", "待确认"), '—'],
    [t("Background sync service", "后台同步服务"), ({ fresh: t("Available", "可用"), stale: t("Status has expired", "状态已过期"), stopped: t("Stopped", "未运行"), unknown: t("Unconfirmed", "待确认") })[worker.state] || t("Unconfirmed", "待确认"), time(worker.heartbeatAt)],
    [t("Latest background result", "后台最近结果"), ({ starting: t("Starting", "正在启动"), idle: t("Idle", "空闲"), success: t("Success", "成功"), partial: t("Partially complete", "部分完成"), error: t("Failed", "失败"), unknown: t("Unconfirmed", "待确认") })[worker.lastResult] || t("Unconfirmed", "待确认"), time(worker.lastResultAt)],
    [t("Sync configuration", "同步配置"), worker.configCurrent === true ? t("Current configuration active", "当前配置已生效") : worker.configCurrent === false ? t("Configuration needs updating", "配置需要更新") : t("Unconfirmed", "待确认"), '—'], [t("Status read", "状态读取"), '—', time(value.generatedAt)],
  ]);
  table(node, 'replicas', t("Backup replicas", "备份副本"), [t("Replica", "副本"), t("Current state", "当前状态"), t("Last success", "上次成功"), t("Last verification", "上次核验"), t("Latest local snapshot", "最近本地快照")], value.targets.map((target, index) => [targetName(target, index + 1), targetState(target), time(target.lastSuccessAt), time(target.lastVerifiedAt), target.matchesLocalSnapshot === true ? t("Matches", "一致") : target.matchesLocalSnapshot === false ? t("Differs", "不一致") : t("Unconfirmed", "待确认")]), t("No backup replicas registered", "尚未登记备份副本"));
  table(node, 'replica-checks', t("Replica checks", "副本检查记录"), [t("Replica", "副本"), t("Last check", "最近检查"), t("Check result", "检查结果"), t("Historical result", "历史结果"), t("History timestamp", "历史记录时间"), t("Registration", "登记状态")], value.targets.map((target, index) => [targetName(target, index + 1), time(target.lastCheckAt), recordedState(target.lastCheckState), recordedState(target.lastRecordedState), time(target.recordedAt), target.configured === true ? t("Registered", "已登记") : t("Unconfirmed", "待确认")]), t("No replica checks", "暂无副本检查记录"));
  table(node, 'storage-scope', t("Coverage and limits", "覆盖与限制"), [t("Scope", "范围"), t("Status and details", "状态与说明")], [
    [t("Verified coverage", "成功覆盖"), t("Pending verification. Source registration alone does not verify backup coverage.", "待核验；已登记来源不代表已成功备份全部业务数据。")], [t("Browser records", "浏览器记录"), value.coverage?.browserData === 'requires-export' ? t("Export and verify separately.", "需要导出并单独核验。") : t("Pending verification.", "待核验。")], [t("Original audio", "原音频"), t("Save and verify separately.", "需单独核验与保存。")], [t("Recovery material", "恢复材料"), t("Save and verify separately.", "需单独核验与保存。")], [t("Replica consistency", "副本一致性"), t("Compared with the latest local snapshot. Newer working data may still be pending.", "仅对比最近本地快照，不表示最新工作数据已全部上云。")], [t("Timestamp definitions", "时间含义"), t("Status reads, successful backups and remote verification have separate timestamps.", "状态读取、备份成功与远端核验是不同时间。")],
  ]);
}
function observationIdentity(row) { return [eventNames[row.event_name] || t("Other event", "其他事件"), routeNames[row.route_id] || t("Other entry", "其他入口"), appNames[row.app_id] || t("Other app", "其他应用"), capabilityNames[row.capability] || t("Other capability", "其他能力")]; }
function outcomeValue(row, key) {
  const values = row.outcomes;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return t("Unconfirmed", "待确认");
  if (Object.hasOwn(values, key)) return quantity(values[key]);
  const total = Object.values(values).reduce((sum, value) => count(value) === null ? NaN : sum + value, 0);
  return count(row.samples) !== null && total === row.samples ? '0' : t("Unconfirmed", "待确认");
}
function renderObservations(node, report) {
  clearNode(node);
  if (!['ready', 'empty'].includes(report?.status)) {
    table(node, 'report-state', t("Usage and experience", "使用与体验状态"), [t("Item", "项目"), t("Status", "状态")], [[t("Observations", "观测记录"), report?.status === 'disabled' ? t("Usage observations disabled", "尚未启用使用观测") : t("Could not load experience data", "暂时无法读取体验线索")]]); return;
  }
  const expiry = freshUntil({ generatedAt: report.generated_at });
  if (expiry <= Date.now()) {
    table(node, 'report-state', t("Usage and experience", "使用与体验状态"), [t("Item", "项目"), t("Status", "状态")], [[t("Observations", "观测记录"), expiry ? t("Status expired. Refresh to continue.", "状态已过期，请刷新后查看。") : t("Generation time unknown. Refresh to continue.", "生成时间待确认，请刷新后查看。")], [t("Last generated", "最近生成"), time(report.generated_at)]]); return;
  }
  node.dataset.freshUntil = String(expiry);
  table(node, 'methodology', t("Metrics and definitions", "统计范围与口径"), [t("Item", "项目"), t("Value or description", "值或说明")], [
    [t("Record status", "记录状态"), report.status === 'empty' ? t("No observations in this scope", "此范围暂无观测记录") : t("Observations available", "已有观测记录")], [t("Scope", "查看范围"), report.window === 'week' ? t("Last seven days", "近七天") : report.window === 'day' ? t("Last day", "近一天") : t("Unconfirmed", "待确认")], [t("Generated at", "生成时间"), time(report.generated_at)],
    [t("Maximum retention", "记录保留上限"), count(report.retention_days) === null ? t("Unconfirmed", "待确认") : t("{0} days", "{0}天", report.retention_days)], [t("Record limit", "记录条数上限"), quantity(report.max_rows)], [t("System checks excluded", "已排除系统检查"), quantity(report.excluded_system_events)],
    [t("Truncation", "结果截断"), report.truncated === true ? t("Truncated to 30 items per group.", "已截断，每组最多返回30项。") : report.truncated === false ? t("Complete", "未截断") : t("Unconfirmed", "待确认")],
    [t("Client samples", "客户端样本"), t("Client reports are unverified. An app click records the launch attempt.", "客户端上报未经验证；应用图标点击只表示发起打开。")], [t("Capability signals", "能力线索"), t("Review manually before changing requirements or permissions. Denial may reflect access policy.", "需人工复核，不自动变更需求或权限；权限拒绝不等于功能缺失。")], [t("Percentiles", "分位数"), t("For each group, p50 and p95 are upper bounds for 50% and 95% of timing samples. Percentiles are not averaged across groups.", "50%的耗时样本不高于p50，95%不高于p95；按每组计算，不平均分位数，也不推断趋势。")], [t("Missing timings", "空耗时"), t("Missing samples are distinct from a measured zero.", "暂无耗时样本不等于0毫秒；已知0毫秒如实显示。")],
  ]);
  for (const [scope, title] of Object.entries(reportScopes)) {
    const rows = Array.isArray(report[scope]) ? report[scope] : [];
    const section = element('section', 'observation-section'); section.append(element('h4', '', title)); node.append(section);
    if (['business', 'browser'].includes(scope)) chart(section, `${scope}-latency`, t("{0} latency percentiles (ms)", "{0}耗时分位数（毫秒）", title), rows.map(row => `${appNames[row.app_id] || t("Other app", "其他应用")} / ${scope === 'browser' ? eventNames[row.event_name] || t("Other event", "其他事件") : capabilityNames[row.capability] || t("Other capability", "其他能力")}`), [{ label: 'p50', values: rows.map(row => latency(row.p50_ms)) }, { label: 'p95', values: rows.map(row => latency(row.p95_ms)) }], t("ms", "毫秒"));
    table(section, scope, t("{0} samples and timings", "{0}样本与耗时", title), [t("Event", "事件"), t("Entry", "入口"), t("App", "应用"), t("Capability", "能力"), t("Samples", "样本数"), t("Slow samples", "偏慢数"), t("Unsuccessful", "未成功数"), 'p50', 'p95', t("Source quality", "来源质量")], rows.map(row => [...observationIdentity(row), quantity(row.samples), quantity(row.slow_samples), quantity(row.failure_samples), duration(row.p50_ms), duration(row.p95_ms), scope === 'browser' ? t("Unverified client report", "客户端上报，未经验证") : t("Server observation", "服务端观测")]), t("No samples of this type", "暂无此类样本"));
    table(section, `${scope}-outcomes`, t("{0} outcomes", "{0}结果分布", title), [t("Event", "事件"), t("Entry", "入口"), t("App", "应用"), t("Capability", "能力"), ...Object.values(outcomes)], rows.map(row => [...observationIdentity(row), ...Object.keys(outcomes).map(key => outcomeValue(row, key))]), t("No outcome data", "暂无结果分布"));
  }
  const candidates = Array.isArray(report.capability_candidates) ? report.capability_candidates : [];
  table(node, 'capabilities', t("Capability signals to review", "待复核的能力线索"), [t("App", "应用"), t("Capability", "能力"), t("Signal count", "线索数"), t("Review status", "复核状态")], candidates.map(row => [appNames[row.app_id] || t("Other app", "其他应用"), capabilityNames[row.capability] || t("Other capability", "其他能力"), quantity(row.samples), row.requires_review === true ? t("Needs human review", "需要人工复核") : t("Unconfirmed", "待确认")]), t("No clear unsupported capability signals", "暂无明确的未支持能力线索"));
}

function loginUrl(value) {
  try {
    const url = new URL(value);
    const query = [...url.searchParams];
    if (url.username || url.password || url.hash || query.some(([key, value]) => key !== 'return_to' || value !== '/') || query.length > 1 || url.pathname !== '/auth/login' || !['https:', 'http:'].includes(url.protocol) || url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function startPlatformOverview({ getIdentity = () => null, onSessionRejected = () => {} } = {}) {
  const root = document.querySelector('.platform-overview');
  if (!root || started) return;
  started = true;
  const panels = document.querySelector('#platform-panels'), notice = document.querySelector('#platform-notice'), updated = document.querySelector('#platform-updated'), refreshButton = document.querySelector('#platform-refresh');
  const experience = document.querySelector('#platform-experience'), observationNode = document.querySelector('#platform-observations'), windowSelect = document.querySelector('#platform-window');
  const groups = { permissions: document.querySelector('#platform-permissions'), connections: document.querySelector('#platform-connections'), storage: document.querySelector('#platform-storage') };
  let epoch = 0, observationEpoch = 0, controller, observationController, reading = false, sessionEnded = false, accessAllowed = false;
  function clear() {
    observationEpoch++;
    for (const node of Object.values(groups)) { clearNode(node); delete node.dataset.freshUntil; }
    observationController?.abort(); panels.hidden = true; experience.hidden = true; clearNode(observationNode); experience.open = false; updated.textContent = '';
  }
  function message(text, url) {
    notice.replaceChildren(element('span', '', text)); notice.hidden = false;
    const href = loginUrl(url); if (href) { const link = element('a', '', t("Sign in", "登录")); link.href = href; notice.append(link); }
  }
  function restricted(status, body) {
    epoch++; observationEpoch++; controller?.abort(); reading = false; refreshButton.disabled = false; root.setAttribute('aria-busy', 'false'); clear();
    message(status === 401 ? t("Sign in to view permissions, connections and storage.", "登录后查看权限、连接与数据存储状态。") : t("Your account does not have access.", "当前账号没有查看权限。"), status === 401 ? body?.loginUrl : null);
    onSessionRejected(status);
  }
  async function request(path, active) {
    const timeout = globalThis.AbortSignal?.timeout?.(5000);
    const signal = timeout && globalThis.AbortSignal?.any ? globalThis.AbortSignal.any([active.signal, timeout]) : active.signal;
    return fetch(path, { cache: 'no-store', credentials: 'same-origin', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer', signal, headers: { Accept: 'application/json' } });
  }
  async function observations(currentEpoch) {
    const currentObservation = ++observationEpoch, selected = ['day', 'week'].includes(windowSelect.value) ? windowSelect.value : 'day';
    observationController?.abort(); observationController = new AbortController();
    clearNode(observationNode); observationNode.append(element('div', 'overview-status', t("Loading experience data…", "正在读取体验线索…")));
    try {
      const response = await request(`/api/platform/observations?window=${selected}`, observationController);
      let body; try { body = await response.json(); } catch {}
      if (epoch !== currentEpoch || observationEpoch !== currentObservation) return;
      if ([401, 403].includes(response.status)) return restricted(response.status, body);
      if (!response.ok) throw new Error('Observation summary unavailable.');
      renderObservations(observationNode, body);
    } catch { if (epoch === currentEpoch && observationEpoch === currentObservation) renderObservations(observationNode, null); }
  }
  async function refresh() {
    if (!accessAllowed || sessionEnded || document.visibilityState === 'hidden') return;
    const identity = getIdentity();
    if (identity?.platformAdmin !== true || identity.expiresAt <= Date.now()) { deactivate(); return; }
    const currentEpoch = ++epoch;
    controller?.abort(); controller = new AbortController(); reading = true; refreshButton.disabled = true; root.setAttribute('aria-busy', 'true');
    try {
      const response = await request('/api/platform/status', controller);
      let body; try { body = await response.json(); } catch {}
      if (epoch !== currentEpoch) return;
      if ([401, 403].includes(response.status)) return restricted(response.status, body);
      if (!response.ok || body?.schemaVersion !== 1 || !body.sections) throw new Error('Platform status unavailable.');
      panels.hidden = false;
      permissions(groups.permissions, body.sections.permissions); connections(groups.connections, body.sections.connections); storage(groups.storage, body.sections.storage);
      notice.hidden = true; experience.hidden = false; updated.textContent = t("Read at {0}", "读取于 {0}", time(body.generatedAt));
      if (experience.open) void observations(currentEpoch);
    } catch { if (epoch === currentEpoch) { clear(); message(t("Could not read status. Refresh to retry.", "暂时无法读取状态，请稍后刷新。")); } }
    finally { if (epoch === currentEpoch) { reading = false; refreshButton.disabled = false; root.setAttribute('aria-busy', 'false'); } }
  }
  function deactivate() {
    epoch++; observationEpoch++; controller?.abort(); reading = false; accessAllowed = false; clear();
    root.hidden = true; refreshButton.disabled = true; root.setAttribute('aria-busy', 'false');
  }
  function updateAccess() {
    deactivate();
    const identity = getIdentity();
    accessAllowed = identity?.platformAdmin === true && identity.expiresAt > Date.now();
    root.hidden = !accessAllowed; refreshButton.disabled = !accessAllowed;
    if (accessAllowed) { sessionEnded = false; message(t("Loading status…", "正在读取状态…")); void refresh(); }
  }
  refreshButton.addEventListener('click', refresh);
  experience.addEventListener('toggle', () => { if (experience.open && !panels.hidden) void observations(epoch); else { observationEpoch++; observationController?.abort(); clearNode(observationNode); } });
  windowSelect.addEventListener('change', () => { if (experience.open && !panels.hidden) void observations(epoch); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { epoch++; observationEpoch++; controller?.abort(); clear(); message(t("Loading status…", "正在读取状态…")); }
    else void refresh();
  });
  globalThis.addEventListener('pageshow', event => { if (event.persisted) { clear(); void refresh(); } });
  setInterval(() => { if (!reading && document.visibilityState !== 'hidden') void refresh(); }, 30000);
  setInterval(() => {
    if (panels.hidden) return;
    for (const [key, node] of Object.entries(groups)) if (node.dataset.freshUntil && Number(node.dataset.freshUntil) <= Date.now()) unknown(node, { permissions: t("Permissions", "权限控制"), connections: t("Connections", "连接情况"), storage: t("Business storage", "业务数据存储") }[key], t("Status has expired", "状态已过期"));
    if (observationNode.dataset.freshUntil && Number(observationNode.dataset.freshUntil) <= Date.now()) {
      observationEpoch++; observationController?.abort(); clearNode(observationNode);
      table(observationNode, 'report-state', t("Usage and experience", "使用与体验状态"), [t("Item", "项目"), t("Status", "状态")], [[t("Observations", "观测记录"), t("Status expired. Refresh to continue.", "状态已过期，请刷新后查看。")]]);
    }
  }, 1000);
  return { updateAccess, clear: deactivate, refresh };
}
