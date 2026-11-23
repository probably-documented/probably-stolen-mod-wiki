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
const { auditExternalLinks, CODES } = auditModule;

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
// A6 — the set of codes
// ---------------------------------------------------------------------------

test('A6 — the exported CODES is exactly what the rules report: one input per rule, and nothing else', async (t) => {
  const violations = await auditOf(t, {
    'index.html': page(
      '<a href="//example.com/x">protocol-relative</a>',
      '<img src="https://evil.example/x.png" alt=""/>',
      '<a href="/index.html">root-relative</a>',
      '<script>alert(1)</script>',
      '<script src="evil.js"></script>',
      '<div onclick="x()">event</div>',
      '<a href="javascript:alert(1)">script url</a>',
      '<base href="x/">',
      '<meta http-equiv="refresh" content="1">',
      '<iframe srcdoc="x"></iframe>',
      '<iframe src="data:text/html,x"></iframe>', // A9
    ),
    'assets/js/x.js': 'fetch("/x");\nXMLHttpRequest', // a page is not scanned for these (ruling AB c)
    'css/theme.css': page(
      'a{background:url(https://evil.example/a.png)}',
      'b{background:url(//cdn.example.com/b.png)}',
      'c{background:url(/c.png)}',
      'd{background:url(data:image/png;base64,AAAA)}', // A9
    ),
  });
  const reported = [...new Set(violations.map((v) => v.code))].sort();
  const expected = [...CODES].filter((code) => code !== 'unreadable').sort();
  assert.deepEqual(reported, expected,
    'every rule reports a code of the exported list, and every code of the list (but `unreadable`, a file the build cannot read — not made to happen here) is reported by some rule');
});

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
    'a-first.html:1 [root-relative-url]',
    'css/theme.css:1 [css-external-url]',
    'z-last.html:1 [external-url]',
    'z-last.html:3 [external-url]',
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

test('A2 — src="http(s)://…" on any element is a violation (external-url)', async (t) => {
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
    `${HTML}:1 [external-url]`,
    `${HTML}:2 [external-url]`,
    `${HTML}:3 [external-url]`,
    `${HTML}:4 [external-url]`,
    `${HTML}:5 [external-url]`,
    `${HTML}:6 [external-url]`, // a tag that spans lines is reported where it starts
    `${HTML}:8 [external-url]`,
    `${HTML}:9 [external-url]`,
  ]);
});

test('A2 — a <script src> to an outside URL is reported once, as the external resource it is', async (t) => {
  const violations = await auditOf(t, { [HTML]: '<script src="https://evil.example/x.js"></script>' });
  assert.deepEqual(brief(violations), [`${HTML}:1 [external-url]`], 'external-url, and not a second script-src line for the same tag');
});

test('A2 — <link href="http(s)://…"> is a violation, and so is an http(s) href on any other element that is not <a> (external-url)', async (t) => {
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
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5].map((n) => `${HTML}:${n} [external-url]`));
});

test('A2 — CSS url(http…) is a violation (css-external-url): in a <style> block, in a style attribute, in a .css file', async (t) => {
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
    'css/theme.css:1 [css-external-url]',
    `${HTML}:2 [css-external-url]`,
    `${HTML}:3 [css-external-url]`,
    `${HTML}:5 [css-external-url]`,
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
    `${HTML}:1 [protocol-relative-url]`,
    `${HTML}:2 [protocol-relative-url]`,
    `${HTML}:3 [protocol-relative-url]`,
    `${HTML}:4 [css-external-url]`,
  ]);
});

