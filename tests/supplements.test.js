'use strict';

// The hand-written supplement layer over the data (import plan Task 6).
//
// content/mods/<modId>/items/<物品ID>.md is the one place a contributor edits
// an item: its front matter overwrites the same fields of the item the data
// files describe. The build reads the entries through the layout
// (tools/build/content-layout.js). One rule differs from the offline repo's
// merge.js applySupplement: an empty value (empty string, empty array) does
// NOT overwrite. The CMS serialises every field it declares, so a field left
// blank in the editor is "not filled in", not "clear what the game data says".
//
// Pinned on purpose (a change would show on the 65 item pages): the
// provenance label of an overwritten field stays `content:items/<file name>`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readSupplements, mergeSupplements } = require('../tools/build/supplements.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

function tmpDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `supplements-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/** wondrous_milk's mod in the fixture data. */
const MOD = 'lewd_meme';

/**
 * Write content/mods/<mod>/items/<id>.md — the given front matter lines
 * between --- markers — and return the entry the layout lists it as.
 */
function writeEntry(contentDir, mod, id, fmLines) {
  const file = path.join(contentDir, 'mods', mod, 'items', `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ['---', ...fmLines, '---', ''].join('\n'));
  return { id, file };
}

/** A layout, built by hand, whose one mod holds the given item entries. */
const layoutWith = (contentDir, items, mod = MOD) => ({
  home: null, sections: [], site: [], strayFiles: [], legacyDirs: [], imageFolders: [],
  mods: [{ id: mod, dir: path.join(contentDir, 'mods', mod), indexFile: null, redirectsFile: null, items, mechanics: [], nestedIndexFiles: [] }],
});

const itemOf = (data, id) => data.items.find((it) => it.id === id);
const toPosix = (p) => p.split(path.sep).join('/');
const milkBefore = structuredClone(FIXTURE_DATA).items.find((it) => it.id === 'wondrous_milk');

test('补充层覆盖数据:非空字段赢,来源记成 content:items/<file>', async (t) => {
  const contentDir = tmpDir(t, 'merge');
  const layout = layoutWith(contentDir, [writeEntry(contentDir, MOD, 'wondrous_milk', [
    'item_id: wondrous_milk',
    `mod: ${MOD}`,
    "notes: '手写的备注'",
    'price: 999',
    'related:',
    '  - tentacle_body',
    'usage:',
    '  - type: sell',
    "    text: '卖掉它'",
  ])]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, layout, () => {});

  const item = itemOf(data, 'wondrous_milk');
  assert.equal(item.notes, '手写的备注');
  assert.equal(item.price, 999);
  assert.deepEqual(item.related, ['tentacle_body']);
  assert.deepEqual(item.usage, [{ type: 'sell', text: '卖掉它' }]);
  // The label names the entry file only — the directory it is in does not show (it is on every item page).
  assert.equal(item.provenance.notes, 'content:items/wondrous_milk.md');
  assert.equal(item.provenance.price, 'content:items/wondrous_milk.md');
  // a field the supplement did not mention keeps the data value
  assert.equal(item.description, milkBefore.description);
});

test('空字符串与空数组不覆盖数据', async (t) => {
  const contentDir = tmpDir(t, 'empty');
  const layout = layoutWith(contentDir, [writeEntry(contentDir, MOD, 'wondrous_milk', [
    "description: ''",
    'categories: []',
    "notes: ''",
    'related:',
  ])]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, layout, () => {});

  const item = itemOf(data, 'wondrous_milk');
  assert.equal(item.description, milkBefore.description, 'an empty description does not erase the data');
  assert.deepEqual(item.categories, milkBefore.categories, 'an empty array does not erase the data');
  assert.equal(item.notes, milkBefore.notes);
  assert.equal(item.provenance.description, milkBefore.provenance.description, 'no provenance label for a field that did not change');
});

test('价格:数字与数字字符串都接受;非数字不覆盖', async (t) => {
  for (const [raw, expected] of [['42', 42], ['42.5', 42.5]]) {
    const contentDir = tmpDir(t, `price-${raw}`);
    const layout = layoutWith(contentDir, [writeEntry(contentDir, MOD, 'wondrous_milk', [`price: ${raw}`])]);
    const data = structuredClone(FIXTURE_DATA);
    await mergeSupplements(data, layout, () => {});
    assert.equal(itemOf(data, 'wondrous_milk').price, expected);
  }
  const bad = tmpDir(t, 'price-bad');
  const layout = layoutWith(bad, [writeEntry(bad, MOD, 'wondrous_milk', ["price: 'not a number'"])]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, layout, () => {});
  assert.equal(itemOf(data, 'wondrous_milk').price, milkBefore.price);
});

