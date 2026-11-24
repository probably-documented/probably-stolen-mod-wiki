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
//   AE  (round 4, ruling AE) a tag allow-list: a tag that is not on it is
//       refused wherever it stands (unsupported-tag); title, meta, link and
//       style belong in the <head>; there is no foreign content — a page is
//       read by the HTML rules throughout, and the CSS of every <style> is
//       read on its own
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
  // (ruling AE 1: an <svg> is not on the allow-list, nor is a <text> — the page is refused for the two. The <a href>
  // inside is an external link as any other: it is not reported for it)
  assert.deepEqual(brief(violations), [`${HTML}:7 [unsupported-tag]`, `${HTML}:7 [unsupported-tag]`]);
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
  // (ruling AE 1: an <iframe>, a <video>, an <embed> and an <audio> are not on the allow-list — one more entry each,
  // the tag first; the outside address is still reported)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [external-url]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [external-url]`,
    `${HTML}:3 [unsupported-tag]`, `${HTML}:3 [external-url]`,
    `${HTML}:4 [unsupported-tag]`, `${HTML}:4 [external-url]`,
    `${HTML}:5 [external-url]`,
    `${HTML}:6 [external-url]`, // a tag that spans lines is reported where it starts
    `${HTML}:8 [external-url]`,
    `${HTML}:9 [unsupported-tag]`, `${HTML}:9 [external-url]`,
  ]);
});

test('A2 — a <script src> to an outside URL is reported once, as the external resource it is', async (t) => {
  const violations = await auditOf(t, { [HTML]: '<script src="https://evil.example/x.js"></script>' });
  assert.deepEqual(brief(violations), [`${HTML}:1 [external-url]`], 'external-url, and not a second script-src line for the same tag');
});

test('A2 — <link href="http(s)://…"> is a violation, and so is an http(s) href on any other element that is not <a> (external-url)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      // (ruling AE 2: the two <link>s stand in the <head>, where a <link> belongs)
      '<head><link rel="stylesheet" href="https://evil.example/x.css"/>',
      '<link rel="icon" href="https://evil.example/favicon.ico"></head>',
      '<area href="https://evil.example/map"/>',
      '<use href="https://evil.example/s.svg#a"/>',
      '<image href="https://evil.example/i.png"/>',
      '<a href="https://example.com/fine">a link is fine</a>',
    ),
  });
  // (ruling AE 1: <area>, <use> and <image> are not on the allow-list — one more entry each; the two <link>s are in the <head>)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [external-url]`,
    `${HTML}:2 [external-url]`,
    `${HTML}:3 [unsupported-tag]`, `${HTML}:3 [external-url]`,
    `${HTML}:4 [unsupported-tag]`, `${HTML}:4 [external-url]`,
    `${HTML}:5 [unsupported-tag]`, `${HTML}:5 [external-url]`,
  ]);
});

test('A2 — CSS url(http…) is a violation (css-external-url): in a <style> block, in a style attribute, in a .css file', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      'a{background:url(https://evil.example/a.png)}',
      'b{background:url( "https://evil.example/b.png" )}',
      '</style></head>',
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
      '<head><link rel="stylesheet" href="//cdn.example.com/x.css"/>', // (ruling AE 2: in the <head>, where a <link> belongs)
      '<style>a{background:url(//cdn.example.com/x.png)}</style></head>',
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
      '<head><link rel="stylesheet" href="/css/theme.css"/>', // (ruling AE 2: in the <head>, where a <link> and a <style> belong)
      '<script src="/assets/js/x.js"></script>',
      '<style>a{background:url(/assets/x.png)}</style></head>',
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
      '<head><style>b{fill:url(#grad)} c{background:url()}</style></head>', // (ruling AE 2: in the <head>, where a <style> belongs)
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
  // (ruling AE 1: the <iframe> on line 9 is not on the allow-list — one more entry; the <form> on line 8 is)
  assert.deepEqual(brief(violations), [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `${HTML}:${n} [script-url]`),
    `${HTML}:9 [unsupported-tag]`, `${HTML}:9 [script-url]`,
    ...[10, 11].map((n) => `${HTML}:${n} [script-url]`),
  ]);
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
    // (ruling AE 2: in the <head>, where a <meta> belongs — in the body each of the six would be an unsupported tag too)
    [HTML]: page(
      '<head><meta http-equiv="refresh" content="0; url=https://evil.example/">',
      '<meta content="5" http-equiv=refresh>',
      '<META HTTP-EQUIV="X-UA-Compatible" CONTENT="IE=edge">',
      '<meta charset="UTF-8"/>',
      '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
      '<meta name="robots" content="noindex"></head>',
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
  // (ruling AE 1: an <iframe> is not on the allow-list — one more entry for each of the three, and for the fourth,
  // which carries no srcdoc; the <div> on line 3 is on the list)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [srcdoc]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [srcdoc]`,
    `${HTML}:3 [srcdoc]`,
    `${HTML}:4 [unsupported-tag]`,
  ]);
});

test('A4 — several violations in one tag are reported one each, in document order', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: '<a href="javascript:alert(1)" onclick="x()" target="_blank">t</a>\n<iframe src="https://evil.example/" srcdoc="x" onload="y()"></iframe>',
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [script-url]`, // href comes first in the tag…
    `${HTML}:1 [inline-event-handler]`, // …then onclick
    `${HTML}:2 [unsupported-tag]`, // (ruling AE 1: an <iframe> is not on the allow-list) — the tag itself…
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
    // (ruling AE 2: in the <head>, where a <style> belongs)
    [HTML]: page(
      '<head><script type="application/json">{"html": "<img src=x onerror=alert(1)><script>alert(2)</script>"}</script>',
      '<style>.a::before{content:"<script onclick=x>"}</style></head>',
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
  // (ruling AE 1: a <video> and an <object> are not on the allow-list — one more entry each; the <form> and the <button> are)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [external-url]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [external-url]`,
    `${HTML}:3 [unsupported-tag]`, `${HTML}:3 [external-url]`,
    `${HTML}:4 [external-url]`,
    `${HTML}:5 [external-url]`,
    `${HTML}:6 [external-url]`,
  ]);
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
  // (ruling AE 1: a <video> and an <object> are not on the allow-list — the tags are refused, the site-relative
  // addresses on them are not reported)
  assert.deepEqual(brief(violations), [`${HTML}:2 [unsupported-tag]`, `${HTML}:3 [unsupported-tag]`]);
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
      '<head><meta name="anything" content="0; url=https://evil.example/"></head>', // content — (ruling AE 2: in the <head>, where a <meta> belongs)
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
  // (ruling AE 1: the <video>, the <object> and the <use> are not on the allow-list — one more entry each)
  const unsupported = new Set([5, 6, 14]);
  assert.deepEqual(brief(violations), lines.flatMap((_, i) => (unsupported.has(i + 1) ? [`${HTML}:${i + 1} [unsupported-tag]`] : []).concat(`${HTML}:${i + 1} [root-relative-url]`)));
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
      '<head><style>@import "https://fonts.example.com/x.css";</style></head>', // (ruling AE 2: in the <head>, where a <style> belongs)
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

test('review Important 1 — cause 1: a /* inside a string is text, not a comment; the rule after it is still CSS — with a real comment further down, as in the reviewer\'s case', async (t) => {
  // The /* inside the string opened a "comment" for the audit before the fix,
  // and only the */ of a REAL comment further down closed it: everything in
  // between went unreported — b's address. (As first written this case had no
  // real comment, and the old reading reported b's address too: it was green
  // before the fix and proved nothing. The comment is the case.)
  // A real comment is still a comment: nothing in it is reported.
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{content:"/*"}',
      'b{background:url(https://evil.example/b.png)}',
      '/* a real comment: url(https://evil.example/commented.png) is text here */',
      'c{background:url(https://evil.example/c.png)}',
      '',
    ].join('\n'),
    [HTML]: ['<head><style>', 'a{content:"/*"}', 'b{background:url(https://evil.example/d.png)}', '/* real */', '</style></head>'].join('\n'), // (ruling AE 2: in the <head>)
  });
  assert.deepEqual(brief(violations), [
    'css/theme.css:2 [css-external-url]',
    'css/theme.css:4 [css-external-url]',
    `${HTML}:3 [css-external-url]`,
  ]);
});

test('review Important 1 — cause 2: an address may run across lines — a string continued with a backslash, an escaped newline, an @import', async (t) => {
  const violations = await auditOf(t, {
    'css/theme.css': [
      'a{background:url("https://evil.example/a\\', // the string goes on after the line break
      '.png")}',
      'b{background:url("https://evil.example/b\\a .png")}', // \a is a line feed inside the string
      'c{background:url("https://evil.example/c\\d .png")}', // …and \d a carriage return
      // The audit reports the last three addresses where Chromium 152 fetches
      // nothing: the two @imports — after a rule an @import is ignored — and
      // d — `screen` is no value of the background shorthand, so that
      // declaration is dropped. The address is read all the same, on the safe
      // side (seen in the browser; task-6b report, Fix Report). The first
      // three it does fetch.
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
  // (ruling AE 1: the <iframe>, the <object>, the <embed> and the <video> are not on the allow-list — one more entry each)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [data-url]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [data-url]`,
    `${HTML}:3 [unsupported-tag]`, `${HTML}:3 [data-url]`,
    ...[4, 5, 6, 7].map((n) => `${HTML}:${n} [data-url]`),
    `${HTML}:8 [data-url]`,
    `${HTML}:9 [data-url]`,
    `${HTML}:10 [unsupported-tag]`, `${HTML}:10 [data-url]`,
    `${HTML}:11 [data-url]`,
    `${HTML}:12 [css-data-url]`,
  ]);
});

test('ruling AB(b) / A9 — …and in a script tag, a stylesheet, a form, a stray attribute: no slot is left', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script src="data:text/javascript,alert(1)"></script>', // a data: address, and a script source off the list
      '<head><link rel="stylesheet" href="data:text/css,body{color:red}"></head>', // (ruling AE 2: in the <head>, where a <link> belongs)
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
    ...[2, 3, 4].map((n) => `${HTML}:${n} [data-url]`),
    `${HTML}:5 [unsupported-tag]`, `${HTML}:5 [unsupported-tag]`, `${HTML}:5 [data-url]`, // (ruling AE 1: the <svg> and the <image>)
    `${HTML}:6 [data-url]`,
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
  // The data: addresses are allowed in their slots — and the slots are all that is left of it: a <picture>, a
  // <source> and a <video> are not on the allow-list (ruling AE 1), so the tags are refused.
  assert.deepEqual(brief(violations), [`${HTML}:7 [unsupported-tag]`, `${HTML}:7 [unsupported-tag]`, `${HTML}:8 [unsupported-tag]`]);
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
  // (the second tag spans two lines, so the third one is on line 4; ruling AE 1: an <iframe> is not on the allow-list)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [data-url]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [data-url]`,
    `${HTML}:4 [unsupported-tag]`, `${HTML}:4 [data-url]`,
  ]);
});

test('ruling AB(d) — a javascript: address is refused in ANY attribute, on any tag: that is what catches SVG animation', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<animate values="javascript:alert(1)">',
      '<set attributeName="href" to="javascript:alert(2)">',
      '<a href=" JaVaScRiPt:alert(3)">x</a>',
      '<form action="vbscript:msgbox(4)"></form>',
    ),
  });
  // (ruling AE 1: <animate> and <set> are not on the allow-list — one more entry each)
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [script-url]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [script-url]`,
    `${HTML}:3 [script-url]`,
    `${HTML}:4 [script-url]`,
  ]);
});

// ===========================================================================
// Review round 2 (of fd618bc)
// ===========================================================================
// Critical (a regression of round 1) and ruling AC(1): the tag scanner read
// only the first 256 characters of an attribute name, 4096 of an unquoted
// value and 64 of a tag name. Whatever followed the cut was read as
// something new — an attribute the browser does not have. With round 1's
// rule "of repeated attributes only the first is kept", a name that ran
// past the cut could make the audit drop the REAL `type` / `src` / `href`
// as a repeat; and without any repeat, the audit could be given a `type` /
// `src` the browser never saw. The browser executes or loads; the audit said
// nothing — though before round 1 it reported these.
//
// Ruling AC(1): nothing is cut in the parse phase. Names and values are read
// to where they really end; a length limit belongs to the snippet shown in a
// report and nowhere else.
//
// Every line below was tried in Chrome 152 (task-6b report, round 2): what
// the browser did with it is what the audit must say.

const X256 = 'x'.repeat(256); // the reviewer's x×256 — no blank between it and what follows
const X255 = 'x'.repeat(255);
const A4096 = 'a'.repeat(4096); // the reviewer's a×4096 after `data=`

test('review round 2, Critical — a name of 256 characters is one name with the `type` / `src` / `href` after it: the browser has no such attribute, and the audit reads the same (the reviewer\'s table)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      `<script ${X256}type="application/json" type="text/javascript">alert(1)</script>`, // no `type` → runs
      `<script ${X256}src="data.js" src="admin/vendor/cms.js"></script>`, // no `src` by that name → cms.js is the first src
      `<a ${X256}href="ok.html" href="javascript:alert(1)">link</a>`, // the live href is the javascript: one
      `<iframe ${X256}src="ok.html" src="https://evil.example/"></iframe>`, // the outside address is loaded
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [script-inline]`,
    `${HTML}:2 [script-src]`,
    `${HTML}:3 [script-url]`,
    `${HTML}:4 [unsupported-tag]`, `${HTML}:4 [external-url]`, // (ruling AE 1: an <iframe> is not on the allow-list)
  ]);
});

