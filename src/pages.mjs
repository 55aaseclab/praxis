export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

const copy = {
  en: {
    home: 'Workbench', returnHome: 'Return to workbench', catalog: 'Product documents',
    skip: 'Skip to document', navigation: 'Document navigation', requirements: 'Product requirements',
    all: 'All documents', main: 'Platform', apps: 'Apps', missing: 'Document unavailable',
    unspecified: 'Unspecified', contents: 'Contents', outline: 'Document outline', project: 'Project',
    version: 'Version', body: 'Document body', empty: 'This document is empty.',
    retry: 'This document is unavailable. Reload or choose another document.', unknown: 'Document not found.',
    browse: 'Browse all documents',
  },
  zh: {
    home: '工作台', returnHome: '回到工作台', catalog: 'PRD集合',
    skip: '跳到文档内容', navigation: '需求文档导航', requirements: '产品需求',
    all: '全部文档', main: '本项目', apps: '第三方项目', missing: '文档暂不可用',
    unspecified: '未标注', contents: '目录', outline: '文档目录', project: '项目',
    version: '版本', body: 'PRD正文', empty: '文档内容为空。',
    retry: '文档暂不可用，请稍后重新加载或阅读其他文档。', unknown: '文档不存在。',
    browse: '浏览全部文档',
  },
};

export function page(title, body, { className = '', header = true, locale = 'en' } = {}) {
  const labels = copy[locale];
  return `<!doctype html><html lang="${locale === 'zh' ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Praxis</title><link rel="icon" href="/praxis.svg" type="image/svg+xml"><link rel="stylesheet" href="/styles.css"></head><body${className ? ` class="${escapeHtml(className)}"` : ''}>${header ? `<header class="topbar"><a class="brand" href="/" aria-label="${labels.returnHome}"><img src="/praxis.svg" alt="" width="28" height="28">Praxis</a><a class="header-link" href="/prds/">${labels.catalog}</a></header>` : ''}${body}</body></html>`;
}

const listIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/></svg>';
const documentIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h8"/></svg>';

function prdShell(title, documents, currentId, body, { systemNavigation = false, locale = 'en' } = {}) {
  const labels = copy[locale];
  const home = systemNavigation ? '' : `<a class="prd-home" href="/" aria-label="${labels.returnHome}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-7v-7h-4v7H3V10Z"/></svg><span>${labels.home}</span></a>`;
  return page(title, `<a class="prd-skip-link" href="#main">${labels.skip}</a><div class="prd-shell"><aside class="prd-sidebar" aria-label="${labels.navigation}"><div class="prd-brand">PRDs<span>${labels.requirements}</span></div><nav class="prd-nav" aria-label="${labels.catalog}"><a class="prd-nav-entry" href="/prds/"${currentId === null ? ' aria-current="page"' : ''}>${listIcon}<span>${labels.all}</span><span class="prd-count">${documents.length}</span></a>${documents.map(document => `<a class="prd-nav-entry prd-document-link" href="/prds/${escapeHtml(document.id)}/"${document.id === currentId ? ' aria-current="page"' : ''}>${documentIcon}<span>${escapeHtml(document.project)}</span></a>`).join('')}</nav>${home}</aside><main class="reader" id="main" tabindex="-1">${body}</main></div>`, { className: 'prd-body', header: false, locale });
}

export function catalogPage(documents, options = {}) {
  const labels = copy[options.locale || 'en'];
  const groups = [{ id: 'main', title: labels.main }, { id: 'third-party', title: labels.apps }];
  return prdShell(labels.catalog, documents, null, `<h1 id="_top">${labels.catalog}</h1>${groups.map(group => `<section class="prd-group" aria-labelledby="prd-group-${group.id}"><h2 id="prd-group-${group.id}">${group.title}</h2><ul class="prd-list">${documents.filter(doc => doc.group === group.id).map(doc => `<li><a class="prd-entry" href="/prds/${doc.id}/"><span><strong>${escapeHtml(doc.project)}</strong><span class="entry-title">${escapeHtml(doc.title)}</span>${doc.status !== 'ready' ? `<span class="unavailable">${labels.missing}</span>` : ''}</span><span class="prd-version">${escapeHtml(doc.version || labels.unspecified)}</span></a></li>`).join('')}</ul></section>`).join('')}`, options);
}

export function documentPage(document, rendered, documents = [], options = {}) {
  const labels = copy[options.locale || 'en'];
  const readable = document.status === 'ready' && rendered;
  const headings = (rendered?.headings || []).filter(heading => heading.depth === 2);
  const outline = headings.length > 2 ? `<details class="prd-outline"><summary>${labels.contents}</summary><nav aria-label="${labels.outline}"><ul>${headings.map(heading => `<li><a href="#${escapeHtml(heading.slug)}">${escapeHtml(heading.text)}</a></li>`).join('')}</ul></nav></details>` : '';
  return prdShell(document.title, documents, document.id || '', `<h1 id="_top">${escapeHtml(document.title)}</h1>${document.id ? `<dl class="prd-metadata"><div><dt>${labels.project}</dt><dd>${escapeHtml(document.project)}</dd></div><div><dt>${labels.version}</dt><dd>${escapeHtml(document.version || labels.unspecified)}</dd></div></dl>` : ''}${readable ? document.content.trim() ? `${outline}<article class="prd-document" aria-label="${labels.body}">${rendered.html}</article>` : `<p class="prd-empty">${labels.empty}</p>` : `<p class="prd-empty">${document.id ? labels.retry : labels.unknown}</p><a class="prd-back" href="/prds/">${labels.browse}</a>`}`, options);
}
