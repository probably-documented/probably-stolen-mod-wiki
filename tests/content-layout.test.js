'use strict';

// readContentLayout: the per-mod content directory, read into one shape. It only looks at
// directory entries and file names — never at a file's content — and what it reports is what
// the checks, the image publishing and the CMS catalogs all start from.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { readContentLayout } = require('../tools/build/content-layout.js');

async function tmpDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-layout-'));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir while a just-written file is
  // still held: that is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

async function touch(root, rel) {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), '');
}

const p = (root) => (rel) => path.join(root, rel);

const EMPTY = { home: null, sections: [], site: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [] };

test('readContentLayout: no content directory → an empty layout', async () => {
  assert.deepEqual(await readContentLayout(null), EMPTY);
});

test('readContentLayout: a directory that is not there is an empty layout too', async (t) => {
  const root = await tmpDir(t);
  assert.deepEqual(await readContentLayout(path.join(root, 'nope')), EMPTY);
});

test('readContentLayout: the whole shape, sorted, every path joined under the content directory', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  for (const rel of [
    'home.md',
    'sections/lewd-meme-series.md',
    'site/about.md',
    'mods/zeta/_index.md',
    'mods/alpha/_index.md', 'mods/alpha/redirects.yaml',
    'mods/alpha/items/b.jpg', // not a page: only .md counts
    'mods/alpha/items/b.md', 'mods/alpha/items/a.md',
    'mods/alpha/mechanics/one.md', 'mods/alpha/mechanics/two.MD',
    'mods/alpha/images/pic.png',
    'sections/images/c.png',
    'site/images/s.png',
    'images/home.png',
  ]) await touch(root, rel);

  assert.deepEqual(await readContentLayout(root), {
    home: at('home.md'),
    sections: [{ slug: 'lewd-meme-series', file: at('sections/lewd-meme-series.md') }],
    site: [{ slug: 'about', file: at('site/about.md') }],
    mods: [
      {
        id: 'alpha', dir: at('mods/alpha'), indexFile: at('mods/alpha/_index.md'), redirectsFile: at('mods/alpha/redirects.yaml'),
        items: [{ id: 'a', file: at('mods/alpha/items/a.md') }, { id: 'b', file: at('mods/alpha/items/b.md') }],
        mechanics: [{ slug: 'one', file: at('mods/alpha/mechanics/one.md') }, { slug: 'two', file: at('mods/alpha/mechanics/two.MD') }],
        nestedIndexFiles: [],
      },
      {
        id: 'zeta', dir: at('mods/zeta'), indexFile: at('mods/zeta/_index.md'), redirectsFile: null,
        items: [], mechanics: [], nestedIndexFiles: [],
      },
    ],
    strayFiles: [],
    legacyDirs: [],
    imageFolders: [
      { imagesDir: at('images'), dests: ['images'] },
      { imagesDir: at('mods/alpha/images'), dests: ['images', 'mods/images'] },
      { imagesDir: at('sections/images'), dests: ['sections/images'] },
      { imagesDir: at('site/images'), dests: ['site/images'] },
    ],
  });
});


test('readContentLayout: main/index.md is recognized as a mod landing page when _index.md is absent', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  await touch(root, 'mods/installation_guide_list/main/index.md');

  const layout = await readContentLayout(root);

  assert.equal(layout.mods.length, 1);
  assert.equal(layout.mods[0].id, 'installation_guide_list');
  assert.equal(layout.mods[0].indexFile, at('mods/installation_guide_list/main/index.md'));
});

test('readContentLayout: the canonical _index.md takes precedence over main/index.md', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  await touch(root, 'mods/example/_index.md');
  await touch(root, 'mods/example/main/index.md');

  const layout = await readContentLayout(root);

  assert.equal(layout.mods[0].indexFile, at('mods/example/_index.md'));
});

test('readContentLayout: a nested _index.md, a stray file and a legacy directory are reported, not hidden', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  for (const rel of [
    'mods/alpha/_index.md', 'mods/alpha/mechanics/one.md',
    'mods/alpha/sub/_index.md', 'mods/alpha/sub/deep/_index.md',
    'mods/loose.md', 'mods/notes.txt',
    'items/old.md', 'mechanics/old.md',
  ]) await touch(root, rel);

  const layout = await readContentLayout(root);

  assert.equal(layout.mods.length, 1, 'the one mod directory is still a mod');
  assert.deepEqual(layout.mods[0].nestedIndexFiles, [at('mods/alpha/sub/_index.md'), at('mods/alpha/sub/deep/_index.md')]);
  assert.deepEqual(layout.strayFiles, [at('mods/loose.md'), at('mods/notes.txt')]);
  assert.deepEqual(layout.legacyDirs, [at('items'), at('mechanics')]);
});

test('readContentLayout: a mod directory that holds nothing but images is still a mod, with no index', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  await touch(root, 'mods/alpha/images/pic.png');

  const layout = await readContentLayout(root);

  assert.deepEqual(layout.mods, [{
    id: 'alpha', dir: at('mods/alpha'), indexFile: null, redirectsFile: null,
    items: [], mechanics: [], nestedIndexFiles: [],
  }]);
  assert.deepEqual(layout.imageFolders, [{ imagesDir: at('mods/alpha/images'), dests: ['images', 'mods/images'] }]);
});

test('readContentLayout: only directories count as image folders; no folder is listed for a missing one', async (t) => {
  const root = await tmpDir(t);
  const at = p(root);
  // a FILE called images, not a folder
  await touch(root, 'mods/alpha/images');
  await touch(root, 'mods/alpha/_index.md');

  const layout = await readContentLayout(root);

  assert.deepEqual(layout.imageFolders, []);
  assert.equal(layout.mods[0].indexFile, at('mods/alpha/_index.md'));
});
