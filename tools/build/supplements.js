'use strict';

// 手写补充层（导入计划 Task 6）：`content/mods/<modId>/items/<物品ID>.md` 的 frontmatter
// 覆盖 `data/mods/*.json` 里同一件物品的字段——贡献者在 CMS 里改的就是这一层。构建通过
// 布局（tools/build/content-layout.js）找到这些词条。
//
// 规则与离线仓库 `tools/extract/merge.js` 的 applySupplement 一致，只有一处
// 不同：**空值不覆盖**（空字符串、空数组、null）。CMS 会把它声明的每个字段
// 都序列化，编辑器里没填的字段写出来是空值；那不是"清空数据"，是"没填"。
// 所以：
//   - name / description / flavor / notes / icon：非空字符串才覆盖；
//   - price：数字（或非空数字字符串）才覆盖；
//   - shape：两个有限数字的数组才覆盖；
//   - categories / tags / usage / sources / related / aliases：非空数组才覆盖。
//   - title：非空时就是物品在站上的名字（纯手写的物品靠它起名）。
//   - icon：上传的图片（CMS 的图片控件写成 ../images/<文件名>）记成 items/<mod>/<文件名>，
//     图片由构建从这个 mod 的 images/ 里发布；别的写法照旧。
// 覆盖过的字段在 provenance 里记成 `content:items/<文件名>`（与离线的
// `content:items/<fileName>` 标签一致；改它，每一个物品页的「数据来源」表都会变）。

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');
const { resolveItemId } = require('./item-ids.js');
const { uploadedIconName } = require('./content-lint.js');

const SCALAR_FIELDS = Object.freeze(['name', 'description', 'flavor', 'notes']);
const ARRAY_FIELDS = Object.freeze(['categories', 'tags', 'usage', 'sources', 'related', 'aliases']);

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * 布局里的物品词条 → `[{ id, frontmatter, fileName, file }]`，按布局列出的顺序
 * （一个 mod 一个 mod、一个词条一个词条）。没有布局就没有补充层。
 * @param {object|null} layout readContentLayout 的结果
 * @returns {Promise<Array<{ id: string, frontmatter: object, fileName: string, file: string }>>}
 */
async function readSupplements(layout) {
  const out = [];
  for (const mod of layout?.mods ?? []) {
    for (const { id, file } of mod.items) {
      const text = await fs.readFile(file, 'utf8');
      out.push({ id, frontmatter: splitFrontmatter(text).fm, fileName: path.basename(file), file });
    }
  }
  return out;
}

/**
 * Apply one supplement to one item (in place).
 * @param {object} item
 * @param {object} frontmatter
 * @param {string} fileName
 * @param {Set<object>} [uploadedIcons] 上传了图标的物品记在这里(构建入口发布它们时用)
 */
function applySupplement(item, frontmatter, fileName, uploadedIcons = new Set()) {
  const label = `content:items/${fileName}`;
  // 「数据来源」说的是哪个字段盖住了游戏数据。纯手写物品没有游戏数据可盖,词条里写的
  // 字段就是它的全部内容,不记这张表。
  const fromData = !item.handwritten;
  const set = (field, value) => {
    item[field] = value;
    if (fromData) item.provenance = { ...(item.provenance ?? {}), [field]: label };
  };

  for (const field of SCALAR_FIELDS) {
    const value = frontmatter[field];
    if (typeof value === 'string' && value !== '') set(field, value);
  }
  // 标题:填了就是物品在站上的名字(纯手写的物品靠它;有数据的物品留空就用数据里的名称)。
  // 填的正好是数据里已有的名字时什么也没盖住,来源照旧是游戏文本。
  const title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
  if (title !== '' && title !== item.name) set('name', title);

  // 图标:上传的图片记成 items/<mod>/<文件名>(构建要的路径,图片由构建从这个 mod 的 images/ 里
  // 发布);别的写法照旧。是不是上传的写法,和内容检查的 R 用同一条规则。
  const rawIcon = frontmatter.icon;
  if (typeof rawIcon === 'string' && rawIcon !== '') {
    const uploaded = item.mod == null ? null : uploadedIconName(rawIcon);
    if (uploaded !== null) {
      set('icon', `items/${item.mod}/${uploaded}`);
      uploadedIcons.add(item);
    } else {
      set('icon', rawIcon);
    }
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
 * @param {object|null} layout readContentLayout 的结果(null 时不做任何事)
 * @param {(line: string) => void} [warn]
 * @returns {Promise<Set<object>>} 上传了图标的物品(它们的 icon 已经是 items/<mod>/<文件名>)
 */
async function mergeSupplements(data, layout, warn = console.warn) {
  const byId = new Map((data.items ?? []).map((item) => [item.id, item]));
  const uploadedIcons = new Set();
  for (const { id, frontmatter, fileName, file } of await readSupplements(layout)) {
    // A file name that differs from the id by case only still names its item (resolveItemId).
    const realId = resolveItemId(id, byId.keys());
    const item = realId === null ? undefined : byId.get(realId);
    if (item === undefined) {
      // The content lint rejects unknown file names before this; be forgiving
      // here (a file without an item is skipped, never turned into a new item).
      warn(`[build] supplement skipped: ${toPosix(file)} names no item (${id})`);
      continue;
    }
    applySupplement(item, frontmatter, fileName, uploadedIcons);
  }
  return uploadedIcons;
}

/**
 * 纯手写物品(阶段 3 Task 3):对不上任何已导出物品的词条,本身就是一件物品。
 * 把它们追加到 data.items 的末尾 — 名称是词条的 title,没填就是文件名;其余字段都是
 * 「什么都没有」,词条里手写的描述等字段随后由 mergeSupplements 填上(所以先调这个)。
 * @param {object} data 载入的模型(它的 items 会被追加)
 * @param {object|null} layout readContentLayout 的结果
 * @returns {Promise<number>} 追加了几件
 */
async function addHandwrittenItems(data, layout) {
  const exported = (data.items ?? []).map((item) => item.id);
  const added = [];
  for (const mod of layout?.mods ?? []) {
    for (const entry of mod.items) {
      // A file name that differs from an id by case only still names its exported item.
      if (resolveItemId(entry.id, exported) !== null) continue;
      const { fm } = splitFrontmatter(await fs.readFile(entry.file, 'utf8'));
      const title = typeof fm.title === 'string' ? fm.title.trim() : '';
      added.push({
        id: entry.id,
        aliases: [],
        name: title === '' ? entry.id : title,
        mod: mod.id,
        // The mark that tells a hand-written item from an exported one: no 「数据来源」 table and
        // no 「适用于…」 line on its page, and it is not offered in the CMS's list of exported items.
        handwritten: true,
        price: null,
        shape: null,
        icon: null,
        categories: [],
        tags: [],
        description: null,
        flavor: null,
        usage: [],
        sources: [],
        related: [],
        notes: null,
        provenance: {},
      });
    }
  }
  data.items = [...(data.items ?? []), ...added];
  return added.length;
}

module.exports = { readSupplements, mergeSupplements, applySupplement, addHandwrittenItems };
