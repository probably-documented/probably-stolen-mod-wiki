'use strict';

// 手写补充层（导入计划 Task 6）：`content/items/<id>.md` 的 frontmatter 覆盖
// `data/mods/*.json` 里同一件物品的字段——贡献者在 CMS 里改的就是这一层。
//
// 规则与离线仓库 `tools/extract/merge.js` 的 applySupplement 一致，只有一处
// 不同：**空值不覆盖**（空字符串、空数组、null）。CMS 会把它声明的每个字段
// 都序列化，编辑器里没填的字段写出来是空值；那不是"清空数据"，是"没填"。
// 所以：
//   - name / description / flavor / notes / icon：非空字符串才覆盖；
//   - price：数字（或非空数字字符串）才覆盖；
//   - shape：两个有限数字的数组才覆盖；
//   - categories / tags / usage / sources / related / aliases：非空数组才覆盖。
// 覆盖过的字段在 provenance 里记成 `content:items/<文件名>`（与离线的
// `content:items/<fileName>` 标签一致）。

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');
const { resolveItemId } = require('./item-ids.js');

const SCALAR_FIELDS = Object.freeze(['name', 'description', 'flavor', 'notes', 'icon']);
const ARRAY_FIELDS = Object.freeze(['categories', 'tags', 'usage', 'sources', 'related', 'aliases']);

/**
 * content/items/*.md → `[{ id, frontmatter, fileName }]`, sorted by file name.
 * A missing directory (or no content layer at all) is no supplement.
 * @param {string|null} contentDir
 * @returns {Promise<Array<{ id: string, frontmatter: object, fileName: string }>>}
 */
async function readSupplements(contentDir) {
  if (contentDir == null) return [];
  const dir = path.join(contentDir, 'items');
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const name of names.filter((entry) => entry.endsWith('.md')).sort()) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    out.push({ id: name.slice(0, -'.md'.length), frontmatter: splitFrontmatter(text).fm, fileName: name });
  }
  return out;
}

/**
 * Apply one supplement to one item (in place).
 * @param {object} item
 * @param {object} frontmatter
 * @param {string} fileName
 */
function applySupplement(item, frontmatter, fileName) {
  const label = `content:items/${fileName}`;
  const set = (field, value) => {
    item[field] = value;
    item.provenance = { ...(item.provenance ?? {}), [field]: label };
  };

  for (const field of SCALAR_FIELDS) {
    const value = frontmatter[field];
    if (typeof value === 'string' && value !== '') set(field, value);
  }

  const price = frontmatter.price;
  if (typeof price === 'number' && Number.isFinite(price)) {
    set('price', price);
  } else if (typeof price === 'string' && price.trim() !== '' && Number.isFinite(Number(price))) {
    set('price', Number(price));
  }

  const shape = frontmatter.shape;
  if (Array.isArray(shape) && shape.length === 2 && shape.every((n) => Number.isFinite(Number(n)))) {
    set('shape', shape.map(Number));
  }

  for (const field of ARRAY_FIELDS) {
    const value = frontmatter[field];
    if (Array.isArray(value) && value.length > 0) set(field, value);
  }
}

/**
 * Overwrite the fields the contributors filled in; leave everything else as
 * the data files describe it.
 * @param {object} data  the loaded model (its items are mutated)
 * @param {string|null} contentDir
 * @param {(line: string) => void} [warn]
 */
async function mergeSupplements(data, contentDir, warn = console.warn) {
  const byId = new Map((data.items ?? []).map((item) => [item.id, item]));
  for (const { id, frontmatter, fileName } of await readSupplements(contentDir)) {
    // A file name the CMS lowercased still names its item (resolveItemId).
    const realId = resolveItemId(id, byId.keys());
    const item = realId === null ? undefined : byId.get(realId);
    if (item === undefined) {
      // The id lint rejects unknown file names before this; be forgiving here
      // (a file without an item is skipped, never turned into a new item).
      warn(`[build] supplement skipped: content/items/${fileName} names no item (${id})`);
      continue;
    }
    applySupplement(item, frontmatter, fileName);
  }
}

module.exports = { readSupplements, mergeSupplements, applySupplement };
