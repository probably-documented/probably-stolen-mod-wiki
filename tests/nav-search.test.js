'use strict';

// The data behind the home page search (stage 3, task 1): tools/build/nav-search.js.
//
// The home page lists every mod under its sections and searches them by name,
// id, summary, and the aliases and keywords a mod's redirects.yaml declares.
// The model is built here from three sources and written as one small script,
// nav-search.js, so the search runs in the browser with no fetch — the same
// offline and on the site.

const test = require('node:test');
const testVm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { parseRedirectsYaml, readRedirects, buildNavSearch } = require('../tools/build/nav-search.js');
// The script is written by the renderer, next to data.js: render.js is where every file of the site comes from.
const { renderNavSearchJs } = require('../tools/build/render.js');
const { readContentLayout } = require('../tools/build/content-layout.js');

async function tmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nav-search-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

async function put(root, rel, text) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
}

test('parseRedirectsYaml: the two top-level lists, each on its own; quotes come off; an empty text or a missing list is an empty list', () => {
  // The shape the CMS writes (stage 2b smoke test): plain YAML, one item per line.
  assert.deepEqual(parseRedirectsYaml('mod: alpha\naliases:\n  - 黑市\n  - \'暗流 market\'\nkeywords:\n  - 交易\n'),
    { aliases: ['黑市', '暗流 market'], keywords: ['交易'] });
  assert.deepEqual(parseRedirectsYaml(''), { aliases: [], keywords: [] }, 'an empty file');
  assert.deepEqual(parseRedirectsYaml(null), { aliases: [], keywords: [] }, 'no text at all');
  assert.deepEqual(parseRedirectsYaml('mod: alpha\naliases:\n  - 黑市\n'), { aliases: ['黑市'], keywords: [] }, 'only one of the two');
  // …and the flow forms a hand-written file may use
  assert.deepEqual(parseRedirectsYaml('keywords: []\naliases: ["a", \'b\']\n'), { aliases: ['a', 'b'], keywords: [] });
  assert.deepEqual(parseRedirectsYaml('aliases:\nkeywords: [x, y]\n'), { aliases: [], keywords: ['x', 'y'] });
  // Anything else on the top level is left alone: another key\'s list is not an alias.
  assert.deepEqual(parseRedirectsYaml('mod: alpha\nnotes:\n  - 不是别名\naliases:\n    - 缩进深一点也是它的\n'),
    { aliases: ['缩进深一点也是它的'], keywords: [] });
});

test('readRedirects: keyed by the mod directory; a mod without the file is absent, an empty file is present with two empty lists', async (t) => {
  const root = await tmpDir(t);
  await put(root, 'mods/alpha/redirects.yaml', 'mod: alpha\naliases:\n  - 黑市\nkeywords: []\n');
  await put(root, 'mods/beta/redirects.yaml', '');
  await put(root, 'mods/gamma/_index.md', '---\ntitle: 丙\n---\n');

  const redirects = await readRedirects(await readContentLayout(root));

  assert.deepEqual([...redirects.keys()].sort(), ['alpha', 'beta'], 'gamma has no redirects.yaml: not in the map');
  assert.deepEqual(redirects.get('alpha'), { aliases: ['黑市'], keywords: [] });
  assert.deepEqual(redirects.get('beta'), { aliases: [], keywords: [] }, 'an empty file is a mod with nothing to add');
  assert.deepEqual([...(await readRedirects(await readContentLayout(path.join(root, 'nope')))).keys()], [], 'no content tree, no redirects');
});

/** A content tree with everything buildNavSearch reads, and the layout over it. */
async function treeWith(t) {
  const root = await tmpDir(t);
  await put(root, 'mods/alpha/_index.md', "---\ntitle: 被数据的名字压过\nsummary: ''\nauthor: ''\nversion: ''\nprerequisites: []\n---\n\n甲的正文。\n");
  await put(root, 'mods/beta/_index.md', "---\ntitle: 乙\nsummary: ''\n---\n\n乙的正文。\n");
  await put(root, 'mods/gamma/_index.md', "---\ntitle: 丙\nsummary: ''\n---\n");
  // eps: a directory that is a mod as far as the layout is concerned, with neither data nor a page of its own
  await put(root, 'mods/eps/items/thing.md', "---\nitem_id: thing\nmod: eps\ntitle: 东西\n---\n");
  await put(root, 'sections/one.md', "---\ntitle: 第一\norder: 2\nmods:\n  - alpha\n  - beta\n  - eps\n  - ghost\n---\n\n第一分区的介绍，第一段。\n\n第二段不进摘要。\n");
  await put(root, 'sections/two.md', "---\ntitle: 第二\nmods:\n  - alpha\n---\n\n第二分区的介绍。\n");
  const layout = await readContentLayout(root);
  const data = {
    mods: [
      { id: 'delta', name: '丁', description: '丁的介绍。\n【1.0.0】版本行之后的内容不算简介' },
      { id: 'alpha', name: '甲', description: '甲的介绍。' },
    ],
  };
  const redirects = new Map([['alpha', { aliases: ['黑市'], keywords: ['交易'] }]]);
  return { root, layout, data, redirects };
}

