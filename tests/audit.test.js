'use strict';

// Task 6b A tests: tools/build/audit.js — the site audit.
//
// Two rulings of 2026-11-23 shape the rules:
//   外链政策 B — external links in the body are allowed; loading external
//                resources is still forbidden.
//   Ruling T   — ```html blocks can be written by any contributor once the CMS
//                is online, so obviously dangerous HTML is refused at build.
//
// What is pinned here, per requirement:
//   A1  <a href="http(s)://…"> is allowed, with no whitelist any more
//   A2  src="http(s)://…", <link href="http(s)://…"> (any non-<a> http href),
//       protocol-relative src/href, CSS url(http…) / url(//…), fetch(, XMLHttpRequest
//   A3  root-relative href="/…", src="/…", CSS url(/…)
//   A4  *.html only: executable inline <script>, <script src> outside the
//       first-party list, on<name>= attributes, javascript:/vbscript: URLs,
//       <base>, <meta http-equiv>, srcdoc
//   A5  .js / .css are build output: A4 does not apply to them, A2 and A3 do
//   A6  the shape: an array of { file, line, code, detail }, sorted by file
//       then position
//
// Every case builds a throwaway directory and audits it — nothing here reads
// the real dist/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const auditModule = require('../tools/build/audit.js');
const { auditExternalLinks } = auditModule;

let counter = 0;

async function tmpDir(t) {
  counter += 1;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `audit-${counter}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/** Writes `files` ({ '<posix rel path>': text }) into a fresh directory and audits it. */
async function auditOf(t, files) {
  const dir = await tmpDir(t);
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(dir, ...rel.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text);
  }
  return auditExternalLinks(dir);
}

/** `file:line [code]` per violation — what the assertions compare. */
const brief = (violations) => violations.map((v) => `${v.file}:${v.line} [${v.code}]`);

const HTML = 'index.html';
const page = (...lines) => lines.join('\n');

// ---------------------------------------------------------------------------
// A6 — the shape
// ---------------------------------------------------------------------------

test('A6 — returns an array of { file, line, code, detail }, sorted by file then position; paths are relative and posix', async (t) => {
  const violations = await auditOf(t, {
    'z-last.html': '<img src="https://evil.example/a.png"/>\n<p>ok</p>\n<img src="https://evil.example/b.png"/>',
    'a-first.html': '<a href="/index.html">x</a>',
    'css/theme.css': 'a{background:url(https://evil.example/c.png)}',
    'img/logo.png': 'not scanned: not html/js/css',
  });

  assert.deepEqual(violations.map((v) => `${v.file}:${v.line} [${v.code}]`), [
    'a-first.html:1 [href-root-relative]',
    'css/theme.css:1 [css-url-http]',
    'z-last.html:1 [src-http]',
    'z-last.html:3 [src-http]',
  ]);
  for (const v of violations) {
    assert.deepEqual(Object.keys(v).sort(), ['code', 'detail', 'file', 'line'], `keys of ${JSON.stringify(v)}`);
    assert.equal(typeof v.file, 'string');
    assert.ok(Number.isInteger(v.line) && v.line >= 1, `line is 1-based, got ${v.line}`);
    assert.equal(typeof v.code, 'string');
    assert.ok(typeof v.detail === 'string' && v.detail.length > 0 && v.detail.length <= 160, `detail is a non-empty snippet of at most 160 characters, got ${JSON.stringify(v.detail)}`);
  }
  assert.ok(violations[1].detail.includes('url(https://evil.example/c.png)'), 'detail shows the offending text');
  assert.ok(violations[2].detail.includes('src="https://evil.example/a.png"'), '…of the offending tag');
});

test('A6 — an empty directory, a directory without html/js/css, or a directory that does not exist: no violations', async (t) => {
  assert.deepEqual(await auditOf(t, {}), []);
  assert.deepEqual(await auditOf(t, { 'img/logo.png': 'x', 'README.md': '# hi' }), []);
  assert.deepEqual(await auditExternalLinks(path.join(await tmpDir(t), 'no-such-dir')), []);
});

// ---------------------------------------------------------------------------
// A1 — external links are allowed
// ---------------------------------------------------------------------------

test('A1 — <a href="http(s)://…"> is an external link and allowed: no whitelist, any quoting, any case, a tag across lines', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<!DOCTYPE html>',
      '<p>见 <a href="https://example.com/a">外链</a>、<a href="http://example.org/b">另一个</a>。</p>',
      '<p><a target="_blank" rel="noopener noreferrer" href="https://wiki.biligame.com/probablystolen">深空当铺 BWIKI</a>(CC BY-NC-SA 4.0)</p>',
      "<a href='https://example.com/single'>单引号</a> <a href=https://example.com/bare>无引号</a> <A HREF=\"HTTPS://EXAMPLE.COM/UPPER\">大写</A>",
      '<a\n  href="https://example.com/multiline">跨行</a>',
      '<svg><a href="https://example.com/svg"><text>svg 里的 a</text></a></svg>',
      '<a href=" https://example.com/padded ">前后空白</a>',
      '<a href="https://example.com/?q=1&amp;r=2#frag">查询串</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('A1 — the footer credit needs no special whitelist any more: audit.js does not export one', () => {
  assert.equal('BWIKI_CREDIT_URL' in auditModule, false, 'BWIKI_CREDIT_URL is gone from the audit module');
});

// ---------------------------------------------------------------------------
// A2 — loading external resources stays forbidden
// ---------------------------------------------------------------------------

test('A2 — src="http(s)://…" on any element is a violation (src-http)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img src="https://evil.example/x.png" alt=""/>',
      '<iframe src="http://evil.example"></iframe>',
      '<video src="https://evil.example/v.mp4"></video>',
      '<embed src="https://evil.example/e"/>',
      '<IMG SRC=\'https://evil.example/upper.png\'>',
      '<img\n  src="https://evil.example/multiline.png">',
      '<script src="https://evil.example/x.js"></script>',
      '<audio src="https://evil.example.com/a.mp3"></audio>',
    ),
  });
  // Line 6 holds a tag that spans lines 6–7, so the next tags sit on 8 and 9.
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [src-http]`,
    `${HTML}:2 [src-http]`,
    `${HTML}:3 [src-http]`,
    `${HTML}:4 [src-http]`,
    `${HTML}:5 [src-http]`,
    `${HTML}:6 [src-http]`, // a tag that spans lines is reported where it starts
    `${HTML}:8 [src-http]`,
    `${HTML}:9 [src-http]`,
  ]);
});