test('ruling AB(c) — a page is not scanned for the words fetch( and XMLHttpRequest: in a page they can only be text; a .js file and a stylesheet still are', async (t) => {
  // The reviewer's sentence: with A4 closing every way to run a script, this
  // is a sentence — and the report used to fail the build on it, telling the
  // contributor to "delete this code".
  const violations = await auditOf(t, {
    [HTML]: page(
      '<p>本站页面不使用 fetch( 请求网络。</p>',
      '<p>也不使用 XMLHttpRequest。</p>',
      '<div title="fetch( and XMLHttpRequest">nor in an attribute</div>',
      '<script type="application/json">{"note": "fetch( is a word here"}</script>',
    ),
    'assets/js/x.js': 'window.fetch ("/x");\nfunction prefetch(x) {}\nnew XMLHttpRequest();',
    'css/theme.css': '/* a stylesheet is not expected to call fetch( — counted anyway */',
  });
  assert.deepEqual(brief(violations), [
    'assets/js/x.js:1 [fetch]',
    'assets/js/x.js:3 [xhr]', // prefetch( is not fetch(
    'css/theme.css:1 [fetch]',
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
    'css/theme.css:1 [css-root-relative]',
    `${HTML}:1 [root-relative-url]`,
    `${HTML}:2 [root-relative-url]`,
    `${HTML}:3 [root-relative-url]`,
    `${HTML}:4 [root-relative-url]`,
    `${HTML}:5 [css-root-relative]`,
    `${HTML}:6 [css-root-relative]`,
    `${HTML}:7 [root-relative-url]`,
  ]);
});

test('A3 — site-relative paths, fragments, query strings are not root-relative (nothing reported); a data: address is A9\'s business, not A3\'s', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="items.html">a</a> <a href="../items.html">b</a> <a href="#x">c</a> <a href="?q=1">d</a> <a href="">e</a>',
      '<img src="assets/a.png"/> <img src="../assets/b.png"/> <img src="./c.png"/>',
      '<style>b{fill:url(#grad)} c{background:url()}</style>',
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

test('A4 — a script block is a data block for THREE types only (ruling AB a): application/json, text/plain, application/ld+json — case-insensitive; its content is not read as markup', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="application/json">{"a": 1}</script>',
      '<script type="application/ld+json">{"@context": "https://schema.org", "url": "https://example.com/x"}</script>',
      '<script type="text/plain">not a script to any browser</script>',
      '<script type=\'APPLICATION/JSON\'>{}</script>',
      '<script type="Application/LD+JSON">{}</script>',
      '<script type="Text/Plain">x</script>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('ruling AB(a) — every other type is a script the audit refuses: the reviewer\'s speculationrules line, importmap, text/template, an unknown type, a parameter, blanks', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="speculationrules">{"prefetch":[{"url":"https://evil.example/x"}]}</script>',
      '<script type="importmap">{"imports": {"x": "/x.js"}}</script>',
      '<script type="text/template"><div>x</div></script>',
      '<script type="application/speculation+json">{"prefetch":[{"url":"https://evil.example/x"}]}</script>',
      '<script type="foo/bar">x</script>',
      '<script type="application/json; charset=utf-8">{"a": 1}</script>', // a parameter: the browser runs nothing — and it is not on the list
      '<script type=" application/json ">{"a": 1}</script>', // blanks: not on the list either
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6, 7].map((n) => `${HTML}:${n} [script-inline]`));
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
    `${HTML}:8 [external-url]`, // an outside URL is the external resource it is
    `${HTML}:9 [protocol-relative-url]`,
    `${HTML}:10 [root-relative-url]`,
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
  // (ruling AA) the first one is outside-addressed too: a <base> is no longer a special case
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [base-tag]`, `${HTML}:1 [external-url]`, `${HTML}:2 [base-tag]`, `${HTML}:3 [base-tag]`,
  ]);
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
  // (ruling AA) the first one also carries an outside address in its content
  // attribute: two entries, the tag first
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [meta-http-equiv]`, `${HTML}:1 [external-url]`,
    `${HTML}:2 [meta-http-equiv]`, `${HTML}:3 [meta-http-equiv]`,
  ]);
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
    `${HTML}:2 [external-url]`,
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
    'assets/js/y.js:1 [external-url]',
    'assets/js/y.js:2 [external-url]',
    'assets/js/y.js:3 [root-relative-url]',
    'assets/js/y.js:4 [protocol-relative-url]',
    'assets/js/y.js:6 [css-external-url]',
    'css/z.css:1 [css-root-relative]',
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

