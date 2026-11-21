import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { PUBLIC_GUIDANCE_MCP_PATH, PUBLIC_GUIDANCE_TOOLS } from './public-mcp-registry.mjs';
import { assertMcpSkillCoverage, skillForTool, registerMcpSkills } from './business/mcp-skills.mjs';

export { PUBLIC_GUIDANCE_MCP_PATH, PUBLIC_GUIDANCE_TOOLS } from './public-mcp-registry.mjs';
assertMcpSkillCoverage(PUBLIC_GUIDANCE_TOOLS);
const MAX_BODY = 16384;
const supportedMethods = new Set(['initialize', 'ping', 'notifications/initialized', 'tools/list', 'tools/call', 'resources/list', 'resources/read']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function configuredOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Public guidance requires a canonical HTTPS or loopback HTTP origin.');
  return url;
}
function preferredLanguage(header = '') {
  let language = 'en', best = 0;
  for (const range of String(header).slice(0, 512).split(',')) {
    const match = /^\s*(en|zh)(?:-[a-z0-9]+)*(?:\s*;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/i.exec(range);
    if (!match) continue;
    const weight = match[2] === undefined ? 1 : Number(match[2]);
    if (weight > best) { best = weight; language = match[1].toLowerCase(); }
  }
  return language;
}
function introduction(origin, t) {
  return {
    name: 'Praxis',
    summary: t("Praxis connects external agents, business data and interfaces. People view and use their data in the workbench and apps. External agents act on the resources their users authorize.", "Praxis 将外部智能体、业务数据和界面连接起来：智能体操作获准的数据，用户在工作台和应用中查看与使用。Praxis 内部没有智能体。"),
    workbenchUrl: origin + '/', loginUrl: origin + '/auth/login',
    publicGuidance: { url: origin + PUBLIC_GUIDANCE_MCP_PATH, authentication: 'none', purpose: t("Fixed public product information and setup guidance", "固定产品介绍和使用指南") },
    businessConnection: { url: origin + '/mcp', authentication: 'OAuth 2.0', purpose: t("Business operations after the user approves the scope", "用户确认授权范围后的业务操作") },
    access: t("Administrators configure a user’s access. The user delegates a subset to an external agent. Effective delegation follows current permissions, and the user can revoke it in Settings → Agent delegations.", "管理员先配置用户可访问的范围；用户再将自己已有权限的子集委托给外部智能体。委托随当前权限收紧，用户可在「设置 → 智能体委托」中撤销。"),
    limits: [t("The public guide returns no account, space, application resource or business record.", "公共指南不提供用户、空间、应用资源或业务记录。"), t("Check the external client’s support for custom remote MCP and verify its connection directly. Public discovery alone does not establish a mobile integration.", "第三方智能体是否支持自定义远程 MCP，需查看该客户端并实际验证；本指南不代表手机 App 已接通。")],
  };
}
function homeScreen(platform, origin, t) {
  const shared = { platform, url: origin + '/', automaticInstallation: false, note: t("Confirm these actions in your browser. A shortcut still requires sign-in and does not guarantee offline use. Browser menus vary by version.", "这些操作由用户在自己的浏览器中确认；快捷方式不绕过登录，也不保证离线使用。菜单名称可能随浏览器版本变化。") };
  if (platform === 'ios_safari') return { ...shared, steps: [t("Open the workbench in Safari on iPhone.", "在 iPhone 的 Safari 打开工作台链接。"), t("Open Share and choose Add to Home Screen. If needed, look in Edit Actions in the Share menu.", "打开分享菜单，选择“添加到主屏幕”；如未显示，可在分享菜单的“编辑操作”中查找。"), t("Confirm the name Praxis and tap Add.", "确认名称为 Praxis，点击“添加”。")], sources: [{ title: t("Apple: Add a website to the iPhone home screen", "Apple：将网站加入 iPhone 主屏幕"), url: 'https://support.apple.com/guide/iphone/iph42ab2f3a7/ios' }] };
  if (platform === 'android_chrome') return { ...shared, steps: [t("Open the workbench in Chrome on Android.", "在 Android 的 Chrome 打开工作台链接。"), t("Choose Install Praxis on the workbench and confirm, or use Install app or Add to home screen in the browser menu.", "点击工作台提供的“保存到桌面”并确认安装；也可在浏览器菜单选择安装应用或添加到主屏幕。"), t("Confirm the name Praxis and tap Add. If the option is unavailable, bookmark the page and consult the browser help.", "确认名称为 Praxis，点击“添加”；找不到相应菜单时可先保存书签并查看浏览器说明。")], sources: [{ title: t("Google: Website shortcuts in Chrome on Android", "Google：Android Chrome 网站快捷方式"), url: 'https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DAndroid' }] };
  if (platform === 'desktop') return { ...shared, steps: [t("Open the workbench in your desktop browser.", "在桌面浏览器打开工作台链接。"), t("In Chrome or Edge, choose Install Praxis and confirm, or use the browser’s Install app menu. In Safari on macOS, choose File → Add to Dock.", "Chrome／Edge可点击工作台提供的“保存到桌面”并确认安装，也可使用浏览器的安装应用菜单；Mac Safari可选择“文件→添加到程序坞”。"), t("Name it Praxis and create the shortcut. Subsequent visits still require Praxis sign-in and the appropriate app permissions.", "确认名称为 Praxis 并创建；再次打开仍须通过Praxis登录与权限检查。")], sources: [{ title: t("Google: Website shortcuts in desktop Chrome", "Google：电脑 Chrome 网站快捷方式"), url: 'https://support.google.com/chrome/answer/15085120?co=GENIE.Platform%3DDesktop' }] };
  return { ...shared, steps: [t("Open the workbench in your system browser.", "先在系统浏览器打开工作台链接。"), t("Use Safari’s Share menu on iPhone, Chrome’s shortcut menu on Android, or bookmarks and site shortcuts on a computer.", "iPhone 可使用 Safari 的分享菜单；Android 可使用 Chrome 的快捷方式菜单；电脑可保存书签或创建网站快捷方式。"), t("If an embedded browser lacks those menus, open the workbench URL in Safari or Chrome and confirm the action there.", "如果当前 App 的内置浏览器没有这些菜单，请将工作台链接复制到 Safari 或 Chrome，再由用户确认操作。")], sources: [] };
}
function guidance(platform, origin, t) {
  return {
    platform,
    workflow: [
      { step: 1, text: t("Sign in to the workbench and open an app or project you have permission to use.", "在浏览器登录工作台，打开已经获准访问的应用或项目。"), url: origin + '/' },
      { step: 2, text: t("If your external agent supports custom remote MCP, add the protected business endpoint. Sign in and use the native space dropdown on the OAuth consent page to designate an accessible space, then explicitly select its permitted actions. An account without spaces can create one inline; creation grants no app or resource access.", "如果外部智能体支持自定义远程 MCP，添加受保护业务入口。登录后，在 OAuth 同意页使用原生空间下拉框指定可访问空间，再明确勾选该空间允许的操作；无空间时可内联创建，创建不授予应用或资源访问权限。"), url: origin + '/mcp' },
      { step: 3, text: t("Use the agent with authorized data and check the results in the app. Revoke its delegation in Settings → Agent delegations when needed.", "通过智能体操作获准数据，在应用中查看结果；需要收回委托时，打开「设置 → 智能体委托」。"), url: origin + '/admin/' },
    ],
    spaceInstructions: [
      t("For a designated authorization, the code-exchange and refresh token responses include space_id. Read the relevant tool schema and pass that value as arguments.spaceId in tools/call; the token field and tool argument use different spelling.", "指定空间的授权在代码交换及刷新令牌响应中返回 space_id。阅读目标工具的参数结构，并在 tools/call 中将该值传入 arguments.spaceId；令牌字段与工具参数的拼写不同。"),
      t("Some SDKs or client harnesses strip or hide token extensions such as space_id. On the authenticated /mcp connection, read the authorized space IDs in initialize instructions or call praxis_refresh_capabilities with {} and inspect spaces[].spaceId. These are the connection's currently authorized catalog spaces, not additional permissions.", "部分 SDK 或客户端 harness 会剥离或隐藏 space_id 等令牌扩展。请在已认证的 /mcp 连接中读取 initialize 说明里的获准空间 ID，或以 {} 调用 praxis_refresh_capabilities 并查看 spaces[].spaceId；这些仅是该连接当前获准的目录空间，不增加权限。"),
      t("Use only the space the user explicitly designated or authorized for this task. For a legacy grant or an ambiguous space choice, confirm the intended space with the user; never guess an ID or choose the first space arbitrarily. If it is absent from current authorized discovery, obtain the required consent or permissions before continuing. Every tool call still checks space, app, action and resource access.", "仅使用用户为当前任务明确指定或授权的空间。旧委托或空间选择不明确时，先向用户确认目标空间，不猜测 ID，也不任取第一个空间；当前获准发现中缺少该空间时，先取得所需同意或权限再继续。每次工具调用仍校验空间、应用、动作和资源权限。"),
    ],
    homeScreen: homeScreen(platform, origin, t),
    connectionNote: t("The anonymous /mcp/guide endpoint serves fixed guidance. Business operations use /mcp and require sign-in and explicit delegation.", "无需认证的 /mcp/guide 只提供本指南。业务操作连接 /mcp，并需要用户登录和明确授权；不能把公共指南连接视为已经获得业务权限。"),
  };
}
function reply(response, status, value, headers = {}) {
  if (response.destroyed || response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers });
  response.end(body);
}
function rpcError(response, status, id, code, message) { reply(response, status, { jsonrpc: '2.0', id, error: { code, message } }); }
function validId(value) { return typeof value === 'string' && value.length <= 128 || Number.isSafeInteger(value); }
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0, done = false;
    const chunks = [];
    const cleanup = () => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', error); request.off('aborted', aborted); request.off('close', closed); };
    const fail = (status, code) => { if (done) return; done = true; cleanup(); request.once('error', () => {}); request.resume(); reject(Object.assign(new Error('Public MCP request rejected.'), { status, code })); };
    const data = chunk => { size += chunk.length; if (size > MAX_BODY) fail(413, 'TOO_LARGE'); else chunks.push(chunk); };
    const end = () => { if (done) return; done = true; cleanup(); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Public MCP request rejected.'), { status: 400, code: 'INVALID_JSON' })); } };
    const error = () => fail(400, 'INVALID_REQUEST'), aborted = () => fail(400, 'INVALID_REQUEST'), closed = () => { if (!request.complete) fail(400, 'INVALID_REQUEST'); };
    const timer = setTimeout(() => fail(408, 'REQUEST_TIMEOUT'), 2000); timer.unref?.();
    request.on('data', data); request.once('end', end); request.once('error', error); request.once('aborted', aborted); request.once('close', closed);
  });
}

