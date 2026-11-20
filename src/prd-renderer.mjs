import { posix } from 'node:path';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { getPrdSources } from './prd-catalog.mjs';

function safeLink(value, source, sources) {
  if (typeof value !== 'string') return null;
  const href = value.trim().replace(/[\u0000-\u0020\u007f]/g, '');
  if (href.startsWith('#')) return { href };
  if (/^(?:https?:|mailto:)/i.test(href)) {
    try {
      const url = new URL(href);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
      return { href: url.href, ...(url.protocol !== 'mailto:' && { target: '_blank', rel: ['noopener', 'noreferrer'] }) };
    } catch { return null; }
  }
  if (href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href)) return null;
  const hashIndex = href.indexOf('#');
  const fragment = hashIndex < 0 ? '' : href.slice(hashIndex);
  let path;
  try { path = decodeURIComponent((hashIndex < 0 ? href : href.slice(0, hashIndex)).split('?')[0]); }
  catch { return null; }
  if (path === '/prds/' || sources.some(entry => path === `/prds/${entry.id}/`)) return { href: `${path}${fragment}` };
  if (path.startsWith('/')) return null;
  const target = posix.normalize(posix.join(posix.dirname(source || ''), path));
  const entry = sources.find(candidate => candidate.source === target || candidate.en === target);
  if (!entry) return null;
  const edition = entry.en ? (entry.en === target ? '?lang=en' : '?lang=zh') : '';
  return { href: `/prds/${entry.id}/${edition}${fragment}` };
}

function stripActiveContent() {
  return tree => {
    function visit(node) {
      if (!node.children) return;
      node.children = node.children.flatMap(child => {
        if (child.type === 'html' || child.type.startsWith('mdx')) return [];
        if (child.type === 'image' || child.type === 'imageReference') return child.alt ? [{ type: 'text', value: child.alt }] : [];
        visit(child);
        return [child];
      });
    }
    visit(tree);
  };
}

function sanitizeLinks() {
  return (tree, file) => {
    const source = file.data.astro?.frontmatter?.prdSource;
    const sources = file.data.astro?.frontmatter?.prdSources || [];
    function visit(node) {
      if (node.type === 'element') {
        if (['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'img', 'form', 'input'].includes(node.tagName)) {
          node.type = 'text'; node.value = ''; delete node.children; delete node.properties;
          return;
        }
        if (node.tagName === 'a') {
          const properties = safeLink(node.properties?.href, source, sources);
          node.properties = properties || {};
          if (!properties) node.tagName = 'span';
        } else if (node.properties) {
          for (const key of Object.keys(node.properties)) if (/^on/i.test(key) || ['style', 'src', 'srcDoc'].includes(key)) delete node.properties[key];
        }
      }
      for (const child of node.children || []) visit(child);
    }
    visit(tree);
  };
}

let processor;
export async function renderPrdMarkdown(document, { root, sources } = {}) {
  sources ??= await getPrdSources(root ? { root } : {});
  processor ??= createMarkdownProcessor({
    syntaxHighlight: false,
    smartypants: false,
    gfm: true,
    remarkPlugins: [stripActiveContent],
    remarkRehype: { allowDangerousHtml: false },
    rehypePlugins: [sanitizeLinks],
  });
  const renderer = await processor;
  const content = String(document.content || '').replace(/^\uFEFF/, '').replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const result = await renderer.render(content, { frontmatter: { prdSource: document.source, prdSources: sources } });
  return { html: result.code, headings: result.metadata.headings };
}