test('review round 2, Critical — the controls at 255 and at 257 characters (4095 and 4097 of a value): the cut could be used only at exactly 256 (4096)', async (t) => {
  // At exactly 256 the name ends where the old scan stopped reading, so
  // `type` began a new "attribute" for it. One character more and the name
  // runs past the cut: what is left of it is glued to `type`, which then is
  // no `type` for the audit either; one less, and the name is read whole.
  // Both were reported before this round, and must be still. The same for an
  // unquoted value at exactly 4096.
  const both = async (x, valueLength) => brief(await auditOf(t, {
    [HTML]: page(
      `<script ${x}type="application/json" type="text/javascript">alert(1)</script>`,
      `<script ${x}src="data.js" src="admin/vendor/cms.js"></script>`,
      `<a ${x}href="ok.html" href="javascript:alert(1)">link</a>`,
      `<iframe ${x}src="ok.html" src="https://evil.example/"></iframe>`,
      `<script data=${'a'.repeat(valueLength)}type=application/json>alert(1)</script>`,
    ),
  }));
  const expected = [
    `${HTML}:1 [script-inline]`, `${HTML}:2 [script-src]`, `${HTML}:3 [script-url]`,
    `${HTML}:4 [unsupported-tag]`, `${HTML}:4 [external-url]`, // (ruling AE 1: an <iframe>)
    `${HTML}:5 [script-inline]`,
  ];
  assert.deepEqual(await both(X255, 4095), expected, '255 characters, 4095 of a value');
  assert.deepEqual(await both('x'.repeat(257), 4097), expected, '257 characters, 4097 of a value');
});

test('ruling AC(1) — no repeated attribute needed: a `type` / `src` glued to a long name is no attribute at all, so the script runs inline', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      `<script ${X256}type="application/json">alert(1)</script>`,
      `<script ${X256}src="data.js">alert(1)</script>`,
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [script-inline]`, `${HTML}:2 [script-inline]`]);
});

test('ruling AC(1) — an unquoted value is read to its real end: 4096 a\'s and then, with no blank, a `type` / `src` that is part of the value', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      `<script data=${A4096} type=application/json>alert(1)</script>`, // a blank: a second attribute, a data block — the browser runs nothing
      `<script data=${A4096}type=application/json>alert(1)</script>`, // no blank: one value, no `type` — the browser runs it
      `<script data=${A4096} src=data.js>alert(1)</script>`, // a blank: src is the first-party data.js — the browser runs the inline body not
      `<script data=${A4096}src=data.js>alert(1)</script>`, // no blank: no `src` — the browser runs the inline body
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:2 [script-inline]`, `${HTML}:4 [script-inline]`]);
});

test('ruling AC(1) — however long a name or a value, it is read to its end: 100 000 characters, and a value with a quote in it', async (t) => {
  const long = 'x'.repeat(100000);
  const violations = await auditOf(t, {
    [HTML]: page(
      `<script ${long}type="text/javascript">alert(1)</script>`,
      `<img ${long}src="https://evil.example/x.png" alt="">`,
      `<iframe data=${'a'.repeat(5000)}" src="https://evil.example/"></iframe>`, // the unquoted value ends at the blank; src is its own attribute
      `<img src="${'a'.repeat(100000)}" alt="">`, // a quoted value that long is still one value
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [script-inline]`,
    `${HTML}:2 [external-url]`,
    `${HTML}:3 [unsupported-tag]`, `${HTML}:3 [external-url]`, // (ruling AE 1: an <iframe>)
  ]);
  // the snippet of a report entry is where a length limit belongs
  assert.ok(violations.every((v) => v.detail.length <= 160), 'no detail longer than 160 characters');
});

test('ruling AC(4) — a repeated href, both ways: the browser keeps the first, and so does the audit', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="javascript:alert(1)" href="ok.html">the javascript: one is the first — the live href</a>',
      '<a href="ok.html" href="javascript:alert(1)">ok.html is the first — the second is dropped</a>',
      `<a ${X256}href="javascript:alert(1)" href="ok.html">the long name is not href: ok.html is the live one; the javascript: value is still reported, in any attribute</a>`,
      `<a ${X256}href="ok.html" href="javascript:alert(1)">the long name is not href: the javascript: one is the live href</a>`,
    ),
  });
  assert.deepEqual(brief(violations), [1, 3, 4].map((n) => `${HTML}:${n} [script-url]`));
});

test('ruling AC(1) — the tag name is read to its end too (300 characters): what follows it is read as before (a control)', async (t) => {
  const name = 'x'.repeat(300);
  const violations = await auditOf(t, {
    [HTML]: page(`<${name} onclick="alert(1)">text</${name}>`, `<${name} src="https://evil.example/x.png">text</${name}>`),
  });
  // the second line: the browser loads nothing from an unknown element; the audit reports the outside address in any attribute (ruling AA) — the safe side, as before.
  // And (ruling AE 1) an unknown element is not on the allow-list: each line reports the tag first.
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [inline-event-handler]`,
    `${HTML}:2 [unsupported-tag]`, `${HTML}:2 [external-url]`,
  ]);
});

// ---------------------------------------------------------------------------
// Review round 2 — Important: a string that the END OF THE TEXT closes
//
// The lexer dropped every string that its quote did not close — whether a
// line break ended it (a bad string, which a browser drops too) or the text
// itself did. CSS Syntax 3 drops only the first: at the end of the text the
// string stands, with what was read of it. A browser requests the address in
// it — in a <style>, in a style="" attribute, at the end of a stylesheet
// file — and the audit said nothing.
//
// Each line below was tried in Chrome 152 (task-6b report, round 2), the
// controls included: a string that a LINE BREAK ends is requested by nobody.
// ---------------------------------------------------------------------------

test('review round 2, Important — a string that the end of the text closes still holds its address: @import in a <style>, left open four ways', async (t) => {
  const violations = await auditOf(t, {
    // (ruling AE 2: in the <head>, where a <style> belongs)
    [HTML]: page(
      '<head><style>@import "https://evil.example/a.css</style>',
      "<style>@import 'https://evil.example/b.css</style>",
      '<style>@import "https://evil.example/c.css\\</style>', // ending in a backslash
      '<style>@import "https://evil.example/d.css\\\r\n</style>', // a backslash, then CRLF — one line to HTML, one to CSS
      '<style>@import "https://evil.example/e.css\\\n</style></head>', // a backslash, then LF
    ),
  });
  // (the fourth line holds a line break of its own, so the fifth is on line 6)
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 6].map((n) => `${HTML}:${n} [css-external-url]`));
});

test('review round 2, Important — …and url(, image-set( in a <style>, a url( in a style="" attribute', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>f3{background:url("https://evil.example/f3.png</style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      '<style>f5{background:image-set("https://evil.example/f5.png 1x)}</style></head>', // the open string swallows ` 1x)}` into the address — the browser asks for exactly that
      '<div style="background:url(\'https://evil.example/f7.png">x</div>', // open to the end of the attribute value
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [css-external-url]`));
});

test('review round 2, Important — the same at the end of a stylesheet file: @import and url(, each kind of address', async (t) => {
  const cases = [
    ['@import "https://evil.example/x.css', 'css-external-url'],
    ['a{background:url("https://evil.example/y.png', 'css-external-url'],
    ['@import "//evil.example/z.css', 'css-external-url'],
    ['@import "/root.css', 'css-root-relative'],
    ['a{background:url("data:image/png;base64,AAAA', 'css-data-url'],
    ['@import "https://evil.example/closed.css"', 'css-external-url'], // closed, no `;`: whole to the end — a control, reported before this round too
  ];
  for (const [text, code] of cases) {
    assert.deepEqual(brief(await auditOf(t, { 'css/theme.css': text })), [`css/theme.css:1 [${code}]`], text);
  }
});

test('review round 2, Important — the controls: a string that a LINE BREAK ends is a bad string, dropped as a browser drops it; an open string with no outside address reports nothing', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      // (ruling AE 2: in the <head>, where a <style> belongs)
      '<head><style>@import "https://evil.example/b1.css\nbody{color:red}</style>',
      '<style>@import "https://evil.example/b2.css\n</style>',
      '<style>@import "https://evil.example/b3.css\n";</style>',
      '<style>b4{background:url("https://evil.example/b4.png\n)}</style>',
      '<style>@import "theme-more.css</style>', // open, and a site file: asked for, allowed
      '<style>e11{content:"just text, never closed}</style></head>',
    ),
    'css/theme.css': '@import "https://evil.example/u12.css\n', // open, then the line ends the file
    'css/other.css': '@import "https://evil.example/b8.css\nbody{color:red}\n',
  });
  assert.deepEqual(violations, []);
});

// ---------------------------------------------------------------------------
// Review round 2 — ruling AC(2): a style attribute is decoded before it is
// read as CSS
//
// A browser decodes the character references of an attribute value before it
// reads that value as CSS: style="background:url(&quot;https://…&quot;)" is a
// quoted address to it. The audit gave the raw value to the CSS lexer, which
// saw `&quot;` — no quote, no address it knew. The same decoding reaches
// every character the CSS syntax is made of: the `*` of a comment's end
// (&ast;/), the letters of `url` (&#114;), a quote written without its `;`
// (&quot + a blank), a tab inside an address (&Tab;), which a URL parser
// drops.
//
// Two things go the other way, and the audit over-reported: inside a
// <style> element or a stylesheet file the browser decodes NOTHING (the
// audit decoded `&#104;ttps://` there); and it decodes ONCE — `&#38;quot;`
// is `&quot;` written out, not a quote (the audit, in two passes, made it
// one). Each line was tried in Chrome 152 (task-6b report, round 2).
// ---------------------------------------------------------------------------

test('ruling AC(2) — a style attribute is decoded before it is read as CSS: &quot; and &apos; are quotes to the browser (the reviewer\'s two)', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div style="background:url(&quot;https://evil.example/h.png&quot;)">x</div>',
      '<div style="background:url(&apos;https://evil.example/i.png&apos;)">x</div>',
      '<div style="background:url(https://evil.example/j.png)">x</div>', // nothing to decode — a control
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [css-external-url]`));
});

test('ruling AC(2) — the decoding reaches every character the CSS syntax is made of: the end of a comment, a name, a quote without its `;`, a tab in the address', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div style="/* &ast;/ background:url(https://evil.example/e3.png)">x</div>', // &ast;/ closes the comment the audit never saw closed
      '<div style="background:url(&quot https://evil.example/e4.png &quot)">x</div>', // no `;`, then a blank: decoded all the same
      '<div style="background:u&#114;l(&quot;https://evil.example/e6.png&quot;)">x</div>', // `url` itself, spelled with a reference
      '<div style="background:u&#x72;l(https://evil.example/e6b.png)">x</div>', // a hexadecimal one
      '<div style="background:url(&quot;https://evil.example/e7&#Tab;.png&quot;)">x</div>', // a tab, which the URL parser drops
      '<div style="&sol;*&ast;/ background:url(https://evil.example/e8.png)">x</div>', // a whole empty comment, written with references — a control, reported before this round too
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5, 6].map((n) => `${HTML}:${n} [css-external-url]`));
});

test('ruling AC(2) — decoded ONCE, as a browser does: &#38;quot; is `&quot;` written out, and &quot with a letter after it is not decoded at all', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div style="background:url(&#38;quot;https://evil.example/e9.png&#38;quot;)">x</div>', // the browser asks for a relative address named `&quot;https:…`
      '<div style="background:url(&quothttps://evil.example/e5.png)">x</div>', // for historical reasons `&quot` stays when a letter follows
      '<a href="javascript&#38;colon;alert(1)">a link to a relative address, not a script</a>', // the same in a URL attribute
    ),
  });
  assert.deepEqual(violations, []);
});

test('ruling AC(2) — where the browser decodes nothing, the audit decodes nothing: inside a <style> element and in a stylesheet file', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>e10{background:url(&quot;https://evil.example/e10.png&quot;)}</style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      '<style>e11{background:url("&#104;ttps://evil.example/e11.png")}</style></head>',
    ),
    'css/theme.css': 'a{background:url("&#104;ttps://evil.example/x.png")}',
  });
  assert.deepEqual(violations, []);
});

test('ruling AC(2) — once decoded, the CSS rules apply as anywhere else: a line break inside the string makes it a bad string; a blank inside does not', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div style="background:url(\'https://evil.example/b7.png&#10;\')">x</div>', // decoded to a line break, before the quote: the browser asks for nothing
      '<div style="background:url(\'https://evil.example/e12&#32;.png\')">x</div>', // decoded to a blank, inside a closed string: asked for
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:2 [css-external-url]`]);
});

