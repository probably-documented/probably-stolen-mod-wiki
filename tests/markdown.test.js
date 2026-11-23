'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { mdToHtml } = require('../tools/build/markdown.js');

// Ruled signature: mdToHtml(mdText, lookup, renderInline) -> {html, toc}
// T6 never owns the card template; renderInline is injected by the caller.
function makeCtx(items = []) {
  const map = new Map(items.map((it) => [it.id, it]));
  const calls = [];
  return {
    lookup: (id) => (map.has(id) ? map.get(id) : null),
    renderInline: (item) => {
      calls.push(item.id);
      return `<span class="item-inline" data-item-id="${item.id}">${item.name}</span>`;
    },
    calls,
  };
}

test('mdToHtml has the ruled signature and returns {html, toc}', () => {
  assert.equal(typeof mdToHtml, 'function');
  const { html, toc } = mdToHtml('plain text', () => null, () => '');
  assert.equal(html, '<p>plain text</p>');
  assert.deepEqual(toc, []);
});

test('ATX headings get slug ids and feed the toc', () => {
  const ctx = makeCtx();
  const md = ['## 基础机制', '', '### 获取途径', '', '## 基础机制'].join('\n');
  const { html, toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<h2 id="基础机制">基础机制</h2>'), 'h2 with slug id');
  assert.ok(html.includes('<h3 id="获取途径">获取途径</h3>'), 'h3 with slug id');
  assert.ok(html.includes('<h2 id="基础机制-2">基础机制</h2>'), 'duplicate heading gets -2 suffix');

  assert.deepEqual(toc, [
    { id: '基础机制', level: 2, title: '基础机制' },
    { id: '获取途径', level: 3, title: '获取途径' },
    { id: '基础机制-2', level: 2, title: '基础机制' },
  ]);
});

test('slug rules: lowercase, whitespace to dash, punctuation stripped, CJK kept', () => {
  const ctx = makeCtx();
  const md = ['## Cooking & Recipes', '', '## 获取与合成！', '', '## FAQ (v2)'].join('\n');
  const { toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.deepEqual(toc.map((entry) => entry.id), ['cooking-recipes', '获取与合成', 'faq-v2']);
});

test('GFM pipe table renders with alignment and expands wikilinks in cells', () => {
  const ctx = makeCtx([
    { id: 'wondrous_milk', name: '神奇乳汁' },
    { id: 'milk_rich', name: '浓稠乳汁' },
  ]);
  const md = [
    '| 物品 | 价格 | 来源 |',
    '|:---|---:|:---:|',
    '| [[wondrous_milk]] | 80 | 暗流交易 |',
    '| [[milk_rich]] | 150 | 暗流交易 |',
    '| [[ghost_item]] | 0 | 不存在 |',
  ].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<table>'), 'table rendered');
  assert.equal((html.match(/<th\b/g) || []).length, 3, 'three header cells');
  assert.equal((html.match(/<td>/g) || []).length, 9, 'three body rows x three columns');
  assert.ok(html.includes('<th style="text-align:left">物品</th>'), 'left alignment');
  assert.ok(html.includes('<th style="text-align:right">价格</th>'), 'right alignment');
  assert.ok(html.includes('<th style="text-align:center">来源</th>'), 'center alignment');
  // Wikilinks inside cells are expanded through lookup + renderInline.
  assert.ok(html.includes('<span class="item-inline" data-item-id="wondrous_milk">神奇乳汁</span>'));
  assert.ok(html.includes('<span class="wikilink-missing">[[ghost_item]]</span>'));
  assert.deepEqual(ctx.calls, ['wondrous_milk', 'milk_rich']);
});

test('[[id]] resolves through lookup and renderInline produces the card html', () => {
  const ctx = makeCtx([{ id: 'wondrous_milk', name: '神奇乳汁' }]);
  const { html } = mdToHtml('喝 [[wondrous_milk]] 变强。', ctx.lookup, ctx.renderInline);

  assert.ok(
    html.includes('<span class="item-inline" data-item-id="wondrous_milk">神奇乳汁</span>'),
    'card html injected verbatim',
  );
  assert.ok(html.includes('<p>喝  变强。</p>') === false, 'wikilink replaced, not kept as text');
  assert.deepEqual(ctx.calls, ['wondrous_milk'], 'renderInline called exactly once');
});

test('unknown id renders wikilink-missing span without calling renderInline', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('试试 [[不存在id]] 的效果。', ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<span class="wikilink-missing">[[不存在id]]</span>'));
  assert.deepEqual(ctx.calls, [], 'renderInline must not be called when lookup misses');
});

test('ordered and unordered lists with 2-space nesting', () => {
  const ctx = makeCtx();
  const md = [
    '- 顶层一',
    '  - 子项 a',
    '  - 子项 b',
    '- 顶层二',
    '',
    '1. 第一步',
    '2. 第二步',
    '',
    '- 外层',
    '  1. 内层有序',
  ].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(
    html.includes('<ul><li>顶层一<ul><li>子项 a</li><li>子项 b</li></ul></li><li>顶层二</li></ul>'),
    'nested ul: child list sits inside the parent li',
  );
  assert.ok(html.includes('<ol><li>第一步</li><li>第二步</li></ol>'), 'ordered list');
  assert.ok(
    html.includes('<ul><li>外层<ol><li>内层有序</li></ol></li></ul>'),
    'unordered nesting an ordered list',
  );
});

test('raw html in prose is escaped to prevent injection', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('恶意 <script>alert(1)</script> 内容', ctx.lookup, ctx.renderInline);

  assert.equal(html.includes('<script>'), false, 'no raw script tag in output');
  assert.ok(html.includes('&lt;script&gt;'), 'angle brackets escaped');
});

test('bold, italic and inline code; code spans skip inner markdown', () => {
  const ctx = makeCtx([{ id: 'wondrous_milk', name: '神奇乳汁' }]);
  const md = '这是 **粗体** 与 *斜体* 与 `代码 **不加粗** [[wondrous_milk]] a<b`';
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<strong>粗体</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.ok(html.includes('<code>代码 **不加粗** [[wondrous_milk]] a&lt;b</code>'), 'code span verbatim + escaped');
  assert.deepEqual(ctx.calls, [], 'no wikilink resolution inside code spans');
});

test('paragraph merging: single newline joins, blank line splits', () => {
  const ctx = makeCtx();
  const md = ['第一行', '第二行', '', '第二段。', '继续第二段。'].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<p>第一行第二行</p>'), 'CJK lines merge without spaces');
  assert.ok(html.includes('<p>第二段。继续第二段。</p>'), 'two paragraphs, each merged');

  const latin = mdToHtml('call setup\nthen run', ctx.lookup, ctx.renderInline).html;
  assert.ok(latin.includes('<p>call setup then run</p>'), 'latin words keep a space at the join');
});

test('unsupported syntax (blockquote) is kept as escaped text without crashing', () => {
  const ctx = makeCtx();
  const md = '> 这是一段引用\n> 第二行';
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('&gt; 这是一段引用'), 'blockquote marker kept as text');
  assert.equal(html.includes('<blockquote>'), false, 'no blockquote element emitted');
});

