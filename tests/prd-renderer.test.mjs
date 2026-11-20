import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPrdMarkdown as renderDocument } from '../src/prd-renderer.mjs';


const registeredSources = [
  {id:'praxis',source:'docs/PRD.md',en:'docs/PRD.en.md'},
  {id:'reminder',source:'third_party/reminder/docs/PRD.md',en:'third_party/reminder/docs/PRD.en.md'},
  {id:'memo',source:'third_party/memo/docs/Memo_PRD.md',en:'third_party/memo/docs/PRD.en.md'},
  {id:'tingproof',source:'third_party/tingproof/docs/PRD.md',en:'third_party/tingproof/docs/PRD.en.md'},
];
const renderPrdMarkdown = document => renderDocument(document, { sources: registeredSources });

function document(content, source = 'docs/PRD.md', id = 'praxis') {
  return { id, group: id === 'praxis' ? 'main' : 'third-party', project: id, source, title: 'Synthetic PRD', version: 'v0.1.0', status: 'ready', content };
}

test('Markdown tables, code blocks and heading metadata remain readable', async () => {
  const result = await renderPrdMarkdown(document('# Synthetic PRD\n\n## 功能需求\n\n| Feature | Priority |\n| --- | --- |\n| Read sources | P0 |\n\n```js\nconst literal = "<script>safe code</script>";\n```\n\n```mermaid\nflowchart LR\n A --> B\n```\n'));
  assert.equal(typeof result.html, 'string');
  assert.match(result.html, /<table(?:\s|>)/);
  assert.match(result.html, /<th(?:\s|>)/);
  assert.match(result.html, /Read sources/);
  assert.match(result.html, /<pre(?:\s|>)/);
  assert.match(result.html, /<code(?:\s|>)/);
  assert.match(result.html, /const/);
  assert.match(result.html, /flowchart LR/);
  assert.doesNotMatch(result.html, /<script(?:\s|>)/i);
  assert.doesNotMatch(result.html, /<svg(?:\s|>)/i);
  assert.ok(Array.isArray(result.headings));
  assert.ok(result.headings.some(heading => heading.text === '功能需求'));
});

test('raw HTML, images and MDX expressions never become executable output', async () => {
  delete globalThis.__prdRendererExecuted;
  const content = '# Safe document\n\n<script>globalThis.__prdRendererExecuted = true</script>\n\n<iframe src="https://example.test/"></iframe>\n\n<img src="x" onerror="globalThis.__prdRendererExecuted=true">\n\n<div class="raw-html-marker" onclick="alert(1)">Raw HTML</div>\n\n![Remote image](https://example.test/tracker.png)\n\n<CustomComponent unsafe="yes" />\n\n{globalThis.__prdRendererExecuted = true}\n\n**Safe bold Markdown**\n';
  const { html } = await renderPrdMarkdown(document(content));
  assert.doesNotMatch(html, /<(?:script|iframe|img|svg|object|customcomponent)(?:\s|>)/i);
  assert.doesNotMatch(html, /\s(?:onerror|onclick)=/i);
  assert.doesNotMatch(html, /class="raw-html-marker"/);
  assert.match(html, /<strong>Safe bold Markdown<\/strong>/);
  assert.equal(globalThis.__prdRendererExecuted, undefined);
});

test('only safe explicit protocols and document anchors remain clickable', async () => {
  const { html } = await renderPrdMarkdown(document('# Links\n\n[Web](https://example.test/docs)\n\n[HTTP](http://example.test/)\n\n[Email](mailto:author@example.test)\n\n[Anchor](#links)\n\n[Danger](javascript:alert(1))\n\n[Encoded](java&#x73;cript:alert(1))\n\n[Data](data:text/html;base64,PHNjcmlwdD4=)\n\n[File](file:///etc/passwd)\n\n[Protocol relative](//example.test/private)\n'));
  assert.match(html, /href="https:\/\/example\.test\/docs"/);
  assert.match(html, /href="http:\/\/example\.test\/"/);
  assert.match(html, /href="mailto:author@example\.test"/);
  assert.match(html, /href="#links"/);
  assert.doesNotMatch(html, /href=["'](?:javascript:|java&#x73;cript:|data:|file:|\/\/)/i);
  assert.match(html, /Danger/);
  assert.match(html, /Encoded/);
});

test('relative links map only to allowed PRDs and other local paths become plain text', async () => {
  const { html } = await renderPrdMarkdown(document('# PRD links\n\n[Reminder](../third_party/reminder/docs/PRD.md)\n\n[Memo](../third_party/memo/docs/Memo_PRD.md)\n\n[Self](PRD.md)\n\n[Catalog](/prds/tingproof/)\n\n[Unknown](ROADMAP.md)\n\n[Private data](../third_party/reminder/data/checklist.json)\n\n[Host path](/etc/passwd)\n'));
  assert.match(html, /href="\/prds\/reminder\/\?lang=zh"/);
  assert.match(html, /href="\/prds\/memo\/\?lang=zh"/);
  assert.match(html, /href="\/prds\/praxis\/\?lang=zh"/);
  assert.match(html, /href="\/prds\/tingproof\/"/);
  assert.doesNotMatch(html, /href="(?:ROADMAP\.md|[^"\s]*checklist\.json|\/etc\/passwd)"/);
  assert.match(html, /Unknown/);
  assert.match(html, /Private data/);
  assert.match(html, /Host path/);
});

test('relative PRD links resolve against a third-party source directory', async () => {
  const { html } = await renderPrdMarkdown(document('# Related\n\n[Main](../../../docs/PRD.md)\n\n[Memo](../../memo/docs/Memo_PRD.md)\n\n[Not a PRD](../../../docs/ROADMAP.md)\n', 'third_party/reminder/docs/PRD.md', 'reminder'));
  assert.match(html, /href="\/prds\/praxis\/\?lang=zh"/);
  assert.match(html, /href="\/prds\/memo\/\?lang=zh"/);
  assert.doesNotMatch(html, /href="[^"\s]*ROADMAP\.md"/);
});

test('English and Chinese source links resolve to the corresponding workbench edition', async () => {
  const { html } = await renderPrdMarkdown(document('# Sources\n\n[English](PRD.en.md) / [简体中文](PRD.md)', 'docs/PRD.en.md'));
  assert.match(html, /href="\/prds\/praxis\/\?lang=en"/);
  assert.match(html, /href="\/prds\/praxis\/\?lang=zh"/);
});