test('A2 — a <script src> to an outside URL is reported once, as the external resource it is', async (t) => {
  const violations = await auditOf(t, { [HTML]: '<script src="https://evil.example/x.js"></script>' });
  assert.deepEqual(brief(violations), [`${HTML}:1 [src-http]`], 'src-http, and not a second script-src line for the same tag');
});

test('A2 — <link href="http(s)://…"> is a violation, and so is an http(s) href on any other element that is not <a> (href-http)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<link rel="stylesheet" href="https://evil.example/x.css"/>',
      '<link rel="icon" href="https://evil.example/favicon.ico">',
      '<area href="https://evil.example/map"/>',
      '<use href="https://evil.example/s.svg#a"/>',
      '<image href="https://evil.example/i.png"/>',
      '<a href="https://example.com/fine">a link is fine</a>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5].map((n) => `${HTML}:${n} [href-http]`));
});

test('A2 — CSS url(http…) is a violation (css-url-http): in a <style> block, in a style attribute, in a .css file', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<style>',
      'a{background:url(https://evil.example/a.png)}',
      'b{background:url( "https://evil.example/b.png" )}',
      '</style>',
      '<div style="background:url(\'https://evil.example/c.png\')"></div>',
      '<div style="color:red">no url here</div>',
    ),
    'css/theme.css': '@font-face{src:url(https://evil.example/f.woff2) format("woff2")}',
  });
  assert.deepEqual(brief(violations), [
    'css/theme.css:1 [css-url-http]',
    `${HTML}:2 [css-url-http]`,
    `${HTML}:3 [css-url-http]`,
    `${HTML}:5 [css-url-http]`,
  ]);
});