// A control: these edges read the same in the decoder as it was and in the
// rewritten one (it was checked against the old file before the commit).
test('the decoder — its edges, as a control: a reference to 0, to a surrogate, past U+10FFFF; names with and without `;`; hexadecimal', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<a href="&#xD800;javascript:alert(1)">a surrogate is U+FFFD in HTML</a>',
      '<a href="&#0;javascript:alert(1)">0 is U+FFFD too</a>',
      '<a href="&#99999999999999999999;javascript:alert(1)">past U+10FFFF as well</a>',
      '<a href="&QUOT;javascript:alert(1)">&QUOT; is a quote, a capital name of its own</a>',
      '<a href="&APOS;javascript:alert(1)">&APOS; is no reference at all — no capital of that one</a>',
      '<a href="javascript&colon alert(1)">the colon named without its `;` is no reference</a>',
      '<a href="javascript&colon;alert(1)">the colon, named</a>',
      '<a href="&#x6A;&#97;vascript:alert(1)">hexadecimal and decimal</a>',
      '<a href="&#X6A;avascript:alert(1)">a capital X too</a>',
    ),
  });
  assert.deepEqual(brief(violations), [7, 8, 9].map((n) => `${HTML}:${n} [script-url]`));
});

// ---------------------------------------------------------------------------
// Review round 2 — ruling AC(3): the time the audit takes
//
// Three places grew with the square. The report snippet was built for every
// attribute of a tag — eagerly, as an argument — though only a tag with a
// violation ever shows one; the names seen on a tag were kept in a list and
// scanned for each further attribute; and the line of every violation was
// counted from the top of the file, one violation after another. 32 000
// attributes took 46 seconds. The third the re-review did not name: with
// 8 000 distinct event attributes, 3.7 s at the top of a file and 25 s after
// a megabyte of it. One shape of it is in the CSS path too: the line a
// violation is on was searched for from the top, and to the end, each time.
//
// What is asserted is an upper bound with room: linear reading takes a few
// milliseconds on these files, the square took seconds.
// ---------------------------------------------------------------------------

const letters = (n) => { let s = ''; do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

test('ruling AC(3) — time grows with the size, not with its square: one tag of 6000 attributes (3000 distinct event attributes), 300 000 lines into the file', async (t) => {
  const attributes = Array.from({ length: 6000 }, (_, n) => (n % 2 ? `data-a${n}="1"` : `on${letters(n)}="x${n}()"`)).join(' ');
  const linesBefore = 300000;
  const started = performance.now();
  const violations = await auditOf(t, { [HTML]: `${'p\n'.repeat(linesBefore)}<div ${attributes}></div>\n` });
  const ms = performance.now() - started;
  assert.equal(violations.length, 3000, 'one entry per event attribute');
  assert.ok(violations.every((v) => v.code === 'inline-event-handler' && v.line === linesBefore + 1), 'each on the line the tag is on');
  assert.ok(ms < 500, `the audit took ${ms.toFixed(0)} ms — it used to take seconds here, and minutes with more attributes`);
});

test('ruling AC(3) — the same for a long stylesheet: 8000 rules, each with an outside address, and not one line break in it', async (t) => {
  const css = Array.from({ length: 8000 }, (_, i) => `c${i}{background:url("https://evil.example/${i}.png")}`).join('');
  const started = performance.now();
  const violations = await auditOf(t, { 'css/theme.css': css });
  const ms = performance.now() - started;
  assert.equal(violations.length, 8000);
  assert.ok(violations.every((v) => v.code === 'css-external-url' && v.line === 1));
  assert.ok(ms < 500, `the audit took ${ms.toFixed(0)} ms — it used to grow with the square of the number of addresses`);
});

// ---------------------------------------------------------------------------
// Review round 2 — found while parsing exactly, after the four fixes above:
// inside <svg> / <math> a <script/> or <style/> IS self-closing — for a browser
//
// The audit took every <script> and <style> for an HTML one: an element whose
// content is text up to the next </script> or </style>. In an HTML document
// that is so — but inside foreign content (SVG, MathML) the start tag ends
// where its `/>` says, and what follows it is markup again. So, given
//   <svg><script/></svg>   <iframe src="javascript:alert(1)"></iframe>
// the browser ran the iframe's script, and the audit — looking for a
// </script> that never came — read the rest of the file as the text of that
// script: nothing in it was checked. Every line was tried in Chrome 152
// (task-6b report, round 2).
//
// Round 2 answered with a count of the <svg> / <math> seen opened, round 3
// with never leaving the foreign content at all — a state machine, and every
// new gap of the rounds came out of it. Round 4 (ruling AE 1 and AE 3) answers
// with neither: an <svg> or a <math> is not on the allow-list, so a page that
// holds one is refused for it whatever is written inside — and the audit reads
// the page by the HTML rules throughout, a <script/> being an HTML script
// wherever it stands. The strings of this section are kept as they were; what
// is asserted is what the audit says of them now: the page is refused — for
// the tags that are not on the allow-list, and for each executable <script> —
// and what a browser loaded or ran after an HTML <script/> that never closes
// is the script's text to the audit, and is not read.
// ---------------------------------------------------------------------------

test('review round 2, found while parsing exactly, read by the HTML rules — an <svg> or a <math> is refused, and a <script/> or <style/> inside it is an HTML one: what follows it is its text, to the next </script> or </style>', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<svg><script/></svg>', // to a browser an empty SVG script; to the audit an HTML <script/>, open — its text runs to the </script> of line 5
      '<iframe src="https://evil.example/q1.html"></iframe>', // script text: not read
      '<svg><style/></svg>', // script text
      '<img src="https://evil.example/q2.png" alt="">', // script text
      '<svg><script>alert(1)</script></svg>', // the </script> that ends the script of line 1 — so no tag of this line is read
      '<svg><style>@import "https://evil.example/q4.css";</style></svg>', // an HTML <style>: its CSS is read, and its address reported
      '<svg><style><img src="https://evil.example/q5.png"></style></svg>', // …and here the <img> is the <style>'s CSS text: no address, and no tag
      '<math><style/></math>', // an HTML <style/>, open to the end of the page
      '<iframe src="https://evil.example/q6.html"></iframe>', // style text: not read
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [script-inline]`,
    `${HTML}:6 [unsupported-tag]`, `${HTML}:6 [unsupported-tag]`, `${HTML}:6 [css-external-url]`,
    `${HTML}:7 [unsupported-tag]`, `${HTML}:7 [unsupported-tag]`,
    `${HTML}:8 [unsupported-tag]`, `${HTML}:8 [unsupported-tag]`,
  ]);
});

test('review round 2, found while parsing exactly, read by the HTML rules — an SVG <script/> with a data: href: refused for the <svg>, for the address and for the script; the <iframe> after it is the script\'s text', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<svg><script href="data:text/javascript,alert(1)"/></svg>', // runs in the browser; to the audit an HTML <script/> that nothing closes
      '<iframe src="javascript:alert(1)"></iframe>', // runs in the browser: the first navigation of the frame. To the audit the script's text
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [unsupported-tag]`, `${HTML}:1 [data-url]`, `${HTML}:1 [script-inline]`]);
});

test('review round 2, found while parsing exactly, read by the HTML rules — the `/` before `>` of a <script/> is nothing in HTML, and what follows is the script\'s text', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<div><script/></div>',
      '<iframe src="https://evil.example/q8.html"></iframe>', // script text: fetched by nobody
      '<svg></svg><script/>', // the SVG is closed first: an HTML script again
      '<iframe src="https://evil.example/q9.html"></iframe>', // script text as well
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [script-inline]`]); // the first <script/> swallows the rest, the browser as the audit
});

test('review round 2, found while parsing exactly, read by the HTML rules — where a browser leaves the SVG early (<desc> is an HTML integration point, <p> breaks out): the <script/> after it is an HTML script for both — and the image after it is the script\'s text to the audit', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<svg><desc><script/></desc></svg>', // <desc> is an HTML integration point: the browser makes an HTML script of it
      '<img src="https://evil.example/q10.png" alt="">', // …and never loads the image, which is that script's text
    ),
    'other.html': page(
      '<svg><p><script/></svg>', // <p> breaks out of the SVG: an HTML script again
      '<img src="https://evil.example/q11.png" alt="">', // …never loaded
    ),
  });
  // the page is refused for the tags that are not on the allow-list and for the script; the <p> is on the list, and
  // the images are the text of a script that nothing closes — as they are to the browser
  assert.deepEqual(brief(violations), [
    `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [unsupported-tag]`, `${HTML}:1 [script-inline]`, // the <svg>, the <desc>, the <script/>
    'other.html:1 [unsupported-tag]', 'other.html:1 [script-inline]', // the <svg>, the <script/>
  ]);
});

// ---------------------------------------------------------------------------
// Review round 2 — found while parsing exactly: two more places where the
// spec lets CSS write an address as a bare STRING
//
// The audit's CSS rules cover the syntaxes the spec has for a resource
// address: url(), @import, image-set() (a bare string in it is an address).
// Two were missing from that list. The src of @font-face takes a url as a
// bare string (CSS Fonts: `src: "font.woff2"`), and so does image(). Chrome
// 152 drops such a value and fetches nothing (task-6b report, round 2) — so
// reporting them over-reports, on the safe side, like a <script/> of an SVG.
// They are reported because the list is "what the spec lets be an address",
// not "what one browser loads today": an outside font that no word is said
// about is the same thing whether it was written with url() or without.
// ---------------------------------------------------------------------------

test('review round 2, found while parsing exactly — the src of @font-face may hold its address as a bare string: reported like url()', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>@font-face{font-family:f1;src:"https://evil.example/f1.woff2"}</style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      '<style>@font-face{font-family:f2;src:local("No Such Font"), "https://evil.example/f2.woff2" format("woff2")}</style>',
      '<style>@font-face{font-family:f3;src:"https://evil.example/f3.woff2" format("woff2") tech(variations)}</style>',
      '<style>@font-face{font-family:f4;src:"/f4.woff2"}</style></head>', // root-relative, as ever
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [css-external-url]`).concat(`${HTML}:4 [css-root-relative]`));
});

test('review round 2, found while parsing exactly — and only there: a font-family written as a string, a name in local(), a format() or tech() — none is an address', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>@font-face{font-family:"https://evil.example/not-an-address";src:local("https://evil.example/not-an-address")}</style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      '<style>@font-face{font-family:"https://evil.example/a";src:url("theme.woff2") format("https://evil.example/not-an-address")}</style>',
      '<style>x{content:"https://evil.example/not-an-address"}</style></head>', // a string in any other declaration
    ),
  });
  assert.deepEqual(violations, []);
});

test('review round 2, found while parsing exactly — image() takes its address as a bare string too, like image-set()', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head><style>x{background-image:image("https://evil.example/i.png")}</style>', // (ruling AE 2: in the <head>, where a <style> belongs)
      '<style>x{background-image:image("https://evil.example/j.png" type("image/png"))}</style>',
      '<style>x{background-image:image(url("https://evil.example/k.png"))}</style></head>', // url() inside: read by the url() rule, once
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3].map((n) => `${HTML}:${n} [css-external-url]`));
});

// ---------------------------------------------------------------------------
// Review round 3 — the Critical of the re-review: a </svg> or </math> inside a
// comment, a CDATA section or a processing instruction is TEXT to a browser.
// The audit took it for the end tag, left the foreign content, and read what
// followed as the text of an HTML <script>: a data block holding <img
// onerror> was executed by the browser and reported by nobody.
//
// The audit no longer leaves. Once it has seen an <svg> or <math> that does
// not close itself, it reads the rest of the page the way it reads foreign
// content: the content of a <script> or <style> is markup (a <style>'s is
// CSS as well), and nothing is skipped. It used to count on leaving at
// </svg>. A browser leaves at more places than that (an element that breaks
// out, an HTML integration point) and, as the re-review showed, at fewer: a
// </svg> that is not a token leaves nowhere. A count that is wrong in that
// direction reads LESS than the browser does; no count reads more. What that
// costs is on the safe side and is pinned below as "the price of never
// leaving": after the first <svg> the body of an HTML <script> is read as
// markup too.
//
// Reading the code for the Critical found an end tag read short. An end
// tag may carry attributes, and a quoted value may hold a `>`; the audit
// resumed right after the FIRST `>` — inside that value. A <script src> of
// the allow-list written there made it skip the rest of the page, and
// nothing was reported while the browser ran an <img onerror> after it. No
// <svg> is needed for that: it is plain HTML, and it was there from the
// first. An end tag is now read to where it ends.
//
// It found the CSS of a <style> read short too. The audit took a <style>
// in foreign reading for an element whose content runs to the first
// </style>. In foreign content a </style> inside a comment, a CDATA
// section, a processing instruction or a tag is no token, and the first one
// that IS a token may close a <style> nested inside; the browser applies the
// text nodes that are the element's own children up to where the element
// really ends. The CSS is now read to there.
//
// Each attack string is a test of its own, each on a page of its own.
// Every line was tried in Chrome 152 (task-6b report, round 3).
//
// Round 4 (ruling AE) — what the table asserts has changed with the reading.
// Every string of it holds a tag that is not on the allow-list — an <svg>, a
// <math>, a <style> in the body, an <iframe> … —, so every one of them still
// fails the build: for that tag, and for each further one inside it. What a
// browser executed or loaded INSIDE the <svg> is not named by the audit any
// more: the page is read by the HTML rules throughout, and nothing inside an
// <svg> is parsed — an <svg> costs its page the build whatever is written in
// it, and what a contributor is told to do is delete it with all that is
// inside it. The entry of round 3 is kept at the end of each line. The seven
// e-strings, on pages without an <svg>, read exactly as before. The strings
// themselves are untouched.
// ---------------------------------------------------------------------------

