'use strict';

// Import plan Task 4: load the site data from data/mods/*.json + data/wiki.json.
//
// Every failure a contributor can cause by hand-editing a data file must come
// out as one Chinese line that names the file and what is wrong with it — the
// build stops there, and nothing is rendered.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadWikiData } = require('../tools/build/wiki-data.js');

/** A temp dir removed when the test ends. */
function tmpDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `wiki-data-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const WIKI = {
  baseline: { date: '2026-11-18', versions: { a_mod: '1' } },
  facets: { categories: ['饮料'] },
  news: [{ date: '2026-11-18', text: '上线' }],
  changelog: [{ mod: 'a_mod', version: '1', date: '2026-11-18', text: '初始' }],
};

const MOD = (id, items) => ({
  id, name: `名字 ${id}`, version: '1', author: 'x', prerequisites: [], description: `描述 ${id}`,
  itemCount: items.length, items: items.map((itemId) => ({ id: itemId, mod: id, name: null })),
});

/** Write a data dir; files maps a name under mods/ to an object (or a raw string). */
function writeData(dir, files, wiki = WIKI) {
  fs.mkdirSync(path.join(dir, 'mods'), { recursive: true });
  for (const [name, payload] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'mods', name),
      typeof payload === 'string' ? payload : JSON.stringify(payload));
  }
  if (wiki !== null) fs.writeFileSync(path.join(dir, 'wiki.json'), JSON.stringify(wiki));
  return dir;
}

test('加载:mods 按文件名排序、items 按 mod 拼接、mechanics 为空、wiki 的全局部分带过来', async (t) => {
  const dir = writeData(tmpDir(t, 'ok'), {
    'b_mod.json': MOD('b_mod', ['i2', 'i3']),
    'a_mod.json': MOD('a_mod', ['i1']),
  });
  const data = await loadWikiData(dir);

  assert.deepEqual(data.mods.map((m) => m.id), ['a_mod', 'b_mod']);
  assert.deepEqual(data.items.map((i) => i.id), ['i1', 'i2', 'i3']);
  assert.deepEqual(data.mechanics, []);
  assert.deepEqual(data.baseline, WIKI.baseline);
  assert.deepEqual(data.facets, WIKI.facets);
  assert.deepEqual(data.news, WIKI.news);
  assert.deepEqual(data.changelog, WIKI.changelog);
  // mod 元数据带过来,itemCount 以 items 为准
  assert.equal(data.mods[0].name, '名字 a_mod');
  assert.equal(data.mods[1].itemCount, 2);
});

test('缺 wiki.json → 中文错误指出文件', async (t) => {
  const dir = writeData(tmpDir(t, 'no-wiki'), { 'a_mod.json': MOD('a_mod', ['i1']) }, null);
  await assert.rejects(loadWikiData(dir), /data\/wiki\.json 不存在/);
});

test('mods 目录缺失 / 没有任何 mod 文件 → 中文错误', async (t) => {
  const noMods = tmpDir(t, 'no-mods');
  fs.writeFileSync(path.join(noMods, 'wiki.json'), JSON.stringify(WIKI));
  await assert.rejects(loadWikiData(noMods), /数据目录不存在/);

  const empty = writeData(tmpDir(t, 'empty'), {}, WIKI);
  fs.rmSync(path.join(empty, 'mods'), { recursive: true, force: true });
  fs.mkdirSync(path.join(empty, 'mods'));
  await assert.rejects(loadWikiData(empty), /没有任何 mod 文件/);
});

test('坏 JSON → 中文错误指出文件', async (t) => {
  const dir = writeData(tmpDir(t, 'bad-json'), { 'a_mod.json': '{ not json' });
  await assert.rejects(loadWikiData(dir), /data\/mods\/a_mod\.json 不是合法的 JSON/);
});

test('文件名与 id 不符 / 物品 id 重复 / item.mod 未知 → 各自的中文错误', async (t) => {
  const mismatch = writeData(tmpDir(t, 'mismatch'), { 'a_mod.json': MOD('other', ['i1']) });
  await assert.rejects(loadWikiData(mismatch), /data\/mods\/a_mod\.json.*与文件名不符/);

  const dupItem = writeData(tmpDir(t, 'dup-item'), {
    'a_mod.json': MOD('a_mod', ['same']),
    'b_mod.json': MOD('b_mod', ['same']),
  });
  await assert.rejects(loadWikiData(dupItem), /data\/mods\/b_mod\.json.*物品 id 重复: same/);

  const unknownMod = writeData(tmpDir(t, 'unknown-mod'), {
    'a_mod.json': { ...MOD('a_mod', []), itemCount: 1, items: [{ id: 'i1', mod: 'nope' }] },
  });
  await assert.rejects(loadWikiData(unknownMod), /data\/mods\/a_mod\.json.*不是 a_mod/);
});