test('A2 — protocol-relative references (src="//…", href="//…", url(//…)) are external resources and violations', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img src="//cdn.example.com/x.png"/>',
      '<a href="//example.com/x">a link does not get a pass either</a>',
      '<link rel="stylesheet" href="//cdn.example.com/x.css"/>',
      '<style>a{background:url(//cdn.example.com/x.png)}</style>',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [src-protocol-relative]`,
    `${HTML}:2 [href-protocol-relative]`,
    `${HTML}:3 [href-protocol-relative]`,
    `${HTML}:4 [css-url-protocol-relative]`,
  ]);
});

test('A2 — a fetch( call and XMLHttpRequest are violations, in a page, in a script, in a stylesheet', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<p>fetch( in running text counts too</p>\n<p>and so does XMLHttpRequest</p>',
    'assets/js/x.js': 'window.fetch ("/x");\nfunction prefetch(x) {}\nnew XMLHttpRequest();',
    'css/theme.css': '/* a stylesheet is not expected to call fetch( — counted anyway */',
  });
  assert.deepEqual(brief(violations), [
    'assets/js/x.js:1 [fetch]',
    'assets/js/x.js:3 [xhr]', // prefetch( is not fetch(
    'css/theme.css:1 [fetch]',
    `${HTML}:1 [fetch]`,
    `${HTML}:2 [xhr]`,
  ]);
});

// ---------------------------------------------------------------------------
// A3 — root-relative paths
// ---------------------------------------------------------------------------

test('A3 — root-relative href="/…", src="/…" and CSS url(/…) are violations: dead under file://, wrong on a GitHub Pages project site', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="/index.html">首页</a>',
      '<img src="/assets/x.png"/>',
      '<link rel="stylesheet" href="/css/theme.css"/>',
      '<script src="/assets/js/x.js"></script>',
      '<style>a{background:url(/assets/x.png)}</style>',
      '<div style="background:url( /assets/y.png )"></div>',
      "<a href=' /single-quoted '>quotes do not help</a>",
    ),
    'css/theme.css': 'a{background:url(/x.png)}',
  });
  assert.deepEqual(brief(violations), [
    'css/theme.css:1 [css-url-root-relative]',
    `${HTML}:1 [href-root-relative]`,
    `${HTML}:2 [src-root-relative]`,
    `${HTML}:3 [href-root-relative]`,
    `${HTML}:4 [src-root-relative]`,
    `${HTML}:5 [css-url-root-relative]`,
    `${HTML}:6 [css-url-root-relative]`,
    `${HTML}:7 [href-root-relative]`,
  ]);
});

test('A3 — site-relative paths, fragments, query strings and data: URLs are not root-relative (nothing reported)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="items.html">a</a> <a href="../items.html">b</a> <a href="#x">c</a> <a href="?q=1">d</a> <a href="">e</a>',
      '<img src="assets/a.png"/> <img src="../assets/b.png"/> <img src="./c.png"/>',
      '<style>a{background:url(data:image/png;base64,AAAA)} b{fill:url(#grad)} c{background:url()}</style>',
      '<a href="https://example.com/a/b">an external link is not root-relative either</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// A4 — dangerous HTML in *.html
// ---------------------------------------------------------------------------

test('A4 — an executable inline <script> is always a violation (script-inline): any case, any JS type, a tag across lines, an unclosed one', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script>alert(1)</script>',
      '<SCRIPT>alert(2)</SCRIPT>',
      '<script type="text/javascript">alert(3)</script>',
      '<script type="application/javascript; charset=utf-8">alert(4)</script>',
      '<script type="module">alert(5)</script>',
      '<script type="">alert(6)</script>',
      '<script\n  id="x">alert(7)</script>',
      '<script type="text/vbscript">MsgBox 8</script>',
      '<script',
    ),
  });
  // The tag written on line 7 spans lines 7–8, so the last two sit on 9 and 10.
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6, 7, 9, 10].map((n) => `${HTML}:${n} [script-inline]`));
});

test('A4 — a script block whose type is not executable is a data block and is allowed; its content is not read as markup', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="application/json">{"a": 1}</script>',
      '<script type="application/ld+json">{"@context": "https://schema.org", "url": "https://example.com/x"}</script>',
      '<script type="importmap">{"imports": {"x": "/x.js"}}</script>',
      '<script type="text/template"><div onclick="x()">&amp;</div></script>',
      '<script type=\'APPLICATION/JSON\'>{}</script>',
      '<script type="text/plain">not a script to any browser</script>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('A4 — a script block ends at its first </script> for the audit — a browser keeps going past a nested <script> after <!--, so this one case is over-reported, on the safe side', async (t) => {
  // To a browser the whole element below is one (non-executable) data block:
  // after `<!--` a nested `<script>` puts it in the double-escaped state,
  // where the first </script> does not close it. The audit stops there and
  // reads on as markup, so the <img onerror> it then sees is reported.
  const violations = await auditOf(t, {
    [HTML]: '<script type="application/json"><!-- <script></script><img src=x onerror=alert(1)> --></script>',
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [inline-event-handler]`]);
});

