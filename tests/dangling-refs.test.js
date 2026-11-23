'use strict';

// Task 5b B tests: tools/build/dangling-refs.js — the dangling-reference
// check that used to live only in tests/skeleton-build.test.js
// (findDanglingRefs, Task 4), now on the build side so that the BUILD fails
// when a page or stylesheet points at a file dist does not ship.
//
// Why it matters: the CMS will let contributors delete pages. A link left
// pointing at a deleted page must not deploy — but the failure has to tell
// a non-programmer which file to edit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { findDanglingRefs, formatDanglingRefs } = require('../tools/build/dangling-refs.js');

const toPosix = (p) => p.split(path.sep).join('/');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `dangling-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry is still pending. That is the cleanup failing,
  // not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/** files: { '<posix rel path>': text | null } — null creates the file empty (its content does not matter). */
async function tree(t, label, files) {
  const root = await tmpDir(t, label);
  await put(root, files);
  return root;
}

async function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, text ?? `shipped: ${rel}\n`);
  }
}

test('a clean tree: every relative href/src/url() resolves → scanned counts the .html/.css files, dangling is empty', async (t) => {
  const dist = await tree(t, 'clean', {
    'index.html': `<a href="items.html">全部</a> <a href="mechanics/a.html#sec">锚点</a> <a href="mechanics/a.html?q=1#x">查询</a>