export function createPublicMcpHandler({ origin, clock = Date.now } = {}) {
  const canonical = configuredOrigin(origin), sessions = new Set();
  let started = clock(), count = 0, closed = false;
  const handler = async (request, response) => {
    if (request.url !== PUBLIC_GUIDANCE_MCP_PATH) return false;
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Referrer-Policy', 'no-referrer');
    if (request.headers.host !== canonical.host) { reply(response, 403, { code: 'HOST_REJECTED' }); return true; }
    if (request.headers.origin && request.headers.origin !== canonical.origin || request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) { reply(response, 403, { code: 'ORIGIN_REJECTED' }); return true; }
    if (closed) { reply(response, 503, { code: 'UNAVAILABLE' }); return true; }
    if (clock() - started >= 60000) { started = clock(); count = 0; }
    if (++count > 60 || sessions.size >= 4) { reply(response, 429, { code: 'RATE_LIMITED' }, { 'Retry-After': '60' }); return true; }
    if (request.method === 'OPTIONS') { response.writeHead(204, { Allow: 'POST, OPTIONS', 'Access-Control-Allow-Origin': canonical.origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version', 'Cache-Control': 'no-store' }); response.end(); return true; }
    if (request.method !== 'POST') { reply(response, 405, { code: 'METHOD_NOT_ALLOWED' }, { Allow: 'POST, OPTIONS' }); return true; }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '') || request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity') { reply(response, 415, { code: 'UNSUPPORTED_MEDIA_TYPE' }, { Connection: 'close' }); return true; }
    const length = request.headers['content-length'];
    if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > MAX_BODY)) { reply(response, 413, { code: 'TOO_LARGE' }, { Connection: 'close' }); return true; }
    let server, transport, cleaned = false;
    const stop = (terminate = false) => {
      if (cleaned) return; cleaned = true; clearTimeout(timeout); sessions.delete(stop);
      if (terminate) { response.destroy(); request.destroy(); }
      transport?.close().catch(() => {}); server?.close().catch(() => {});
    };
    const timeout = setTimeout(() => { if (!response.headersSent) reply(response, 503, { code: 'REQUEST_TIMEOUT' }, { Connection: 'close' }); else response.destroy(); request.destroy(); stop(); }, 5000); timeout.unref?.();
    sessions.add(stop); response.once('close', stop); response.once('finish', stop);
    try {
      const body = await readBody(request);
      if (!object(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string' || body.id !== undefined && !validId(body.id)) { rpcError(response, 400, null, -32600, 'Invalid JSON-RPC request'); return true; }
      if (!supportedMethods.has(body.method)) { if (body.id === undefined) { response.writeHead(202); response.end(); } else rpcError(response, 200, body.id, -32601, 'Method is not available on the public guidance endpoint'); return true; }
      if (body.method === 'tools/call' && !PUBLIC_GUIDANCE_TOOLS.some(tool => tool.name === body.params?.name)) { rpcError(response, 200, body.id ?? null, -32602, 'Unknown public guidance tool'); return true; }
      const language = preferredLanguage(request.headers['accept-language']);
      const t = (english, chinese) => language === 'zh' ? chinese : english;
      response.setHeader('Content-Language', language === 'zh' ? 'zh-CN' : 'en');
      server = new McpServer({ name: 'praxis-public-guidance', version: '1.0.0' }, { instructions: t('After connecting, briefly explain how to use Praxis and offer to help the user save its workbench to their home screen or desktop. Read praxis_about and praxis_use_guide for the fixed instructions; use the user-known platform, or other when it is unknown. Guide the user to log in to the workbench and explicitly authorize the separate protected MCP endpoint for business operations. The user confirms browser shortcut creation. Read the companion public skill through resources/list and resources/read before applying these tools; tool metadata identifies the fixed skill URI. This public service accesses no accounts or business data and does not establish a phone App connection.', '连接后简要介绍 Praxis 的使用方法，并说明如何由用户自己保存工作台快捷方式。使用 praxis_about 和 praxis_use_guide 读取固定指南。按设备选择平台，未知时选择 other。需要业务操作的用户应登录工作台，并向独立受保护 MCP 完成授权。先通过 resources/list 和 resources/read 取得两项工具关联的公共技能。公共端点不读取账号或业务数据，手机第三方客户端接入需要另行验证。') });
      registerMcpSkills(server, PUBLIC_GUIDANCE_TOOLS);
      for (const tool of PUBLIC_GUIDANCE_TOOLS) server.registerTool(tool.name, { title: t(tool.title, tool.titleZh), description: t(tool.description, tool.descriptionZh), inputSchema: tool.schema, _meta: { 'praxis/skill': skillForTool(tool) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async args => {
        const value = tool.name === 'praxis_about' ? introduction(canonical.origin, t) : guidance(args.platform, canonical.origin, t);
        return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      });
      transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch (error) {
      if (!response.headersSent && !response.destroyed) reply(response, [400, 408, 413].includes(error.status) ? error.status : 500, { code: ['INVALID_JSON', 'INVALID_REQUEST', 'REQUEST_TIMEOUT', 'TOO_LARGE'].includes(error.code) ? error.code : 'REQUEST_FAILED' }, { Connection: 'close' });
      else if (!response.writableEnded) response.destroy();
    } finally { if (response.writableEnded || response.destroyed) stop(); }
    return true;
  };
  handler.close = () => { closed = true; for (const stop of [...sessions]) stop(true); };
  return handler;
}