test('A4 — a data block ends at its </script>; what follows is read as markup again', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<script type="application/json">{"a": "</script><script>alert(1)</script>"}</script>',
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [script-inline]`]);
});

test('A4 — <script src>: only the three scripts the first-party templates load are allowed, everything else is a violation (script-src)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script src="data.js"></script>',
      '<script src="assets/js/search.js"></script>',
      '<script src="assets/js/item-filter.js"></script>',
      '<script src="evil.js"></script>',
      '<script src="./data.js"></script>',
      '<script src="assets/js/other.js"></script>',
      '<script src=""></script>',
      '<script src="HTTPS://evil.example/x.js"></script>',
      '<script src="//evil.example/x.js"></script>',
      '<script src="/x.js"></script>',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:4 [script-src]`,
    `${HTML}:5 [script-src]`, // the list holds exact values
    `${HTML}:6 [script-src]`,
    `${HTML}:7 [script-src]`,
    `${HTML}:8 [src-http]`, // an outside URL is the external resource it is
    `${HTML}:9 [src-protocol-relative]`,
    `${HTML}:10 [src-root-relative]`,
  ]);
});

test('A4 — the allowed <script src> list is exactly what the first-party templates write', () => {
  assert.deepEqual([...auditModule.ALLOWED_SCRIPT_SRC], ['assets/js/item-filter.js', 'assets/js/search.js', 'data.js']);
});

test('A4 — an inline event attribute on<name>= is a violation (inline-event-handler): quoted or not, any case, spaces around =, after a slash, without a value', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div onclick="alert(1)">a</div>',
      '<img src="x.png" onerror=alert(1)>',
      '<body onload = "init()">',
      '<a href="x.html" ONMOUSEOVER="y()">c</a>',
      '<div/onclick="z()">d</div>',
      '<p onfoo>e</p>',
      '<div\n  onfocus="f()">across lines</div>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6, 7].map((n) => `${HTML}:${n} [inline-event-handler]`));
});

test('A4 — what is not an event attribute is not reported: data-* names, words in an ordinary attribute, running text, escaped sample code', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div data-onclick="x"></div>',
      '<p class="btn on hover" title="button">the word on</p>',
      '<p>不要写 onclick= 这种属性</p>',
      '<code>&lt;div onclick=x&gt;</code>',
      '<p>javascript: 是一种 URL 方案;onload= 是事件属性</p>',
      '<a href="items.html" title="only">a site-relative link</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('A4 — a javascript: or vbscript: URL is a violation (script-url): any case, leading blanks, embedded tabs, character references, unquoted', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="javascript:alert(1)">a</a>',
      '<a href="JaVaScRiPt:alert(1)">b</a>',
      '<a href="  javascript:alert(1)">c</a>',
      '<a href="java\tscript:alert(1)">d</a>',
      '<a href="java&#x09;script:alert(1)">e</a>',
      '<a href="&#106;avascript:alert(1)">f</a>',
      '<a href=javascript:alert(1)>g</a>',
      '<form action="javascript:alert(1)"></form>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<a href="vbscript:msgbox(1)">h</a>',
      '<a href="javascript&colon;alert(1)">i</a>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => `${HTML}:${n} [script-url]`));
});

test('A4 — javascript: as text, or inside a longer URL, is not a javascript: URL', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<code>javascript:alert(1)</code>',
      '<p>javascript: 是一种 URL 方案</p>',
      '<a href="https://example.com/?q=javascript:x">not at the start</a>',
      '<a href="item/javascript.html">a path that merely contains the word</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('A4 — a <base> tag is a violation (base-tag): it changes what every relative address on the page resolves to', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<base href="https://evil.example/">\n<BASE target="_blank">\n<base/>\n<p>no base here</p>',
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [base-tag]`));
});

test('A4 — a <meta> with http-equiv is a violation (meta-http-equiv); the ordinary <meta> tags of a page are not', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<meta http-equiv="refresh" content="0; url=https://evil.example/">',
      '<meta content="5" http-equiv=refresh>',
      '<META HTTP-EQUIV="X-UA-Compatible" CONTENT="IE=edge">',
      '<meta charset="UTF-8"/>',
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
      '<meta name="robots" content="noindex">',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [meta-http-equiv]`));
});

