import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readApps, resolveAppIcon } from './apps.mjs';
import { requestLocale } from './web-gateway.mjs';

const WORKSPACE_ROOT = fileURLToPath(new URL('../', import.meta.url));
const sessionCookie = /(?:^|;\s*)praxis_business_session=[A-Za-z0-9_-]{16,512}(?:;|$)/;
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[char]);

const copy = {
  en: {
    lang: 'en', path: '/', home: '/', other: '/zh-cn/', otherLabel: '简体中文', otherLang: 'zh-CN',
    title: 'Praxis — A self-hosted workbench for your AI agent',
    description: 'Use the AI agent you choose with self-hosted apps for notes, tasks, projects and more. Authorize access, review results, and build your own apps.',
    demoImage: '/home-images/workbench-en.png', demoAnimation: '/home-images/workbench-en.gif',
    demoAlt: 'Paseo conversation beside the Praxis workbench showing a synthetic record to review field notes',
    skip: 'Skip to content', mainNav: 'Main navigation', apps: 'Apps', start: 'Get started', openWorkbench: 'Open workbench',
    heroTitle: 'A self-hosted workbench<br>for your AI agent.',
    tryAgent: 'Try with your agent', selfHost: 'Self-host Praxis',
    play: 'Play example', pause: 'Pause example',
    stepsHeading: 'Authorize. Ask. Review.',
    steps: [
      ['Authorize access', 'Sign in and approve specific apps, records and actions. You can revoke access at any time.'],
      ['Ask for an outcome', 'Use your preferred agent. Start with a task, not a tour of the interface.'],
      ['Review the result', 'Open the native app to read, watch, listen or check the evidence when you choose.'],
    ],
    appsHeading: 'Useful apps. A place for your own.',
    appsLead: 'Eleven built-in components, each with its own records and interface. Start with what you need, then build an app around the way you work.',
    viewSource: 'View source for',
    cardsHeading: 'Your attention, on your terms.',
    cardsLead: 'Choose what to focus on, what can wait and what to hide. Open the source when you need context.',
    cardsNote: 'Synthetic design preview. Reading a card does not accept work or send a read receipt.',
    cardApp: 'Memo', cardReason: 'Because you flagged it for review',
    cardTitle: 'Review field notes', cardMeta: 'Due tomorrow · 10:00', cardEvidence: 'Synthetic example · source record lives in your Memo',
    cardOpen: 'Open', cardLater: 'Later', cardHide: 'Hide this version',
    ownHeading: 'Keep the work yours.',
    ownership: [
      ['Your data, on your terms.', 'Run your own instance. Choose app access and revoke it when you need to.'],
      ['A trace you can follow.', 'Review recorded agent calls and workflow observations.'],
    ],
    startHeading: 'Try one real task.', startLead: 'Before setting up your own instance, paste this prompt into your agent.',
    signIn: 'Open the workbench to sign in',
    accountNote: 'Create a Praxis account, then sign in. App and resource access is granted separately.',
    register: 'Create an account',
    firstTask: 'Then ask: “Add a record to review the field notes tomorrow.”',
    copyPrompt: 'Copy prompt', copied: 'Copied', copyFailed: 'Copy failed. Select and copy the text.',
    hostHeading: 'Or make it your own.',
    hostLead: 'Git, Docker Engine and Compose v2 are all you need to start the complete workbench and eleven built-in apps.',
    setupGuide: 'Full setup guide', buildApps: 'Build your own apps',
    credentials: 'Get the generated owner account:',
    thenOpen: 'Then open http://127.0.0.1:4321/ and connect your agent to your local instance.',
    faqHeading: 'A few things to know.',
    faq: [
      ['Does Praxis replace my agent?', 'No. Your external agent interprets the task and calls authorized app tools. Praxis owns the app records, checks operations and presents results.'],
      ['Can I use it with other people?', 'Yes. Praxis supports personal, family and team or organization use, with app, resource and action permissions. Membership does not automatically share private records.'],
      ['Can I build and host my own app?', 'Yes. Use the app standard to register an independent app. Managed deployment also needs its reviewed integration and explicit installation configuration.'],
      ['Can I see what my agent did?', 'Settings includes Trace for actual MCP calls and supplemental runtime observations. Full-business-process analysis and workflow improvement remain product goals.'],
    ],
    resources: 'Resources', docs: 'Documentation', contribute: 'Contribute',
  },
  zh: {
    lang: 'zh-CN', path: '/zh-cn/', home: '/zh-cn/', other: '/', otherLabel: 'English', otherLang: 'en',
    title: 'Praxis — 为你的 AI 智能体准备的自托管工作台',
    description: '用你选择的 AI 智能体，操作自己的笔记、任务、项目等应用。由你授权，查看并使用结果，也能开发和部署自己的应用。',
    demoImage: '/home-images/workbench-zh.png', demoAnimation: '/home-images/workbench-zh.gif',
    demoAlt: '真实 Paseo 会话与 Praxis 工作台并排，展示复核现场笔记的合成记录',
    skip: '跳到正文', mainNav: '主导航', apps: '内置应用', start: '开始使用', openWorkbench: '打开工作台',
    heroTitle: '为你的 AI 智能体，<br>准备一个自己的工作台。',
    tryAgent: '用你的智能体试试', selfHost: '自行部署 Praxis',
    play: '播放示例', pause: '暂停示例',
    stepsHeading: '授权。提问。查看结果。',
    steps: [
      ['先授权访问范围', '登录并批准具体应用、记录和操作，之后可以随时撤销。'],
      ['说出想要的结果', '继续使用你喜欢的智能体，从一件具体的事开始。'],
      ['按自己的节奏查看结果', '打开应用，读、看、听，或在需要时回到依据核验。'],
    ],
    appsHeading: '现成的应用，也给你的应用留了位置。',
    appsLead: '十一个内置组件，各自保存记录、提供界面。从需要的开始，也可以围绕自己的工作开发新应用。',
    viewSource: '查看源码：',
    cardsHeading: '你的注意力，由你安排。',
    cardsLead: '哪些现在看，哪些稍后处理，哪些先收起，由你决定。需要上下文时，再打开来源。',
    cardsNote: '合成内容设计预览。阅读卡片不代表接受工作，也不会发送已读回执。',
    cardApp: '备忘', cardReason: '因为你标记了待复核',
    cardTitle: '复核现场笔记', cardMeta: '明天 10:00 到期', cardEvidence: '合成示例 · 来源记录保存在你的备忘中',
    cardOpen: '打开', cardLater: '稍后', cardHide: '收起这一版',
    ownHeading: '自己的工作，自己掌握。',
    ownership: [
      ['数据与授权，由你掌握。', '自行部署数据，按需授权应用，随时撤销访问。'],
      ['操作线索，可以回看。', '回看已记录的智能体调用和工作流观察。'],
    ],
    startHeading: '先试一件真正的事。', startLead: '部署自己的实例之前，把下面这段话复制给你的智能体。',
    signIn: '打开工作台并登录',
    accountNote: '创建 Praxis 账号后登录。应用与资源访问权限需单独授权。',
    register: '创建账号',
    firstTask: '然后说：“在备忘里加一条明天复核现场笔记的记录。”',
    copyPrompt: '复制连接提示', copied: '已复制', copyFailed: '复制失败，请选择并复制文本。',
    hostHeading: '也可以，部署你自己的。',
    hostLead: '准备好 Git、Docker Engine 与 Compose v2，启动完整工作台和十一个内置应用。',
    setupGuide: '完整部署指南', buildApps: '开发自己的应用',
    credentials: '读取首次生成的管理员账号：',
    thenOpen: '然后打开 http://127.0.0.1:4321/，让智能体连接你的本地实例。',
    faqHeading: '你可能还想知道。',
    faq: [
      ['Praxis 会替换我正在用的智能体吗？', '不会。外部智能体理解任务并调用获授权的应用工具；Praxis 保存应用记录、校验操作，并把结果呈现给人。'],
      ['能和其他人一起用吗？', '可以个人、家庭、团队或组织使用，按应用、资源和动作控制权限。加入一个组织不等于自动共享私人记录。'],
      ['能开发和部署自己的应用吗？', '可以。按照应用标准登记独立应用；受管部署还需要审核过的集成和明确的安装配置。'],
      ['能查看智能体做过哪些操作吗？', '设置中的 Trace 展示实际 MCP 调用及补充的运行观察。覆盖完整业务过程的分析与流程改进仍属于产品目标。'],
    ],
    resources: '相关资源', docs: '文档', contribute: '参与贡献',
  },
};