test('anchor links render as <a> elements', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('见 [合成表](#合成表) 说明。', ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<a href="#合成表">合成表</a>'));
});

// ===== ```html passthrough fences =====

test('```html fence passes its content through as raw, unescaped html', () => {
  const ctx = makeCtx();
  const md = [
    '前文',
    '',
    '```html ',
    '<div class="flow-chart">',
    '  <div class="flow-node">节点</div>',
    '</div>',
    '```',
    '',
    '后文',
  ].join('\n');
  const { html, toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(
    html.includes('<div class="flow-chart">\n  <div class="flow-node">节点</div>\n</div>'),
    'fence body inserted verbatim, line breaks kept',
  );
  assert.equal(html.includes('&lt;div'), false, 'no html escaping inside the fence');
  assert.equal(html.includes('<code>'), false, 'no markdown parsing inside the fence');
  assert.deepEqual(toc, [], 'fence contributes nothing to the toc');
});

test('text before and after a closed ```html fence parses as markdown normally', () => {
  const ctx = makeCtx([{ id: 'wondrous_milk', name: '神奇乳汁' }]);
  const md = [
    '段落一 [[wondrous_milk]]',
    '',
    '```html',
    '<div>RAW</div>',
    '```',
    '',
    '## 小节',
    '',
    '- 列表项',
  ].join('\n');
  const { html, toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(
    html.includes('<p>段落一 <span class="item-inline" data-item-id="wondrous_milk">神奇乳汁</span></p>'),
    'markdown before the fence still resolves wikilinks',
  );
  assert.ok(html.includes('<div>RAW</div>'), 'fence body verbatim between them');
  assert.ok(html.includes('<h2 id="小节">小节</h2>'), 'heading after the fence parses');
  assert.ok(html.includes('<li>列表项</li>'), 'list after the fence parses');
  assert.deepEqual(toc, [{ id: '小节', level: 2, title: '小节' }]);
});

test('unterminated ```html fence falls back to plain text without eating the document', () => {
  const ctx = makeCtx();
  const md = ['之前', '', '```html', '<div>没闭合', '', '之后正文', '', '## 尾部'].join('\n');
  const { html, toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('&lt;div&gt;没闭合'), 'fence body survives as escaped plain text');
  assert.ok(html.includes('<p>之后正文</p>'), 'paragraph after the broken fence survives');
  assert.ok(html.includes('<h2 id="尾部">尾部</h2>'), 'rest of the document parses');
  assert.deepEqual(toc, [{ id: '尾部', level: 2, title: '尾部' }]);
});

test('bare ``` fence (no html tag) keeps the status quo: text, not passthrough', () => {
  const ctx = makeCtx();
  const md = ['```', '<div>x</div>', '```', '', '正文'].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.equal(html.includes('<div>x</div>'), false, 'not passed through as raw html');
  assert.ok(html.includes('&lt;div&gt;'), 'escaped as plain text like before');
  assert.ok(html.includes('<p>正文</p>'), 'document continues after it');
});

test('a ```js line inside an ```html fence is content, not a closer', () => {
  const ctx = makeCtx();
  const md = [
    '```html',
    '<div>',
    '```js',
    'const x = 1',
    '</div>',
    '```',
    '',
    '尾段',
  ].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('```js\nconst x = 1\n</div>'), 'only a bare ``` closes the fence');
  assert.ok(html.includes('<p>尾段</p>'), 'document after the real closer parses');
});

test('a ```html line with trailing text is not a fence opener', () => {
  const ctx = makeCtx();
  const md = ['```html 不是围栏', '', '正文'].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('```html 不是围栏'), 'line kept as ordinary text');
  assert.ok(html.includes('<p>正文</p>'), 'rest of the document unaffected');
});