// ---------------------------------------------------------------------------
// Ruling AA (task 6b) — by tag, not by named attribute
//
// Naming attributes (src, href) did not hold: srcset, poster, data, action,
// formaction and ping all load from outside and none of them was looked at.
// The rule is now by class. Outside an <a href>, no attribute value of any
// tag may hold an http:// or https:// address or start with //; and no
// URL-bearing attribute may start with / (the list is URL_ATTRIBUTES in
// audit.js). Each gap below was shown to slip through by a probe before this
// change; each is pinned here as caught, next to the legal use of the same
// attribute.
// ---------------------------------------------------------------------------

test('AA — the six HTML gaps are closed: srcset, poster, object data, action, formaction, ping', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img srcset="https://evil.example/a.png 1x" alt=""/>',
      '<video poster="https://evil.example/p.png"></video>',
      '<object data="https://evil.example/o.svg"></object>',
      '<form action="https://evil.example/submit"></form>',
      '<button formaction="https://evil.example/go">x</button>',
      '<a href="items.html" ping="https://evil.example/track">x</a>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6].map((n) => `${HTML}:${n} [external-url]`));
});

test('AA — …and the same attributes with site-relative values are not reported', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img srcset="a.png 1x, b.png 2x" src="a.png" alt=""/>',
      '<video poster="p.png" src="v.mp4"></video>',
      '<object data="o.svg"></object>',
      '<form action="submit.html"></form>',
      '<button formaction="go.html">x</button>',
      '<a href="items.html" ping="track.html">x</a>',
      '<a href="https://example.com/x">an outside link is fine</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('AA — a plain-text address outside every tag is not a violation; neither is an <a href> to an outside page', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<p>参考 https://example.com/a、http://example.org/b 和 //example.net/c</p>',
      '<p>写法示例:srcset="https://example.com/a.png" 会加载外部图片。</p>',
      '<a href="https://example.com/x">外链</a> <a href="http://example.org/y">另一个</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('AA — by class: any attribute of any tag but <a href>, wherever in the value the address sits', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<meta name="anything" content="0; url=https://evil.example/">', // content
      '<div data-x="https://evil.example/d">any attribute at all</div>',
      '<img srcset="a.png 1x, https://evil.example/b.png 2x" alt=""/>', // not at the start of the value
      '<img src="HTTPS://EVIL.EXAMPLE/upper.png" alt=""/>', // case does not matter
      '<img src="&#104;ttps://evil.example/decoded.png" alt=""/>', // character references
      '<img src=https://evil.example/bare.png>', // an unquoted value
      '<a href="x.html" title="see https://example.com">only the href of an <a> is exempt</a>',
      '<a xlink:href="https://evil.example/svg">…and xlink:href is not href</a>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${HTML}:${n} [external-url]`));
});

test('AA — <base href="https://…"> is refused twice over: as a <base>, and as an outside address (no special case any more)', async (t) => {
  const violations = await auditOf(t, { [HTML]: '<base href="https://evil.example/">' });
  assert.deepEqual(brief(violations), [`${HTML}:1 [base-tag]`, `${HTML}:1 [external-url]`]);
});

test('AA — protocol-relative: any attribute value that starts with //, <a href> included; a // elsewhere is nothing', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img srcset="//cdn.example.com/a.png 1x" alt=""/>',
      '<div data-x="//evil.example/d">any attribute</div>',
      '<img srcset=" //cdn.example.com/b.png 1x" alt=""/>', // after a blank
      '<a href="//example.com/x">a link does not get a pass either</a>',
      '<a href="https://example.com/x">an https link is fine</a>',
      '<div class="a//b" title="x // y">not at the start: fine</div>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4].map((n) => `${HTML}:${n} [protocol-relative-url]`));
});