const R3 = 'r3.html';
/** The payload of a data block: an <img> that runs script when its address fails. */
const R3_IMG = (id) => `<img src=x onerror="alert('${id}')">`;
/** A data block holding the payload: no violation by itself, wherever it stands. */
const R3_BLOCK = (id, type = 'application/json') => `<script type="${type}">${R3_IMG(id)}</script>`;
/** What the audit reports on the one line of a page: the codes in document order. */
const R3_CODES = (...codes) => codes.map((code) => `${R3}:1 [${code}]`);
/** What R3_ICON is under the allow-list (ruling AE 1): its eleven tags — the <svg>, every tag inside it, the <style> after it. */
const R3_TAGS = Array(11).fill('unsupported-tag');
/** A legitimate inline SVG: a gradient, shapes, a title and a description, a comment. */
const R3_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><title>Search</title><desc>A magnifying glass</desc>'
  + '<defs><linearGradient id="r3g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#ccc"/></linearGradient></defs>'
  + '<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="10" cy="10" r="7" fill="url(#r3g)"/><path d="M15 15l6 6"/></g><!-- a comment --></svg>'
  + '<style>.r3{fill:url(#r3g)}</style>';

const ROUND3 = [
  // --- the Critical, in each kind of text a browser does not read as markup
  ['c01', 'Critical — </svg> inside a comment, then a data block holding <img onerror> (the shortest string of the re-review)', `<svg><!-- </svg> -->${R3_BLOCK('c01')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c02', 'Critical — </svg> inside a comment, then a data block of type text/plain holding <img onerror>', `<svg><!-- </svg> -->${R3_BLOCK('c02', 'text/plain')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c03', 'Critical — </svg> inside a comment, then a data block holding <foreignObject><script>', '<svg><!-- </svg> --><script type="application/json"><foreignObject><script>alert(\'c03\')</script></script>', ['unsupported-tag']], // round 3: [script-inline]
  ['c04', 'Critical — </svg> inside a comment, then a data block holding an outside <img src>', '<svg><!-- </svg> --><script type="application/json"><img src="https://evil.example/c04.png"></script>', ['unsupported-tag']], // round 3: [external-url]
  ['c05', 'Critical — </svg> inside a comment, then a data block holding <a href="javascript:…">', '<svg><!-- </svg> --><script type="application/json"><a href="javascript:alert(\'c05\')">c05</a></script>', ['unsupported-tag']], // round 3: [script-url]
  ['c06', 'Critical — </svg> inside a comment, then a <style> holding <a href="javascript:…">', '<svg><!-- </svg> --><style><a href="javascript:alert(\'c06\')">c06</a></style>', ['unsupported-tag', 'unsupported-tag']], // the <svg> and the <style>; round 3: [script-url]
  ['c07', 'Critical — </svg> inside a CDATA section, then a data block holding <img onerror>', `<svg><g><![CDATA[ </svg> ]]>${R3_BLOCK('c07')}`, ['unsupported-tag', 'unsupported-tag']], // the <svg> and the <g>; round 3: [inline-event-handler]
  ['c08', 'Critical — </svg> inside a CDATA section that follows <svg> itself, then a data block holding <img onerror>', `<svg><![CDATA[</svg>]]>${R3_BLOCK('c08')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c09', 'Critical — </math> inside a comment, then a data block holding <img onerror>', `<math><!-- </math> -->${R3_BLOCK('c09')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c10', 'Critical — </svg> inside a CDATA section inside an SVG <style>, then a data block holding an outside <img src>', '<svg><style><![CDATA[ </svg> ]]></style><script type="application/json"><img src="https://evil.example/c10.png"></script>', ['unsupported-tag', 'unsupported-tag']], // the <svg> and the <style>; round 3: [external-url]
  ['c11', 'Critical — </svg> inside a processing instruction, then a data block holding <img onerror>', `<svg><?pi </svg> ?>${R3_BLOCK('c11')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c12', 'Critical — </math> inside a processing instruction, then a data block holding <img onerror>', `<math><?pi </math> ?>${R3_BLOCK('c12')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c13', 'Critical — </math> inside a CDATA section, then a data block holding <img onerror>', `<math><![CDATA[</math>]]>${R3_BLOCK('c13')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c14', 'Critical — </svg> inside a bogus comment (<!…>), then a data block holding <img onerror>', `<svg><!bogus </svg> >${R3_BLOCK('c14')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c15', 'Critical — </svg> inside the quoted system identifier of a DOCTYPE, then a data block holding <img onerror>', `<svg><!DOCTYPE html SYSTEM "</svg>">${R3_BLOCK('c15')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c16', 'Critical — </svg> inside a comment that looks nested (comments do not nest: the first --> ends it), then a data block holding <img onerror>', `<svg><!-- <!-- </svg> --> -->${R3_BLOCK('c16')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['c17', 'Critical — </math> inside a CDATA section after <mrow>, then a data block holding <img onerror>', `<math><mrow><![CDATA[</math>]]>${R3_BLOCK('c17')}`, ['unsupported-tag', 'unsupported-tag']], // the <math> and the <mrow>; round 3: [inline-event-handler]
  ['k01', 'a </svg> inside a quoted attribute value: the page is refused for the <svg> and the <g>; the data block after it is an HTML one to the audit too — its content is text', `<svg><g title="</svg>">${R3_BLOCK('k01')}`, ['unsupported-tag', 'unsupported-tag']], // round 3: [inline-event-handler]
  // --- where a browser closes the <svg> early (a comment that closes at once,
  // a </svg> that is a token): the data block after it is an HTML one there.
  // It is one to the audit as well — the payload in it is text to both, and
  // the page is refused for the <svg> alone. (Round 3, never leaving the
  // foreign content, read it as markup and reported the payload besides.)
  ['p01', 'a comment that closes at once (<!-->), so the </svg> after it closes the SVG for a browser too', `<svg><!--></svg>-->${R3_BLOCK('p01')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['p02', 'a comment that closes at once (<!--->)', `<svg><!---></svg>-->${R3_BLOCK('p02')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['p03', 'a comment that ends with --!>, so the </svg> after it is a token', `<svg><!-- x --!> </svg> -->${R3_BLOCK('p03')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['p04', 'a </svg> inside a comment, and then the real one', `<svg><!-- </svg> --></svg>${R3_BLOCK('p04')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  ['p05', '</svg> inside the text of an SVG script: a token there, which closes the SVG; the script is an executable one to the audit, the data block after it is not read', `<svg><script>var s = "</svg>";</script>${R3_BLOCK('p05')}`, ['unsupported-tag', 'script-inline']], // round 3: [script-inline, inline-event-handler]
  ['p06', 'a </svg> inside a CDATA section, and then the real one', `<svg><![CDATA[ </svg> ]]> </svg>${R3_BLOCK('p06')}`, ['unsupported-tag']], // round 3: [inline-event-handler]
  // --- found while reading the code for the Critical: an end tag may carry
  // attributes, and a quoted value may hold a `>`. The audit resumed right
  // after the FIRST `>` — inside that value. A <script src> of the allow-list
  // written there made it skip the rest of the page: nothing was reported.
  ['e01', 'found while reading — an end tag carries an attribute whose quoted value holds >: a <script src> of the allow-list written inside that value hid all that followed', `<p></p title="x><script src=assets/js/search.js>y">${R3_IMG('e01')}`, ['inline-event-handler']],
  ['e02', 'found while reading — the same, after a script of the allow-list', `<script src="assets/js/search.js"></script a="x><script src=assets/js/search.js>y">${R3_IMG('e02')}`, ['inline-event-handler']],
  ['e03', 'found while reading — the same, after a data block', `<script type="application/json">{}</script a="x><script type="application/json">y">${R3_IMG('e03')}`, ['inline-event-handler']],
  ['e04', 'found while reading — the same, after a <style>: the link with a javascript: address that followed was never read', '<style>x</style a="x><style>y"><a href="javascript:alert(\'e04\')">e04</a>', ['unsupported-tag', 'script-url']], // the <style> is in the body (ruling AE 2); round 3: [script-url]
  ['e05', 'found while reading — the same with single quotes', `<p></p title='x><script src=assets/js/search.js>y'>${R3_IMG('e05')}`, ['inline-event-handler']],
  ['e06', 'control — an end tag with an attribute and no > inside its value: read right before', `<script src="assets/js/search.js"></script x="y">${R3_IMG('e06')}`, ['inline-event-handler']],
  ['e07', 'control — a start tag with > inside a quoted value: read right before', `<div title="a>b">${R3_IMG('e07')}`, ['inline-event-handler']],
  ['e08', 'found while reading — the same before an embedded page from outside', '<p></p title="x><script src=assets/js/search.js>y"><iframe src="https://evil.example/e08.html"></iframe>', ['unsupported-tag', 'external-url']], // round 3: [external-url]
  ['k03', 'the control of the re-review: a data block inside an <svg> with no comment — a data block to the audit, whatever is in it; refused for the <svg> alone', `<svg><script type="application/json">${R3_IMG('k03')}</script>`, ['unsupported-tag']], // round 3: [inline-event-handler]
  // --- the CSS of a <style> after an <svg>: read like that of any <style>,
  // from where its start tag ends to the first </style> — a <style/> does not
  // close itself in HTML, so what follows it is its text (round 2: a browser
  // closes it there and fetches the @import after it all the same, with its
  // preload scanner). The address is named beside the two tags.
  ['b01', 'a <style/> after a closed <svg>: an HTML style to the audit — its CSS is read', '<svg></svg><style/>@import url(https://evil.example/b01.css);</style>', ['unsupported-tag', 'unsupported-tag', 'css-external-url']],
  ['b10', 'a <style/> after a closed <svg>: a url() in what follows is read', '<svg></svg><style/>x{background:url(https://evil.example/b10.png)}</style>', ['unsupported-tag', 'unsupported-tag', 'css-external-url']],
  ['b08', 'a <style/> inside an <svg> closes itself and stays empty for a browser, which fetches an @import after it all the same (its preload scanner reads the text on to </style>): read like an HTML <style/>', '<svg><style/>@import url(https://evil.example/b08.css);</style></svg>', ['unsupported-tag', 'unsupported-tag', 'css-external-url']],
  // --- the address sits after the first </style> of the page. INSIDE the
  // SVG <style> for a browser — a nested <style>, a comment, a tag, a
  // processing instruction or a CDATA section holds the </style> that ends
  // the range for the audit —, and each of these was fetched in Chrome 152
  // (task-6b report, round 3). The audit does not parse what is inside an
  // <svg> (ruling AE 3): it reads the <style> by the HTML rules, to the first
  // </style>, and does not name the address. The page is refused all the
  // same — for the <svg> and the <style> themselves —, and what a contributor
  // is told to do is delete the <svg> with all that is inside it. (Round 3,
  // with the state machine, named it: css-external-url.)
  // b11 and b12: the browser fetched nothing there — and the audit names
  // nothing there now (round 3 read more than the browser applied).
  ['b06', 'the CSS of an SVG <style> inside a CDATA section: before the first </style> — read', '<svg><style><![CDATA[ @import url(https://evil.example/b06.css); ]]></style></svg>', ['unsupported-tag', 'unsupported-tag', 'css-external-url']],
  ['b02', 'the CSS of an SVG <style> after a nested <style>: after the first </style>', '<svg><style><style></style>@import url(https://evil.example/b02.css);</style></svg>', ['unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  ['b03', 'the CSS of an SVG <style> after a comment holding </style>', '<svg><style><!-- </style> -->@import url(https://evil.example/b03.css);</style></svg>', ['unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  ['b04', 'the CSS of an SVG <style> after a tag whose quoted value holds </style>', '<svg><style><g title="</style>"></g>@import url(https://evil.example/b04.css);</style></svg>', ['unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  ['b05', 'the CSS of an SVG <style> after a processing instruction holding </style>', '<svg><style><?pi </style> ?>junk{} rect{fill:url(https://evil.example/b05.png)}</style><rect width="8" height="8"/></svg>', ['unsupported-tag', 'unsupported-tag', 'unsupported-tag']], // the <svg>, the <style>, the <rect>; round 3: [css-external-url]
  ['b07', 'the CSS of an SVG <style> after a CDATA section holding </style>', '<svg><style><![CDATA[ </style> ]]>junk{} rect{fill:url(https://evil.example/b07.png)}</style><rect width="8" height="8"/></svg>', ['unsupported-tag', 'unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  ['b09', 'the CSS of an SVG <style> after two nested <style>', '<svg><style><style><style></style></style>@import url(https://evil.example/b09.css);</style></svg>', ['unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  ['b11', 'an HTML integration point (<desc>) inside an SVG <style>: the browser closed the style at the </style> before it and fetched nothing', '<svg><style><desc></style>@import url(https://evil.example/b11.css);</style>', ['unsupported-tag', 'unsupported-tag']], // the <svg> and the <style>; round 3: [css-external-url]
  ['b12', '</style> inside a tag that stays open: what follows is that element\'s text, which the browser applies nowhere', '<svg><style><g title="</style>">@import url(https://evil.example/b12.css);</style></svg>', ['unsupported-tag', 'unsupported-tag']], // round 3: [css-external-url]
  // --- a legitimate inline SVG is refused too: an <svg> is not on the
  // allow-list (ruling AE 1), one entry per tag inside it — and nothing for
  // the link and the script of the allow-list after it. An inline <script>
  // after an <svg> is an executable one as any other, and its body is its text.
  ['s01', 'a legitimate inline SVG, a <style> after it, a link and a script of the allow-list: the link and the script are not reported — the SVG and the <style> are, each tag inside them once', `${R3_ICON}<p>Text <a href="https://example.com/">a link</a>.</p><script src="assets/js/search.js"></script>`, R3_TAGS], // round 3: []
  ['s02', 'an inline <script> after an <svg>: executable, reported for itself; a tag-looking string in its body is the script\'s text — not read', `<svg><circle r="1"/></svg><script>var s = "${R3_IMG('s02')}";</script>`, ['unsupported-tag', 'unsupported-tag', 'script-inline']], // the <svg>, the <circle>; round 3: [script-inline, inline-event-handler]
  ['s03', 'an HTML <script/> after a closed <svg>: it opens a script that nothing closes, so the <iframe> after it is that script\'s text and is not read; the page is refused for the <svg> and the <script>', '<svg></svg><script/><iframe src="https://evil.example/s03.html"></iframe>', ['unsupported-tag', 'script-inline']], // round 3: [script-inline, external-url]
];

for (const [id, what, html, codes] of ROUND3) {
  test(`review round 3, ${what} [${id}]`, async (t) => {
    const violations = await auditOf(t, { [R3]: html });
    assert.deepEqual(brief(violations), R3_CODES(...codes));
  });
}

// Guards for the time the audit takes (ruling AC 3 of round 2 is the rule: linear reading takes milliseconds on
// these files; the square took seconds, or the memory of the process). What is asserted is an upper bound with room.
test('review round 3, read by the HTML rules — 200 <style> in a row, none ever closed, then 500 rules with an outside address: one element, 500 reports — each address once — in a few milliseconds', async (t) => {
  // To a browser the first <style> takes all the text: the 199 inside it are no elements, and its CSS is all of it.
  // (Round 3, reading foreign content, saw 200 elements inside one another and had to keep their CSS from being read
  // 200 times over; the guard it needed — what was read once was not read twice — is what let a first <style>
  // swallow the ones after it, ruling AE 4.)
  const html = `<svg>${'<style>'.repeat(200)}${Array.from({ length: 500 }, (_, i) => `c${i}{background:url("https://evil.example/${i}.png")}`).join('')}`;
  const started = performance.now();
  const violations = await auditOf(t, { [R3]: html });
  const ms = performance.now() - started;
  assert.deepEqual(brief(violations).slice(0, 2), [`${R3}:1 [unsupported-tag]`, `${R3}:1 [unsupported-tag]`], 'the <svg>, and the one <style>');
  assert.equal(violations.filter((v) => v.code === 'css-external-url').length, 500, 'each address once');
  assert.equal(violations.length, 502);
  assert.ok(ms < 500, `the audit took ${ms.toFixed(0)} ms`);
});

test('review round 3, read by the HTML rules — time grows with the size, not with its square: 30 000 <style>, none ever closed, after an <svg>', async (t) => {
  // The first <style> takes the rest of the text: ONE look for a </style>, to the end of it — where the audit of
  // round 2 looked once per element (10 000 took 12 seconds), and the state machine of round 3 had to read on
  // with nothing left to look for. Two tags are reported: the <svg>, and the one <style>.
  const html = `<svg>${'<style>'.repeat(30000)}`;
  const started = performance.now();
  const violations = await auditOf(t, { [R3]: html });
  const ms = performance.now() - started;
  assert.deepEqual(brief(violations), [`${R3}:1 [unsupported-tag]`, `${R3}:1 [unsupported-tag]`]);
  assert.ok(ms < 500, `the audit took ${ms.toFixed(0)} ms`);
});

test('review round 3, read by the HTML rules — and not with the number of comments either: one <style> never closed, 10 000 comments each holding a rule, then one rule — 10 001 addresses', async (t) => {
  // To the CSS scanner a `<!--` and a `-->` are nothing (CDO and CDC tokens), so the rule in each comment is CSS
  // that it reads: more than the browser applies — in an SVG <style> the comments are no text of the style —,
  // never less. The addresses are read once each, and the time does not grow with their number.
  const rule = 'x{background:url("https://evil.example/a.png")}';
  const html = `<svg><style>${`<!-- ${rule} -->`.repeat(10000)}${rule}`;
  const started = performance.now();
  const violations = await auditOf(t, { [R3]: html });
  const ms = performance.now() - started;
  assert.deepEqual(brief(violations).slice(0, 2), [`${R3}:1 [unsupported-tag]`, `${R3}:1 [unsupported-tag]`], 'the <svg>, and the one <style>');
  assert.equal(violations.filter((v) => v.code === 'css-external-url').length, 10001, 'what a comment holds is read as CSS too');
  assert.equal(violations.length, 10003);
  assert.ok(ms < 500, `the audit took ${ms.toFixed(0)} ms`);
});

// ===========================================================================
// Review round 4 — ruling AE: a tag allow-list, and no foreign content
//
// Every new gap of the three rounds before came out of the state machine
// that imitated how a browser parses SVG / MathML "foreign content" and
// where a <style> element ends. Ruling AE: imitate nothing. A ```html block
// may hold common tags only — a tag that is not on the allow-list is refused,
// whatever is inside it — so there is no foreign content left to parse, and
// the state machine is gone (AE 1, AE 3). The four elements that belong in
// the <head> are allowed there and nowhere else (AE 2). The CSS of every
// <style> is read on its own, to the first </style or the end of the text
// (AE 4). The allow-list is the common typographic tags of the ruling plus
// the structural tags the first-party templates emit — counted on the built
// site, with the audit's own tokenizer (task-6b round-4 report).
// ===========================================================================

// ---------------------------------------------------------------------------
// Ruling AE 2: <title>, <meta>, <link> and <style> belong in the <head>
//
// They are the head's own elements: a <link rel="stylesheet"> loads a file, a
// <style> is applied, a <meta http-equiv> can redirect — and a browser acts
// on them in the body just the same. The first-party templates write them in
// the <head> and nowhere else; what a contributor writes lands in the body.
// So in the body each is an unsupported tag.
//
// The audit cannot tell the template's head from one written into a page: it
// reads tags. The head is the first <head> … to the first </head> after it —
// the one a browser has too, for a <head> written in the body opens nothing
// there. Where the head cannot be told — no <head> at all, a <head> that is
// never closed, a <head/> — nothing is head and everything is body: the
// stricter reading.
// ---------------------------------------------------------------------------

/** The layout templates.js writes on every page, as far as its tags go (counted on the built site). */
const HEAD_LAYOUT = [
  '<!DOCTYPE html>',
  '<html lang="zh-Hans-CN">',
  '<head>',
  '<meta charset="UTF-8"/>',
  '<meta name="viewport" content="width=device-width, initial-scale=1"/>',
  '<title>首页 · 淫色深空 Wiki</title>',
  '<link rel="stylesheet" href="css/theme.css"/>',
  '</head>',
  '<body><div class="page-wrap"><p>正文</p></div></body>',
  '</html>',
].join('\n');

test('ruling AE 2 — in the <head> the four are not reported for where they stand: the layout of every first-party page, with a <style> and a second <link> as a template may write them', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: HEAD_LAYOUT.replace('</head>',
      '<link rel="icon" href="assets/favicon.png"/>\n<style>.a{fill:url(#grad)} b{background:url(assets/b.png)}</style>\n</head>'),
    'deep/page.html': HEAD_LAYOUT.replace('href="css/theme.css"', 'href="../css/theme.css"'),
  });
  assert.deepEqual(violations, []);
});

test('ruling AE 2 — in the body each of the four is an unsupported tag: once, where the tag starts, with the tag as its snippet — any case, self-closing or not', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<title>写在正文里的标题</title>',
      '<meta charset="UTF-8">',
      '<LINK rel="stylesheet" href="css/theme.css">',
      '<Style>.a{color:red}</style>',
      '<style/>',
    ),
  });
  assert.deepEqual(brief(violations), [1, 2, 3, 4, 5].map((n) => `${HTML}:${n} [unsupported-tag]`));
  assert.deepEqual(violations.map((v) => v.detail), [
    '<title>', '<meta charset="UTF-8">', '<LINK rel="stylesheet" href="css/theme.css">', '<Style>', '<style/>',
  ]);
});

test('ruling AE 2 — only the first <head>…</head> is the head. A <head> written in the body opens nothing; and where the head cannot be told — none, one never closed, a <head/>, one that opens later — everything before or outside it is body: the stricter reading', async (t) => {
  // [file, page, the lines that hold one of the four outside the head]
  const cases = [
    ['second.html', HEAD_LAYOUT.replace('</body>', '<head><meta charset="UTF-8"></head></body>'), [9]],
    ['none.html', '<meta charset="UTF-8">\n<p>no head at all</p>', [1]],
    ['never-closed.html', '<head>\n<meta charset="UTF-8">\n<link rel="stylesheet" href="css/theme.css">', [2, 3]],
    ['self-closing.html', '<head/>\n<meta charset="UTF-8">', [2]],
    ['opens-later.html', '<html>\n<meta charset="UTF-8">\n<head>\n<meta name="viewport" content="width=device-width">\n</head>', [2]],
  ];
  for (const [file, html, lines] of cases) {
    const violations = await auditOf(t, { [file]: html });
    assert.deepEqual(brief(violations), lines.map((n) => `${file}:${n} [unsupported-tag]`), html);
  }
});

test('ruling AE 2 — where the head ends is read by the rules of the rest of the audit: a </head> inside the text of a <script> or a <style> is no token and closes nothing', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head>',
      '<script type="application/json">{"a": "</head><meta charset=\\"UTF-8\\">"}</script>',
      '<style>.a::before{content:"</head>"}</style>',
      '<meta charset="UTF-8">',
      '<link rel="stylesheet" href="css/theme.css">',
      '</head>',
    ),
  });
  assert.deepEqual(violations, []);
});

test('ruling AE 2 — in the <head> the other rules apply as anywhere else: <meta http-equiv>, an outside or root-relative href of a <link>, the CSS of a <style>', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<head>',
      '<meta http-equiv="refresh" content="1">',
      '<link rel="stylesheet" href="https://evil.example/x.css">',
      '<link rel="stylesheet" href="/css/theme.css">',
      '<style>@import url(https://evil.example/y.css);</style>',
      '<style>a{background:url(/a.png)}</style>',
      '<title>ok</title>',
      '</head>',
    ),
  });
  assert.deepEqual(brief(violations), [
    `${HTML}:2 [meta-http-equiv]`,
    `${HTML}:3 [external-url]`,
    `${HTML}:4 [root-relative-url]`,
    `${HTML}:5 [css-external-url]`,
    `${HTML}:6 [css-root-relative]`,
  ]);
});

test('ruling AE 2 — the head-only tags are exactly title, meta, link and style, exported in order: the report reads the list to say where such a tag belongs', () => {
  assert.deepEqual([...auditModule.HEAD_ONLY_TAGS], ['link', 'meta', 'style', 'title']);
});

// ---------------------------------------------------------------------------
// Ruling AE 1: a tag allow-list
//
// The audit no longer keeps a list of what is dangerous — every round found
// one more thing to put on it. It keeps a list of what a ```html block may
// hold and refuses everything else: what a mature sanitizer does (MediaWiki
// included), and a far smaller surface to verify — the tags have to be cut
// out right and their names looked up, nothing more. SVG, MathML, <iframe>
// … are not allowed in contributor content at all, so nothing of what is
// inside them has to be parsed (AE 3).
//
// The allow-list is the typographic tags of the ruling plus the structural
// tags the first-party build emits. The latter were counted on the built
// site with the audit's own tokenizer — every tag name of the 21 pages, and
// whether it stands in the head or in the body (task-6b round-4 report):
//   templates.js layout    html head body div small span br a img form
//                          input button
//   templates.js infobox   table caption tr td th
//   render.js items.html   section
//   markdown.js            h1–h6 p ul ol li table thead tbody tr th td code
//                          strong em a img span
// (a, b, i, br, caption, code, h1–h4, li, ol, p, small, span, table, tbody,
// td, th, thead, tr, ul are on the typographic list already.)
// title, meta and link belong in the <head> (ruling AE 2); script and base
// are refused by their own rules wherever they stand (A4).
// ---------------------------------------------------------------------------

/** The common typographic tags of the ruling, as it lists them. */
const TYPOGRAPHIC_TAGS = 'a abbr b bdi bdo blockquote br caption code dd del details dfn dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img ins kbd li mark ol p pre q rp rt ruby s samp small span strong sub summary sup table tbody td tfoot th thead tr u ul var wbr'.split(' ');
/** What the first-party build emits beyond that list (counted on the built site). */
const STRUCTURAL_TAGS = ['body', 'button', 'div', 'form', 'head', 'html', 'input', 'section'];

test('ruling AE 1 — the allow-list is exactly the typographic tags of the ruling plus the structural tags the first-party build emits; the head-only tags and the two of their own rules are not on it', () => {
  assert.deepEqual([...auditModule.ALLOWED_TAGS].sort(), [...TYPOGRAPHIC_TAGS, ...STRUCTURAL_TAGS].sort(), 'as a set: the order is the source\'s own');
  assert.equal(auditModule.ALLOWED_TAGS.size, TYPOGRAPHIC_TAGS.length + STRUCTURAL_TAGS.length, 'no name twice');
  for (const name of [...auditModule.HEAD_ONLY_TAGS, 'script', 'base']) {
    assert.ok(!auditModule.ALLOWED_TAGS.has(name), `${name} is not on the allow-list`);
  }
});

test('ruling AE 1 — a tag that is not on the allow-list is refused wherever it stands: once, where the tag starts, with the tag as its snippet', async (t) => {
  const names = [
    // foreign roots, embedded content
    'svg', 'math', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal',
    // media, and what belongs to it
    'video', 'audio', 'source', 'picture', 'track', 'canvas', 'map', 'area',
    // form controls and structural elements that are not on the list
    'select', 'option', 'optgroup', 'textarea', 'label', 'fieldset', 'legend', 'datalist', 'output', 'progress', 'meter', 'dialog',
    'main', 'nav', 'header', 'footer', 'article', 'aside', 'address', 'hgroup', 'col', 'colgroup',
    // content that is not markup to a browser; obsolete elements
    'template', 'noscript', 'noembed', 'noframes', 'slot', 'marquee', 'center', 'font', 'big', 'strike', 'tt', 'acronym',
    // a custom element, an unknown one, names of other shapes. (A name that does not begin with an ASCII letter —
    // `<标签>` — is no tag to a browser either: its `<` is text.)
    'my-widget', 'x-foo', 'foo', 'x1', 'a_b', 'a.b', 'x-标签',
  ];
  const violations = await auditOf(t, { [HTML]: names.map((name) => `<${name}></${name}>`).join('\n') });
  assert.deepEqual(brief(violations), names.map((_, n) => `${HTML}:${n + 1} [unsupported-tag]`));
  assert.deepEqual(violations.map((v) => v.detail), names.map((name) => `<${name}>`), 'the tag as its snippet; the end tags are not reported');
});

test('ruling AE 1 — everything inside an unsupported tag is refused too, and what comes after it is read on', async (t) => {
  const icon = '<svg viewBox="0 0 24 24" aria-hidden="true"><title>Search</title><desc>A magnifying glass</desc>'
    + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/></linearGradient></defs>'
    + '<g fill="none"><circle cx="10" cy="10" r="7"/><path d="M15 15l6 6"/></g></svg>';
  const violations = await auditOf(t, { [HTML]: page(icon, '<p>after it</p><img src="https://evil.example/a.png" alt="">') });
  const inside = ['svg', 'title', 'desc', 'defs', 'linearGradient', 'stop', 'g', 'circle', 'path'];
  assert.deepEqual(brief(violations), [...inside.map(() => `${HTML}:1 [unsupported-tag]`), `${HTML}:2 [external-url]`]);
  inside.forEach((name, n) => assert.ok(violations[n].detail.startsWith(`<${name}`), `${name}: ${violations[n].detail}`));
});

test('ruling AE 1 — everything on the allow-list passes, written in the body as a contributor writes it: lower-case or capitals, self-closing where it may be', async (t) => {
  const VOID = new Set(['br', 'hr', 'img', 'input', 'wbr']);
  const names = [...auditModule.ALLOWED_TAGS];
  const element = (name) => (VOID.has(name) ? `<${name}/>` : `<${name}></${name}>`);
  assert.deepEqual(await auditOf(t, { 'lower.html': names.map(element).join('\n') }), []);
  assert.deepEqual(await auditOf(t, { 'capitals.html': names.map((name) => element(name.toUpperCase())).join('\n') }), []);
});

test('ruling AE 1 — what a contributor writes in markdown passes: every construct of the renderer, in the page layout', async (t) => {
  const { mdToHtml } = require('../tools/build/markdown.js');
  const { itemInline } = require('../tools/build/templates.js');
  const { html } = mdToHtml([
    '## 标题', '',
    '一段正文,含 [[milk_barrel]]、**粗体**、*斜体*、`代码` 和 [链接](https://example.com/)。', '',
    '![图](assets/a.png)', '',
    '| 列 | 右对齐 |', '| --- | ---: |', '| a | b |', '',
    '- 一项', '- 另一项', '  1. 子项', '', '```html', '<div class="flow">直通块 <span>OK</span></div>', '```',
  ].join('\n'), (id) => ({ id, name: `物品 ${id}`, icon: null }), (item) => itemInline(item, '../'));
  // every tag the renderer made is on the allow-list…
  const made = [...new Set([...html.matchAll(/<\/?([a-z][a-z0-9-]*)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(made, ['a', 'code', 'div', 'em', 'h2', 'img', 'li', 'ol', 'p', 'span', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'], 'what the renderer emits for every construct');
  for (const name of made) assert.ok(auditModule.ALLOWED_TAGS.has(name), `the renderer's <${name}> is on the allow-list`);
  // …and so is the page it is in
  assert.deepEqual(await auditOf(t, { 'mechanics/x.html': HEAD_LAYOUT.replace('<p>正文</p>', () => html) }), []);
});

test('ruling AE 1 — <script> and <base> are not "unsupported tags": each is refused by its own rule wherever it stands, and gets no second entry', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script>alert(1)</script>',
      '<script src="evil.js"></script>',
      '<script type="application/json">{}</script>', // a data block: allowed
      '<script src="data.js"></script>', // a source on the allow-list: allowed
      '<base href="x/">',
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [script-inline]`, `${HTML}:2 [script-src]`, `${HTML}:5 [base-tag]`]);
});

// ---------------------------------------------------------------------------
// Ruling AE 3: there is no foreign content
//
// The audit used to keep track of <svg> / <math> and of where a browser
// leaves them — a state machine, and every new gap of three rounds came out
// of it. It is gone. A tag that is not on the allow-list is refused, so an
// <svg> or a <math> costs its page the build whatever is written inside it:
// nothing inside has to be parsed right. From there on the page is read by
// the HTML rules, as it is without one: the content of a <script> or a
// <style> is text to the first matching end tag, wherever the element
// stands.
//
// What that costs is on one side only, and that side is safe: inside an
// <svg> a browser reads a <script/> as self-closing and the content of a
// <style> as markup — so the audit may read LESS than the browser does after
// an <svg> (the text of an HTML <script/> that never closes). The page is
// refused for the <svg> itself, and for the <script>; and what a contributor
// is told to do is delete the <svg> — after which the rest of the page is
// read in full. Pinned below as what it is.
// ---------------------------------------------------------------------------

test('ruling AE 3 — there is no foreign content: an <svg> or a <math> adds its own entry and changes nothing else — what follows is read by the HTML rules, as it is without one', async (t) => {
  const fragments = [
    '<script>alert(1)</script>',
    '<script/>',
    '<script type="application/json">{"a": "<img src=x onerror=alert(1)>"}</script>',
    '<style>@import "https://evil.example/a.css";</style>',
    '<style/>@import url(https://evil.example/b.css);</style>',
    '<script/> <iframe src="https://evil.example/c.html"></iframe>',
    '<style><img src="https://evil.example/d.png"></style>',
    '</svg><script src="https://evil.example/e.js"></script>',
    '<circle r="1"/><a href="javascript:alert(1)">x</a>',
    '<desc><script/></desc><img src="https://evil.example/f.png">',
    '<head><link rel="stylesheet" href="https://evil.example/g.css"></head>',
  ];
  for (const fragment of fragments) {
    const plain = brief(await auditOf(t, { [HTML]: fragment }));
    for (const root of ['svg', 'math']) {
      assert.deepEqual(brief(await auditOf(t, { [HTML]: `<${root}>${fragment}` })), [`${HTML}:1 [unsupported-tag]`, ...plain], `<${root}>${fragment}`);
    }
    // …and its end tag, where it is a token, changes nothing either
    assert.deepEqual(brief(await auditOf(t, { [HTML]: `<svg>${fragment}</svg>` })), [`${HTML}:1 [unsupported-tag]`, ...plain], `<svg>${fragment}</svg>`);
  }
});

test('ruling AE 3 — a <script> is an HTML script element wherever it stands: its text runs to the first </script, and a <script/> does not close itself', async (t) => {
  // Inside an <svg> a browser closes a <script/> at once and loads what follows; the audit reads the page
  // by the HTML rules, where `<script/>` opens a script that nothing closes. The page is refused all the
  // same — for the <svg> and for the <script> — and read in full once the <svg> is gone.
  const violations = await auditOf(t, {
    [HTML]: page('<svg><script/></svg>', '<iframe src="https://evil.example/a.html"></iframe>'),
  });
  assert.deepEqual(brief(violations), [`${HTML}:1 [unsupported-tag]`, `${HTML}:1 [script-inline]`]);
});

test('ruling AE 3 — a data block is not markup, wherever it stands: what is inside it is not reported, before or after an <svg>; what follows its </script> is read again', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<script type="application/json">{"html": "<img src=x onerror=alert(1)><style>@import url(https://evil.example/a.css);</style>"}</script>',
      '<svg><script type="text/plain"><iframe src="https://evil.example/b.html"></iframe><style>@import url(https://evil.example/c.css);</style></script>',
      '<img src=x onerror=alert(1)>',
    ),
  });
  assert.deepEqual(brief(violations), [`${HTML}:2 [unsupported-tag]`, `${HTML}:3 [inline-event-handler]`]);
});

// ---------------------------------------------------------------------------
// Ruling AE 4: the CSS of every <style> is read on its own
//
// Each <style> takes its own range, by the rules HTML has for the text of
// an element: from where its start tag ends to the first `</style` (followed
// by what may follow a tag name, or by the end of the text) — and to the end
// of the text when there is none, as a browser reads it. No element knows of
// another. What is reported twice is decided where the entries are made, not
// by skipping what was "read already".
//
// The regression this guards: after the fix of round 3 the first <style> of
// a page could take a range to the end of the page (a `</style` the audit
// skipped, a comment with no end), and every <style> inside that range was
// skipped as "read already" — the browser requested their addresses and the
// audit said nothing. n01–n03 are the strings the re-review named; each page
// was requested from in a browser. A <style> in the body is an unsupported
// tag (AE 2) and its CSS is read all the same: a browser applies it there.
// ---------------------------------------------------------------------------

const R4 = 'r4.html';
/**
 * What a page reports for the CSS of its <style>s, against `{ css, unsupported }`: the entries of the CSS
 * rules in full, and how many unsupported tags there are — and nothing else.
 */
function assertCssBrief(violations, expected, what) {
  const entries = brief(violations);
  assert.deepEqual(entries.filter((entry) => /\[css-/.test(entry)), expected.css, `${what}: the CSS entries`);
  assert.equal(entries.filter((entry) => /\[unsupported-tag\]/.test(entry)).length, expected.unsupported, `${what}: unsupported tags`);
  assert.deepEqual(entries.filter((entry) => !/\[(?:css-|unsupported-tag)/.test(entry)), [], `${what}: nothing else`);
}
/** The tags an inline SVG of R3_ICON holds, the <style> after it included. */
const R4_ICON_TAGS = 11;

const ROUND4 = [
  // --- the strings the re-review of round 3 named: the browser requested each address, the audit reported none
  ['n01', '<svg><style>/*</style></svg>, then on the next line <style>@import url(https://…)',
    '<svg><style>/*</style></svg>\n<style>@import url(https://evil.example/n01.css);</style>',
    { css: [`${R4}:2 [css-external-url]`], unsupported: 3 }],
  ['n02', 'a legitimate inline SVG with a <style>, then on the same line don\'t and <style>@import "https://…"',
    `${R3_ICON}don't<style>@import "https://evil.example/n02.css";</style>`,
    { css: [`${R4}:1 [css-external-url]`], unsupported: R4_ICON_TAGS + 1 }],
  ['n03', '<svg><style>.a{content:"</style><style>@import "https://…"</style> — an unpaired quote on the line',
    '<svg><style>.a{content:"</style><style>@import "https://evil.example/n03.css";</style>',
    { css: [`${R4}:1 [css-external-url]`], unsupported: 3 }],
  // --- the same two causes, in other writings
  ['n04', 'a data: address and a root-relative one in the <style>s that follow',
    '<svg><style>/*</style></svg>\n<style>@import "data:text/css,body{color:red}";</style>\n<style>@import "/root.css";</style>',
    { css: [`${R4}:2 [css-data-url]`, `${R4}:3 [css-root-relative]`], unsupported: 4 }],
  ['n05', 'a CSS comment that never closes, in the <head>; two <style>s follow it',
    '<head><style>/*</style>\n<style>@import "https://evil.example/n05a.css";</style>\n<style>b{background:url(https://evil.example/n05b.png)}</style></head>',
    { css: [`${R4}:2 [css-external-url]`, `${R4}:3 [css-external-url]`], unsupported: 0 }],
  ['n06', 'an unpaired quote on the line, in the <head>',
    '<head><style>.a{content:"</style><style>@import "https://evil.example/n06.css";</style></head>',
    { css: [`${R4}:1 [css-external-url]`], unsupported: 0 }],
  ['n12', 'an HTML comment with no end inside the first <style>',
    '<svg><style><!-- </style></svg>\n<style>@import url(https://evil.example/n12.css);</style>',
    { css: [`${R4}:2 [css-external-url]`], unsupported: 3 }],
  ['n13', 'an HTML comment with no end and no </style> for the first <style>: a <style> inside its text is no element, and its address is the first one\'s CSS',
    '<svg><style><!-- <style>@import url(https://evil.example/n13.css);</style>',
    { css: [`${R4}:1 [css-external-url]`], unsupported: 2 }],
  // --- each <style> on its own
  ['n07', 'three <style> in a row: each is reported once',
    '<head>\n<style>@import "https://evil.example/n07a.css";</style>\n<style>@import "https://evil.example/n07b.css";</style>\n<style>@import "https://evil.example/n07c.css";</style>\n</head>',
    { css: [`${R4}:2 [css-external-url]`, `${R4}:3 [css-external-url]`, `${R4}:4 [css-external-url]`], unsupported: 0 }],
  ['n08', 'four kinds of address, each in its own <style>, a comment that never closes among them',
    '<head><style>@import "https://evil.example/n08a.css";</style>\n<style>/*</style>\n<style>b{background:url(//evil.example/n08b.png)}</style>\n<style>c{background:image-set("https://evil.example/n08c.png" 1x)}</style>\n<style>@font-face{font-family:d;src:"/n08d.woff2"}</style></head>',
    { css: [`${R4}:1 [css-external-url]`, `${R4}:3 [css-external-url]`, `${R4}:4 [css-external-url]`, `${R4}:5 [css-root-relative]`], unsupported: 0 }],
  ['n09', 'the order is nothing: an address in the first and in the last of four, none in the two between',
    '<head><style>a{background:url(https://evil.example/n09a.png)}</style>\n<style>.b{color:red}</style>\n<style>/* x */</style>\n<style>@import "https://evil.example/n09b.css";</style></head>',
    { css: [`${R4}:1 [css-external-url]`, `${R4}:4 [css-external-url]`], unsupported: 0 }],
  ['n10', 'one address read by two rules (image-set(url("…"))): one entry',
    '<head><style>x{background:image-set(url("https://evil.example/n10.png") 1x)}</style></head>',
    { css: [`${R4}:1 [css-external-url]`], unsupported: 0 }],
  ['n11', 'one in the <head> and two in the body: they do not know of one another; the ones in the body are unsupported tags as well',
    '<head><style>/*</style></head>\n<style>@import "https://evil.example/n11a.css";</style>\n<style>@import "https://evil.example/n11b.css";</style>',
    { css: [`${R4}:2 [css-external-url]`, `${R4}:3 [css-external-url]`], unsupported: 2 }],
];

for (const [id, what, html, expected] of ROUND4) {
  test(`ruling AE 4 — ${what} [${id}]`, async (t) => {
    assertCssBrief(await auditOf(t, { [R4]: html }), expected, what);
  });
}

test('ruling AE 4 — a <style> that is never closed runs to the end of the text, as in a browser: its CSS is read there, and a <style> inside that text is no element', async (t) => {
  const violations = await auditOf(t, { [R4]: '<head><style>@import "https://evil.example/a.css";\n<style>@import "https://evil.example/b.css";' });
  // (the <head> never closes — a </head> there would be the style's text — so nothing is head, and the <style> is
  // an unsupported tag in the body: the stricter reading of ruling AE 2)
  assert.deepEqual(brief(violations), [`${R4}:1 [unsupported-tag]`, `${R4}:1 [css-external-url]`, `${R4}:2 [css-external-url]`],
    'both addresses are the one element\'s CSS, each read once');
});

test('ruling AE 4 — what ends a <style> is `</style` followed by a blank, a `/`, a `>` or the end of the text: anything else is part of its CSS', async (t) => {
  const cases = [
    // [file, page, what is reported]
    ['not-an-end-tag.html', '<head><style>.a{content:"</styleX>"} b{background:url(https://evil.example/a.png)}</style></head>',
      ['not-an-end-tag.html:1 [css-external-url]']], // </styleX> closes nothing: b's address is still the element's CSS
    // `</style` at the very end of the text closes the element. The <head> has no </head> after it — there is no text after —: nothing is head
    ['cut-by-the-end.html', '<head><style>@import "https://evil.example/b.css";</style',
      ['cut-by-the-end.html:1 [unsupported-tag]', 'cut-by-the-end.html:1 [css-external-url]']],
    ['end-tag-with-attribute.html', '<head><style>x</style foo="x><style>@import url(https://evil.example/c.css);</style>"></head>',
      []], // an end tag may carry attributes, and a quoted value may hold a `>`: it is read to where IT ends
  ];
  for (const [file, pageText, expected] of cases) {
    assert.deepEqual(brief(await auditOf(t, { [file]: pageText })), expected, pageText);
  }
});

// ===========================================================================
// Review round 5 — ruling AG 1: a bogus comment is read to the first `>`
//
// Four writings are no tag at all to a browser, but a comment — a "bogus
// comment" — whose text runs to the first `>` (HTML, 13.2.5.42 "Bogus
// comment state"):
//   </ x     `</` followed by what is neither an ASCII letter nor `>`
//   <!x, <![ `<!` followed by neither `--` nor `doctype`, in any case (a CDATA
//            section outside foreign content is one of them)
//   <?x      a `<?`
// and `</>` is nothing at all: ignored.
//
// The audit read the first of them as an end tag — by the tag rules, since
// round 3 ("an end tag is read to where it ends"), quoted values included:
// `</ x="y><img src=x onerror=alert(1)>` took the rest of the page for the
// value of an attribute and nothing in it was checked, while the browser was
// back in the page at the first `>` and ran the onerror (review round 5, the
// Critical: a regression of that fix of round 3). A `</` that is followed by
// a letter is an end tag as before (the e-strings of round 3: it may carry
// attributes, and a quoted value may hold a `>`).
//
// What is inside a bogus comment is parsed by no browser and read by no audit;
// after the `>` the page is read on. A real comment (`<!--…`) is still not
// recognised (see the head of this file), and a DOCTYPE is read as ever.
// ===========================================================================

/** A bogus comment in each of the four writings: `comment(inside)` is the comment up to (not including) its `>`. */
const BOGUS_COMMENT = [
  ['</ and neither a letter nor >', (inside) => `</ ${inside}`],
  ['<! and neither -- nor doctype', (inside) => `<!bogus ${inside}`],
  ['<![CDATA[, a bogus comment outside foreign content', (inside) => `<![CDATA[ ${inside}`],
  ['<?', (inside) => `<?pi ${inside}`],
];
/** What stands after it on the page — what a browser acts on. [what, the tag, what the audit reports] */
const AFTER_THE_COMMENT = [
  ['an <img onerror>', '<img src=x onerror="alert(1)">', ['inline-event-handler']],
  ['an inline <script>', '<script>alert(1)</script>', ['script-inline']],
  ['an image from outside', '<img src="https://evil.example/x.png">', ['external-url']],
  ['a javascript: link', '<a href="javascript:alert(1)">x</a>', ['script-url']],
  ['a <style> in the body with an outside @import', '<style>@import "https://evil.example/x.css";</style>', ['unsupported-tag', 'css-external-url']],
];

test('ruling AG 1 — the shortest string of the re-review, as it was written: the browser ran the onerror, and the audit said nothing', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [HTML]: '</ x="y><img src=x onerror=alert(1)>' })), [`${HTML}:1 [inline-event-handler]`]);
});

for (const [writing, comment] of BOGUS_COMMENT) {
  for (const [what, tag, codes] of AFTER_THE_COMMENT) {
    test(`ruling AG 1 — a bogus comment (${writing}) does not swallow ${what}: it ends at the first >, and the page is read on`, async (t) => {
      // the quoted `x="y` is what the audit used to read on, as the value of an attribute of an end tag
      assert.deepEqual(brief(await auditOf(t, { [HTML]: `${comment('x="y')}>\n${tag}\n<p>after</p>` })), codes.map((code) => `${HTML}:2 [${code}]`));
    });
  }
}

test('ruling AG 1 — what is inside a bogus comment is not read — a browser parses none of it —, and the comment ends at the FIRST >', async (t) => {
  const cases = [
    // [page, what is reported]
    ['</ <img src=x onerror="alert(1)">><p>after</p>', []], // the comment is `</ <img src=x onerror="alert(1)">`: the <img> is its text
    ['<!bogus <script>alert(1)</script>><p>after</p>', []],
    ['<![CDATA[ <img src="https://evil.example/x.png"> ]]><p>after</p>', []],
    ['<?pi <a href="javascript:alert(1)">x</a>><p>after</p>', []],
    ['</ <script>alert(1)</script>', []], // never closed: to the end of the text
    ['<!bogus <img src=x onerror="alert(1)">', []],
    ['<?pi <img src=x onerror="alert(1)">', []],
    ['</ <img src=x onerror="alert(1)"></p><p>after</p>', []], // the first `>` is the one of the <img> tag: `</p>` and the <p> are what follows the comment
  ];
  for (const [pageText, expected] of cases) {
    assert.deepEqual(brief(await auditOf(t, { [HTML]: pageText })), expected, pageText);
  }
});

test('ruling AG 1 — </> is no end tag at all: ignored, and the page is read on', async (t) => {
  const violations = await auditOf(t, { [HTML]: page('</><img src=x onerror="alert(1)">', '</>', '</></>', '</> <p>ok</p>') });
  assert.deepEqual(brief(violations), [`${HTML}:1 [inline-event-handler]`]);
});

test('ruling AG 1 — a `</`, a `<!` or a `<?` with nothing after it is a comment that nothing closes: nothing is reported', async (t) => {
  for (const pageText of ['<p>ok</p></', '<p>ok</p></ ', '<p>ok</p><!', '<p>ok</p><!-', '<p>ok</p><?', '<p>ok</p><?pi']) {
    assert.deepEqual(await auditOf(t, { [HTML]: pageText }), [], pageText);
  }
});

test('ruling AG 1 — an end tag is read as before: `</` followed by a letter, with attributes, and a quoted value that holds a `>` (round 3, the e-strings)', async (t) => {
  const violations = await auditOf(t, { [HTML]: page(
    '<p></p title="x><script src=assets/js/search.js>y"><img src=x onerror="alert(1)">', // the end tag runs to ITS `>`: the <img> is read (round 3, e01)
    '</p x="y"><script>alert(2)</script>', // an end tag with an attribute, its value closed: nothing hidden after it
    '</P ><img src=x onerror="alert(3)">', // a blank before the `>`: still an end tag
    '</ p><img src=x onerror="alert(4)">', // and a blank right after `</`: a bogus comment, ending at the `>` of `</ p>`
    '</p\t><img src=x onerror="alert(5)">', // a tab before the `>`: still an end tag
  ) });
  const line = (n, code) => `${HTML}:${n} [${code}]`;
  assert.deepEqual(brief(violations), [line(1, 'inline-event-handler'), line(2, 'script-inline'), line(3, 'inline-event-handler'), line(4, 'inline-event-handler'), line(5, 'inline-event-handler')]);
});

test('ruling AG 1 — what is not a bogus comment changes nothing: a real comment is still not recognised, and a DOCTYPE, in any case, is read as ever', async (t) => {
  const violations = await auditOf(t, {
    [HTML]: page(
      '<!-- <script>alert(1)</script> -->', // a real comment: a tag inside one is checked like any other (the head of this file)
      '<!---><script>alert(2)</script>-->',
      '<!-- x><script>alert(3)</script>', // `<!--`, a `>` right after: a real comment, read on as before
      '<!- x><script>alert(4)</script>', // `<!- `: neither `--` nor doctype — a bogus comment to its `>`, then the script
      '<!DoCtYpE html><script>alert(5)</script>', // a DOCTYPE, in any case: no comment
      '<!doctypehtml><script>alert(6)</script>', // the seven characters are what count
      '<!doctyp><script>alert(7)</script>', // cut short: not the seven characters — a bogus comment
      '<!DOCTYPE><script>alert(8)</script>',
    ),
  });
  const line = (n) => `${HTML}:${n} [script-inline]`;
  assert.deepEqual(brief(violations), [line(1), line(2), line(3), line(4), line(5), line(6), line(7), line(8)]);
});

test('ruling AG 1 — where the <head> is, is read by the same rule: a bogus comment in the head does not close it, and one before a tag does not hide it', async (t) => {
  const cases = [
    // [file, page, what is reported]
    ['in-the-head.html', '<head></ x="y><meta charset="UTF-8"></head><p>ok</p>', []], // the <meta> is in the head
    ['after-the-comment.html', '</ x="y>\n<head><link rel="stylesheet" href="https://evil.example/x.css"></head>', ['after-the-comment.html:2 [external-url]']],
    ['then-the-body.html', '<head></head></ x="y>\n<meta charset="UTF-8">', ['then-the-body.html:2 [unsupported-tag]']], // the head was closed first: the <meta> is in the body
  ];
  for (const [file, pageText, expected] of cases) {
    assert.deepEqual(brief(await auditOf(t, { [file]: pageText })), expected, pageText);
  }
});

// ===========================================================================
// Review round 5 — ruling AG 2: an address is judged by the URL parser, not by how it begins
//
// The rules looked for how a value began: `https://`, `//`, `/`. A browser
// reads an address with its URL parser, and that reads more than beginnings:
// `https:host/path` is another host (from a page on file://; no `//` after
// the scheme), so is `http:host/path`; anything that begins with a backslash
// is read like one that begins with a slash — `\path` is the site root,
// `\/host/path` another host —; and `file:` is a file of the reader's own
// machine. Chrome 157 loaded every line of the reviewer's table, and the
// audit said nothing. On the allow-list of round 4 img, input, form and a
// stay on a page, and these rules are the only thing that holds them.
//
// So an address is read by the URL parser now — the one Node has built in,
// the algorithm browsers have too (WHATWG URL) — twice: from a page served
// over https, and from a page opened as a file:// (this site is opened so).
// It is outside when it is so from either. What is written in an attribute
// is made what the parser is given first: the character references decoded,
// the leading and trailing C0 controls and blanks dropped, every tab, line
// feed and carriage return deleted. The javascript: and the data: rules read
// that too.
//
// The parser has one quirk that matters here, and the cases pin it: a value
// whose scheme is the scheme of the page is read as a RELATIVE address —
// `https:host/path` from a page on https is `…/a/b/host/path`. The https
// page alone would let it through; what catches it is the file:// page,
// where it is the other host. (A page on http reads `http:host/path` the
// same relative way — and that one the https page catches.)
//
// The root-relative rule stays a judgment on the writing itself, by ruling:
// a value that begins with `/` or with a backslash is the site root — dead
// under file:// — whatever the parser would make of it. It holds for the
// URL-bearing attributes only (URL_ATTRIBUTES), as ever; and `<a href>` keeps
// its exemption for outside links, on the href alone.
// ===========================================================================

const R5 = 'r5.html';
/** The page each reading starts from: one served over https, one opened as a file://. */
const R5_ON_HTTPS = 'https://example.invalid/a/b/page.html';
const R5_ON_FILE = 'file:///a/b/page.html';

/**
 * The reviewer's table: [label, the writing, what the audit reports of `<img src="…">`, what the URL parser makes
 * of the writing from the https page and from the file:// page]. Each was loaded by Chrome 157 on an http page,
 * and — but the two marked "not on http" — on a file:// page too, with the audit saying nothing.
 */
const R5_TABLE = [
  ['https:host/path', 'https:host/path', 'external-url', 'https://example.invalid/a/b/host/path', 'https://host/path'],
  ['https:/host/path', 'https:/host/path', 'external-url', 'https://example.invalid/host/path', 'https://host/path'],
  [String.raw`https:\\host\path`, String.raw`https:\\host\path`, 'external-url', 'https://host/path', 'https://host/path'],
  [String.raw`https:/\host/path`, String.raw`https:/\host/path`, 'external-url', 'https://host/path', 'https://host/path'],
  [String.raw`\/host/path`, String.raw`\/host/path`, 'root-relative-url', 'https://host/path', 'file://host/path'],
  ['http:host/path', 'http:host/path', 'external-url', 'http://host/path', 'http://host/path'],
  [String.raw`\path`, String.raw`\path`, 'root-relative-url', 'https://example.invalid/path', 'file:///path'],
  ['file:///… (not on http)', 'file:///C:/Windows/win.ini', 'external-url', 'file:///C:/Windows/win.ini', 'file:///C:/Windows/win.ini'],
  ['file://host/share/x.png (not on http)', 'file://host/share/x.png', 'external-url', 'file://host/share/x.png', 'file://host/share/x.png'],
];

for (const [label, writing, code, onHttps, onFile] of R5_TABLE) {
  test(`ruling AG 2 — ${label}: loaded by the browser, and reported (${code})`, async (t) => {
    // what the URL parser makes of the writing from each page — the two meanings of ruling AG 2, pinned
    assert.equal(new URL(writing, R5_ON_HTTPS).href, onHttps, 'from a page on https');
    assert.equal(new URL(writing, R5_ON_FILE).href, onFile, 'from a page on file://');
    assert.deepEqual(brief(await auditOf(t, { [R5]: `<img src="${writing}">` })), [`${R5}:1 [${code}]`]);
  });
}

test('ruling AG 2 — the same writing wherever an address can be loaded or held: srcset, an image button, a table background, the url() of a style attribute, a form, a button, a ping', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [R5]: page(
    '<img srcset="https:host/a.png 1x, b.png 2x" alt="">', // the first candidate; the second is a site file
    '<input type="image" src="https:/host/btn.png" alt="">',
    '<table background="https:host/bg.png"><tr><td>x</td></tr></table>',
    '<div style="background:url(https:host/bg.png)">x</div>',
    '<form action="https:host/submit"></form>',
    '<button formaction="https:host/go">go</button>',
    '<a href="x.html" ping="https:host/track">x</a>', // ping is not href: no exemption
    '<a href="https:host/path">an outside link is allowed, on the href alone</a>',
    '<div style="background:url(\\\\host\\\\bg.png)">x</div>', // in CSS a backslash is escaped — two make one: the site root
  ) })), [
    `${R5}:1 [external-url]`,
    `${R5}:2 [external-url]`,
    `${R5}:3 [external-url]`,
    `${R5}:4 [css-external-url]`,
    `${R5}:5 [external-url]`,
    `${R5}:6 [external-url]`,
    `${R5}:7 [external-url]`,
    `${R5}:9 [css-root-relative]`,
  ]);
});

