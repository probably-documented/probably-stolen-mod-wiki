'use strict';

// 站点数据加载（导入计划 Task 4）：`data/mods/<modId>.json` + `data/wiki.json`。
//
// 数据文件由离线仓库的 `node tools/build/build.js --export-data <dir>` 生成
// （见 modwiki 的 tools/build/export-wiki-data.js），入库后只读。有人手工改
// 坏一个文件时，失败是一行中文：哪个文件、哪里不对——构建停在这里，什么
// 都不渲染。

const fs = require('node:fs/promises');
const path = require('node:path');

/** The file's JSON, or a Chinese error that names the file. */
async function readJson(file, label) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`${label} 不存在: ${file}`);
    throw err;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} 不是合法的 JSON(${file}): ${err.message}`);
  }
}

/**
 * 读 `dataDir` 下按 mod 拆分的完整数据，组装成 `renderSite` 要的形状。
 * `mechanics` 是空数组：机制页由 `content/mods/<modId>/mechanics/` 重建。
 * @param {string} [dataDir]
 * @returns {Promise<{ baseline: object, mods: object[], items: object[], mechanics: [], news: object[], changelog: object[], facets: object }>}
 */
async function loadWikiData(dataDir = 'data') {
  const wiki = await readJson(path.join(dataDir, 'wiki.json'), 'data/wiki.json');

  const modsDir = path.join(dataDir, 'mods');
  let entries;
  try {
    entries = await fs.readdir(modsDir);
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error(`数据目录不存在: ${modsDir}`);
    throw err;
  }
  const files = entries.filter((name) => name.endsWith('.json')).sort();
  if (files.length === 0) throw new Error(`数据目录里没有任何 mod 文件: ${modsDir}`);

  const mods = [];
  const itemsByMod = new Map();
  const seenItems = new Set();

  for (const file of files) {
    const label = `data/mods/${file}`;
    const payload = await readJson(path.join(modsDir, file), label);

    const expectedId = file.slice(0, -'.json'.length);
    if (payload.id !== expectedId) {
      throw new Error(`${label}: id 是 ${JSON.stringify(payload.id)},与文件名不符(应为 ${expectedId})`);
    }

    const modItems = Array.isArray(payload.items) ? payload.items : [];
    if (payload.itemCount !== undefined && payload.itemCount !== modItems.length) {
      throw new Error(`${label}: itemCount 是 ${payload.itemCount},但 items 有 ${modItems.length} 个`);
    }

    mods.push({
      id: payload.id,
      name: payload.name,
      version: payload.version,
      author: payload.author,
      prerequisites: payload.prerequisites ?? [],
      description: payload.description,
      itemCount: modItems.length,
    });

    const out = [];
    for (const item of modItems) {
      if (typeof item.id !== 'string' || item.id === '') throw new Error(`${label}: 有物品没有 id`);
      if (seenItems.has(item.id)) throw new Error(`${label}: 物品 id 重复: ${item.id}`);
      seenItems.add(item.id);
      if (item.mod !== payload.id) {
        throw new Error(`${label}: 物品 ${item.id} 的 mod 是 ${JSON.stringify(item.mod)},不是 ${payload.id}`);
      }
      out.push(item);
    }
    itemsByMod.set(payload.id, out);
  }

  // The data's own mod order (the home page and the data baseline show it);
  // a mod the order does not mention follows, by file name.
  const order = Array.isArray(wiki.modOrder) ? wiki.modOrder : [];
  const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
  mods.sort((a, b) => rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const items = mods.flatMap((mod) => itemsByMod.get(mod.id));

  return {
    baseline: wiki.baseline,
    mods,
    items,
    mechanics: [],
    news: wiki.news ?? [],
    changelog: wiki.changelog ?? [],
    facets: wiki.facets ?? { categories: [] },
  };
}

module.exports = { loadWikiData };