test('AA — root-relative (A3) applies to every URL-bearing attribute, <a href> included, and to each candidate of a list', async (t) => {
  const lines = [
    '<a href="/index.html">首页</a>',
    '<img src="/assets/x.png" alt=""/>',
    '<img srcset="/a.png 1x" alt=""/>',
    '<img srcset="a.png 1x, /b.png 2x" alt=""/>', // the second candidate
    '<video poster="/p.png"></video>',
    '<object data="/o.svg"></object>',
    '<form action="/submit"></form>',
    '<button formaction="/go">x</button>',
    '<a href="x.html" ping="/track">x</a>',
    '<blockquote cite="/q"></blockquote>',
    '<img longdesc="/d.html" alt="" usemap="#m"/>', // usemap="#m" is a fragment: fine
    '<html manifest="/m.appcache"></html>',
    '<body background="/bg.png"></body>',
    '<use xlink:href="/s.svg#a"/>',
  ];
  const violations = await auditOf(t, { [HTML]: lines.join('\n') });
  assert.deepEqual(brief(violations), lines.map((_, i) => `${HTML}:${i + 1} [root-relative-url]`));
});

test('AA — …and to nothing that is not a URL-bearing attribute: a custom or plain attribute may start with /', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<div data-path="/x" title="/y" class="/z" id="/w" aria-label="/v">not addresses</div>',
  });
  assert.deepEqual(violations, []);
});

test('AA — one attribute can break two rules; that is two entries, the outside address first', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<img srcset="/a.png 1x, https://evil.example/b.png 2x" alt=""/>',
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [external-url]`, `${HTML}:1 [root-relative-url]`]);
});

test('AA — the tag scanner reads quoted values: a > inside quotes does not cut the tag short', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div title="a > b" onclick="x()">after the quoted > there is still an event attribute</div>',
      "<div title='a > b' ping='https://evil.example/'>single quotes too</div>",
      '<img src="x.png" alt="a>b" srcset="https://evil.example/a.png 1x"/>',
      '<a href="https://example.com/" title="x>y" onclick="z()">an outside href (fine), an event attribute after a quoted ></a>',
      '<img\n  alt="a > b"\n  srcset="https://evil.example/a.png 1x">',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [inline-event-handler]`,
    `${HTML}:2 [external-url]`,
    `${HTML}:3 [external-url]`,
    `${HTML}:4 [inline-event-handler]`, // …and no external-url: the https:// sits in the <a href>
    `${HTML}:5 [external-url]`, // a tag that spans lines is reported where it starts
  ]);
});

