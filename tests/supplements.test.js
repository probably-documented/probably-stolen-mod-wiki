'use strict';

// Import plan Task 6: the hand-written supplement layer over the data.
//
// content/items/<id>.md is the one place a contributor edits: its frontmatter
// overwrites the same fields of the item the data files describe. One rule
// differs from the offline repo's merge.js applySupplement: an empty value
// (empty string, empty array) does NOT overwrite. The CMS serialises every
// field it declares, so a field left blank in the editor is "not filled in",
// not "clear what the game data says".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { readSupplements, mergeSupplements } = require('../tools/build/supplements.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

function tmpDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `supplements-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Write content/items/<id>.md: the given frontmatter lines between --- markers. */
async function writeItem(contentDir, id, fmLines) {
  fs.mkdirSync(path.join(contentDir, 'items'), { recursive: true });
  fs.writeFileSync(path.join(contentDir, 'items', `${id}.md`), ['---', ...fmLines, '---', ''].join('\n'));
}

const itemOf = (data, id) => data.items.find((it) => it.id === id);
const milkBefore = structuredClone(FIXTURE_DATA).items.find((it) => it.id === 'wondrous_milk');

test('补充层覆盖数据:非空字段赢,来源记成 content:items/<file>', async (t) => {
  const contentDir = tmpDir(t, 'merge');
  await writeItem(contentDir, 'wondrous_milk', [
    'slug: wondrous_milk',
    "notes: '手写的备注'",
    'price: 999',
    'related:',
    '  - tentacle_body',
    'usage:',
    '  - type: sell',
    "    text: '卖掉它'",
  ]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, contentDir, () => {});

  const item = itemOf(data, 'wondrous_milk');
  assert.equal(item.notes, '手写的备注');
  assert.equal(item.price, 999);
  assert.deepEqual(item.related, ['tentacle_body']);
  assert.deepEqual(item.usage, [{ type: 'sell', text: '卖掉它' }]);
  assert.equal(item.provenance.notes, 'content:items/wondrous_milk.md');
  assert.equal(item.provenance.price, 'content:items/wondrous_milk.md');
  // a field the supplement did not mention keeps the data value
  assert.equal(item.description, milkBefore.description);
});

test('空字符串与空数组不覆盖数据', async (t) => {
  const contentDir = tmpDir(t, 'empty');
  await writeItem(contentDir, 'wondrous_milk', [
    "description: ''",
    'categories: []',
    "notes: ''",
    'related:',
  ]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, contentDir, () => {});

  const item = itemOf(data, 'wondrous_milk');
  assert.equal(item.description, milkBefore.description, 'an empty description does not erase the data');
  assert.deepEqual(item.categories, milkBefore.categories, 'an empty array does not erase the data');
  assert.equal(item.notes, milkBefore.notes);
  assert.equal(item.provenance.description, milkBefore.provenance.description, 'no provenance label for a field that did not change');
});

test('价格:数字与数字字符串都接受;非数字不覆盖', async (t) => {
  for (const [raw, expected] of [['42', 42], ['42.5', 42.5]]) {
    const contentDir = tmpDir(t, `price-${raw}`);
    await writeItem(contentDir, 'wondrous_milk', [`price: ${raw}`]);
    const data = structuredClone(FIXTURE_DATA);
    await mergeSupplements(data, contentDir, () => {});
    assert.equal(itemOf(data, 'wondrous_milk').price, expected);
  }
  const bad = tmpDir(t, 'price-bad');
  await writeItem(bad, 'wondrous_milk', ["price: 'not a number'"]);
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, bad, () => {});
  assert.equal(itemOf(data, 'wondrous_milk').price, milkBefore.price);
});

test('块列表与单行 JSON 两种写法结果相同', async (t) => {
  const block = tmpDir(t, 'block');
  await writeItem(block, 'wondrous_milk', ['usage:', '  - type: sell', '    text: 卖掉']);
  const json = tmpDir(t, 'json');
  await writeItem(json, 'wondrous_milk', ['usage: [{"type":"sell","text":"卖掉"}]']);

  const a = structuredClone(FIXTURE_DATA);
  const b = structuredClone(FIXTURE_DATA);
  await mergeSupplements(a, block, () => {});
  await mergeSupplements(b, json, () => {});
  assert.deepEqual(itemOf(a, 'wondrous_milk').usage, itemOf(b, 'wondrous_milk').usage);
});

test('没有对应物品的补充文件:warn 跳过,不新建物品', async (t) => {
  const contentDir = tmpDir(t, 'ghost');
  await writeItem(contentDir, 'ghost_item', ["notes: '不该出现'"]);
  const data = structuredClone(FIXTURE_DATA);
  const warnings = [];
  await mergeSupplements(data, contentDir, (line) => warnings.push(line));

  assert.equal(itemOf(data, 'ghost_item'), undefined);
  assert.equal(data.items.length, FIXTURE_DATA.items.length);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ghost_item/);
});

test('contentDir 为 null:什么都不做', async () => {
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, null, () => {});
  assert.deepEqual(data, structuredClone(FIXTURE_DATA));
  assert.deepEqual(await readSupplements(null), []);
});

test('大小写不敏感:文件名的 id 与数据里的 id 只差大小写时,仍然找到那件物品', async (t) => {
  const contentDir = tmpDir(t, 'case');
  await writeItem(contentDir, 'gear.maiddress', ['slug: gear.maidDress', "notes: '小写文件名'"]);
  const data = { items: [{ id: 'gear.maidDress', notes: null, provenance: {} }], mods: [] };
  await mergeSupplements(data, contentDir, () => {});
  assert.equal(data.items[0].notes, '小写文件名');
  assert.equal(data.items[0].provenance.notes, 'content:items/gear.maiddress.md');
});