test('ruling AG 2 — a <script src> written so is the outside resource it is: reported once, as that — no second script-src entry', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [R5]: page('<script src="https:host/x.js"></script>', '<script src="https:/\\host/y.js"></script>') })), [
    `${R5}:1 [external-url]`,
    `${R5}:2 [external-url]`,
  ]);
});

test('ruling AG 2 — what is written is made what the parser is given first: character references, blanks and controls at both ends, a tab, a line feed or a carriage return inside — and the javascript: and the data: rule read the same', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [R5]: page(
    '<img src="&#104;ttps:host/x.png" alt="">', // `&#104;` is h
    '<img src="https&colon;host/x.png" alt="">', // the colon, named
    '<img src="&#9;https:host/x.png&#10;" alt="">', // a tab and a line feed at both ends
    '<img src="  https:host/x.png &#1;" alt="">', // blanks, and a control
    '<img src="ht&#9;tps:host/x.png" alt="">', // a tab inside the scheme
    '<img src="https:&#13;host/x.png" alt="">', // a carriage return after the scheme
    '<a href="  javascript&#58;alert(1)">x</a>', // the javascript: rule, on what was made of the value
    '<img src="jav&#9;ascript&#58;alert(1)" alt="">', // in any attribute
    '<iframe src="da&#10;ta:text/html,x"></iframe>', // the data: rule too (`&#10;` is a line feed)
  ) })), [
    ...[1, 2, 3, 4, 5, 6].map((n) => `${R5}:${n} [external-url]`),
    `${R5}:7 [script-url]`,
    `${R5}:8 [script-url]`,
    `${R5}:9 [unsupported-tag]`, `${R5}:9 [data-url]`,
  ]);
});

