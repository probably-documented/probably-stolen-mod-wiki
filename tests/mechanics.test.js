'use strict';

// tools/build/mechanics.js — the merge of content/mods/<modId>/mechanics/*.md
// into `mechanics` (mergeMechanicsContent, mechanicTitle), read through the
// layout (tools/build/content-layout.js) so that the build entry stays pure
// orchestration. slug = file name, title = frontmatter title > first ATX h1 >
// slug, same slug replaces, new slugs append — and the pages of every mod
// come out in ONE file-name order: never grouped by mod.
//
// And, since stage 3 (task 5): which site page declares the top nav's about
// entry (sitePagesWithNavLabel). A mechanic page can no longer declare it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { mergeMechanicsContent, mechanicTitle, sitePagesWithNavLabel } = require('../tools/build/mechanics.js');
const { readContentLayout } = require('../tools/build/content-layout.js');

const REPO_CONTENT = path.join(__dirname, '..', 'tests', 'fixtures', 'content');
/** The mod directory the fixture content's pages live in. */
const FIXTURE_MOD = 'lewd_meme';

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

const EMPTY_LAYOUT = { home: null, sections: [], site: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [] };

/**
 * A layout, built by hand, whose mods hold the given mechanic pages, written
 * to disk: `{ modId: { '<file name>': text } }`. The mods and their pages are
 * left in the order given — what order the result comes out in is the
 * function's job, not the layout reader's.
 */
async function layoutWith(t, label, mods) {
  const root = await tmpDir(t, label);
  const layout = { ...EMPTY_LAYOUT, mods: [] };
  for (const [id, files] of Object.entries(mods)) {
    const dir = path.join(root, 'mods', id);
    const mechanics = [];
    for (const [name, text] of Object.entries(files)) {
      const file = path.join(dir, 'mechanics', name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, text);
      mechanics.push({ slug: name.replace(/\.md$/i, ''), file });
    }
    layout.mods.push({ id, dir, indexFile: null, redirectsFile: null, items: [], mechanics, nestedIndexFiles: [] });
  }
  return layout;
}

/** One merged entry, as the build uses it: no matter in which order the keys were set. */
const entry = ({ slug, title, source, mod }) => ({ slug, title, source, mod });
const KEYS = ['mod', 'slug', 'source', 'title'];

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

test('mergeMechanicsContent (D2): a null layout / a layout without mods → the base entries as they came, each with mod null', async () => {
  const base = BASE();
  const expected = base.map((m) => entry({ ...m, mod: null }));

  for (const [what, layout] of [['a null layout', null], ['a layout without mods', EMPTY_LAYOUT]]) {
    const merged = await mergeMechanicsContent(base, layout);
    assert.deepEqual(merged, expected, `${what}: the base entries, each with mod: null`);
    assert.deepEqual(merged.map((m) => m.slug), base.map((m) => m.slug), `${what}: same order`);
    for (const m of merged) assert.equal(m.mod, null);
  }
  assert.ok(base.every((m) => !Object.hasOwn(m, 'mod')), 'the input is left as it was');
});

test('mergeMechanicsContent (D2): whatever the layout holds, every entry of the result has the same four keys', async (t) => {
  const base = BASE();
  const keysOf = (merged) => merged.map((m) => Object.keys(m).sort());

  // nothing merged: base entries keep what they came with, plus mod
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, null)), [KEYS, KEYS]);
  // merged: a replaced entry and an appended one have the same shape as the untouched base entries
  const layout = await layoutWith(t, 'shape', {
    [FIXTURE_MOD]: { 'barrel-system.md': '---\ntitle: 替换\n---\n\n正文', 'z-new.md': '正文' },
  });
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, layout)), [KEYS, KEYS, KEYS]);
  // …and a base entry that arrives with a stray navLabel does not keep it: a mechanic page cannot declare the about entry
  const stray = await mergeMechanicsContent(BASE().map((m) => ({ ...m, navLabel: '关于本站' })), null);
  assert.deepEqual(keysOf(stray), [KEYS, KEYS], 'the stray key is dropped, not passed on');
  // and no mechanics at all is an empty list, not an error
  assert.deepEqual(await mergeMechanicsContent([], null), []);
  assert.deepEqual(await mergeMechanicsContent(null, null), []);
});

