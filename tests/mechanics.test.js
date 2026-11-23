'use strict';

// Task 5b C1 tests: tools/build/mechanics.js — the content/mechanics merge
// step (mergeMechanicsContent, mechanicTitle), moved out of the build entry
// (skeleton-build.js) so that entry is pure orchestration again. The
// behaviour is the one the build entry had inlined since Task 4: slug = file
// name, title = frontmatter title > first ATX h1 > slug, same slug replaces,
// new slugs append.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { mergeMechanicsContent, mechanicTitle, mechanicsWithNavLabel } = require('../tools/build/mechanics.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

const REPO_CONTENT = path.join(__dirname, '..', 'content');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mechanics-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry is still pending. That is the cleanup failing,
  // not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

const BASE = () => [
  { slug: 'night-settlement', title: '夜间结算与疲劳', source: '# 夜间结算与疲劳\n\n正文。' },
  { slug: 'barrel-system', title: '桶装系统', source: '# 桶装系统\n\n正文。' },
];

/** A content dir holding content/mechanics/<name> files as given. */
async function contentWith(t, label, files) {
  const contentDir = await tmpDir(t, label);
  const dir = path.join(contentDir, 'mechanics');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return contentDir;
}

// ---------- mechanicTitle ----------

test('mechanicTitle: frontmatter title > first ATX h1 > slug', () => {
  assert.equal(mechanicTitle('---\ntitle: 手写标题\n---\n\n# 被 frontmatter 压过的 h1\n\n正文', 'some-slug'), '手写标题');
  assert.equal(mechanicTitle('---\ntitle:   两侧空白  \n---\n\n正文', 'some-slug'), '两侧空白', 'the title is trimmed');
  assert.equal(mechanicTitle('---\n---\n\n# 正文里的首个 h1\n\n正文', 'some-slug'), '正文里的首个 h1', 'no frontmatter title → first ATX h1');
  assert.equal(mechanicTitle('无 frontmatter 的正文。\n\n## h2 不算\n\n# 正文中间的 h1\n', 'some-slug'), '正文中间的 h1',
    'the h1 is the first ATX h1 anywhere in the body (multi-line match), with or without frontmatter');
  assert.equal(mechanicTitle('---\ntitle: ""\n---\n\n正文', 'some-slug'), 'some-slug', 'an empty frontmatter title is no title');
  assert.equal(mechanicTitle('无标题页正文。\n', 'bare'), 'bare', 'neither frontmatter title nor h1 → the slug');
});

// ---------- mergeMechanicsContent ----------

test('mergeMechanicsContent (D2): contentDir null / a missing directory → the same entries in the same order, and every one of them carries navLabel (null)', async (t) => {
  const base = BASE();
  const expected = base.map((m) => ({ ...m, navLabel: null }));

  const viaNull = await mergeMechanicsContent(base, null);
  const viaMissing = await mergeMechanicsContent(base, path.join(await tmpDir(t, 'no-dir'), 'no-such-content'));

  for (const [what, merged] of [['contentDir null', viaNull], ['a missing content dir', viaMissing]]) {
    assert.deepEqual(merged, expected, `${what}: the base entries, each with navLabel: null`);
    assert.deepEqual(merged.map((m) => m.slug), base.map((m) => m.slug), `${what}: same order`);
    for (const m of merged) {
      assert.ok(Object.hasOwn(m, 'navLabel'), `${what}: ${m.slug} has the navLabel key`);
      assert.equal(m.navLabel, null);
    }
  }
  assert.ok(base.every((m) => !Object.hasOwn(m, 'navLabel')), 'the input is left as it was');
});

test('mergeMechanicsContent (D2): whatever the path, every entry of the result has the same keys', async (t) => {
  const base = BASE();
  const keysOf = (merged) => merged.map((m) => Object.keys(m).sort());
  const expectedKeys = [['navLabel', 'slug', 'source', 'title']];

  // nothing merged: base entries keep what they came with, plus navLabel
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, null)), [expectedKeys[0], expectedKeys[0]]);
  // a base entry that declares a label comes back with it normalised
  const declaring = [{ ...base[0], navLabel: '  顶部入口  ' }, base[1]];
  assert.deepEqual((await mergeMechanicsContent(declaring, null)).map((m) => m.navLabel), ['顶部入口', null]);
  // merged: a replaced entry and an appended one have the same shape as the untouched base entries
  const contentDir = await contentWith(t, 'shape', {
    'barrel-system.md': '---\ntitle: 替换\n---\n\n正文',
    'z-new.md': '正文',
  });
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, contentDir)), [expectedKeys[0], expectedKeys[0], expectedKeys[0]]);
  // and no mechanics at all is an empty list, not an error
  assert.deepEqual(await mergeMechanicsContent([], null), []);
  assert.deepEqual(await mergeMechanicsContent(null, null), []);
});

