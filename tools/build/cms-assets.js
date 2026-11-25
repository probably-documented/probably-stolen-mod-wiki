'use strict';

// CMS 要用的三个文件,写在 dist/admin/ 里,紧接在 admin/ 被复制进去之后:它们是给在线的 CMS 用的,
// 不进站点审计,也不进离线包。
//
//   admin.js           tools/cms/lib.js 和 tools/cms/admin.js 拼成一个文件(admin/index.html 加载它)
//   templates.json     模板库(仓库根的 templates/),「从模板开始」的小窗读它
//   items-by-mod.json  每个 mod 已导出的物品,和哪些已经有词条;「物品 ID」一栏的清单读它

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');

const SCRIPTS = Object.freeze(['lib.js', 'admin.js']);

/**
 * 模板分类的显示名。分类的取值来自模板文件开头的 category,这里决定它在小窗里叫什么、排在第几。
 * 要加新分类:先在这里登记,再在模板里用。
 */
const TEMPLATE_CATEGORIES = Object.freeze([
  Object.freeze({ value: 'mechanic', label: '机制页' }),
  Object.freeze({ value: 'item', label: '物品词条' }),
  Object.freeze({ value: 'nav', label: '导航页' }),
]);

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

const toPosix = (p) => p.split(path.sep).join('/');

const endingInNewline = (text) => (text.endsWith('\n') ? text : `${text}\n`);

/** dist/admin/admin.js:共享库、一个空行、控件脚本。缺哪个源文件都是构建失败。 */
async function joinScripts(repoRoot) {
  const parts = [];
  for (const name of SCRIPTS) {
    const file = path.join(repoRoot, 'tools', 'cms', name);
    let text;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (isMissing(err)) {
        throw new Error(`[cms] CMS 的脚本文件缺失:${file}(仓库的 tools/cms/ 下应当有 ${SCRIPTS.join(' 和 ')})`);
      }
      throw err;
    }
    parts.push(endingInNewline(text));
  }
  // Each part already ends in a newline; the separator is the blank line between them.
  return parts.join('\n');
}

/**
 * 模板库 → { categories, templates }。templates 以文件名(不带 .md)为键,按文件名排序。
 * 每个模板的开头都要有 title、category、applies_to;category 必须是已登记的分类。
 * 还没有 templates/ 目录时是空列表,分类照样带上。
 */
async function readTemplates(repoRoot) {
  const dir = path.join(repoRoot, 'templates');
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (isMissing(err)) names = [];
    else throw err;
  }
  const templates = {};
  for (const name of names.filter((entry) => /\.md$/i.test(entry)).sort()) {
    const file = path.join(dir, name);
    const { fm, body } = splitFrontmatter(await fs.readFile(file, 'utf8'));
    for (const key of ['title', 'category']) {
      if (typeof fm[key] !== 'string' || fm[key].trim() === '') {
        throw new Error(`[cms] 模板 ${toPosix(file)} 的开头缺少 ${key}:每个模板都要有 title、category、applies_to 三项`);
      }
    }
    if (!TEMPLATE_CATEGORIES.some((category) => category.value === fm.category)) {
      throw new Error(`[cms] 模板 ${toPosix(file)} 的 category 是「${fm.category}」,不是已登记的分类(${TEMPLATE_CATEGORIES.map((c) => c.value).join('、')})。`
        + '要加新分类,先在 tools/build/cms-assets.js 的 TEMPLATE_CATEGORIES 里登记它的显示名');
    }
    if (!Array.isArray(fm.applies_to) || fm.applies_to.length === 0) {
      throw new Error(`[cms] 模板 ${toPosix(file)} 的开头缺少 applies_to:至少要选一个适用类型(例如 mechanics 或 items)`);
    }
    templates[name.replace(/\.md$/i, '')] = {
      title: fm.title.trim(),
      category: fm.category,
      applies_to: fm.applies_to.map(String),
      description: typeof fm.description === 'string' ? fm.description : '',
      body,
    };
  }
  return { categories: TEMPLATE_CATEGORIES, templates };
}

/** 物品清单:顺序跟数据;taken 是这件物品已经有词条(文件名只差大小写也算)。 */
function itemCatalog(layout, data) {
  const entryNames = new Set((layout?.mods ?? []).flatMap((mod) => mod.items.map((entry) => entry.id)));
  const entryNamesLower = new Set([...entryNames].map((name) => name.toLowerCase()));
  const hasEntry = (id) => entryNames.has(id) || entryNamesLower.has(id.toLowerCase());
  const items = data?.items ?? [];
  return {
    mods: (data?.mods ?? []).map((mod) => ({
      id: mod.id,
      name: mod.name ?? null,
      items: items.filter((item) => item.mod === mod.id).map((item) => ({ id: item.id, name: item.name ?? null, taken: hasEntry(item.id) })),
    })),
  };
}

/**
 * @param {object} args
 * @param {string} args.repoRoot 仓库根:tools/cms/ 和 templates/ 在这里
 * @param {string} args.distDir dist/admin/ 已经由构建复制好
 * @param {object} args.layout readContentLayout 的结果;没有内容目录时是空布局
 * @param {object} args.data 载入的站点数据
 * @returns {Promise<{ templates: number, items: number }>} 模板数,清单里的物品数
 * @throws {Error} 缺一个源脚本;模板缺 title、category、applies_to,或分类没有登记
 */
async function writeCmsAssets({ repoRoot, distDir, layout, data }) {
  const adminDir = path.join(distDir, 'admin');
  const catalog = await readTemplates(path.resolve(repoRoot));
  const items = itemCatalog(layout, data);
  await fs.writeFile(path.join(adminDir, 'admin.js'), await joinScripts(path.resolve(repoRoot)));
  await fs.writeFile(path.join(adminDir, 'templates.json'), `${JSON.stringify(catalog, null, 2)}\n`);
  await fs.writeFile(path.join(adminDir, 'items-by-mod.json'), `${JSON.stringify(items, null, 2)}\n`);
  return { templates: Object.keys(catalog.templates).length, items: items.mods.reduce((count, mod) => count + mod.items.length, 0) };
}

module.exports = { writeCmsAssets, TEMPLATE_CATEGORIES };
