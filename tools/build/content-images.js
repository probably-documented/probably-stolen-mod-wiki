'use strict';

// Images of the per-mod content layout (readContentLayout).
//
// The CMS stores an image an editor inserts in the folder beside the file:
// a mod's pages in content/mods/<modId>/images/, a section page in
// content/sections/images/, a site page in content/site/images/. A page
// references it relative to the file — `![alt](../images/x.png)` from an
// entry or a mechanic page, `images/x.png` from a mod's own navigation page —
// so every images/ folder is published to each place its pages look (the
// layout lists them: imageFolders).
//
// Only bitmaps are published. An SVG is refused: it can hold a script, and on
// this site it would be served from the same origin as the CMS, whose sign-in
// tokens live in the browser.

const fs = require('node:fs/promises');
const path = require('node:path');

/** The name of the folder the CMS stores a page's images in. */
const IMAGES_DIR = 'images';

/**
 * Bitmap formats a contributor may upload, by extension. Anything else under
 * an images/ folder is refused: SVG (scripts), HTML, and files nobody displays.
 */
const BITMAP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/**
 * Every file under `dir`, at any depth, sorted — and none when it doesn't exist.
 * Any other failure to read it is rethrown.
 */
async function listFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(full)));
    else files.push(full);
  }
  return files.sort();
}

/**
 * 新目录结构（readContentLayout）：布局里每个图片文件夹下不是位图的文件，排序。预检用，
 * 构建在动旧的 dist 之前跑它。
 * @param {{ imageFolders: Array<{ imagesDir: string }> }} layout
 * @returns {Promise<string[]>}
 */
async function findUnsupportedImagesIn(layout) {
  const unsupported = [];
  for (const { imagesDir } of layout.imageFolders) {
    for (const file of await listFiles(imagesDir)) {
      if (!BITMAP_EXT.has(path.extname(file).toLowerCase())) unsupported.push(file);
    }
  }
  return unsupported.sort();
}

/**
 * 新目录结构：把位图复制到它们所在文件夹的每一处 dests（相对 dist 的 posix 路径）。
 * 一个 mod 的图片发两处：词条里引用的是 `../images/…`（页面在深度 1），mod 导航页里
 * 引用的是 `images/…`（同在深度 1，但在它自己的目录下）。
 * @param {{ imageFolders: Array<{ imagesDir: string, dests: string[] }> }} layout
 * @param {string} distDir
 * @returns {Promise<number>} 复制的次数
 */
async function copyLayoutImages(layout, distDir) {
  let copied = 0;
  for (const { imagesDir, dests } of layout.imageFolders) {
    for (const file of await listFiles(imagesDir)) {
      // 预检已经拦下非位图;这里再筛一次,调用顺序错了也不会把 SVG 发出去
      if (!BITMAP_EXT.has(path.extname(file).toLowerCase())) continue;
      for (const dest of dests) {
        const to = path.join(distDir, ...dest.split('/'), path.relative(imagesDir, file));
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.copyFile(file, to);
        copied += 1;
      }
    }
  }
  return copied;
}

module.exports = { BITMAP_EXT, IMAGES_DIR, findUnsupportedImagesIn, copyLayoutImages };