test('mergeMechanicsContent: slug = file name, source = the file as written; same slug replaces, new slugs append in file-name order', async (t) => {
  const contentDir = await contentWith(t, 'merge', {
    'z-new.md': '---\ntitle: 新页面\n---\n\n新页面正文。\n',
    'barrel-system.md': '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', // replaces BASE[1]
    'a-first.md': '无标题页正文。\n', // no fm, no h1 → title is the slug
    'notes.txt': 'not a page', // not markdown: ignored
    'README.MD': 'case-variant suffix: still a markdown page',
  });
  await fs.mkdir(path.join(contentDir, 'mechanics', 'drafts'));
  await fs.writeFile(path.join(contentDir, 'mechanics', 'drafts', 'nested.md'), 'a directory entry is not a page\n');

  const merged = await mergeMechanicsContent(BASE(), contentDir);

  assert.deepEqual(
    merged.map((m) => [m.slug, m.title]),
    [
      ['night-settlement', '夜间结算与疲劳'],
      ['barrel-system', '手写替换标题'],
      ['README', 'README'], // .MD stripped case-insensitively; no title → slug
      ['a-first', 'a-first'],
      ['z-new', '新页面'],
    ],
    'base order kept, replaced in place, new slugs appended in file-name order',
  );
  const replaced = merged.find((m) => m.slug === 'barrel-system');
  assert.equal(replaced.source, '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', 'source is the file as written');
  assert.equal(merged.find((m) => m.slug === 'night-settlement').source, BASE()[0].source, 'an untouched base entry keeps its source');
  assert.deepEqual(Object.keys(replaced).sort(), ['navLabel', 'slug', 'source', 'title'], 'an entry carries exactly slug, title, source, navLabel');
});

test('mergeMechanicsContent: the repo\'s content/mechanics/install-compat.md merges as the page it is', async () => {
  const raw = await fs.readFile(path.join(REPO_CONTENT, 'mechanics', 'install-compat.md'), 'utf8');
  const merged = await mergeMechanicsContent(BASE(), REPO_CONTENT);
  const page = merged.find((m) => m.slug === 'install-compat');
  assert.deepEqual(page, { slug: 'install-compat', title: '安装与兼容性', source: raw, navLabel: '关于本站' });
  assert.equal(merged.length, BASE().length + 1);
});

// ---------- Task 5b A — nav_label ----------

test('navLabel: frontmatter `nav_label` → the label (trimmed); empty, blank, missing or not a string → null', async (t) => {
  const contentDir = await contentWith(t, 'nav-label', {
    'set.md': '---\ntitle: A\nnav_label: 关于本站\n---\n\n正文',
    'padded.md': '---\nnav_label:   关于本站  \n---\n\n正文',
    'quoted.md': '---\nnav_label: "关于本站"\n---\n\n正文',
    'single-quoted.md': "---\nnav_label: '关于本站'\n---\n\n正文",
    'empty.md': '---\nnav_label: ""\n---\n\n正文',
    'bare.md': '---\nnav_label:\n---\n\n正文', // a key without a value parses to ''
    'blank.md': '---\nnav_label: "   "\n---\n\n正文',
    'number.md': '---\nnav_label: 123\n---\n\n正文', // the YAML subset parses numbers → not a string
    'boolean.md': '---\nnav_label: true\n---\n\n正文',
    'list.md': '---\nnav_label:\n  - 关于本站\n---\n\n正文', // a block list → not a string
    'none.md': '---\ntitle: 没有 nav_label\n---\n\n正文',
  });

  const merged = await mergeMechanicsContent(BASE(), contentDir);
  const navLabelOf = Object.fromEntries(merged.map((m) => [m.slug, m.navLabel]));

  assert.deepEqual(navLabelOf, {
    'night-settlement': null, // base entries: nothing declared
    'barrel-system': null,
    set: '关于本站', padded: '关于本站', quoted: '关于本站', 'single-quoted': '关于本站',
    empty: null, bare: null, blank: null, number: null, boolean: null, list: null, none: null,
  });
  for (const m of merged) {
    assert.ok(m.navLabel === null || (typeof m.navLabel === 'string' && m.navLabel.trim() !== '' && m.navLabel === m.navLabel.trim()),
      `${m.slug}: navLabel is null or a trimmed non-empty string, got ${JSON.stringify(m.navLabel)}`);
  }
});