const repository = app => 'https://github.com/55aaseclab/' + (app.source ? app.source.replace(/^third_party\//, '').replace(/\/+$/, '') : app.id);

function homeHtml({ texts, origin, apps, icons, icon, stylesHref, scriptHref }) {
  const o = escapeHtml(origin);
  const loginUrl = `${o}/auth/login?return_to=${encodeURIComponent('/')}`;
  const prompt = `Connect to Praxis at ${o}/mcp using OAuth. Help me sign in and choose what you may access, then show my available apps and tools.`;
  const appsList = apps.map(app => {
    const labels = app.labels?.[texts.lang === 'zh-CN' ? 'zh' : 'en'] || {};
    const name = labels.name || app.name, description = labels.description || app.description;
    return `<li><a href="${escapeHtml(repository(app))}" aria-label="${escapeHtml(texts.viewSource)} ${escapeHtml(name)}"><img src="${icons.get(app.id)}" alt="" width="44" height="44"><span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(description)}</small></span></a></li>`;
  }).join('');
  const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', name: 'Praxis', url: `${o}/`, inLanguage: texts.lang },
    { '@type': 'SoftwareSourceCode', name: 'Praxis', codeRepository: 'https://github.com/55aaseclab/praxis', license: 'https://www.apache.org/licenses/LICENSE-2.0', applicationCategory: 'BusinessApplication', operatingSystem: 'Linux' },
  ] });
  return `<!doctype html>
<html lang="${texts.lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(texts.title)}</title>
<meta name="description" content="${escapeHtml(texts.description)}"><meta name="theme-color" content="#ffffff">
<link rel="canonical" href="${o}${texts.path}">
<link rel="alternate" hreflang="en" href="${o}/"><link rel="alternate" hreflang="zh-Hans" href="${o}/zh-cn/"><link rel="alternate" hreflang="x-default" href="${o}/">
<meta property="og:type" content="website"><meta property="og:site_name" content="Praxis">
<meta property="og:title" content="${escapeHtml(texts.title)}"><meta property="og:description" content="${escapeHtml(texts.description)}">
<meta property="og:url" content="${o}${texts.path}">
<meta property="og:image" content="${o}${texts.demoImage}"><meta property="og:image:width" content="2048"><meta property="og:image:height" content="1233"><meta property="og:image:alt" content="${escapeHtml(texts.demoAlt)}">
<link rel="icon" href="${icon}" type="image/svg+xml">
<link rel="stylesheet" href="${stylesHref}"><script src="${scriptHref}" defer></script>
<script type="application/ld+json">${jsonLd}</script>
</head>
<body>
<a class="skip" href="#content">${texts.skip}</a>
<header class="site-header"><div class="header-inner wrap"><a class="brand" href="${texts.home}" aria-label="Praxis"><img src="${icon}" width="34" height="34" alt="">Praxis</a><nav aria-label="${texts.mainNav}"><a href="#apps">${texts.apps}</a><a href="#start">${texts.start}</a><a href="https://github.com/55aaseclab/praxis/blob/main/docs/README.md">${texts.docs}</a><a href="https://github.com/55aaseclab/praxis/blob/main/CONTRIBUTING.md">${texts.contribute}</a><a href="https://github.com/55aaseclab/praxis">GitHub</a></nav><div class="header-actions"><a href="${texts.other}?lang=${texts.otherLang === 'en' ? 'en' : 'zh'}" lang="${texts.otherLang}" hreflang="${texts.otherLang}">${texts.otherLabel}</a><a class="workbench" href="${loginUrl}">${texts.openWorkbench}</a></div></div></header>
<main id="content">
<section class="hero wrap" aria-labelledby="hero-title"><div class="hero-intro"><h1 id="hero-title">${texts.heroTitle}</h1><div class="hero-actions"><a class="button primary" href="#start">${texts.tryAgent}</a><a class="button secondary" href="#self-host">${texts.selfHost}</a></div></div><figure class="product-example hero-demo"><img id="product-demo" src="${texts.demoImage}" data-animation="${texts.demoAnimation}" width="2048" height="1233" alt="${escapeHtml(texts.demoAlt)}" fetchpriority="high"><figcaption class="demo-controls"><button class="demo-toggle" type="button" aria-pressed="false" data-play="${texts.play}" data-pause="${texts.pause}" data-poster="${texts.demoImage}" data-animation="${texts.demoAnimation}" hidden><span aria-hidden="true" class="play-symbol">▷</span><span data-demo-label>${texts.play}</span></button><noscript><a class="demo-toggle demo-fallback" href="${texts.demoAnimation}"><span aria-hidden="true" class="play-symbol">▷</span><span>${texts.play}</span></a></noscript></figcaption></figure></section>
<section class="steps wrap" aria-labelledby="steps-heading"><h2 id="steps-heading">${texts.stepsHeading}</h2><ol>${texts.steps.map(([heading, text], index) => `<li><span class="step-number" aria-hidden="true">${index + 1}</span><h3>${heading}</h3><p>${text}</p></li>`).join('')}</ol></section>
<section id="apps" class="apps-section wrap" aria-labelledby="apps-heading"><div class="section-heading"><h2 id="apps-heading">${texts.appsHeading}</h2><p>${texts.appsLead}</p></div><ul class="apps">${appsList}</ul></section>
<section id="cards" class="cards-section wrap" aria-labelledby="cards-heading"><div class="cards-grid"><div><h2 id="cards-heading">${texts.cardsHeading}</h2><p class="cards-lead">${texts.cardsLead}</p><p class="small">${texts.cardsNote}</p></div><div class="card-stage"><article class="result-card" aria-label="${texts.cardTitle}"><header><img src="${icons.get('memo')}" alt="" width="28" height="28"><span class="card-app">${texts.cardApp}</span></header><p class="card-reason">${texts.cardReason}</p><h3>${texts.cardTitle}</h3><p class="card-meta">${texts.cardMeta}</p><p class="card-evidence">${texts.cardEvidence}</p><div class="card-actions"><span class="card-primary">${texts.cardOpen}</span><span class="card-quiet">${texts.cardLater}</span><span class="card-quiet">${texts.cardHide}</span></div></article></div></div></section>
<section class="ownership wrap" aria-labelledby="own-heading"><h2 id="own-heading">${texts.ownHeading}</h2><div class="ownership-body">${texts.ownership.map(([heading, text]) => `<div><h3>${heading}</h3><p>${text}</p></div>`).join('')}</div></section>
<section class="start-band" id="start" aria-labelledby="start-heading"><div class="wrap start-grid"><div class="start-copy"><h2 id="start-heading">${texts.startHeading}</h2><p>${texts.startLead}</p><a class="text-link" href="${loginUrl}">${texts.signIn}</a></div><div><div class="prompt"><p id="connection-prompt">${escapeHtml(prompt)}</p><button type="button" class="copy-button" data-copy="connection-prompt" data-done="${texts.copied}" data-error="${texts.copyFailed}" aria-label="${texts.copyPrompt}" title="${texts.copyPrompt}" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></div><p class="small account-note">${texts.accountNote} <a href="${o}/auth/register?lang=${texts.lang === 'zh-CN' ? 'zh' : 'en'}">${texts.register}</a></p><p class="first-task">${texts.firstTask}</p><span class="sr-only" role="status" aria-live="polite" id="copy-status"></span></div></div></section>
<section class="self-host wrap" id="self-host" aria-labelledby="host-heading"><div><h2 id="host-heading">${texts.hostHeading}</h2><p>${texts.hostLead}</p><div class="docs-links"><a class="text-link" href="https://github.com/55aaseclab/praxis/blob/main/README.md#quickstart">${texts.setupGuide}</a><a class="text-link" href="https://github.com/55aaseclab/praxis/blob/main/docs/APP-STANDARD.md">${texts.buildApps}</a></div></div><div><pre aria-label="Start Praxis"><code>git clone --recurse-submodules \\
  https://github.com/55aaseclab/praxis.git
cd praxis
docker compose up --build -d --wait</code></pre><p class="small">${texts.credentials}</p><pre class="credentials"><code>docker compose exec core node \\
  scripts/builtin-install.mjs credentials</code></pre><p class="small">${texts.thenOpen}</p></div></section>
<section class="faq wrap" aria-labelledby="faq-heading"><h2 id="faq-heading">${texts.faqHeading}</h2><div>${texts.faq.map(([question, answer]) => `<div><h3>${question}</h3><p>${answer}</p></div>`).join('')}</div></section>
</main>
<footer class="wrap"><div><a class="brand" href="${texts.home}"><img src="${icon}" width="26" height="26" alt="">Praxis</a><p>© ${new Date().getUTCFullYear()} <a href="https://www.55aaseclab.com/">55AA Security Lab</a></p></div><nav aria-label="${texts.resources}"><a href="https://github.com/55aaseclab/praxis/blob/main/docs/README.md">${texts.docs}</a><a href="https://github.com/55aaseclab/praxis/blob/main/CONTRIBUTING.md">${texts.contribute}</a><a href="https://github.com/55aaseclab/praxis">GitHub</a></nav></footer>
</body></html>`;
}