test('empty input yields empty output', () => {
  const ctx = makeCtx();
  const { html, toc } = mdToHtml('', ctx.lookup, ctx.renderInline);
  assert.equal(html, '');
  assert.deepEqual(toc, []);
});

// ===== B1 (task 6b): external links open in a new tab =====
//
// 站长裁决(2026-11-23):正文里允许外部链接。它们带 target="_blank" 与
// rel="noopener noreferrer"(与 templates.js 页脚署名的写法一致);站内链接、
// 锚点与 mailto 保持原样。

test('B1 — 外部链接(http/https)带 target="_blank" rel="noopener noreferrer";站内相对链接、锚点、mailto 不带', () => {
  const ctx = makeCtx();
  const md = [
    '见 [外链](https://example.com/a) 与 [另一个](http://example.org/b)。',
    '',
    '[站内](../items.html) [锚点](#合成表) [邮件](mailto:someone@example.com)',
  ].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">外链</a>'),
    'an https link carries the two attributes, in this order');
  assert.ok(html.includes('<a href="http://example.org/b" target="_blank" rel="noopener noreferrer">另一个</a>'),
    'an http link too');
  assert.equal((html.match(/ target="_blank" rel="noopener noreferrer"/g) || []).length, 2,
    'exactly the two external links carry them');
  assert.ok(html.includes('<a href="../items.html">站内</a>'), 'a site-relative link carries neither');
  assert.ok(html.includes('<a href="#合成表">锚点</a>'), 'a fragment link carries neither');
  assert.ok(html.includes('<a href="mailto:someone@example.com">邮件</a>'), 'mailto is not an external http(s) link');
});

