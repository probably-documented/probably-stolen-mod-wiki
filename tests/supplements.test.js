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

const { readSupplements, mergeSupplements, addHandwrittenItems } = require('../tools/build/supplements.js');
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

// ---------- 阶段 3 Task 3:纯手写物品 ----------

/** A mod folder of the layout, built by hand. */
const modDir = (contentDir, id, items, indexFile = null) => ({
  id, dir: path.join(contentDir, 'mods', id), indexFile, redirectsFile: null, items, mechanics: [], nestedIndexFiles: [],
});

test('addHandwrittenItems: an entry that names no exported item becomes an item of its own, in the mod of its folder', async (t) => {
  const contentDir = tmpDir(t, 'handwritten');
  const exported = writeEntry(contentDir, 'lewd_meme_remake', 'milk_barrel', ["title: '桶'"]); // an exported item: not added again
  const thing = writeEntry(contentDir, 'ghost_mod', 'thing', ["title: '东西'", "description: '一把没人导出过的东西。'"]);
  const nameless = writeEntry(contentDir, 'ghost_mod', 'nameless', ["title: ''"]);
  const layout = { ...layoutWith(contentDir, []), mods: [modDir(contentDir, 'lewd_meme_remake', [exported]), modDir(contentDir, 'ghost_mod', [thing, nameless])] };
  const data = structuredClone(FIXTURE_DATA);

  const added = await addHandwrittenItems(data, layout);

  assert.equal(added, 2);
  assert.equal(data.items.filter((it) => it.id === 'milk_barrel').length, 1, 'an exported item is left alone');
  const [byThing, byNameless] = ['thing', 'nameless'].map((id) => data.items.find((it) => it.id === id));
  assert.deepEqual(
    (({ id, name, price, shape, icon, aliases, categories, tags, provenance }) => ({ id, name, price, shape, icon, aliases, categories, tags, provenance }))(byThing),
    { id: 'thing', name: '东西', price: null, shape: null, icon: null, aliases: [], categories: [], tags: [], provenance: {} },
  );
  assert.equal(byNameless.name, 'nameless', 'no title: named by its file');
  assert.equal(byThing.mod, 'ghost_mod', 'the mod is the folder it is in');
  assert.equal(byNameless.mod, 'ghost_mod');
  // The mark that tells a hand-written item from an exported one, wherever it matters.
  assert.equal(byThing.handwritten, true);
  assert.equal(byNameless.handwritten, true);
  assert.equal(data.items.find((it) => it.id === 'milk_barrel').handwritten, undefined, 'an exported item carries no such mark');
  // 一个只差大小写的文件名仍然是那件已导出的物品,不是新物品
  const cased = tmpDir(t, 'handwritten-case');
  const lower = writeEntry(cased, MOD, 'gear.maiddress', ["title: '不该多出来'"]);
  const twin = structuredClone(FIXTURE_DATA);
  twin.items.push({ id: 'gear.maidDress', mod: MOD, name: '女仆装', provenance: {} });
  assert.equal(await addHandwrittenItems(twin, { ...layoutWith(cased, []), mods: [modDir(cased, MOD, [lower])] }), 0);
  assert.equal(twin.items.length, FIXTURE_DATA.items.length + 1, 'only the item that was pushed in');
  // 没有内容树、或者什么都不缺:什么都不加
  assert.equal(await addHandwrittenItems({ items: [{ id: 'egg' }] }, null), 0);
  const nothing = structuredClone(FIXTURE_DATA);
  assert.equal(await addHandwrittenItems(nothing, { mods: [] }), 0);
  assert.deepEqual(nothing.items, structuredClone(FIXTURE_DATA).items);
});

test('a hand-written item takes the rest of its entry too: add it first, then merge — and nothing warns that it names no item', async (t) => {
  const contentDir = tmpDir(t, 'handwritten-merge');
  const thing = writeEntry(contentDir, 'ghost_mod', 'thing', ["title: '东西'", "description: '一把没人导出过的东西。'", 'related:', '  - milk_barrel']);
  const layout = { ...layoutWith(contentDir, []), mods: [modDir(contentDir, 'ghost_mod', [thing])] };
  const data = structuredClone(FIXTURE_DATA);
  await addHandwrittenItems(data, layout);
  const warnings = [];
  await mergeSupplements(data, layout, (line) => warnings.push(line));

  const item = data.items.find((it) => it.id === 'thing');
  assert.equal(item.description, '一把没人导出过的东西。');
  assert.deepEqual(item.related, ['milk_barrel']);
  assert.deepEqual(warnings, [], 'the item is there by the time the entries are merged');
});

test('title: a non-empty title in the entry overwrites the name of an exported item; an empty one does not', async (t) => {
  const titled = tmpDir(t, 'title');
  const data = structuredClone(FIXTURE_DATA);
  await mergeSupplements(data, layoutWith(titled, [writeEntry(titled, MOD, 'wondrous_milk', ["title: '好喝的乳汁'"])]), () => {});
  assert.equal(itemOf(data, 'wondrous_milk').name, '好喝的乳汁');
  assert.equal(itemOf(data, 'wondrous_milk').provenance.name, 'content:items/wondrous_milk.md');

  const blank = tmpDir(t, 'title-blank');
  const untouched = structuredClone(FIXTURE_DATA);
  await mergeSupplements(untouched, layoutWith(blank, [writeEntry(blank, MOD, 'wondrous_milk', ["title: ''"])]), () => {});
  assert.equal(itemOf(untouched, 'wondrous_milk').name, milkBefore.name);

  // A title that is the name the data already gives covers nothing: the name stays where it came from.
  const same = tmpDir(t, 'title-same');
  const kept = structuredClone(FIXTURE_DATA);
  await mergeSupplements(kept, layoutWith(same, [writeEntry(same, MOD, 'wondrous_milk', [`title: ${milkBefore.name}`])]), () => {});
  assert.equal(itemOf(kept, 'wondrous_milk').name, milkBefore.name);
  assert.equal(itemOf(kept, 'wondrous_milk').provenance.name, milkBefore.provenance.name, 'still the game text, not the entry');
});