<img src="assets/bwiki/emblem.jpg" alt=""/> <a href="a%20b.png">空格</a> <a href="index.html">自己</a>`,
    'a b.png': null,
    'items.html': '<script src="data.js"></script><script src="assets/js/search.js"></script><link rel="stylesheet" href="css/theme.css"/>',
    'data.js': 'window.WIKI_DATA = {};',
    'assets/js/search.js': '// js',
    'assets/bwiki/emblem.jpg': null,
    'css/theme.css': 'body{background:url(../assets/bwiki/bg.png) no-repeat}\n@font-face{src:url("../assets/fonts/x.woff2") format("woff2")}\n',
    'assets/bwiki/bg.png': null,
    'assets/fonts/x.woff2': null,
    'mechanics/a.html': '<a href="../index.html">上级</a><a href="b.html">同级</a>',
    'mechanics/b.html': null,
    // not the site's own files
    'admin/index.html': '<a href="missing-in-admin.html">CMS shell</a><link href="gone.css" rel="stylesheet"/>',
    'admin/gone.css': 'a{background:url(nope.png)}',
    'favicon.ico': null, // neither .html nor .css: not scanned
  });

  const result = await findDanglingRefs(dist);

  assert.deepEqual(result.dangling, []);
  assert.equal(result.scanned, 5, 'index.html, items.html, css/theme.css, mechanics/a.html, mechanics/b.html — not admin/*, not .ico');
});

test('references that are NOT site files are skipped: schemes, mailto:, data:, root-relative, protocol-relative, fragments, empty', async (t) => {
  const dist = await tree(t, 'skip', {
    'index.html': [
      '<a href="https://example.com/x">http</a>',
      '<a href="HTTP://example.com/x">scheme is case-insensitive</a>',
      '<a href="mailto:someone@example.com">mail</a>',
      '<a href="data:text/plain,hi">data</a>',
      '<a href="javascript:void(0)">js</a>',
      '<a href="/index.html">root-relative</a>',
      '<a href="//cdn.example.com/x.js">protocol-relative</a>',
      '<a href="#top">fragment</a>',
      '<a href="">empty</a>',
      '<a href="?q=1">query only</a>',
      '<img src="">',
    ].join('\n'),
    'css/theme.css': 'a{background:url(https://example.com/x.png)} b{background:url(data:image/png;base64,AAAA)} c{fill:url(#grad)} d{background:url()}',
  });

  const result = await findDanglingRefs(dist);
  assert.deepEqual(result.dangling, [], 'nothing here is a file of the site');
  assert.equal(result.scanned, 2);
});

test('a dangling reference is reported as { file, ref }: dist-relative posix paths, the ref RESOLVED (query/hash stripped, percent-decoding undone)', async (t) => {
  const outside = await tmpDir(t, 'outside');
  await fs.writeFile(path.join(outside, 'outside.html'), 'exists on disk, but outside dist');
  const dist = await tree(t, 'report', {
    'items.html': null,
    'css/theme.css': '@font-face{src:url(../assets/fonts/gone.woff2) format("woff2")}',
    'mechanics/keep.html': '<a href="../items.html">fine</a><a href="gone.html">sibling gone</a><a href="keep.html">fine</a>',
  });
  const toOutside = toPosix(path.relative(dist, path.join(outside, 'outside.html')));
  assert.ok(toOutside.startsWith('../'), `sanity: outside dist, got ${toOutside}`);
  await put(dist, {
    'index.html': [
      '<a href="mechanics/nope.html">missing page</a>',
      '<IMG SRC="assets/js/gone.js" alt=""/>', // attribute case, uppercase tag
      '<a href="mechanics/Nope.html#x?q=y">case matters</a>',
      '<a href="mechanics/">a directory is not a file</a>',
      `<a href="${toOutside}">outside dist</a>`,
      '<a href="mechanics/%ZZ.html">not valid percent-encoding</a>',
      '<a href="items.html">fine</a>',
    ].join('\n'),
  });

  const result = await findDanglingRefs(dist);

  assert.deepEqual(result, {
    scanned: 4,
    dangling: [
      { file: 'css/theme.css', ref: 'assets/fonts/gone.woff2' },
      { file: 'index.html', ref: 'mechanics/nope.html' },
      { file: 'index.html', ref: 'assets/js/gone.js' },
      { file: 'index.html', ref: 'mechanics/Nope.html' },
      { file: 'index.html', ref: 'mechanics' },
      { file: 'index.html', ref: toOutside }, // resolved outside dist: the offline zip would not carry it
      { file: 'index.html', ref: 'mechanics/%ZZ.html' },
      { file: 'mechanics/keep.html', ref: 'mechanics/gone.html' },
    ],
  });
});

test('0 scanned is not 0 dangling: an empty dist (or one without site html/css) scans nothing', async (t) => {
  const empty = await tmpDir(t, 'empty');
  assert.deepEqual(await findDanglingRefs(empty), { scanned: 0, dangling: [] });
  const onlyJs = await tree(t, 'only-js', { 'data.js': 'x', 'admin/index.html': '<a href="nope.html">x</a>' });
  assert.deepEqual(await findDanglingRefs(onlyJs), { scanned: 0, dangling: [] }, 'the CMS shell is not the site: nothing scanned');
});

test('admin/ never takes part: a dangling link in the CMS shell is not reported, scanned or counted', async (t) => {
  const dist = await tree(t, 'admin', {
    'index.html': '<a href="items.html">ok</a>',
    'items.html': null,
    'admin/index.html': '<a href="missing.html">dangling inside the shell</a>',
    'admin/vendor/cms.css': 'a{background:url(../missing.png)}',
    // On win32 (case-insensitive) this is the very same directory as above;
    // on Linux a second one. Skipped either way.
    'ADMIN/index.html': '<a href="missing.html">ADMIN is admin</a>',
    'admin.html': '<a href="missing.html">a page merely NAMED admin is the site\'s own → reported</a>',
  });

  const result = await findDanglingRefs(dist);
  assert.deepEqual(result.dangling, [{ file: 'admin.html', ref: 'missing.html' }]);
  assert.equal(result.scanned, 3, 'index.html, items.html, admin.html');
});

test('formatDanglingRefs: one line per reference "page → missing target", then one actionable hint in Chinese', () => {
  const report = formatDanglingRefs({
    scanned: 22,
    dangling: [
      { file: 'mechanics/install-compat.html', ref: 'mechanics/nope.html' },
      { file: 'index.html', ref: 'css/gone.css' },
    ],
  }, {
    sourceOf: (file) => (file.startsWith('mechanics/') ? `content/mechanics/${file.slice('mechanics/'.length).replace(/\.html$/, '.md')}` : null),
  });
  const lines = report.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\[links\] FAIL — 2 处链接指向不存在的文件:$/);
  assert.equal(lines[1], '  mechanics/install-compat.html → mechanics/nope.html(编辑 content/mechanics/install-compat.md)');
  assert.equal(lines[2], '  index.html → css/gone.css', 'a page with no editable source gets no bracket');
  assert.match(lines[3], /^提示:/);
  for (const word of ['删除', '恢复', '修正']) assert.ok(lines[3].includes(word), `the hint mentions ${word}`);

  // without a sourceOf every page is "generated by the build"
  const bare = formatDanglingRefs({ scanned: 1, dangling: [{ file: 'index.html', ref: 'x.html' }] });
  const bareLines = bare.split('\n');
  assert.equal(bareLines[1], '  index.html → x.html');
  assert.ok(bareLines[2].includes('自动生成'), '…and the hint says what that means');
});

// D3 (task 6b): the hint used to be one dense paragraph of some 300
// characters, and it spelled a page-to-file mapping into itself
// ("mechanics/<名字>.html 对应 content/mechanics/<名字>.md") — a path that
// could disagree with the contentDir the build was actually given. Every path
// in the report now comes from sourceOf, in the brackets of its own line.

test('D3 — the hint is short, and no path is written into it: the only paths in the report are the ones sourceOf puts in the brackets', () => {
  const report = formatDanglingRefs({ scanned: 1, dangling: [{ file: 'mechanics/a.html', ref: 'mechanics/b.html' }] }, {
    sourceOf: () => 'site/pages/mechanics/a.md', // a content tree that is not the default content/
  });
  const lines = report.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '  mechanics/a.html → mechanics/b.html(编辑 site/pages/mechanics/a.md)', 'the path sourceOf gave, and only there');
  assert.match(lines[2], /^提示:/, 'the hint is the last line');
  assert.ok(!lines[2].includes('content/'), 'the hint names no hard-coded content directory: it could disagree with the real one');
  assert.ok(!lines[2].includes('<名字>') && !lines[2].includes('<物品ID>'), '…and spells out no page-to-file mapping either');
  assert.ok(!/\.md|\.html/.test(lines[2]), '…no file names at all: they are all in the brackets above');
  assert.ok(lines[2].length <= 130, `short enough to read at a glance: ${lines[2].length} characters`);
  for (const word of ['删除', '恢复', '修正', '自动生成', '维护者']) assert.ok(lines[2].includes(word), `the hint still mentions ${word}`);
});

// D5 (task 6b): listSiteFiles' comment said "the skipped top-level trees",
// its code skipped an entry named `admin` at EVERY depth. Only the top-level
// admin/ of dist is the CMS shell; an `admin` deeper down is the site's own
// file, and a broken link in it must not slip through.

test('D5 — only the TOP-LEVEL admin/ is skipped: an `admin` deeper down is the site\'s own and takes part', async (t) => {
  const dist = await tree(t, 'admin-nested', {
    'index.html': null,
    'items.html': null,
    'mechanics/admin.html': '<a href="missing-in-mechanics.html">a page merely NAMED admin, deeper down</a>',
    'item/admin/panel.html': '<a href="missing-in-nested-admin.html">inside a nested admin directory</a>',
    'item/admin/ADMIN/DEEPER.html': '<a href="missing-deeper.html">at any depth</a>',
    'css/admin/theme.css': 'a{background:url(missing-in-nested-admin.png)}',
    // the shell itself, and everything under it, is still left out
    'admin/index.html': '<a href="missing-in-shell.html">the shell</a>',
    'admin/item/admin/panel.html': '<a href="missing.html">…all of it</a>',
    'ADMIN/index.html': '<a href="missing-in-shell.html">ADMIN is admin at the top level too</a>',
  });

  const result = await findDanglingRefs(dist);

  assert.deepEqual(result.dangling, [
    { file: 'css/admin/theme.css', ref: 'css/admin/missing-in-nested-admin.png' },
    { file: 'item/admin/ADMIN/DEEPER.html', ref: 'item/admin/ADMIN/missing-deeper.html' },
    { file: 'item/admin/panel.html', ref: 'item/admin/missing-in-nested-admin.html' },
    { file: 'mechanics/admin.html', ref: 'mechanics/missing-in-mechanics.html' },
  ]);
  assert.equal(result.scanned, 6,
    'index.html, items.html, mechanics/admin.html, item/admin/panel.html, item/admin/ADMIN/DEEPER.html, css/admin/theme.css — nothing under the top-level admin/');
});