test('mechanicsWithNavLabel: the entries that declare a nav label, in order', async (t) => {
  const none = [{ slug: 'a', title: 'A', source: 's', navLabel: null }, { slug: 'b', title: 'B', source: 's' }];
  assert.deepEqual(mechanicsWithNavLabel(none), [], 'nothing declared → empty');
  assert.deepEqual(mechanicsWithNavLabel(null), [], 'no mechanics at all → empty');
  const two = [
    { slug: 'a', title: 'A', source: 's', navLabel: '关于本站' },
    { slug: 'b', title: 'B', source: 's', navLabel: null },
    { slug: 'c', title: 'C', source: 's', navLabel: '另一个' },
  ];
  assert.deepEqual(mechanicsWithNavLabel(two).map((m) => m.slug), ['a', 'c'], 'order kept');
});

// ---------- Task 6b D1 — "is navLabel set?" has ONE implementation ----------
//
// There were two: normalizeNavLabel in mechanics.js and, in render.js, its own
// `typeof m.navLabel === 'string' && m.navLabel.trim() !== ''`. Equal today —
// and free to drift the day one of them changes. render.js now asks
// mechanics.js. (tests/render.test.js may not change for D1, so this lives
// here, next to the function that is now the only one.)

test('D1 — render.js 复用 mechanics.js 的导出:它自己不再判定 navLabel 是否已设置', async () => {
  const render = await fs.readFile(path.join(__dirname, '..', 'tools', 'build', 'render.js'), 'utf8');
  assert.match(render, /require\(['"]\.\/mechanics\.js['"]\)/, 'render.js takes the answer from mechanics.js');
  assert.match(render, /mechanicsWithNavLabel\(/, '…from the exported mechanicsWithNavLabel');
  // The second implementation, gone: a test of the navLabel field written in render.js itself.
  assert.doesNotMatch(render, /typeof\s+[\w.]*navLabel\s*[!=]==?\s*['"]string['"]/,
    'render.js no longer tests navLabel itself');
});

test('D1 — 对每一种 navLabel 形态,页面上有没有「关于本站」入口都与 mechanicsWithNavLabel 的答案一致', async () => {
  const { renderSite } = require('../tools/build/render.js');
  const shapes = [
    [undefined, false], [null, false], ['', false], ['   ', false], ['\t\n', false],
    ['桶装指南', true], ['  桶装指南  ', true], ['关于本站', true],
    [123, false], [true, false], [['关于本站'], false], [{}, false],
  ];
  for (const [shape, declared] of shapes) {
    const data = structuredClone(FIXTURE_DATA);
    data.mechanics = data.mechanics.map((m, i) => ({ ...m, navLabel: i === 0 ? shape : null }));
    const slug = data.mechanics[0].slug;

    // The one implementation's answer…
    const answer = mechanicsWithNavLabel(data.mechanics);
    assert.equal(answer.length, declared ? 1 : 0, `navLabel ${JSON.stringify(shape)}: mechanicsWithNavLabel`);
    // …and what the page shows: the about entry is the LAST link of the menu-row.
    const out = await renderSite(data, { contentDir: null });
    const menuRow = out.get('index.html').split('class="menu-row"')[1].split('</div>')[0];
    const lastLink = (menuRow.match(/<a [^>]*>.*?<\/a>/g) ?? []).at(-1);
    if (declared) {
      assert.equal(lastLink, `<a href="mechanics/${slug}.html">${String(shape).trim()}</a>`,
        `navLabel ${JSON.stringify(shape)}: the about entry, with the label trimmed`);
    } else {
      assert.notEqual(lastLink, undefined);
      assert.ok(!lastLink.includes(`mechanics/${slug}.html`), `navLabel ${JSON.stringify(shape)}: no about entry, got ${lastLink}`);
    }
    for (const [rel, html] of out) {
      if (rel === 'data.js') continue;
      assert.equal(html.split('class="menu-row"')[1].split('</div>')[0].includes(`mechanics/${slug}.html"`), declared,
        `${rel}: same answer on every page`);
    }
  }
});