test('B1 — 大小写不敏感的 HTTP(S) 方案、带查询串与片段的外链同样处理;属性写法不受 href 内容影响', () => {
  const ctx = makeCtx();
  const md = '[大写](HTTPS://example.com/x) [查询](https://example.com/p?a=1&b=2#frag) [形似外链](httpsx://example.com/)';
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);

  assert.ok(html.includes('<a href="HTTPS://example.com/x" target="_blank" rel="noopener noreferrer">大写</a>'), 'the scheme is case-insensitive, the href is left as written');
  assert.ok(html.includes('<a href="https://example.com/p?a=1&amp;b=2#frag" target="_blank" rel="noopener noreferrer">查询</a>'), 'the href stays escaped, the attributes follow it');
  assert.ok(html.includes('<a href="httpsx://example.com/">形似外链</a>'), 'not an http(s) URL: no attributes');
});

test('B3 — ```html 直通块里手写的 <a> 原样输出,不经 mdToHtml 改写、不加属性', () => {
  const ctx = makeCtx();
  const md = [
    '```html',
    '<a href="https://example.com/raw">手写外链</a>',
    '<a class="x" href="https://example.com/y">另一个</a>',
    '```',
  ].join('\n');
  const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);
  assert.equal(html, '<a href="https://example.com/raw">手写外链</a>\n<a class="x" href="https://example.com/y">另一个</a>');
});

// ===== B4 (task 6b, ruling Z): image syntax =====
//
// ![替代文字](地址 "可选标题") → <img src="地址" alt="替代文字">, plus a title
// attribute when one is given. The address is kept exactly as written; what
// may be loaded is the audit's decision (audit.js reports a https:// image in
// Chinese and fails the build). Same boundaries as links: not parsed inside
// `code` spans, and a ```html block is passed through untouched.

test('B4 — 基本写法 ![替代文字](地址) → <img src="…" alt="…">;地址原样保留;不进目录', () => {
  const ctx = makeCtx();
  const md = '前 ![示意图](../assets/a.png) 后';
  const { html, toc } = mdToHtml(md, ctx.lookup, ctx.renderInline);
  assert.equal(html, '<p>前 <img src="../assets/a.png" alt="示意图"> 后</p>');
  assert.deepEqual(toc, []);
  assert.ok(!html.includes('<a '), 'an image is not a link');
});

test('B4 — 带标题 ![a](x.png "标题") → 加 title 属性;顺序 src、alt、title', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('![示意图](a.png "一张示意图")', ctx.lookup, ctx.renderInline);
  assert.equal(html, '<p><img src="a.png" alt="示意图" title="一张示意图"></p>');
  // a title may hold a closing parenthesis, and does not become part of the address
  const titled = mdToHtml('![a](a.png "标题) 还在")', ctx.lookup, ctx.renderInline).html;
  assert.equal(titled, '<p><img src="a.png" alt="a" title="标题) 还在"></p>');
});

test('B4 — 替代文字与标题里需要转义的字符被转义;一个引号不会截断属性、变成别的属性', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('![a <b> & "c"](x.png "t <i> & \'q\'")', ctx.lookup, ctx.renderInline);
  assert.equal(html, '<p><img src="x.png" alt="a &lt;b&gt; &amp; &quot;c&quot;" title="t &lt;i&gt; &amp; \'q\'"></p>');
  // the injection shape: the quote must not open an attribute
  const injected = mdToHtml('![a" onerror="alert(1)](x.png)', ctx.lookup, ctx.renderInline).html;
  assert.equal(injected, '<p><img src="x.png" alt="a&quot; onerror=&quot;alert(1)"></p>');
  assert.ok(!/ onerror="/.test(injected), 'no real onerror attribute in the output');
  // a quote inside the address cannot get out of src either
  assert.equal(mdToHtml('![a](x"y.png)', ctx.lookup, ctx.renderInline).html, '<p><img src="x%22y.png" alt="a"></p>');
});

