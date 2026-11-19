const english = {
  lang: 'en', path: '/about/', title: 'Praxis | Self-hosted workbench and scoped MCP access',
  summary: 'Praxis brings independent apps into one workbench. People use a browser and can delegate specific tasks to external agents through the Model Context Protocol (MCP).',
  heading: 'The Praxis workbench',
  sections: [
    ['Find your apps and projects', 'Sign in to see the apps and projects your account can open. Browse source material in Knowledge, review a project in Projects, or read selected Matrix rooms in Matrix Reader. Each app owns its records.'],
    ['Delegate a task', 'Connect a compatible external agent to the MCP endpoint. A user authorizes the client and chooses which resources it may access. For example, a user can let an agent update a reminder in one space and later revoke that permission.'],
    ['Run and extend Praxis', 'The platform uses Node.js and Docker. Maintainers integrate independent apps through the registry and test entry permissions and navigation. Original Praxis platform code is licensed under Apache 2.0. Individual components retain their own license terms.'],
  ],
  component: 'Browse the Praxis repository', enter: 'Open the workbench', readLicense: 'Read the Apache License 2.0',
};

const chinese = {
  lang: 'zh-CN', path: '/about/zh-cn/', title: 'Praxis | 自托管工作台与按范围授权的 MCP 接入',
  summary: 'Praxis 把独立应用汇集到一个工作台。你可以在浏览器中操作，也可以通过模型上下文协议（MCP）把指定任务委托给外部智能体。',
  heading: 'Praxis 工作台',
  sections: [
    ['找到应用和项目', '登录后可以看到账号有权打开的应用和项目。在 Knowledge 浏览资料，在 Projects 查看项目，或在 Matrix Reader 阅读选定的房间。业务记录由各应用保存。'],
    ['委托一项任务', '将兼容的外部智能体连接到 MCP 入口。用户授权客户端并选择可以访问的资源。例如，可以允许智能体更新某个空间的提醒，之后再撤销权限。'],
    ['部署与扩展 Praxis', '平台使用 Node.js 和 Docker。维护者通过注册表接入独立应用，检查入口权限和导航。Praxis 平台原创代码采用 Apache 2.0 许可证，各组件沿用各自的许可条款。'],
  ],
  component: '浏览 Praxis 源码仓库', enter: '打开工作台', readLicense: '阅读 Apache 2.0 许可证',
};

const pages = [english, chinese];

function projectHtml(page, origin) {
  const alternates = pages.map(({ lang, path }) =>
    `<link rel="alternate" hreflang="${lang}" href="${origin}${path}">`).join('\n');
  const sections = page.sections.map(([heading, text]) =>
    `<section><h2>${heading}</h2><p>${text}</p></section>`).join('\n');
  const style = 'html{font:17px/1.65 system-ui,sans-serif;color-scheme:light dark}body{max-width:44rem;margin:clamp(1rem,7vw,6rem) auto;padding:0 1.2rem}nav{display:flex;flex-wrap:wrap;gap:1rem}a{color:LinkText;text-underline-offset:.17em}h1{font-size:clamp(2rem,6vw,3.2rem);line-height:1.1}h2{font-size:1.25rem;margin:1.75rem 0 .25rem}p{margin:.5rem 0 1rem}footer{margin-top:2rem}';
  return `<!doctype html>
<html lang="${page.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title><meta name="description" content="${page.summary}">
<link rel="canonical" href="${origin}${page.path}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${origin}${english.path}">
<meta property="og:type" content="website"><meta property="og:title" content="${page.title}">
<meta property="og:description" content="${page.summary}"><meta property="og:url" content="${origin}${page.path}">
<style>${style}</style></head><body>
<nav aria-label="${page.lang === 'en' ? 'Language' : '语言'}"><a lang="en" hreflang="en" href="/about/">English</a><a lang="zh-CN" hreflang="zh-CN" href="/about/zh-cn/">简体中文</a></nav>
<main><h1>${page.heading}</h1><p>${page.summary}</p><a href="/">${page.enter}</a>
${sections}</main><footer><a href="https://github.com/55aaseclab/praxis">${page.component}</a> · <a href="https://www.apache.org/licenses/LICENSE-2.0">${page.readLicense}</a></footer>
</body></html>`;
}

export function createPublicProjectHandler(canonicalUrl) {
  const canonical = new URL(canonicalUrl);
  const { origin } = canonical;
  const bodies = new Map(pages.map(page => [page.path, ['text/html; charset=utf-8', projectHtml(page, origin)]]));
  bodies.set('/robots.txt', ['text/plain; charset=utf-8', `User-agent: *\nDisallow: /\nAllow: /about/$\nAllow: /about/zh-cn/$\nAllow: /sitemap.xml$\nSitemap: ${origin}/sitemap.xml\n`]);
  bodies.set('/sitemap.xml', ['application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(page => `<url><loc>${origin}${page.path}</loc></url>`).join('')}</urlset>\n`]);

  return (request, response) => {
    if (!bodies.has(request.url)) return false;
    const reply = (status, type, body, extra = {}) => {
      response.writeHead(status, {
        'Content-Type': type, 'Content-Length': Buffer.byteLength(body),
        'Cache-Control': status === 200 ? 'public, max-age=300' : 'no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra,
      });
      response.end(request.method === 'HEAD' ? undefined : body);
      return true;
    };
    if (request.headers.host !== canonical.host) return reply(404, 'text/plain', 'Not found.');
    if (!['GET', 'HEAD'].includes(request.method)) return reply(405, 'text/plain', 'Method not allowed.', { Allow: 'GET, HEAD' });
    const [type, body] = bodies.get(request.url);
    return reply(200, type, body);
  };
}