test('ruling AG 2 — what stays allowed: a site-relative address, a fragment, a query, an empty one; an outside link on the href of an <a>, in these writings too, and a mailto: on it', async (t) => {
  assert.deepEqual(await auditOf(t, { [R5]: page(
    '<img src="x.png" alt=""><img src="../css/x.css" alt=""><img src="./a/b.png" alt="">', // the address is what is judged, not what it names
    '<a href="#x">fragment</a> <a href="?q=1">query</a> <a href="">empty</a>',
    '<a href="https://example.com/x">an outside link</a>',
    '<a href="https:host/path">the same, without the //</a>',
    '<a href="http:host/path">another scheme</a>',
    '<a href="mailto:a@b.example">mail</a>',
    '<a href="ftp://host/x">ftp</a>',
    '<div style="background:url(../a.png)">x</div>',
  ) }), []);
});

test('ruling AG 2 — the root-relative rule is a judgment on the writing: `/` or a backslash to begin with, `/\\` and `\\/` included — on the URL-bearing attributes only, <a href> included', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [R5]: page(
    '<img src="\\path" alt="">', // one backslash: the site root to a browser
    '<a href="/\\host/path">x</a>', // `/\`
    '<img src="\\/host/path" alt="">', // `\/`
    '<img src="\\\\host\\path" alt="">', // `\\`: another host to the parser, the site root by ruling
    '<div data-x="\\\\host\\path" title="\\path">not URL-bearing attributes</div>', // nothing
    '<a href="//host/path">a protocol-relative one keeps its own code</a>',
  ) })), [
    `${R5}:1 [root-relative-url]`,
    `${R5}:2 [root-relative-url]`,
    `${R5}:3 [root-relative-url]`,
    `${R5}:4 [root-relative-url]`,
    `${R5}:6 [protocol-relative-url]`,
  ]);
});