test('B4 — 地址是外部网址时原样输出 <img src="https://…">(随后由构建的审计拦截),不带链接的 target/rel', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('![图](https://example.com/x.png)', ctx.lookup, ctx.renderInline);
  assert.equal(html, '<p><img src="https://example.com/x.png" alt="图"></p>');
  assert.equal(mdToHtml('![图](//cdn.example.com/x.png)', ctx.lookup, ctx.renderInline).html, '<p><img src="//cdn.example.com/x.png" alt="图"></p>');
  assert.equal(mdToHtml('![图](/assets/x.png)', ctx.lookup, ctx.renderInline).html, '<p><img src="/assets/x.png" alt="图"></p>');
});

test('B4 — `![` 出现在代码段里不解析', () => {
  const ctx = makeCtx();
  const { html } = mdToHtml('写法是 `![a](x.png)`,就这样。', ctx.lookup, ctx.renderInline);
  assert.equal(html, '<p>写法是 <code>![a](x.png)</code>,就这样。</p>');
});

test('B4 — ```html 直通块里的 ![…](…) 不解析:直通块原样输出', () => {
  const ctx = makeCtx();
  const md = ['```html', '<p>![a](x.png)</p>', '```'].join('\n');
  assert.equal(mdToHtml(md, ctx.lookup, ctx.renderInline).html, '<p>![a](x.png)</p>');
});

test('B4 — 图片嵌在链接里的常见写法 [![a](x.png)](page.html)', () => {
  const ctx = makeCtx();
  assert.equal(mdToHtml('[![a](x.png)](page.html)', ctx.lookup, ctx.renderInline).html,
    '<p><a href="page.html"><img src="x.png" alt="a"></a></p>');
  // an external link around it keeps its own two attributes; the image stays as written
  assert.equal(mdToHtml('[![a](https://cdn.example.com/x.png)](https://example.com)', ctx.lookup, ctx.renderInline).html,
    '<p><a href="https://example.com" target="_blank" rel="noopener noreferrer"><img src="https://cdn.example.com/x.png" alt="a"></a></p>');
  // …and inside a list item or a table cell it behaves the same: both go through the inline renderer
  assert.equal(mdToHtml('- [![a](x.png)](page.html)', ctx.lookup, ctx.renderInline).html,
    '<ul><li><a href="page.html"><img src="x.png" alt="a"></a></li></ul>');
  const inTable = mdToHtml('| 图 |\n|---|\n| [![a](x.png)](page.html) |', ctx.lookup, ctx.renderInline).html;
  assert.ok(inTable.includes('<td><a href="page.html"><img src="x.png" alt="a"></a></td>'), inTable);
});

test('B4 — 不带 ! 的链接照旧;两段图片相邻各自成图', () => {
  const ctx = makeCtx();
  assert.equal(mdToHtml('[a](x.png)', ctx.lookup, ctx.renderInline).html, '<p><a href="x.png">a</a></p>');
  assert.equal(mdToHtml('![a](x.png)![b](y.png)', ctx.lookup, ctx.renderInline).html,
    '<p><img src="x.png" alt="a"><img src="y.png" alt="b"></p>');
});

