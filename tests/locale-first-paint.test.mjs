import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'parse5';
import { requestLocale, renderPlatformLocale } from '../src/web-gateway.mjs';

function elements(html) {
  const nodes = [];
  const visit = node => { if (node.tagName) nodes.push(node); for (const child of node.childNodes || []) visit(child); };
  visit(parse(html));
  return nodes;
}
const attr = (node, name) => node.attrs.find(attribute => attribute.name === name)?.value;
const text = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('');

test('locale selection accepts only the persisted preference or an explicit supported choice', () => {
  for (const [cookie, expected] of [[undefined, 'en'], ['', 'en'], ['praxis_locale=zh', 'zh'], ['x=1; praxis_locale=en; y=2', 'en'], ['praxis_locale=zh-CN', 'en'], ['other_praxis_locale=zh', 'en'], ['praxis_locale=<script>', 'en']]) {
    const request = { headers: { cookie, 'accept-language': 'zh-CN' } };
    assert.equal(requestLocale(request), expected);
    assert.equal(requestLocale(request, 'en'), 'en');
    assert.equal(requestLocale(request, 'zh'), 'zh');
    assert.equal(requestLocale(request, 'invalid'), expected);
  }
});

test('server localization preserves source text, accessibility and language selection without interpreting translations as HTML', () => {
  const source = '<!doctype html><html lang="en"><head><title data-zh="设置 · Praxis">Settings · Praxis</title></head><body data-praxis-i18n><p data-zh="中文 &lt;script&gt; &amp; 文本">English &amp; text</p><main aria-label="Settings navigation" data-zh-label="设置导航"></main><select data-language-preference><option value="en">English</option><option value="zh">简体中文</option></select><article>User-authored English 用户内容</article></body></html>';
  const chinese = renderPlatformLocale(source, 'zh');
  const nodes = elements(chinese);
  assert.equal(attr(nodes.find(n => n.tagName === 'html'), 'lang'), 'zh-CN');
  assert.equal(attr(nodes.find(n => n.tagName === 'html'), 'data-praxis-locale'), 'zh');
  const paragraph = nodes.find(n => n.tagName === 'p');
  assert.equal(text(paragraph), '中文 <script> & 文本');
  assert.equal(attr(paragraph, 'data-en'), 'English & text');
  assert.equal(attr(nodes.find(n => n.tagName === 'main'), 'aria-label'), '设置导航');
  assert.equal(attr(nodes.find(n => n.tagName === 'main'), 'data-en-label'), 'Settings navigation');
  assert.equal(attr(nodes.find(n => n.tagName === 'option' && attr(n, 'value') === 'zh'), 'selected'), '');
  assert.equal(nodes.filter(n => n.tagName === 'script').length, 0);
  assert.equal(text(nodes.find(n => n.tagName === 'article')), 'User-authored English 用户内容');
  assert.equal(renderPlatformLocale(chinese, 'zh'), chinese, 'Repeated rendering is idempotent.');
  const english = elements(renderPlatformLocale(chinese, 'en'));
  assert.equal(text(english.find(n => n.tagName === 'p')), 'English & text');
  assert.equal(attr(english.find(n => n.tagName === 'main'), 'aria-label'), 'Settings navigation');
  assert.equal(attr(english.find(n => n.tagName === 'option' && attr(n, 'value') === 'en'), 'selected'), '');
});
