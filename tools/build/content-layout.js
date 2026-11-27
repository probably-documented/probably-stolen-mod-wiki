'use strict';

// 新目录结构的读取层:只看目录项和文件名,不读任何文件的内容。
//
//   content/
//   ├─ home.md                    主站导航页(单文件)
//   ├─ sections/<分区>.md         分区导航页
//   ├─ mods/<modId>/              每个 mod 恰好一份
//   │  ├─ _index.md               mod 导航页
//   │  ├─ redirects.yaml          别名和关键词(可缺失)
//   │  ├─ items/<物品ID>.md       物品词条
//   │  ├─ mechanics/<文件名>.md   机制词条
//   │  └─ images/                 这个 mod 的页面用的图片
//   ├─ site/<文件名>.md           不属于任何 mod 的站点页面
//   └─ images/                    主站导航页用的图片
//
// 检查(tools/build/content-lint.js)、图片发布(tools/build/content-images.js)和
// CMS 的清单(tools/build/cms-assets.js)都从这里出发。
//
// 路径都是 path.join(contentDir, …) 的结果,和传入的 contentDir 同一个基准。

const fs = require('node:fs/promises');
const path = require('node:path');

const MD = /\.md$/i;
const INDEX_FILE = '_index.md';
const REDIRECTS_FILE = 'redirects.yaml';
const IMAGES_DIR = 'images';

/** 「不存在」只指 ENOENT / ENOTDIR;别的错误照常抛出。 */
const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/** 目录项;目录不存在时是空数组。 */
async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** 它在,而且是一个目录。 */
async function isDirectory(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

/** 它在(文件或目录)。 */
async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
}

const byName = (key) => (a, b) => {
  const left = path.basename(a[key]);
  const right = path.basename(b[key]);
  return left < right ? -1 : left > right ? 1 : 0;
};

/**
 * 目录下直接的 .md 文件(不进子目录),按文件名排序。
 * @returns {Promise<Array<{ id: string, file: string }>>} id 是不带扩展名的文件名
 */
async function mdFiles(dir) {
  const out = [];
  for (const entry of await listDir(dir)) {
    if (!entry.isFile() || !MD.test(entry.name)) continue;
    out.push({ id: entry.name.replace(MD, ''), file: path.join(dir, entry.name) });
  }
  return out.sort(byName('file'));
}

/** dir 下除顶层之外、任何深度的 `_index.md`,按路径排序。 */
async function nestedIndexFiles(dir) {
  const found = [];
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    const index = path.join(sub, INDEX_FILE);
    if (await exists(index)) found.push(index);
    found.push(...await nestedIndexFiles(sub));
  }
  return found.sort();
}

async function readMod(modsDir, entry) {
  const dir = path.join(modsDir, entry.name);
  const indexFile = path.join(dir, INDEX_FILE);
  const redirectsFile = path.join(dir, REDIRECTS_FILE);
  return {
    id: entry.name,
    dir,
    indexFile: (await exists(indexFile)) ? indexFile : null,
    redirectsFile: (await exists(redirectsFile)) ? redirectsFile : null,
    items: await mdFiles(path.join(dir, 'items')),
    mechanics: (await mdFiles(path.join(dir, 'mechanics'))).map(({ id, file }) => ({ slug: id, file })),
    nestedIndexFiles: await nestedIndexFiles(dir),
  };
}

/**
 * 把内容目录读成一个结构。
 * @param {string|null} contentDir `null` 时得到空布局
 * @returns {Promise<{
 *   home: string|null,
 *   sections: Array<{ slug: string, file: string }>,
 *   site: Array<{ slug: string, file: string }>,
 *   mods: Array<{ id: string, dir: string, indexFile: string|null, redirectsFile: string|null,
 *     items: Array<{ id: string, file: string }>, mechanics: Array<{ slug: string, file: string }>,
 *     nestedIndexFiles: string[] }>,
 *   strayFiles: string[], legacyDirs: string[],
 *   imageFolders: Array<{ imagesDir: string, dests: string[] }>,
 * }>}
 */
async function readContentLayout(contentDir) {
  const layout = { home: null, sections: [], site: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [] };
  if (contentDir == null || !(await isDirectory(contentDir))) return layout;

  const home = path.join(contentDir, 'home.md');
  if (await exists(home)) layout.home = home;
  const slugsOf = (dir) => mdFiles(path.join(contentDir, dir)).then((files) => files.map(({ id, file }) => ({ slug: id, file })));
  layout.sections = await slugsOf('sections');
  layout.site = await slugsOf('site');

  const modsDir = path.join(contentDir, 'mods');
  for (const entry of await listDir(modsDir)) {
    if (entry.isDirectory()) layout.mods.push(await readMod(modsDir, entry));
    else if (entry.isFile()) layout.strayFiles.push(path.join(modsDir, entry.name));
  }
  layout.mods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  layout.strayFiles.sort();

  for (const name of ['items', 'mechanics']) {
    const dir = path.join(contentDir, name);
    if (await isDirectory(dir)) layout.legacyDirs.push(dir);
  }

  // 只列存在的目录。每个 mod 的图片发两处:词条里引用的是 ../images/…(页面在深度 1),
  // mod 导航页里引用的是 images/…(同在深度 1,但要在它自己的目录下)。
  const folder = async (imagesDir, dests) => ((await isDirectory(imagesDir)) ? [{ imagesDir, dests }] : []);
  layout.imageFolders.push(...await folder(path.join(contentDir, IMAGES_DIR), ['images']));
  for (const mod of layout.mods) {
    layout.imageFolders.push(...await folder(path.join(mod.dir, IMAGES_DIR), ['images', 'mods/images']));
  }
  layout.imageFolders.push(...await folder(path.join(contentDir, 'sections', IMAGES_DIR), ['sections/images']));
  layout.imageFolders.push(...await folder(path.join(contentDir, 'site', IMAGES_DIR), ['site/images']));

  return layout;
}

module.exports = { readContentLayout };