test('B4 — 替代文字为空;替代文字里的内联标记保持原样、不被再解析', () => {
  const ctx = makeCtx([{ id: 'wondrous_milk', name: '神奇乳汁' }]);
  assert.equal(mdToHtml('![](x.png)', ctx.lookup, ctx.renderInline).html, '<p><img src="x.png" alt=""></p>');
  assert.equal(mdToHtml('![**粗** 和 *斜*](x.png)', ctx.lookup, ctx.renderInline).html,
    '<p><img src="x.png" alt="**粗** 和 *斜*"></p>');
  assert.deepEqual(ctx.calls, [], 'nothing inside an alt text is looked up or emphasised');
  // The same limit as for links: a `]` inside the alt text ends it, so the
  // whole thing stays as written — including a [[wikilink]], which has two.
  const bracketed = mdToHtml('![a [b]](x.png)', ctx.lookup, ctx.renderInline).html;
  assert.ok(bracketed.includes('![a [b]](x.png)'), bracketed);
  assert.deepEqual(ctx.calls, []);
});

test('B4 — 不支持的写法保持原样,不猜:单引号标题、带空格的地址、缺右括号', () => {
  const ctx = makeCtx();
  for (const md of ["![a](x.png '标题')", '![a](x y.png)', '![a](x.png', '![a [b]](x.png)']) {
    const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);
    assert.ok(!html.includes('<img'), `${md}: not an image`);
    assert.ok(html.includes(md), `${md}: kept as written`);
  }
});

// ===== review Important 2 (of 2c486cd): code spans inside an image =====
//
// A `code` span is set aside as a placeholder while the line is rendered, and
// put back at the very end. An image is set aside too — as a whole tag — so
// the placeholder inside its alt text, title or address was never put back:
// it stayed in the page as a NUL character (and an address holding one made
// the dangling-link check report a target with a NUL in its name). In an
// attribute the code span is plain text; in the text of a link it is still
// a code span.

test('review Important 2 — a code span in an image\'s alt text, title or address is plain text there: no placeholder is left in the page (the reviewer\'s two)', () => {
  const ctx = makeCtx();
  assert.equal(mdToHtml('![a `b` c](x.png)', ctx.lookup, ctx.renderInline).html, '<p><img src="x.png" alt="a b c"></p>');
  assert.equal(mdToHtml('![a](`x.png`)', ctx.lookup, ctx.renderInline).html, '<p><img src="x.png" alt="a"></p>');
  assert.equal(mdToHtml('![a](x.png "t `b` t")', ctx.lookup, ctx.renderInline).html, '<p><img src="x.png" alt="a" title="t b t"></p>');
  assert.equal(mdToHtml('[![`a`](x.png)](`p.html`)', ctx.lookup, ctx.renderInline).html, '<p><a href="p.html"><img src="x.png" alt="a"></a></p>');
  // …and the characters of the code span are escaped as in any attribute
  assert.equal(mdToHtml('![`a<b & "c"`](x.png)', ctx.lookup, ctx.renderInline).html,
    '<p><img src="x.png" alt="a&lt;b &amp; &quot;c&quot;"></p>');
  for (const md of ['![a `b` c](x.png)', '![a](`x.png`)', '![a](x.png "t `b` t")', '[![`a`](x.png)](`p.html`)']) {
    const { html } = mdToHtml(md, ctx.lookup, ctx.renderInline);
    assert.ok(!html.includes('\u0000'), `${md}: the page holds no placeholder character`);
    assert.ok(!/<img[^>]*<code>/.test(html), `${md}: no markup inside the attribute`);
  }
});

test('review Important 2 — the same code span in the address of a link: plain text in href, a code span in the link text', () => {
  const ctx = makeCtx();
  // the link is not set aside, so its placeholder used to be put back — as markup, inside href
  assert.equal(mdToHtml('[a](`x.html`)', ctx.lookup, ctx.renderInline).html, '<p><a href="x.html">a</a></p>');
  assert.equal(mdToHtml('[a](`https://example.com/`)', ctx.lookup, ctx.renderInline).html,
    '<p><a href="https://example.com/" target="_blank" rel="noopener noreferrer">a</a></p>');
  assert.equal(mdToHtml('[a `b` c](`x.html`)', ctx.lookup, ctx.renderInline).html, '<p><a href="x.html">a <code>b</code> c</a></p>');
});
