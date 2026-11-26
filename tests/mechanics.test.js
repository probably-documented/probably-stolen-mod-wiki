'use strict';

// tools/build/mechanics.js — the merge of content/mods/<modId>/mechanics/*.md
// into `mechanics` (mergeMechanicsContent, mechanicTitle), read through the
// layout (tools/build/content-layout.js) so that the build entry stays pure
// orchestration. slug = file name, title = frontmatter title > first ATX h1 >
// slug, same slug replaces, new slugs append — and the pages of every mod
// come out in ONE file-name order: never grouped by mod.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { mergeMechanicsContent, mechanicTitle, mechanicsWithNavLabel } = require('../tools/build/mechanics.js');
const { readContentLayout } = require('../tools/build/content-layout.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

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
const entry = ({ slug, title, source, navLabel, mod }) => ({ slug, title, source, navLabel, mod });

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

test('mergeMechanicsContent (D2): a null layout / a layout without mods → the base entries as they came, each with navLabel null and mod null', async () => {
  const base = BASE();
  const expected = base.map((m) => entry({ ...m, navLabel: null, mod: null }));

  for (const [what, layout] of [['a null layout', null], ['a layout without mods', EMPTY_LAYOUT]]) {
    const merged = await mergeMechanicsContent(base, layout);
    assert.deepEqual(merged, expected, `${what}: the base entries, each with navLabel: null and mod: null`);
    assert.deepEqual(merged.map((m) => m.slug), base.map((m) => m.slug), `${what}: same order`);
    for (const m of merged) {
      assert.ok(Object.hasOwn(m, 'navLabel') && Object.hasOwn(m, 'mod'), `${what}: ${m.slug} has the navLabel and mod keys`);
      assert.equal(m.navLabel, null);
      assert.equal(m.mod, null);
    }
  }
  assert.ok(base.every((m) => !Object.hasOwn(m, 'navLabel') && !Object.hasOwn(m, 'mod')), 'the input is left as it was');
});

test('mergeMechanicsContent (D2): whatever the layout holds, every entry of the result has the same keys', async (t) => {
  const base = BASE();
  const keysOf = (merged) => merged.map((m) => Object.keys(m).sort());
  const sameKeys = [['mod', 'navLabel', 'slug', 'source', 'title']];

  // nothing merged: base entries keep what they came with, plus navLabel and mod
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, null)), [sameKeys[0], sameKeys[0]]);
  // a base entry that declares a label comes back with it normalised
  const declaring = [{ ...base[0], navLabel: '  顶部入口  ' }, base[1]];
  assert.deepEqual((await mergeMechanicsContent(declaring, null)).map((m) => m.navLabel), ['顶部入口', null]);
  // merged: a replaced entry and an appended one have the same shape as the untouched base entries
  const layout = await layoutWith(t, 'shape', {
    [FIXTURE_MOD]: { 'barrel-system.md': '---\ntitle: 替换\n---\n\n正文', 'z-new.md': '正文' },
  });
  assert.deepEqual(keysOf(await mergeMechanicsContent(base, layout)), [sameKeys[0], sameKeys[0], sameKeys[0]]);
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
  for (const m of merged) assert.deepEqual(Object.keys(m).sort(), ['mod', 'navLabel', 'slug', 'source', 'title'], `${m.slug}: exactly these five keys`);
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
  assert.deepEqual(entry(replaced), {
    slug: 'barrel-system', title: '手写替换标题', navLabel: null, mod: 'alpha', source: replaced.source,
  }, 'a page carries exactly slug, title, source, navLabel and mod');
});

test("the repo's fixture page mods/lewd_meme/mechanics/install-compat.md merges as the page it is, under lewd_meme", async () => {
  const raw = await fs.readFile(path.join(REPO_CONTENT, 'mods', FIXTURE_MOD, 'mechanics', 'install-compat.md'), 'utf8');
  const merged = await mergeMechanicsContent(BASE(), await readContentLayout(REPO_CONTENT));
  assert.deepEqual(merged.map((m) => [m.slug, m.mod]), [['night-settlement', null], ['barrel-system', null], ['install-compat', FIXTURE_MOD]],
    'the base entries, then the fixture page — the one page of the one mod in the fixture content');
  assert.deepEqual(entry(merged.find((m) => m.slug === 'install-compat')),
    { slug: 'install-compat', title: '安装与兼容性', source: raw, navLabel: '关于本站', mod: FIXTURE_MOD });
});

// ---------- Task 5b A — nav_label ----------

test('navLabel: frontmatter `nav_label` → the label (trimmed); empty, blank, missing or not a string → null', async (t) => {
  const layout = await layoutWith(t, 'nav-label', {
    [FIXTURE_MOD]: {
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
    },
  });

  const merged = await mergeMechanicsContent(BASE(), layout);
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
    const out = await renderSite(data, { layout: null });
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
      if (rel === 'data.js' || rel === 'nav-search.js') continue;
      assert.equal(html.split('class="menu-row"')[1].split('</div>')[0].includes(`mechanics/${slug}.html"`), declared,
        `${rel}: same answer on every page`);
    }
  }
});