test('every page carries mod = the mod directory it is in; the pages of all mods come out sorted by file name, whatever mod they are in', async (t) => {
  // Deliberately unsorted: the later mod (zeta) holds the page that sorts first.
  const layout = await layoutWith(t, 'across-mods', {
    zeta: { 'mmm.md': '正文。', 'aaa.md': '正文。' },
    alpha: { 'zzz.md': '正文。', 'bbb.md': '正文。' },
  });

  const merged = await mergeMechanicsContent([], layout);

  assert.deepEqual(
    merged.map((m) => [m.slug, m.mod]),
    [['aaa', 'zeta'], ['bbb', 'alpha'], ['mmm', 'zeta'], ['zzz', 'alpha']],
    'one file-name order across mods: mods/zeta/mechanics/aaa.md comes before mods/alpha/mechanics/zzz.md',
  );
  for (const m of merged) assert.deepEqual(Object.keys(m).sort(), KEYS, `${m.slug}: exactly these four keys`);
});

test('mergeMechanicsContent: slug = file name, source = the file as written; with base entries, same slug replaces in place and new pages append in file-name order across mods', async (t) => {
  const layout = await layoutWith(t, 'merge', {
    zeta: {
      'z-new.md': '---\ntitle: 新页面\n---\n\n新页面正文。\n',
      'a-first.md': '无标题页正文。\n', // no fm, no h1 → title is the slug
    },
    alpha: {
      'barrel-system.md': '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', // replaces BASE[1]; `mod:` comes from the directory
      'README.MD': 'case-variant suffix: still a markdown page',
    },
  });

  const merged = await mergeMechanicsContent(BASE(), layout);

  assert.deepEqual(
    merged.map((m) => [m.slug, m.title, m.mod]),
    [
      ['night-settlement', '夜间结算与疲劳', null], // a base entry: no mod
      ['barrel-system', '手写替换标题', 'alpha'], // replaced in place by a page of alpha
      ['README', 'README', 'alpha'], // .MD stripped case-insensitively; no title → slug
      ['a-first', 'a-first', 'zeta'],
      ['z-new', '新页面', 'zeta'],
    ],
    'base order kept, replaced in place, new pages appended in one file-name order (a-first of zeta before z-new)',
  );
  const replaced = merged.find((m) => m.slug === 'barrel-system');
  assert.equal(replaced.source, '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', 'source is the file as written — the front matter need not say mod:');
  assert.equal(merged.find((m) => m.slug === 'night-settlement').source, BASE()[0].source, 'an untouched base entry keeps its source');
  assert.deepEqual(entry(replaced), { slug: 'barrel-system', title: '手写替换标题', mod: 'alpha', source: replaced.source },
    'a page carries exactly slug, title, source and mod');
});

test("a mechanic page can no longer declare the top nav's about entry: a nav_label in its front matter is not read", async (t) => {
  const layout = await layoutWith(t, 'no-nav-label', {
    [FIXTURE_MOD]: { 'one.md': '---\ntitle: 一\nnav_label: 关于本站\n---\n\n正文' },
  });

  const merged = await mergeMechanicsContent([], layout);

  assert.deepEqual(merged, [{ slug: 'one', title: '一', source: '---\ntitle: 一\nnav_label: 关于本站\n---\n\n正文', mod: FIXTURE_MOD }],
    'the page, with no navLabel of its own: the front matter is still in `source`, as written');
});

test("the repo's fixture page mods/lewd_meme/mechanics/install-compat.md merges as the page it is, under lewd_meme", async () => {
  const raw = await fs.readFile(path.join(REPO_CONTENT, 'mods', FIXTURE_MOD, 'mechanics', 'install-compat.md'), 'utf8');
  const merged = await mergeMechanicsContent(BASE(), await readContentLayout(REPO_CONTENT));
  assert.deepEqual(merged.map((m) => [m.slug, m.mod]), [['night-settlement', null], ['barrel-system', null], ['install-compat', FIXTURE_MOD]],
    'the base entries, then the fixture page — the one page of the one mod in the fixture content');
  assert.deepEqual(entry(merged.find((m) => m.slug === 'install-compat')),
    { slug: 'install-compat', title: '安装与兼容性', source: raw, mod: FIXTURE_MOD });
  assert.ok(!/^nav_label:/m.test(raw), 'the fixture page declares no nav_label: it is lewd_meme\'s install page, nothing more');
});