test('块列表与单行 JSON 两种写法结果相同', async (t) => {
  const block = tmpDir(t, 'block');
  const json = tmpDir(t, 'json');
  const a = structuredClone(FIXTURE_DATA);
  const b = structuredClone(FIXTURE_DATA);
  await mergeSupplements(a, layoutWith(block, [writeEntry(block, MOD, 'wondrous_milk', ['usage:', '  - type: sell', '    text: 卖掉'])]), () => {});
  await mergeSupplements(b, layoutWith(json, [writeEntry(json, MOD, 'wondrous_milk', ['usage: [{"type":"sell","text":"卖掉"}]'])]), () => {});
  assert.deepEqual(itemOf(a, 'wondrous_milk').usage, itemOf(b, 'wondrous_milk').usage);
});

test('readSupplements: every item entry of every mod, as the layout lists them', async (t) => {
  const contentDir = tmpDir(t, 'read');
  const milk = writeEntry(contentDir, MOD, 'wondrous_milk', ['item_id: wondrous_milk', "notes: '一'"]);
  const barrel = writeEntry(contentDir, 'lewd_meme_remake', 'milk_barrel', ['item_id: milk_barrel', "notes: '二'"]);
  const layout = {
    ...layoutWith(contentDir, []),
    mods: [layoutWith(contentDir, [barrel], 'lewd_meme_remake').mods[0], layoutWith(contentDir, [milk]).mods[0]],
  };

  const entries = await readSupplements(layout);

  assert.deepEqual(entries, [
    { id: 'milk_barrel', frontmatter: { item_id: 'milk_barrel', notes: '二' }, fileName: 'milk_barrel.md', file: barrel.file },
    { id: 'wondrous_milk', frontmatter: { item_id: 'wondrous_milk', notes: '一' }, fileName: 'wondrous_milk.md', file: milk.file },
  ]);
});

test('没有对应物品的词条:warn 跳过,不新建物品', async (t) => {
  const contentDir = tmpDir(t, 'ghost');
  const ghost = writeEntry(contentDir, MOD, 'ghost_item', ["notes: '不该出现'"]);
  const data = structuredClone(FIXTURE_DATA);
  const warnings = [];
  await mergeSupplements(data, layoutWith(contentDir, [ghost]), (line) => warnings.push(line));

  assert.equal(itemOf(data, 'ghost_item'), undefined);
  assert.equal(data.items.length, FIXTURE_DATA.items.length);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ghost_item/, warnings[0]);
  assert.ok(warnings[0].includes(toPosix(ghost.file)), `the warning names the real file, got: ${warnings[0]}`);
});

test('没有布局(null,或没有 mod):什么都不做', async () => {
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, null, () => {});
  assert.deepEqual(data, structuredClone(FIXTURE_DATA));
  assert.deepEqual(await readSupplements(null), []);
  assert.deepEqual(await readSupplements({ mods: [] }), []);
});

test('大小写不敏感:文件名的 id 与数据里的 id 只差大小写时,仍然找到那件物品', async (t) => {
  const contentDir = tmpDir(t, 'case');
  const layout = layoutWith(contentDir, [writeEntry(contentDir, MOD, 'gear.maiddress', ['item_id: gear.maiddress', "notes: '小写文件名'"])]);
  const data = { items: [{ id: 'gear.maidDress', notes: null, provenance: {} }], mods: [] };
  await mergeSupplements(data, layout, () => {});
  assert.equal(data.items[0].notes, '小写文件名');
  assert.equal(data.items[0].provenance.notes, 'content:items/gear.maiddress.md', 'the label is the file as it is named');
});

test('shape:块列表的两个数字覆盖数据里的尺寸', async (t) => {
  const contentDir = tmpDir(t, 'shape');
  const layout = layoutWith(contentDir, [writeEntry(contentDir, MOD, 'wondrous_milk', ['shape:', '  - 4', '  - 5'])]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, layout, () => {});
  assert.deepEqual(itemOf(data, 'wondrous_milk').shape, [4, 5]);
});
