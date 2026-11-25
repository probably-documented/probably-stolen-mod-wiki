'use strict';

// The image rule of the per-mod content layout. A mod keeps its pages' images in
// mods/<modId>/images/, and references them relative to the file: `../images/x.png` from an
// entry (its page sits one level deep), `images/x.png` from the mod's own navigation page.
// So every image is published to both places, and a section's or a site page's images to the
// one place their pages look. Only bitmaps are published — an SVG can hold a script.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { findUnsupportedImagesIn, copyLayoutImages } = require('../tools/build/content-images.js');
const { readContentLayout } = require('../tools/build/content-layout.js');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `images-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir while a just-written file is
  // still held: that is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

async function put(root, rel, content = '') {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), content);
  return path.join(root, rel);
}

test("findUnsupportedImagesIn: every file under the layout's image folders that is not a bitmap, and nothing else", async (t) => {
  const root = await tmpDir(t, 'find');
  const svg = await put(root, 'mods/alpha/images/logo.svg');
  await put(root, 'mods/alpha/images/a.png');
  await put(root, 'mods/alpha/images/sub/b.JPG'); // extension case does not matter: it is a bitmap
  await put(root, 'sections/images/c.webp');
  const txt = await put(root, 'site/images/d.txt');
  await put(root, 'mods/alpha/not-images/e.svg'); // outside every image folder: not looked at

  const unsupported = await findUnsupportedImagesIn(await readContentLayout(root));

  assert.deepEqual(unsupported, [svg, txt].sort());
});

test('copyLayoutImages: bitmaps go to every place their pages reference them from', async (t) => {
  const root = await tmpDir(t, 'copy');
  const content = path.join(root, 'content');
  const dist = path.join(root, 'dist');
  await put(content, 'mods/alpha/images/a.png', 'a');
  await put(content, 'mods/alpha/images/sub/b.png', 'b');
  await put(content, 'sections/images/c.png', 'c');
  await put(content, 'site/images/d.png', 'd');
  await put(content, 'images/e.png', 'e');
  await put(content, 'mods/alpha/images/logo.svg', '<svg/>'); // not a bitmap: never published

  const copied = await copyLayoutImages(await readContentLayout(content), dist);

  // a mod's images → 2 places each (entries, the mod's own page); sections, site and home → 1 each
  assert.equal(copied, 7);
  const expected = [
    'images/a.png', 'mods/images/a.png',
    'images/sub/b.png', 'mods/images/sub/b.png',
    'sections/images/c.png',
    'site/images/d.png',
    'images/e.png',
  ];
  for (const rel of expected) {
    assert.equal(await fs.readFile(path.join(dist, ...rel.split('/')), 'utf8'), path.basename(rel).charAt(0), rel);
  }
  const published = (await fs.readdir(path.join(dist, 'images'))).sort();
  assert.deepEqual(published, ['a.png', 'e.png', 'sub'], 'the SVG did not travel');
});

test('copyLayoutImages: no image folder → nothing copied and no directory created', async (t) => {
  const dist = path.join(await tmpDir(t, 'empty'), 'dist');
  assert.equal(await copyLayoutImages(await readContentLayout(null), dist), 0);
  await assert.rejects(fs.access(dist), 'no dist was created');
});
