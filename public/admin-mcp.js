import { message as t, locale } from './i18n.js';
const language = locale() === 'en' ? 'en' : 'zh-CN';
const endpointNames = { business: t("Business MCP", "业务 MCP"), guide: t("Public guide MCP", "公共引导 MCP") };
const actionNames = { read: t("Read", "读取"), create: t("Create", "新增"), update: t("Update", "修改"), complete: t("Complete", "完成"), delete: t("Delete", "删除"), submit: t("Submit corrections", "提交校正"), assign: t("Assign tasks", "分配任务") };

function el(tag, className = '', text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function table(caption, headings, rows) {
  const root = el('table', 'own-access-table mcp-table');
  root.append(el('caption', '', caption));
  const head = el('thead'), heading = el('tr');
  for (const text of headings) { const cell = el('th', '', text); cell.scope = 'col'; heading.append(cell); }
  head.append(heading); root.append(head);
  const body = el('tbody');
  for (const values of rows) {
    const row = el('tr');
    values.forEach((value, index) => {
      const cell = el(index ? 'td' : 'th');
      if (!index) cell.scope = 'row';
      if (typeof value === 'string') cell.textContent = value; else cell.append(value);
      row.append(cell);
    });
    body.append(row);
  }
  root.append(body); return root;
}
function stamp(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return t("No observations", "未观测");
  return new Date(value).toLocaleString(language, { hour12: false });
}

export function renderMcpManagement(container, value) {
  if (value?.schemaVersion !== 1 || !Array.isArray(value.endpoints)) throw new Error('Invalid MCP management projection.');
  const fragment = document.createDocumentFragment();
  fragment.append(el('p', 'section-note', t("Tools are available according to the user's current permissions and agent delegation. This registry lists configured tools; access is checked separately.", "业务工具按使用者的当前权限和智能体委托提供。这里的注册清单不代表任何客户端已经获得业务权限。")));
  fragment.append(el('p', 'meta', t("Updated {0}", "更新于 {0}", stamp(value.generatedAt))));
  for (const endpoint of value.endpoints) {
    const section = el('section', 'mcp-section'); section.dataset.mcpEndpoint = endpoint.id;
    section.append(el('h2', '', endpointNames[endpoint.id] || 'MCP'));
    section.append(table(t("Protocol endpoints", "协议入口"), [t("Item", "项目"), t("State", "情况")], [
      [t("Address", "地址"), el('code', 'meta', endpoint.url)],
      [t("Registration", "注册"), endpoint.registration === 'registered' ? t("Registered", "已注册") : t("Disabled", "尚未启用")],
      [t("Transport", "传输"), 'Streamable HTTP（POST）'],
      [t("Authentication", "认证"), endpoint.authentication === 'oauth2-bearer' ? t("OAuth 2.0 Bearer. Business access requires a valid grant.", "OAuth 2.0 Bearer；业务访问需有效委托") : t("Public access to a fixed read-only guide", "无需认证；仅固定只读指南")],
      [t("Discovery scope", "发现范围"), endpoint.discovery === 'authorized-subset' ? t("Returns only tools authorized for the current user", "仅返回当前使用者获准的工具") : t("Fixed public tools without access to accounts or business data", "固定公共工具，不读取账号或业务数据")],
      [t("Tool count", "工具数"), String(endpoint.toolCount)],
    ]));
    if (endpoint.apps.length) {
      section.append(table(t("App configuration and successful calls in the past seven days", "应用配置与近七天成功调用"), [t("App", "应用"), t("State", "情况")], endpoint.apps.map(app => {
        const detail = el('div');
        detail.append(el('span', 'permission-line', app.adapter === 'configured' ? t("Business adapter configured", "业务适配器已配置") : t("Business adapter unconfigured", "业务适配器未配置")));
        const activity = app.activity === 'observed' ? t("Observed successful calls: {0}", "已观测成功调用：{0}", stamp(app.lastObservedAt)) : app.activity === 'not_observed' ? t("No successful calls observed", "未观测到成功调用") : t("Call observations unavailable", "调用观测不可用");
        detail.append(el('span', 'meta', activity));
        return [app.name, detail];
      })));
      section.append(el('p', 'meta', t("Adapter configuration and historical calls are per-app indicators. Check current connectivity separately.", "适配器配置和历史调用均不代表当前连接健康；调用记录按应用汇总。")));
    } else section.append(el('p', 'meta', t("The public guide uses no business adapter and its calls are outside business observations.", "公共指南不接入业务适配器；当前业务观测不统计它的调用。")));
    section.append(table(t("Capabilities", "能力清单"), [t("Tool", "工具"), t("Action and input", "操作与输入")], endpoint.tools.map(tool => {
      const identity = el('div');
      identity.append(el('code', 'meta', tool.name), el('span', 'meta', tool.description));
      const detail = el('div');
      detail.append(el('span', '', actionNames[tool.action] || t("Other action", "其他操作")));
      detail.append(el('span', 'meta', tool.readOnly ? t("Read only", "只读") : t("Writes require resource-scoped authorization", "写入需对象范围授权")));
      if (tool.openWorld) detail.append(el('span', 'meta', t("Includes external service queries", "包含外部服务查询")));
      if (tool.destructive) detail.append(el('span', 'meta', t("Deletion", "删除操作")));
      detail.append(el('span', 'meta', tool.inputFields.length ? t("Input: {0}", "输入：{0}", tool.inputFields.join('、')) : t("No input parameters", "无需输入参数")));
      return [identity, detail];
    })));
    fragment.append(section);
  }
  container.replaceChildren(fragment);
}