test('ruling AG 2 — an address of its own rule is not an outside one on top: a data: image keeps its slot, and a javascript: URL is the script URL it was', async (t) => {
  assert.deepEqual(brief(await auditOf(t, { [R5]: page(
    '<img src="data:image/png;base64,AAAA" alt="">', // allowed by A9 — and no outside address, though the parser gives it a null origin
    '<a href="javascript:alert(1)">x</a>',
    '<div onclick="x()" src="javascript:y()">z</div>',
  ) })), [
    `${R5}:2 [script-url]`,
    `${R5}:3 [inline-event-handler]`, `${R5}:3 [script-url]`,
  ]);
});

test('ruling AG 2 — in CSS the same: url(), @import, image-set() and the src of @font-face — in a stylesheet, in a <style> of the <head>, and in a style attribute', async (t) => {
  assert.deepEqual(brief(await auditOf(t, {
    'css/theme.css': page(
      'a{background:url(https:host/a.png)}',
      '@import "https:/host/b.css";',
      'c{background:image-set("http:host/c.png" 1x)}',
      '@font-face{font-family:d;src:"https:host/d.woff2"}',
      String.raw`e{background:url(\\host\e.png)}`, // two backslashes are one, in CSS: the site root
    ),
    [R5]: '<head><style>f{background:url(https:host/f.png)}</style></head><div style="background:url(https:host/g.png)">x</div>',
  })), [
    ...[1, 2, 3, 4].map((n) => `css/theme.css:${n} [css-external-url]`),
    'css/theme.css:5 [css-root-relative]',
    `${R5}:1 [css-external-url]`,
    `${R5}:1 [css-external-url]`,
  ]);
});