test('AA — a style="" attribute is judged as CSS, once: it is not reported again for the https:// inside it', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<div style="background:url(https://evil.example/a.png)">x</div>',
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [css-external-url]`]);
});

// ---------------------------------------------------------------------------
// Ruling AA — CSS
//
// In a stylesheet, a <style> block or a style="" attribute: @import, url()
// and image-set() may hold neither an outside nor a root-relative address.
// Escapes are undone before anything is looked for (\68 ttps:// is
// https://), and what is inside a quoted string, or a comment, is not CSS
// syntax: content:"url(…)" is text. The two gaps below (@import "…",
// image-set("…")) and the escape were shown to slip through by a probe
// before this change.
// ---------------------------------------------------------------------------

test('AA — the two CSS gaps are closed: @import "https://…" and image-set("https://…"), in a stylesheet, a <style> block and a style attribute', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': page(
      '@import "https://fonts.example.com/x.css";',
      "@import 'https://fonts.example.com/y.css' print;",
      '@import "https://fonts.example.com/z.css" screen and (min-width: 100px);',
      'a{background:image-set("https://evil.example/a.png" 1x, "b.png" 2x)}',
      'b{background:-webkit-image-set(url("https://evil.example/c.png") 1x)}',
      'c{background:image-set("//evil.example/d.png" 1x)}',
      'd{background:image-set("d.png" 1x, "https://evil.example/e.png" 2x)}', // the second of the list
      'e{background:url( "https://evil.example/quoted.png" )}', // blanks and quotes around the address
    ),
    [HTML]: page(
      '<style>@import "https://fonts.example.com/x.css";</style>',
      "<div style=\"background:image-set('https://evil.example/a.png' 1x)\">x</div>",
    ),
  });
  assert.deepEqual(brief(violations), [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `css/theme.css:${n} [css-external-url]`),
    `${HTML}:1 [css-external-url]`,
    `${HTML}:2 [css-external-url]`,
  ]);
});

test('AA — …and the same with site-relative addresses, a fragment, none at all — or inside a string, a comment or running text — is not reported', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': page(
      '@import "theme-more.css";',
      '@import url(../base.css) layer(base);',
      'a{background:image-set("a.png" 1x, "../b.png" 2x)}',
      'c{fill:url(#grad)}',
      'd{background:url()}',
      'e{background:url( "theme-more.png" )}', // blanks and quotes, a site-relative address
      '.f::before{content:"url(https://example.com/this-is-text)"}', // a string is not a url()
      '.g::before{content:"@import https://example.com/this-is-text-too"}', // …nor an @import
      '.h::before{content:"image-set(https://example.com/text) 1x"}', // …nor an image-set()
      '/* @import "https://evil.example/commented.css"; i{background:url(https://evil.example/c.png)} */',
    ),
    [HTML]: '<p>正文里写 url(https://example.com/x.png) 或 @import "https://example.com/y.css" 只是文字。</p>',
  });
  assert.deepEqual(violations, []);
});

test('AA — CSS escapes are undone first: \\68 ttps://, \\75 rl(, \\2f\\2f … cannot get past', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': page(
      String.raw`a{background:\75 rl(https://evil.example/a.png)}`, // \75 + blank = u
      String.raw`b{background:url(\68 ttps://evil.example/b.png)}`, // \68 + blank = h
      String.raw`c{background:url(h\74 tps://evil.example/c.png)}`, // \74 + blank = t
      String.raw`d{background:url(\2f\2f evil.example/d.png)}`, // \2f = /, twice: a protocol-relative address
      String.raw`f{background:url(\2f root-relative.png)}`, // one \2f: root-relative
      String.raw`g{background:url(\2f\2f\65 vil.example/g.png)}`, // \65 + blank = e
      String.raw`h{background:url(\000068 ttps://evil.example/h.png)}`, // six hex digits
      String.raw`i{background:url(\48TTPS://evil.example/i.png)}`, // the escape ends at the first non-hex digit, upper-case hex included
      String.raw`j{background:\u\rl(https://evil.example/j.png)}`, // character escapes: \u is u, \r is r
    ),
  });
  assert.deepEqual(brief(violations), [
    ...[1, 2, 3, 4].map((n) => `css/theme.css:${n} [css-external-url]`),
    'css/theme.css:5 [css-root-relative]',
    ...[6, 7, 8, 9].map((n) => `css/theme.css:${n} [css-external-url]`),
  ]);
});

test('an escaped @ is a name, not an at-keyword — as a browser reads it, nothing is imported and nothing is reported; a real @ is', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': page(
      String.raw`a{background:\@import "https://evil.example/k.css";`,
      String.raw`b{background:\40 import "https://evil.example/e.css";`, // \40 + blank = @ — escaped all the same
      '@import "https://evil.example/real.css";',
    ),
  });
  assert.deepEqual(brief(violations), ['css/theme.css:3 [css-external-url]']);
});

test('AA — …and escapes that spell no address stay what they are: a class name, a string of text', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': page(
      String.raw`.\31 a{color:red}`, // the class "1a"
      String.raw`.a\@b{color:blue}`,
      String.raw`.c::before{content:"\68 ttps://example.com/is just text"}`, // inside a string
      String.raw`.d::after{content:"\2014"}`, // an em dash
    ),
  });
  assert.deepEqual(violations, []);
});

