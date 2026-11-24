'use strict';

// Images beside the pages (task 10b).
//
// The CMS stores an image an editor inserts in a page's own `images/` folder —
// content/mechanics/images/ for a mechanic page, content/items/images/ for an
// item page — and references it relative to the page: `![alt](images/x.png)`.
// The build publishes each folder beside its pages (dist/mechanics/images/,
// dist/item/images/), so one relative reference works online and from file://.
//
// Only bitmaps are published. An SVG is refused: it can hold a script, and on
// this site it would be served from the same origin as the CMS, whose sign-in
// tokens live in the browser.

const fs = require('node:fs/promises');
const path = require('node:path');

/** A folder of pages in content/, and the folder its pages are published to. */
const PAGE_FOLDERS = Object.freeze([
  ['mechanics', 'mechanics'],
  ['items', 'item'],
]);

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
 * The images/ folders of the pages, each with the folder its pages are
 * published to. None when there is no content directory.
 */
function pageImageFolders(contentDir) {
  if (contentDir == null) return [];
  return PAGE_FOLDERS.map(([folder, route]) => ({
    imagesDir: path.join(contentDir, folder, IMAGES_DIR),
    route,
  }));
}

/**
 * Every file under a page's images/ folder that is not a bitmap, by its path.
 * A pre-flight check: the build refuses these before touching dist.
 * @returns {Promise<string[]>} Sorted absolute paths.
 */
async function findUnsupportedImages(contentDir) {
  const unsupported = [];
  for (const { imagesDir } of pageImageFolders(contentDir)) {
    for (const file of await listFiles(imagesDir)) {
      if (!BITMAP_EXT.has(path.extname(file).toLowerCase())) unsupported.push(file);
    }
  }
  return unsupported.sort();
}

/**
 * Copy the bitmaps of every page's images/ folder to the folder its pages are
 * published to. Run it after findUnsupportedImages: what is left is a bitmap.
 * @returns {Promise<number>} Files copied.
 */
async function copyPageImages(contentDir, distDir) {
  let copied = 0;
  for (const { imagesDir, route } of pageImageFolders(contentDir)) {
    for (const file of await listFiles(imagesDir)) {
      const to = path.join(distDir, route, IMAGES_DIR, path.relative(imagesDir, file));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(file, to);
      copied += 1;
    }
  }
  return copied;
}

module.exports = { findUnsupportedImages, copyPageImages, BITMAP_EXT, PAGE_FOLDERS, IMAGES_DIR };