const dataUri = (buffer, type) => `data:${type};base64,${buffer.toString('base64')}`;

async function buildPages({ canonical, root }) {
  const origin = canonical.origin;
  const publicDir = resolve(root, 'public');
  const [css, script, brand] = await Promise.all([
    readFile(resolve(publicDir, 'home.css')),
    readFile(resolve(publicDir, 'home.js')),
    readFile(resolve(publicDir, 'praxis.svg')),
  ]);
  const assetPath = (bytes, extension) => `/home.${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.${extension}`;
  const stylesHref = assetPath(css, 'css'), scriptHref = assetPath(script, 'js');
  const brandUri = dataUri(brand, 'image/svg+xml');
  const images = new Map(await Promise.all(['workbench-en.png', 'workbench-en.gif', 'workbench-zh.png', 'workbench-zh.gif'].map(async name => {
    const body = await readFile(resolve(root, 'docs/images', name));
    return [name, { type: name.endsWith('.gif') ? 'image/gif' : 'image/png', body }];
  })));
  const apps = await readApps(root, { publicUrlsFile: null });
  const icons = new Map();
  for (const app of apps) {
    const icon = await resolveAppIcon(root, `/app-icons/${app.id}.svg`, { apps });
    icons.set(app.id, dataUri(icon.content, 'image/svg+xml'));
  }
  const modified = (await stat(resolve(publicDir, 'home.css'))).mtime.toISOString().slice(0, 10);
  const pages = new Map();
  const cspFor = html => `default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'sha256-${createHash('sha256').update(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]).digest('base64')}'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'`;
  for (const texts of [copy.en, copy.zh]) {
    const html = homeHtml({ texts, origin, apps, icons, icon: brandUri, stylesHref, scriptHref });
    pages.set(texts.path, { type: 'text/html; charset=utf-8', body: Buffer.from(html), csp: cspFor(html) });
  }
  const alternates = `<xhtml:link rel="alternate" hreflang="en" href="${origin}/"/><xhtml:link rel="alternate" hreflang="zh-Hans" href="${origin}/zh-cn/"/><xhtml:link rel="alternate" hreflang="x-default" href="${origin}/"/>`;
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>${origin}/</loc>${alternates}<lastmod>${modified}</lastmod></url><url><loc>${origin}/zh-cn/</loc>${alternates}<lastmod>${modified}</lastmod></url></urlset>\n`;
  const robots = `User-agent: *\nDisallow: /\nAllow: /$\nAllow: /zh-cn/$\nAllow: /sitemap.xml$\nSitemap: ${origin}/sitemap.xml\n`;
  return {
    pages,
    assets: new Map([
      [stylesHref, { type: 'text/css; charset=utf-8', body: css, immutable: true }],
      [scriptHref, { type: 'text/javascript; charset=utf-8', body: script, immutable: true }],
      ['/home.css', { type: 'text/css; charset=utf-8', body: css }],
      ['/home.js', { type: 'text/javascript; charset=utf-8', body: script }],
      ...[...images].map(([name, file]) => [`/home-images/${name}`, { type: file.type, body: file.body }]),
      ['/sitemap.xml', { type: 'application/xml; charset=utf-8', body: Buffer.from(sitemap) }],
      ['/robots.txt', { type: 'text/plain; charset=utf-8', body: Buffer.from(robots) }],
    ]),
  };
}

export function createPublicHomeHandler({ canonicalUrl, root = WORKSPACE_ROOT }) {
  const canonical = new URL(canonicalUrl);
  let ready;
  const state = () => (ready ??= buildPages({ canonical, root }));
  return async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) return false;
    const url = new URL(request.url, canonical);
    const page = url.pathname === '/' || url.pathname === '/index.html' ? '/'
      : url.pathname === '/zh-cn' ? '/zh-cn/'
      : url.pathname === '/zh-cn/' || url.pathname === '/zh-cn/index.html' ? '/zh-cn/'
      : null;
    const asset = url.pathname === '/home.css' || url.pathname === '/home.js' || /^\/home\.[a-f0-9]{20}\.(?:css|js)$/.test(url.pathname) || url.pathname.startsWith('/home-images/')
      ? url.pathname : url.pathname === '/sitemap.xml' || url.pathname === '/robots.txt' ? url.pathname : null;
    if (!page && !asset) return false;
    const choice = url.searchParams.get('lang');
    const explicitLanguage = page && ['en', 'zh'].includes(choice) && [...url.searchParams.keys()].length === 1;
    if (url.search && !explicitLanguage || request.headers.host !== canonical.host) return false;
    const localeCookie = language => `praxis_locale=${language}; Path=/; SameSite=Lax; Max-Age=31536000${canonical.protocol === 'https:' ? '; Secure' : ''}`;
    const redirect = (location, language) => {
      response.writeHead(303, { Location: location, 'Cache-Control': 'no-store', Vary: 'Cookie', ...(language ? { 'Set-Cookie': localeCookie(language) } : {}) });
      response.end();
      return true;
    };
    if (explicitLanguage) return redirect(choice === 'zh' ? '/zh-cn/' : '/', choice);
    if (page === '/' && !sessionCookie.test(request.headers.cookie || '') && requestLocale(request) === 'zh') return redirect('/zh-cn/');
    const { pages, assets } = await state();
    const cache = page ? 'private, no-cache, must-revalidate'
      : assets.get(asset)?.immutable ? 'public, max-age=31536000, immutable'
      : ['/home.css', '/home.js'].includes(asset) ? 'no-cache, must-revalidate'
      : asset.startsWith('/home-') ? 'public, max-age=86400' : 'public, max-age=300';
    const reply = (status, type, body, extra = {}) => {
      response.writeHead(status, {
        'Content-Type': type, 'Content-Length': body.length, Vary: 'Cookie',
        'Cache-Control': status === 200 ? cache : 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return true;
    };
    if (page) {
      if (url.pathname === '/zh-cn') { response.writeHead(308, { Location: '/zh-cn/', 'Cache-Control': 'no-store' }); response.end(); return true; }
      if (sessionCookie.test(request.headers.cookie || '')) return false;
      const target = pages.get(page);
      return reply(200, target.type, target.body, { 'Content-Security-Policy': target.csp, 'Set-Cookie': localeCookie(page === '/' ? 'en' : 'zh') });
    }
    const target = assets.get(asset);
    if (!target) return false;
    return reply(200, target.type, target.body, { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
  };
}