test('AA — an escape changes the lengths; the line reported is still the line the address is written on', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{color:red}',
      'b{',
      String.raw`  background:url(\68 ttps://evil.example/b.png)`, // line 3
      '}',
      String.raw`@import "\2f x.css";`, // line 5, root-relative
    ].join('\n'),
    // a tag across lines: reported where it starts
    [HTML]: '<div\n  style="background:image-set(\\75 rl(\\2f\\2f root.png) 1x)">x</div>',
  });
  assert.deepEqual(brief(violations), ['css/theme.css:3 [css-external-url]', 'css/theme.css:5 [css-root-relative]', `${HTML}:1 [css-external-url]`]);
});

// ---------------------------------------------------------------------------
// Review of 2c486cd — Critical 1: a repeated attribute
//
// HTML parsing drops every attribute whose name is already on the tag: the
// browser keeps the FIRST. The audit kept the last one for `type` and `src`,
// so a script the browser runs passed as a data block. The first four lines
// below are the reviewer's strings, tried in Chromium 152: the first three
// ran, and the fourth loads the CMS shell's script.
// ---------------------------------------------------------------------------

test('review Critical 1 — a repeated attribute: the browser keeps the first, and so does the audit (the reviewer\'s strings)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="text/javascript" type="application/json">alert(1)</script>',
      '<script type="module" type="application/json">alert(2)</script>',
      '<script type="module" type="text/plain">alert(3)</script>',
      '<script src="admin/vendor/cms.js" src="data.js"></script>',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [script-inline]`,
    `${HTML}:2 [script-inline]`,
    `${HTML}:3 [script-inline]`,
    `${HTML}:4 [script-src]`, // the first src is not on the allow-list; the second is dropped
  ]);
});

test('review Critical 1 — the other way round: the first attribute is the harmless one, so there is nothing to report', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="application/json" type="text/javascript">{"a": 1}</script>', // a data block: the second type is dropped
      '<script src="data.js" src="admin/vendor/cms.js"></script>', // the first src is on the allow-list
      '<img src="a.png" src="https://evil.example/x.png">', // the browser loads a.png, not the outside address
      '<a href="https://example.com/x" href="/y">an outside link</a>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('review Critical 1 — every rule reads the first of a repeated attribute, names compared without case', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img src="/x.png" src="a.png">', // root-relative: the address the browser loads
      '<img src="https://evil.example/y.png" src="a.png">', // outside
      '<a href="/y" href="https://example.com/x">link</a>', // root-relative link
      '<img SRC="/z.png" src="a.png">', // the names are the same to the parser
      '<script TYPE="application/json" type="text/javascript">{"a": 1}</script>', // …so this is a data block
      '<div onclick="x()" title="y" onclick="z()">an event attribute is reported once</div>',
      '<img src="https://evil.example/w.png" onclick="x()" src="v.png">', // the outside address is the first one
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [root-relative-url]`,
    `${HTML}:2 [external-url]`,
    `${HTML}:3 [root-relative-url]`,
    `${HTML}:4 [root-relative-url]`,
    `${HTML}:6 [inline-event-handler]`,
    `${HTML}:7 [external-url]`,
    `${HTML}:7 [inline-event-handler]`,
  ]);
});

// ---------------------------------------------------------------------------
// Review of 2c486cd — Important 1: CSS addresses that slipped through
//
// The CSS was read as "blank the comments, undo the escapes, then run three
// regular expressions that do not cross a line". Two consequences, each
// shown by the reviewer in Chromium 152 (the browser fetched every one of
// these addresses):
//   • a /* inside a string began a "comment", which swallowed the rule after
//     it — a{content:"/*"} on one line, the outside url() on the next;
//   • an address that runs across a line break — a string continued with a
//     backslash, or holding an escaped newline — matched nothing.
// The strings below are the reviewer's.
// ---------------------------------------------------------------------------

