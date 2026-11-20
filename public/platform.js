import { appFact, appNames, loadAppFacts } from './app-registry.js';
import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
import { drawBarChart } from './platform-charts.js';

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


const traceSources = { mcp: t("MCP calls", "MCP 调用"), lifecycle: t("Operation lifecycle", "操作生命周期"), audit: t("Historical access decisions", "历史授权决定"), outbox: t("Application changes", "应用变更记录"), runtime: t("Runtime observations", "运行观察") };
const traceStages = { validation: t("Validation", "校验"), transport: t("Transport", "传输"), authorization: t("Authorization", "授权"), dispatch: t("App invocation", "调用应用"), commit: t("Commit", "提交"), readback: t("Readback", "回读"), result: t("Result", "结果"), runtime: t("Runtime step", "运行步骤") };
const traceStates = { started: t("Outcome not yet recorded", "尚未记录最终结果"), allowed: t("Allowed", "已允许"), denied: t("Denied", "已拒绝"), succeeded: t("Succeeded", "已成功"), failed: t("Failed", "失败"), unknown: t("Outcome unknown", "结果未知"), committed: t("Committed by app", "应用已提交"), not_recorded: t("Not recorded", "未记录"), queued: t("Queued", "排队中"), running: t("Running", "运行中"), waiting: t("Waiting", "等待中"), cancelled: t("Cancelled", "已取消") };
function appendTraceReference(parent, reference) {
  if (!reference || typeof reference.href !== 'string') return;
  const declared = appFact(reference.appId), nativePath = declared?.entry.nativePath;
  const runtime = declared?.runtime === true && declared.entry.policy === 'platform-admin' && typeof nativePath === 'string' && reference.href.startsWith(nativePath) && !/[\\\s]|%(?:2e|2f|5c)|(?:^|\/)\.{1,2}(?:\/|$)/i.test(reference.href.split(/[?#]/, 1)[0]);
  if (!runtime && (!nativePath || reference.href !== nativePath)) return;
  const link = element('a', 'trace-reference', t("Open {0}", "打开{0}", appNames[reference.appId] || reference.appId));
  link.href = reference.href;
  parent.append(link);
  const identity = [reference.spaceId, reference.resourceId, reference.revision === undefined ? null : t("revision {0}", "版本 {0}", reference.revision)].filter(Boolean);
  if (identity.length) parent.append(element('span', '', identity.join(' / ')));
}
function appendTraceMetadata(parent, value) {
  if (value.workflowRecorded) parent.append(element('p', '', value.workflow ? t("Workflow {0}, version {1}, run {2}", "流程 {0}，版本 {1}，运行 {2}", value.workflow.id, value.workflow.version || t("not recorded", "未记录"), value.workflow.runId || t("not recorded", "未记录")) : t("Workflow recorded; business read access is required for its reference.", "已记录流程；查看引用需要相应业务读取权限。")));
  if (value.humanDecisionRecorded) parent.append(element('p', '', value.humanDecision ? t("Human decision: {0} ({1})", "人工决定：{0}（{1}）", ({ approved: t("Approved", "已批准"), rejected: t("Rejected", "已拒绝"), changes_requested: t("Changes requested", "要求修改") })[value.humanDecision.decision] || t("Recorded", "已记录"), value.humanDecision.id) : t("Human decision recorded; business read access is required for its reference.", "已记录人工决定；查看引用需要相应业务读取权限。")));
  if (value.sourceCount) {
    const paragraph = element('p');
    paragraph.append(document.createTextNode(t("Recorded sources: {0}. ", "已记录来源：{0}项。", value.sourceCount)));
    for (const reference of value.sources || []) appendTraceReference(paragraph, reference);
    if ((value.sources || []).length < value.sourceCount) paragraph.append(document.createTextNode(t("Some references require additional business read access.", "部分引用需要相应业务读取权限。")));
    parent.append(paragraph);
  }
}
function traceStepNode(step) {
  const row = element('li', 'trace-step');
  row.append(element('strong', '', traceStages[step.stage] || t("Recorded step", "已记录步骤")), element('span', '', traceStates[step.status] || t("Unconfirmed", "待确认")), element('time', '', time(step.at)));
  if (step.code) row.append(element('span', '', step.code));
  if (step.stage === 'runtime' && step.stepId) row.append(element('span', '', step.stepId));
  if (step.generation !== undefined) row.append(element('span', '', t("Generation {0}", "代次 {0}", step.generation)));
  if (step.committed === true) row.append(element('span', '', t("Commit confirmed", "已确认提交")));
  if (step.reference) { const line = element('p'); appendTraceReference(line, step.reference); row.append(line); }
  else if (step.revisionRecorded) row.append(element('p', '', t("Version recorded; business read access is required.", "版本已记录，查看需要业务读取权限。")));
  appendTraceMetadata(row, step);
  return row;
}
const mcpCategories = { business: t('Business tool', '应用工具'), control: t('Connection control', '连接控制'), unknown: t('Unregistered tool', '未注册工具') };
const mcpOutcomes = { started: t('In progress', '处理中'), succeeded: t('Call succeeded', '调用成功'), failed: t('Call failed', '调用失败'), denied: t('Denied', '已拒绝'), unknown: t('Outcome unknown', '结果未知'), cancelled: t('Call cancelled', '调用已取消') };
const mcpTool = item => ['business', 'control'].includes(item.category) && typeof item.toolName === 'string' ? item.toolName : t('Unregistered tool', '未注册工具');
function renderMcpCalls(node, report, loadSteps, { openMcpCalls = new Set() } = {}) {
  if (!['ready', 'empty'].includes(report?.state) || report.schemaVersion !== 1 || !Array.isArray(report.items) || report.items.some(item => item.kind !== 'mcp')) {
    node.append(element('p', 'overview-status', t('Could not load MCP calls. Refresh to retry.', '暂时无法读取 MCP 调用，请刷新后重试。'))); return;
  }
  const summary = report.summary || {}, coverage = report.coverage?.mcp || {};
  const scope = element('div', 'mcp-call-summary');
  scope.append(element('p', 'trace-scope', report.window === 'week' ? t('MCP tool-call attempts in the last seven days.', '近七天的 MCP 工具调用尝试。') : t('MCP tool-call attempts in the last day.', '近一天的 MCP 工具调用尝试。')));
  if (coverage.recordingStartedAt) scope.append(element('p', 'trace-scope', t('Detailed call recording began {0}.', '详细调用记录始于 {0}。', time(coverage.recordingStartedAt))));
  table(scope, 'mcp-summary', t('MCP call statistics', 'MCP 调用统计'), [t('Calls', '调用数'), t('Succeeded', '成功'), t('Failed', '失败'), t('Denied', '拒绝'), t('Cancelled', '已取消'), t('Unknown', '结果未知'), t('In progress', '处理中'), t('p50 duration', 'p50 耗时'), t('p95 duration', 'p95 耗时')], [[quantity(summary.total), quantity(summary.success), quantity(summary.errors), quantity(summary.denied), quantity(summary.cancelled), quantity(summary.unknown), quantity(summary.inProgress), duration(summary.p50Ms), duration(summary.p95Ms)]]);
  scope.append(element('p', 'trace-scope', t('MCP ingress failures: {0}.', 'MCP 入口失败：{0}。', quantity(summary.ingressFailures))));
  if (Array.isArray(report.byTool) && report.byTool.length) table(scope, 'mcp-tools', t('Calls by tool in this window', '当前时间范围内的工具调用'), [t('Tool', '工具'), t('Type', '类型'), t('Calls', '调用数'), t('Succeeded', '成功'), t('Failed', '失败'), t('Denied', '拒绝'), t('p50 duration', 'p50 耗时'), t('p95 duration', 'p95 耗时')], report.byTool.map(item => [mcpTool(item), mcpCategories[item.category] || t('Unconfirmed', '待确认'), quantity(item.total), quantity(item.success), quantity(item.errors), quantity(item.denied), duration(item.p50Ms), duration(item.p95Ms)]));
  node.append(scope);
  if (!report.items.length) { node.append(element('p', 'overview-status', t('No MCP tool calls were recorded in this window.', '当前时间范围内尚未记录 MCP 工具调用。'))); return; }
  node.append(element('h4', 'mcp-call-list-heading', t('Recent MCP calls', '最近的 MCP 调用')));
  node.append(element('p', 'trace-scope', t('Call results describe the request outcome. Check ongoing job status in its owning app.', '调用结果记录请求的实际结果；进行中的任务状态请在所属应用中查看。')));
  for (const item of report.items) {
    const entry = element('article', 'trace-entry mcp-call'); entry.dataset.callId = item.id;
    const heading = element('div', 'trace-entry-heading'), title = element('h4'); title.append(element('code', '', mcpTool(item)));
    heading.append(title, element('time', '', time(item.at))); entry.append(heading);
    const metadata = element('dl', 'mcp-call-metadata');
    const rows = [[t('Source', '来源'), item.endpoint === '/mcp' ? t('App MCP (/mcp)', '应用 MCP（/mcp）') : t('MCP', 'MCP')], [t('Type', '类型'), mcpCategories[item.category] || t('Unconfirmed', '待确认')], [t('Result', '结果'), mcpOutcomes[item.outcome || item.status] || t('Unconfirmed', '待确认')], [t('Duration', '耗时'), duration(item.durationMs)]];
    if (typeof item.appId === 'string' && item.appId) rows.splice(1, 0, [t('App', '应用'), appNames[item.appId] || item.appId]);
    if (typeof item.actor?.clientRef === 'string' && /^[a-f0-9]{24}$/.test(item.actor.clientRef)) rows.push([t('Client reference', '客户端引用'), item.actor.clientRef.slice(0, 8) + '…']);
    for (const [name, value] of rows) { const pair = element('div'); pair.append(element('dt', '', name), element('dd', '', value)); metadata.append(pair); }
    entry.append(metadata);
    if (typeof item.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(item.code)) entry.append(element('p', 'mcp-call-code', t('Code: {0}', '代码：{0}', item.code)));
    if (item.lifecycleTraceId) {
      const details = element('details', 'trace-lifecycle'), disclosure = element('summary', '', t('Call lifecycle', '调用生命周期')), body = element('div', 'trace-lifecycle-body');
      details.open = openMcpCalls.has(item.id); details.append(disclosure, body); entry.append(details);
      let loading = false, loaded = false;
      async function loadLifecycle() {
        if (!details.open || loading || loaded || !entry.isConnected) return;
        loading = true; body.replaceChildren(element('p', 'overview-status', t('Loading lifecycle…', '正在读取生命周期…')));
        try {
          const value = await loadSteps(item.lifecycleTraceId);
          if (!entry.isConnected) return;
          if (!Array.isArray(value.items) || !value.items.length) body.replaceChildren(element('p', 'overview-status', t('No lifecycle record is available for this call.', '此调用暂无可读取的生命周期记录。')));
          else renderTraces(body, value, loadSteps, { showCoverage: false });
          loaded = true;
        } catch {
          if (!entry.isConnected) return;
          body.replaceChildren(element('p', 'overview-status', t('Could not load the lifecycle.', '暂时无法读取生命周期。')));
          const retry = element('button', 'trace-steps-more', t('Retry', '重试')); retry.type = 'button'; retry.addEventListener('click', () => { loaded = false; void loadLifecycle(); }); body.append(retry);
        } finally { loading = false; }
      }
      details.addEventListener('toggle', () => { if (!entry.isConnected) return; if (details.open) { openMcpCalls.add(item.id); void loadLifecycle(); } else openMcpCalls.delete(item.id); });
      if (details.open) queueMicrotask(() => void loadLifecycle());
    } else entry.append(element('p', 'trace-scope', t('No app lifecycle was recorded for this call.', '此调用未记录应用生命周期。')));
    node.append(entry);
  }
}

function renderTraces(node, report, loadSteps, options = {}) {
  clearNode(node);
  if (report?.source === 'mcp') { renderMcpCalls(node, report, loadSteps, options); return; }
  if (!['ready', 'empty'].includes(report?.state) || report.schemaVersion !== 1 || !Array.isArray(report.items)) {
    if (report?.source === 'runtime' && report.state === 'not_configured') { node.append(element('p', 'overview-status', t("Runtime observations are not configured for this installation.", "此安装尚未配置运行观察来源。"))); return; }
    node.append(element('p', 'overview-status', t("Could not load business traces. Refresh to retry.", "暂时无法读取业务留痕，请刷新后重试。"))); return;
  }
  if (options.showCoverage !== false) {
  const coverage = report.coverage || {};
  node.append(element('p', 'trace-scope', report.source === 'runtime' ? t("Runtime observations show recorded workflow context. They do not establish an MCP call, an application commit or readback.", "运行观察展示已记录的流程上下文，不证明 MCP 调用、应用提交或回读。") : t("Detailed lifecycle coverage begins with recorded traces. Historical access decisions do not prove a commit; app change records do not supply missing invocation or readback steps.", "详细生命周期从实际留痕开始覆盖。历史授权决定不证明已提交，应用变更记录也不补造缺失的调用或回读步骤。")));
  table(node, 'trace-coverage', t("Trace coverage", "留痕覆盖"), [t("Source", "来源"), t("Records", "记录数"), t("First record", "首条记录"), t("Latest record", "最近记录")], Object.entries(traceSources).map(([key, label]) => [label, quantity(coverage[key]?.count), time(coverage[key]?.firstRecordedAt), time(coverage[key]?.lastRecordedAt)]));
  }
  if (!report.items.length) { node.append(element('p', 'overview-status', t("No records in this source.", "当前来源暂无记录。"))); return; }
  for (const item of report.items) {
    const entry = element('article', 'trace-entry'), heading = element('div', 'trace-entry-heading');
    heading.append(element('h4', '', `${appNames[item.appId] || item.appId || t("Unidentified app", "应用未确认")} · ${item.operation || capabilityNames[item.action] || item.action || traceSources[item.kind] || t("Business operation", "业务操作")}`), element('time', '', time(item.at)));
    entry.append(heading, element('p', '', t("Result: {0}", "结果：{0}", traceStates[item.status] || t("Unconfirmed", "待确认"))));
    if (item.kind === 'runtime') {
      const value = item.runtime || {};
      table(entry, `runtime-${item.cursor}`, t("Recorded runtime metadata", "已记录运行元数据"), [t("Field", "字段"), t("Value", "值")], [
        [t("Run", "运行"), value.runId || '—'], [t("Pack", "领域包"), value.packId || '—'], [t("Pack version", "领域包版本"), value.packVersion || t("Not recorded", "未记录")],
        [t("Created", "创建"), time(value.createdAt)], [t("Started", "开始"), time(value.startedAt)], [t("Updated", "更新"), time(value.updatedAt)],
        [t("Recorded steps", "已记录步骤"), `${item.steps?.length || 0} / ${quantity(value.stepCount)}`], [t("Artifact references", "产物引用"), `${value.artifactRefs?.length || 0} / ${quantity(value.artifactCount)}`],
        ...(value.artifactRefs || []).map(reference => [t("Opaque artifact reference", "不透明产物引用"), reference]),
      ]);
    }
    else if (item.kind === 'audit') entry.append(element('p', '', t("Access decision only. Commit and readback were not recorded in this source.", "此来源仅记录授权决定，没有记录提交与回读。")));
    else {
      const commit = item.committed === true ? t("Confirmed", "已确认") : item.committed === false ? t("Not confirmed", "未确认") : t("Not recorded", "未记录");
      entry.append(element('p', '', t("Commit: {0}. Readback: {1}.", "提交：{0}。回读：{1}。", commit, traceStates[item.readback] || t("Not recorded", "未记录"))));
    }
    if (item.requestId) entry.append(element('p', '', t("Request {0}", "请求 {0}", item.requestId)));
    if (item.code) entry.append(element('p', '', item.code));
    if (item.reference) { const reference = element('p'); appendTraceReference(reference, item.reference); entry.append(reference); }
    else if (item.kind !== 'audit') entry.append(element('p', '', t("Source references require current business read access.", "来源引用需要当前有效的业务读取权限。")));
    appendTraceMetadata(entry, item);
    if (Array.isArray(item.steps)) {
      const steps = element('ol', 'trace-steps');
      for (const step of item.steps) steps.append(traceStepNode(step));
      entry.append(steps);
      if (item.olderStepsCursor) {
        const more = element('button', 'trace-steps-more', t("Earlier steps", "较早步骤")); more.type = 'button';
        let cursor = item.olderStepsCursor;
        more.addEventListener('click', async () => {
          more.disabled = true;
          try {
            const previous = await loadSteps(item.id, cursor);
            if (!entry.isConnected) return;
            const page = previous.items?.[0];
            if (!page || !Array.isArray(page.steps)) throw new Error('Trace steps unavailable.');
            steps.prepend(...page.steps.map(traceStepNode)); cursor = page.olderStepsCursor;
            more.hidden = !cursor; more.textContent = t("Earlier steps", "较早步骤");
          } catch { if (entry.isConnected) more.textContent = t("Could not load earlier steps. Retry.", "未能读取较早步骤，请重试。"); }
          finally { more.disabled = false; }
        });
        entry.append(more);
      }
    }
    node.append(entry);
  }
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
  const traceSection = document.querySelector('#platform-trace'), traceNode = document.querySelector('#platform-traces'), traceSource = document.querySelector('#platform-trace-source'), traceWindow = document.querySelector('#platform-trace-window'), traceWindowLabel = document.querySelector('#platform-trace-window-label'), traceNewer = document.querySelector('#platform-trace-newer'), traceOlder = document.querySelector('#platform-trace-older');
  if (!traceSource.querySelector('option[value="runtime"]')) { const option = element('option', '', traceSources.runtime); option.value = 'runtime'; option.dataset.en = 'Runtime observations'; option.dataset.zh = '运行观察'; traceSource.append(option); }
  const groups = { permissions: document.querySelector('#platform-permissions'), connections: document.querySelector('#platform-connections'), storage: document.querySelector('#platform-storage') };
  let epoch = 0, observationEpoch = 0, traceEpoch = 0, controller, observationController, traceController, reading = false, sessionEnded = false, accessAllowed = false;
  let traceCursors = [null], traceIndex = 0, traceNext = null, traceOwner = '', displayedTraceScope = '';
  const openMcpCalls = new Set();
  function clear() {
    observationEpoch++; traceEpoch++;
    for (const node of Object.values(groups)) { clearNode(node); delete node.dataset.freshUntil; }
    observationController?.abort(); traceController?.abort(); panels.hidden = true; experience.hidden = true; traceSection.hidden = true; clearNode(observationNode); clearNode(traceNode); traceCursors = [null]; traceIndex = 0; traceNext = null; traceNewer.disabled = true; traceOlder.disabled = true; updated.textContent = '';
  }
  function message(text, url) {
    notice.replaceChildren(element('span', '', text)); notice.hidden = false;
    const href = loginUrl(url); if (href) { const link = element('a', '', t("Sign in", "登录")); link.href = href; notice.append(link); }
  }
  function restricted(status, body) {
    openMcpCalls.clear(); traceOwner = '';
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
  async function traceRequest(parameters, active, currentEpoch) {
    const response = await request(`/api/platform/traces?${new URLSearchParams(parameters)}`, active);
    let body; try { body = await response.json(); } catch {}
    if (epoch !== currentEpoch || !accessAllowed) throw new Error('Trace session changed.');
    if ([401, 403].includes(response.status)) { restricted(response.status, body); throw new Error('Trace session rejected.'); }
    if (!response.ok || body?.schemaVersion !== 1) throw new Error('Traces unavailable.');
    return body;
  }
  async function traces(currentEpoch) {
    const currentTrace = ++traceEpoch;
    traceController?.abort(); traceController = new AbortController();
    traceNewer.disabled = true; traceOlder.disabled = true;
    const selectedWindow = traceWindow?.value === 'week' ? 'week' : 'day';
    if (traceWindowLabel) traceWindowLabel.hidden = traceSource.value !== 'mcp';
    const requestedScope = traceSource.value + ':' + (traceSource.value === 'mcp' ? selectedWindow : '') + ':' + traceIndex;
    if (displayedTraceScope !== requestedScope || !traceNode.children.length) { clearNode(traceNode); traceNode.append(element('p', 'overview-status', traceSource.value === 'mcp' ? t('Loading MCP calls…', '正在读取 MCP 调用…') : t('Loading business traces…', '正在读取业务留痕…'))); }

    try {
      const parameters = { source: traceSource.value, ...(traceSource.value === 'mcp' && { window: selectedWindow }), limit: '25', ...(traceCursors[traceIndex] && { before: String(traceCursors[traceIndex]) }) };
      const body = await traceRequest(parameters, traceController, currentEpoch);
      if (traceEpoch !== currentTrace) return;
      traceNext = body.nextCursor;
      renderTraces(traceNode, body, (id, before) => traceRequest({ source: 'lifecycle', traceId: id, ...(before !== undefined && before !== null && { before: String(before) }), limit: '25' }, traceController, currentEpoch), { openMcpCalls });
      displayedTraceScope = requestedScope;
      traceNewer.disabled = traceIndex === 0; traceOlder.disabled = !traceNext;
    } catch { if (epoch === currentEpoch && traceEpoch === currentTrace) renderTraces(traceNode, { source: traceSource.value, state: 'unavailable' }); }
  }
  async function refresh() {
    if (!accessAllowed || sessionEnded || document.visibilityState === 'hidden') return;
    const identity = getIdentity();
    if (identity?.platformAdmin !== true || identity.expiresAt <= Date.now()) { deactivate(); return; }
    const currentEpoch = ++epoch;
    controller?.abort(); controller = new AbortController(); reading = true; refreshButton.disabled = true; root.setAttribute('aria-busy', 'true');
    try {
      const [response] = await Promise.all([request('/api/platform/status', controller), loadAppFacts({ signal: controller.signal })]);
      let body; try { body = await response.json(); } catch {}
      if (epoch !== currentEpoch) return;
      if ([401, 403].includes(response.status)) return restricted(response.status, body);
      if (!response.ok || body?.schemaVersion !== 1 || !body.sections) throw new Error('Platform status unavailable.');
      panels.hidden = false;
      permissions(groups.permissions, body.sections.permissions); connections(groups.connections, body.sections.connections); storage(groups.storage, body.sections.storage);
      notice.hidden = true; experience.hidden = false; traceSection.hidden = false; updated.textContent = t("Read at {0}", "读取于 {0}", time(body.generatedAt));
      void observations(currentEpoch); void traces(currentEpoch);
    } catch (error) { if (epoch === currentEpoch) { if ([401, 403].includes(error.status)) return restricted(error.status); clear(); message(t("Could not read status. Refresh to retry.", "暂时无法读取状态，请稍后刷新。")); } }
    finally { if (epoch === currentEpoch) { reading = false; refreshButton.disabled = false; root.setAttribute('aria-busy', 'false'); } }
  }
  function deactivate() {
    const identity = getIdentity(), nextOwner = identity?.user?.id || identity?.userId || '';
    if (identity?.platformAdmin !== true || !nextOwner || traceOwner !== nextOwner) { openMcpCalls.clear(); traceOwner = ''; }
    epoch++; observationEpoch++; controller?.abort(); reading = false; accessAllowed = false; clear();
    root.hidden = true; refreshButton.disabled = true; root.setAttribute('aria-busy', 'false');
  }
  function updateAccess() {
    deactivate();
    const identity = getIdentity();
    traceOwner = identity?.user?.id || identity?.userId || '';
    accessAllowed = identity?.platformAdmin === true && identity.expiresAt > Date.now();
    root.hidden = !accessAllowed; refreshButton.disabled = !accessAllowed;
    if (accessAllowed) { sessionEnded = false; message(t("Loading status…", "正在读取状态…")); void refresh(); }
  }
  refreshButton.addEventListener('click', refresh);
  windowSelect.addEventListener('change', () => { if (!panels.hidden) void observations(epoch); });
  traceSource.addEventListener('change', () => { traceCursors = [null]; traceIndex = 0; if (!panels.hidden) void traces(epoch); });
  traceWindow?.addEventListener('change', () => { traceCursors = [null]; traceIndex = 0; if (!panels.hidden) void traces(epoch); });
  traceOlder.addEventListener('click', () => { if (traceNext && !panels.hidden) { traceCursors = traceCursors.slice(0, traceIndex + 1); traceCursors.push(traceNext); traceIndex++; void traces(epoch); } });
  traceNewer.addEventListener('click', () => { if (traceIndex > 0 && !panels.hidden) { traceIndex--; void traces(epoch); } });
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
