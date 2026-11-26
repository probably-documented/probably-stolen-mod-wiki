'use strict';

// writeCmsAssets: the three files the build writes next to the CMS shell in dist/admin/ —
// admin.js (the two source scripts joined), templates.json and items-by-mod.json. They are
// for the online CMS only: written after the shell is injected, so after the site audit, and
// never in the offline package. Their shapes are what the CMS's scripts read, so they are
// pinned here to the letter.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { writeCmsAssets, TEMPLATE_CATEGORIES } = require('../tools/build/cms-assets.js');
const { readContentLayout } = require('../tools/build/content-layout.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

const noop = () => {};

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cms-assets-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir while a just-written file is
  // still held: that is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

async function put(root, rel, content = '') {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
  return path.join(root, rel);
}

/** A stand-in repository root: the two source scripts, two templates and a file that is not one, and an empty dist/admin/. */
async function fakeRepo(t) {
  const repoRoot = await tmpDir(t, 'repo');
  await put(repoRoot, 'tools/cms/lib.js', '// lib\nwindow.CmsUi = {};\n');
  await put(repoRoot, 'tools/cms/admin.js', '// admin');
  await put(repoRoot, 'templates/mechanic-system.md', '---\ntitle: 系统机制\ncategory: mechanic\napplies_to:\n  - mechanics\ndescription: 介绍一个会自动运行的系统\n---\n\n## 触发条件\n');
  await put(repoRoot, 'templates/item-detail.md', '---\ntitle: 物品详解\ncategory: item\napplies_to:\n  - items\n---\n正文');
  await put(repoRoot, 'templates/notes.txt', 'not a template');
  const distDir = path.join(repoRoot, 'dist');
  await fs.mkdir(path.join(distDir, 'admin'), { recursive: true });
  return { repoRoot, distDir };
}

const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const adminFile = (distDir, name) => path.join(distDir, 'admin', name);

test('admin.js is the library, a blank line, then admin.js, whatever newlines the sources end with', async (t) => {
  const { repoRoot, distDir } = await fakeRepo(t);
  await writeCmsAssets({ repoRoot, distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop });
  assert.equal(await fs.readFile(adminFile(distDir, 'admin.js'), 'utf8'), '// lib\nwindow.CmsUi = {};\n\n// admin\n');
});

test("templates.json is what the picker reads: the categories with their labels, and the templates keyed by file name in file order", async (t) => {
  const { repoRoot, distDir } = await fakeRepo(t);
  const result = await writeCmsAssets({ repoRoot, distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop });
  assert.deepEqual(await readJson(adminFile(distDir, 'templates.json')), {
    categories: TEMPLATE_CATEGORIES,
    templates: {
      'item-detail': { title: '物品详解', category: 'item', applies_to: ['items'], description: '', body: '正文' },
      'mechanic-system': { title: '系统机制', category: 'mechanic', applies_to: ['mechanics'], description: '介绍一个会自动运行的系统', body: '\n## 触发条件\n' },
    },
  });
  assert.deepEqual(result, { templates: 2, items: FIXTURE_DATA.items.length });
});

test("items-by-mod.json follows the data order, a mod with no items included, and marks the items that already have an entry whatever the file name's case", async (t) => {
  const { repoRoot, distDir } = await fakeRepo(t);
  const contentDir = path.join(repoRoot, 'content');
  await put(contentDir, 'mods/lewd_meme/items/WONDROUS_MILK.md');
  await put(contentDir, 'mods/lewd_meme_remake/items/milk_rich.md');
  await writeCmsAssets({ repoRoot, distDir, layout: await readContentLayout(contentDir), data: FIXTURE_DATA, warn: noop });

  const { mods } = await readJson(adminFile(distDir, 'items-by-mod.json'));

  assert.deepEqual(mods.map((mod) => [mod.id, mod.items.map((item) => `${item.id}:${item.taken ? 1 : 0}`)]), [
    ['lewd_meme', ['wondrous_milk:1', 'tentacle_body:0']],
    ['lewd_meme_remake', ['milk_barrel:0', 'milk_rich:1']],
    ['claude.lewdMemeBrood', ['brood_egg:0']],
    ['lewd_meme_brothel', ['palm_brothel:0']],
    ['lewd_meme_legacy_content', []],
    ['dui_mian_lan_qiu_ji_tearl', ['tear_merchant:0']],
  ]);
  assert.deepEqual(mods[0].items[0], {
    id: 'wondrous_milk', name: FIXTURE_DATA.items.find((item) => item.id === 'wondrous_milk').name, taken: true,
  });
});

test("items-by-mod.json offers the exported items only: a hand-written item (one the build made from an entry that names no exported item) is not there to pick", async (t) => {
  const { repoRoot, distDir } = await fakeRepo(t);
  const data = structuredClone(FIXTURE_DATA);
  // What addHandwrittenItems appends to the data for such an entry.
  data.items.push({ id: 'thing', name: '东西', mod: 'lewd_meme_remake', handwritten: true, price: null, provenance: {} });
  const result = await writeCmsAssets({ repoRoot, distDir, layout: await readContentLayout(null), data, warn: noop });

  const { mods } = await readJson(adminFile(distDir, 'items-by-mod.json'));
  assert.deepEqual(mods.map((mod) => [mod.id, mod.items.map((item) => item.id)]), [
    ['lewd_meme', ['wondrous_milk', 'tentacle_body']],
    ['lewd_meme_remake', ['milk_barrel', 'milk_rich']],
    ['claude.lewdMemeBrood', ['brood_egg']],
    ['lewd_meme_brothel', ['palm_brothel']],
    ['lewd_meme_legacy_content', []],
    ['dui_mian_lan_qiu_ji_tearl', ['tear_merchant']],
  ], 'the exported items and nothing of the build\'s own making');
  assert.equal(result.items, FIXTURE_DATA.items.length);
});

test('a missing script, a template without one of its keys, or one of an unknown category stops and names the file', async (t) => {
  const noLib = await fakeRepo(t);
  await fs.rm(path.join(noLib.repoRoot, 'tools/cms/lib.js'));
  await assert.rejects(
    writeCmsAssets({ repoRoot: noLib.repoRoot, distDir: noLib.distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop }),
    /lib\.js/,
  );

  const broken = await fakeRepo(t);
  await put(broken.repoRoot, 'templates/broken.md', '---\ntitle: 缺分类\napplies_to:\n  - items\n---\n正文');
  await assert.rejects(
    writeCmsAssets({ repoRoot: broken.repoRoot, distDir: broken.distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop }),
    /broken\.md[\s\S]*category/,
  );

  const odd = await fakeRepo(t);
  await put(odd.repoRoot, 'templates/odd.md', '---\ntitle: 怪分类\ncategory: recipe\napplies_to:\n  - items\n---\n正文');
  await assert.rejects(
    writeCmsAssets({ repoRoot: odd.repoRoot, distDir: odd.distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop }),
    /odd\.md[\s\S]*recipe/,
  );
});

test('no templates/ directory yet → an empty list that still carries the categories', async (t) => {
  const { repoRoot, distDir } = await fakeRepo(t);
  await fs.rm(path.join(repoRoot, 'templates'), { recursive: true, force: true });
  const result = await writeCmsAssets({ repoRoot, distDir, layout: await readContentLayout(null), data: FIXTURE_DATA, warn: noop });
  assert.deepEqual(result, { templates: 0, items: FIXTURE_DATA.items.length });
  assert.deepEqual(await readJson(adminFile(distDir, 'templates.json')), { categories: TEMPLATE_CATEGORIES, templates: {} });
});