// ---------- 阶段 3 Task 5 — 「关于本站」由站点页面声明 ----------
//
// content/site/<文件名>.md 的 frontmatter `nav_label` 让这一页成为顶栏的「关于本站」入口。
// 全站至多一页(多了由构建入口报错)。这里只管「哪些页面声明了」。

/** A layout whose site/ holds the given pages, written to disk. */
async function siteTree(t, files) {
  const root = await tmpDir(t, 'site');
  const dir = path.join(root, 'site');
  await fs.mkdir(dir);
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return { ...EMPTY_LAYOUT, site: (await readContentLayout(root)).site };
}

test('sitePagesWithNavLabel: the site pages whose nav_label is set — trimmed — in file-name order; blank, missing or not a string counts as not set', async (t) => {
  const layout = await siteTree(t, {
    'about.md': '---\ntitle: 关于本站\nnav_label: 关于本站\n---\n\n正文',
    'help.md': '---\ntitle: 帮助\nnav_label:   帮助我们  \n---\n\n正文',
    'padded.md': '---\nnav_label: "关于本站"\n---\n',
    'single-quoted.md': "---\nnav_label: '关于本站'\n---\n",
    'empty.md': '---\nnav_label: ""\n---\n',
    'bare.md': '---\nnav_label:\n---\n', // a key without a value parses to ''
    'blank.md': '---\nnav_label: "   "\n---\n',
    'number.md': '---\nnav_label: 123\n---\n', // the YAML subset parses numbers → not a string
    'boolean.md': '---\nnav_label: true\n---\n',
    'list.md': '---\nnav_label:\n  - 关于本站\n---\n', // a block list → not a string
    'none.md': '---\ntitle: 没有 nav_label\n---\n',
  });
  const dir = layout.site[0].file.slice(0, -'about.md'.length);

  const pages = await sitePagesWithNavLabel(layout);

  assert.deepEqual(pages, [
    { slug: 'about', navLabel: '关于本站', file: `${dir}about.md` },
    { slug: 'help', navLabel: '帮助我们', file: `${dir}help.md` },
    { slug: 'padded', navLabel: '关于本站', file: `${dir}padded.md` },
    { slug: 'single-quoted', navLabel: '关于本站', file: `${dir}single-quoted.md` },
  ], 'every page that declares, in file-name order, with its file so that a report can name it');
});

test('sitePagesWithNavLabel: no site pages, or no layout at all → nothing declares', async () => {
  assert.deepEqual(await sitePagesWithNavLabel({ site: [] }), []);
  assert.deepEqual(await sitePagesWithNavLabel(null), []);
});

test('sitePagesWithNavLabel: a listed page whose file is gone by the time it is read declares nothing — and does not throw', async (t) => {
  const layout = await siteTree(t, { 'about.md': '---\ntitle: 关于本站\nnav_label: 关于本站\n---\n\n正文' });
  const dir = layout.site[0].file.slice(0, -'about.md'.length);
  layout.site.push({ slug: 'gone', file: `${dir}gone.md` }); // deleted between the layout being read and this

  assert.deepEqual(await sitePagesWithNavLabel(layout), [{ slug: 'about', navLabel: '关于本站', file: `${dir}about.md` }],
    'the page that is there declares; the one that is not is skipped');
});

test("the repo's own content declares 关于本站 exactly once: content/site/about.md", async () => {
  const pages = await sitePagesWithNavLabel(await readContentLayout(path.join(__dirname, '..', 'content')));
  assert.deepEqual(pages.map((p) => p.slug), ['about']);
  assert.equal(pages[0].navLabel, '关于本站');
  // …and no mechanic page does any more
  const layout = await readContentLayout(path.join(__dirname, '..', 'content'));
  for (const page of layout.mods.flatMap((mod) => mod.mechanics)) {
    const raw = await fs.readFile(page.file, 'utf8');
    assert.ok(!/^nav_label:/m.test(raw.slice(0, raw.indexOf('\n---', 3))), `${page.file}: a mechanic page must not declare nav_label`);
  }
});