test('buildNavSearch: the mods in one global order — the exported ones as the data lists them, the hand-written ones after them by title', async (t) => {
  const { layout, data, redirects } = await treeWith(t);

  const model = await buildNavSearch({ data, layout, redirects });

  assert.deepEqual(model.mods.slice(0, 2).map((mod) => [mod.id, mod.name]), [
    ['delta', '丁'], // exported, and the data lists it first; no page file of its own, so the data's name
    ['alpha', '被数据的名字压过'], // exported, but its page's title wins over the name in the data (stage 5)
  ]);
  const handWritten = model.mods.slice(2).map((mod) => mod.id);
  assert.deepEqual(handWritten.slice(0, 2), ['gamma', 'beta'],
    'the hand-written ones come after the exported ones, by title: 丙 before 乙, although beta < gamma as directory names');
  assert.deepEqual([...handWritten].sort(), ['beta', 'eps', 'gamma'], '…and a directory with neither data nor a page is a mod too');
  assert.deepEqual(model.sections.map((section) => [section.slug, section.order]), [['one', 2], ['two', null]],
    'sections with an order come first, by that order; those without follow');
});

test('buildNavSearch: a mod\'s name falls back from its page\'s title to the data to its directory name; its summary is the data\'s description up to the first version line', async (t) => {
  const { layout, data, redirects } = await treeWith(t);

  const model = await buildNavSearch({ data, layout, redirects });
  const by = Object.fromEntries(model.mods.map((mod) => [mod.id, mod]));

  assert.equal(by.alpha.name, '被数据的名字压过', 'the page\'s title wins over the name in the data');
  assert.equal(by.alpha.summary, '甲的介绍。');
  assert.equal(by.delta.summary, '丁的介绍。', 'nothing after the first version line');
  assert.equal(by.delta.name, '丁', 'no page file: the name in the data');
  assert.equal(by.beta.name, '乙', 'no data: the page\'s title');
  assert.equal(by.beta.summary, '', 'no data: no summary');
  assert.equal(by.eps.name, 'eps', 'neither: the directory name');

  // A mod whose data has no name at all: the page's title still shows.
  const thin = await buildNavSearch({
    data: { mods: [{ id: 'alpha', name: null, description: null }] }, layout, redirects,
  });
  const alpha = thin.mods.find((mod) => mod.id === 'alpha');
  assert.equal(alpha.name, '被数据的名字压过', 'no name in the data: the page\'s title');
  assert.equal(alpha.summary, '');
});

test('buildNavSearch: aliases and keywords come from the redirects, a section\'s intro is its first paragraph, and a mod lists the sections it is in, in the sections\' order', async (t) => {
  const { layout, data, redirects } = await treeWith(t);

  const model = await buildNavSearch({ data, layout, redirects });
  const by = Object.fromEntries(model.mods.map((mod) => [mod.id, mod]));

  assert.deepEqual(by.alpha, {
    id: 'alpha', name: '被数据的名字压过', summary: '甲的介绍。', aliases: ['黑市'], keywords: ['交易'], sections: ['one', 'two'],
  }, 'alpha is in both sections, listed in the sections\' order; its page title names it');
  assert.deepEqual(by.delta, { id: 'delta', name: '丁', summary: '丁的介绍。', aliases: [], keywords: [], sections: [] });
  assert.deepEqual(by.eps.sections, ['one'], 'a mod that is only named in a section still learns which one');
  assert.deepEqual(model.sections, [
    { slug: 'one', title: '第一', intro: '第一分区的介绍，第一段。', order: 2 },
    { slug: 'two', title: '第二', intro: '第二分区的介绍。', order: null },
  ]);
});

test('buildNavSearch: no content tree at all is an empty model, and so is no data', async () => {
  assert.deepEqual(await buildNavSearch({ data: { mods: [] }, layout: await readContentLayout(null), redirects: new Map() }), { mods: [], sections: [] });
  assert.deepEqual(await buildNavSearch({ data: null, layout: await readContentLayout(null), redirects: null }), { mods: [], sections: [] });
});

test('renderNavSearchJs: assigns window.NAV_SEARCH, and reads back equal to the model', () => {
  const model = {
    mods: [{ id: 'alpha', name: '甲', summary: '甲的介绍。', aliases: ['黑市'], keywords: [], sections: ['one'] }],
    sections: [{ slug: 'one', title: '第一', intro: '第一分区的介绍。', order: null }],
  };
  const code = renderNavSearchJs(model);
  assert.ok(code.startsWith('window.NAV_SEARCH = '), 'an assignment, like data.js');
  assert.ok(code.endsWith(';\n'));

  const sandbox = { window: {} };
  testVm.runInNewContext(code, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.window.NAV_SEARCH)), model);
});