test('review Important 1 — cause 1: a /* inside a string is text, not a comment; the rule on the next line is still CSS', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': ['a{content:"/*"}', 'b{background:url(https://evil.example/b.png)}', ''].join('\n'),
    [HTML]: ['<style>', 'a{content:"/*"}', 'b{background:url(https://evil.example/c.png)}', '</style>'].join('\n'),
  });
  assert.deepEqual(brief(violations), ['css/theme.css:2 [css-external-url]', `${HTML}:3 [css-external-url]`]);
});

test('review Important 1 — cause 2: an address may run across lines — a string continued with a backslash, an escaped newline, an @import', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{background:url("https://evil.example/a\\', // the string goes on after the line break
      '.png")}',
      'b{background:url("https://evil.example/b\\a .png")}', // \a is a line feed inside the string
      'c{background:url("https://evil.example/c\\d .png")}', // …and \d a carriage return
      '@import "https://evil.example/x\\',
      '.css";',
      "@import 'https://evil.example/y\\",
      ".css';",
      'd{background:url("https://evil.example/\\',
      'd.png") screen;}',
    ].join('\n'),
    [HTML]: "<div style=\"background:url('https://evil.example/e\\\n.png')\">x</div>",
  });
  assert.deepEqual(brief(violations), [
    'css/theme.css:1 [css-external-url]',
    'css/theme.css:3 [css-external-url]',
    'css/theme.css:4 [css-external-url]',
    'css/theme.css:5 [css-external-url]',
    'css/theme.css:7 [css-external-url]',
    'css/theme.css:9 [css-external-url]',
    `${HTML}:1 [css-external-url]`, // a tag across lines is reported where it starts
  ]);
});

test('review Important 1 — image-set() is read the same way: across lines, with an escaped newline', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{background:image-set(',
      '  "https://evil.example/a.png" 1x,',
      '  "b.png" 2x)}',
      'b{background:image-set("https://evil.example/\\',
      'b.png" 1x)}',
      'c{background:-webkit-image-set(url("https://evil.example/c.png") 1x, "https://evil.example/d\\a .png" 2x)}',
    ].join('\n'),
  });
  assert.deepEqual(brief(violations), [
    'css/theme.css:1 [css-external-url]',
    'css/theme.css:4 [css-external-url]',
    'css/theme.css:6 [css-external-url]',
    'css/theme.css:6 [css-external-url]',
  ]);
});

test('review Important 1 — …and read right the other way round too: an escaped quote does not end a string, a comment may span lines, url( with a blank before the address is still url()', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{content:"say \\" url(https://evil.example/inside-a-string.png) \\" more"}', // one string, all of it
      '/* a comment', 'that spans lines: url(https://evil.example/commented.png) */',
      "b{content:'it\\'s text: url(https://evil.example/more-text.png)'}", // the same with single quotes
      'c{background:url( https://evil.example/after-a-blank.png )}', // fetched: the blank makes url( a function
      'd{background:URL("https://evil.example/upper-case.png")}',
    ].join('\n'),
  });
  assert.deepEqual(brief(violations), ['css/theme.css:5 [css-external-url]', 'css/theme.css:6 [css-external-url]']);
});

// ---------------------------------------------------------------------------
// Ruling AB(b) — A9: data: addresses
//
// A data: address is a whole document written into the page. In an iframe,
// an object or an embed, data:text/html runs its script; data:image/svg+xml
// runs the script of the drawing wherever a browser treats it as a document.
// So: a data: address is allowed only as an image that is not SVG (image/*,
// but not image/svg+xml), and only in the src / srcset of <img> or <source>
// or the poster of <video>. Anywhere else — any other tag or attribute, any
// other type — and in CSS, it is a violation: `data-url`, `css-data-url`.
// ---------------------------------------------------------------------------