test('A4 — a srcdoc attribute is a violation (srcdoc): a same-origin frame that can carry a script', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
      '<iframe srcdoc=""></iframe>',
      '<div SRCDOC="x"></div>',
      '<iframe src="frame.html"></iframe>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [srcdoc]`));
});

test('A4 — several violations in one tag are reported one each, in document order', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<a href="javascript:alert(1)" onclick="x()" target="_blank">t</a>\n<iframe src="https://evil.example/" srcdoc="x" onload="y()"></iframe>',
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [script-url]`, // href comes first in the tag…
    `${HTML}:1 [inline-event-handler]`, // …then onclick
    `${HTML}:2 [src-http]`,
    `${HTML}:2 [srcdoc]`,
    `${HTML}:2 [inline-event-handler]`,
  ]);
});

test('A4 — the audit does not recognise HTML comments: a tag inside one is checked like any other', async (t) => {
  // A browser does not run what is inside a complete comment — but where a
  // comment ends has special cases (`<!-->` closes at once), and an audit
  // that trusted them could be talked out of seeing a script. Reporting a
  // commented-out tag costs its author a deletion; missing one costs every
  // reader. Plain comments (no tag inside) are not affected.
  const violations = await auditOf(t, {
    [HTML]: page(
      '<!DOCTYPE html>',
      '</p>',
      '<?xml version="1.0"?><p>ok</p>',
      '<!-- <script>alert(1)</script> <div onclick="x()">y</div> -->',
      '<!--><script>alert(2)</script>-->',
      '<!---><script>alert(3)</script>-->',
      '<!-- a > b <script>alert(4)</script> -->',
      '<!-- never closed <script>alert(5)</script>',
      '<!-- 待补充 -->',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:4 [script-inline]`,
    `${HTML}:4 [inline-event-handler]`,
    `${HTML}:5 [script-inline]`,
    `${HTML}:6 [script-inline]`,
    `${HTML}:7 [script-inline]`,
    `${HTML}:8 [script-inline]`,
  ]);
});

test('A4 — the content of <script> and <style> is not read as tags', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="application/json">{"html": "<img src=x onerror=alert(1)><script>alert(2)</script>"}</script>',
      '<style>.a::before{content:"<script onclick=x>"}</style>',
    ),
  });
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// A5 — .js / .css are build output
// ---------------------------------------------------------------------------

test('A5 — .js and .css are build output: the A4 rules do not apply to them', async (t) => {
  const violations = await auditOf(t, {
    'assets/js/x.js': 'el.innerHTML = "<script>alert(1)</script><div onclick=x>"; location.href = "javascript:x"; el.setAttribute("srcdoc", "1"); document.write(\'<base href="x">\');',
    'assets/js/upper.JS': '<meta http-equiv="refresh">',
    'css/theme.css': '/* <script> */ a::before{content:"onclick="} b{background:url(javascript:alert(1))}',
  });
  assert.deepEqual(violations, []);
});

test('A5 — …but A2 and A3 apply to them as literal text: a script can assemble markup at run time', async (t) => {
  const violations = await auditOf(t, {
    'assets/js/y.js': page(
      'var a = \'<img src="https://evil.example/x.png">\';',
      'var b = \'<a href="https://evil.example">x</a>\';',
      'var c = \'<img src="/root.png">\';',
      'var d = \'<a href="//cdn.example/x">x</a>\';',
      'var e = \'<a href="item/x.html">\';',
      'el.style.background = "url(https://evil.example/y.png)";',
    ),
    'css/z.css': '@import url(/x.css);',
  });
  assert.deepEqual(brief(violations), [
    'assets/js/y.js:1 [src-http]',
    'assets/js/y.js:2 [href-http]',
    'assets/js/y.js:3 [src-root-relative]',
    'assets/js/y.js:4 [href-protocol-relative]',
    'assets/js/y.js:6 [css-url-http]',
    'css/z.css:1 [css-url-root-relative]',
  ]);
});

test('A5 — in a page, src= and href= that are not inside a tag are just text', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<p>写法示例:src="https://example.com/x.png" 会加载外部图片。</p>',
      '<code>href="/index.html"</code>',
    ),
  });
  assert.deepEqual(violations, []);
});