test('ruling AB(b) / A9 — a data: address is refused outside the image slots: the iframe / object / embed that can run a document, an SVG image, a link, a script, a non-image', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
      '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>',
      '<embed src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">',
      '<img src="data:image/svg+xml;base64,AAAA">', // an SVG image is not on the list, even in an <img>
      '<img src="DATA:IMAGE/SVG+XML;base64,AAAA">', // …in any case
      '<img src="data:image/svg+xml;charset=utf-8,<svg></svg>">', // …with a parameter
      '<a href="data:text/html,<b>x</b>">a link to a data: document</a>',
      '<img src="data:text/plain,hello">', // not an image
      '<img src="data:;base64,AAAA">', // no type: text/plain, the default
      '<video poster="data:image/svg+xml;base64,AAAA"></video>',
      '<img srcset="data:image/svg+xml;base64,AAAA 1x">',
      '<div style="background:url(data:image/svg+xml;base64,AAAA)">x</div>',
    ),
  });
  assert.deepEqual(brief(violations), [
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => `${HTML}:${n} [data-url]`),
    `${HTML}:8 [data-url]`,
    `${HTML}:9 [data-url]`,
    `${HTML}:10 [data-url]`,
    `${HTML}:11 [data-url]`,
    `${HTML}:12 [css-data-url]`,
  ]);
});

test('ruling AB(b) / A9 — …and in a script tag, a stylesheet, a form, a stray attribute: no slot is left', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script src="data:text/javascript,alert(1)"></script>', // a data: address, and a script source off the list
      '<link rel="stylesheet" href="data:text/css,body{color:red}">',
      '<form action="data:text/html,<script>alert(1)</script>"></form>',
      '<div data-x="data:text/html,x">a custom attribute</div>',
      '<svg><image href="data:image/svg+xml,<svg></svg>"/></svg>',
      '<img src="a.png" longdesc="data:text/plain,hello">',
    ),
    'css/theme.css': page(
      'a{background:url(data:image/svg+xml;base64,AAAA)}',
      'b{background:url(data:image/png;base64,AAAA)}', // an image — in CSS it is refused all the same
      "c{list-style-image:url('data:image/png;base64,AAAA')}",
      '@import "data:text/css,body{color:red}";',
      'd{background:image-set("data:image/png;base64,AAAA" 1x)}',
    ),
  });
  assert.deepEqual(brief(violations), [
    ...[1, 2, 3, 4, 5].map((n) => `css/theme.css:${n} [css-data-url]`),
    `${HTML}:1 [data-url]`,
    `${HTML}:1 [script-src]`,
    ...[2, 3, 4, 5, 6].map((n) => `${HTML}:${n} [data-url]`),
  ]);
});

test('ruling AB(b) / A9 — allowed: an image that is not SVG, as the src / srcset of an <img> or a <source>, or the poster of a <video>', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<img src="data:image/png;base64,AAAA" alt="">',
      '<img src="data:image/gif;base64,AAAA">',
      '<img src="data:image/webp;base64,AAAA">',
      '<img src="DATA:IMAGE/PNG;base64,AAAA">',
      '<img src="data:image/png;charset=utf-8;base64,AAAA">',
      '<img srcset="data:image/png;base64,AAAA 1x, b.png 2x">',
      '<picture><source srcset="data:image/avif;base64,AAAA" type="image/avif"><img src="b.png"></picture>',
      '<video poster="data:image/jpeg;base64,AAAA" src="v.mp4"></video>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('ruling AB(b) / A9 — a data: address is read as a browser reads it: character references, a line break, blanks, all folded away first', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<iframe src="&#100;ata:text/html,<b>x</b>"></iframe>', // &#100; is d
      '<iframe src="da\nta:text/html,x"></iframe>',
      '<iframe src="  data:text/html,x  "></iframe>',
      '<img src=" DATA:image/png;base64,AAAA " alt="">', // …and so is this one: still an image in an <img>
    ),
  });
  // (the second tag spans two lines, so the third one is on line 4)
  assert.deepEqual(brief(violations), [1, 2, 4].map((n) => `${HTML}:${n} [data-url]`));
});
