'use strict';

// Task 6 tests: the CMS shell (admin/) and its Sveltia CMS configuration.
//
// admin/ is copied into dist/admin/ by buildSkeleton after the external-link
// audit, so none of it is covered by the file:// offline discipline — and
// none of the existing tests looked at it. What is pinned here:
//
//   J — the vendored files are the official artifacts, byte for byte: the
//       main bundle, plus the chunks/additions.js code block and the three
//       shared modules it imports (the GitHub + additions sign-in loads
//       them). The proof that survives a clone is one sha256 per file
//       recorded next to them (admin/vendor/PROVENANCE.md), and every file
//       must come out of git unconverted on every platform (.gitattributes
//       `-text`), or those comparisons would fail on a Windows checkout.
//   index.html — the CMS page loads the one local bundle as a classic
//       script and nothing else: no remote script or stylesheet (the shell
//       is the only part of dist that may talk to the network, and even it
//       must start from files the site ships), and it tells search engines
//       not to index it.
//
// config.yml (task 6 rulings K / L / M / S / V):
//   K — the skeleton: the GitHub backend with the additions sign-in, a
//       placeholder media folder (Sveltia CMS 0.271.0 refuses to start
//       without one; the build never reads it), the URL of the sign-in
//       service, and the two collections contributors edit, both
//       creatable and deletable. The body hints carry the ruled link
//       policy: external links are fine, images are not supported yet.
//   L — an item page's file name is the item id (the build lints it), so the
//       `slug` select offers exactly the real item ids and nothing else.
//       What a contributor may type is what the renderer reads: the body.
//   M — a mechanic page is title + nav_label + body.
//   S — every front matter key of a mechanic page is a field of the
//       mechanics collection. Item pages are not checked: the renderer
//       reads nothing of their front matter, and the CMS writes keys it
//       does not know back unchanged.
//   V — both bodies are Markdown fields opened in raw mode only: until the
//       rich-text round trip has been tried on [[id]] and ```html blocks,
//       WYSIWYG editing stays closed.
//
// And the build: with its default adminDir, buildSkeleton really injects
// the shell into dist/admin/.
//
// Everything here is offline: no registry, no CDN — the bundle is compared
// with the digest that was written down when it was vendored.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildSkeleton } = require('../tools/build/skeleton-build.js');
const { PAGE_FOLDERS } = require('../tools/build/content-images.js');
const { splitFrontmatter } = require('../tools/extract/frontmatter.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');

const REPO_ROOT = path.join(__dirname, '..');
const ADMIN_DIR = path.join(REPO_ROOT, 'admin');
const VENDOR_REL = 'admin/vendor';
const VENDOR_DIR = path.join(REPO_ROOT, ...VENDOR_REL.split('/'));
const PROVENANCE_REL = 'PROVENANCE.md';
const PROVENANCE_PATH = path.join(VENDOR_DIR, PROVENANCE_REL);
const GITATTRIBUTES_PATH = path.join(REPO_ROOT, '.gitattributes');
const INDEX_PATH = path.join(ADMIN_DIR, 'index.html');
const CONFIG_PATH = path.join(ADMIN_DIR, 'config.yml');

/**
 * The official files vendored under admin/vendor/, relative to it — the
 * same paths they have in the @sveltia/cms package's dist/. Nothing else
 * may sit there: tests below compare this list with the directory and with
 * PROVENANCE.md, so an added or missing file fails two tests at once.
 */
const VENDORED = Object.freeze([
  'sveltia-cms.js',
  'chunks/additions.js',
  'chunks/assets/_shared-module_0-C8f2zUat.js',
  'chunks/assets/_shared-module_46-Dfds8-Cf.js',
  'chunks/assets/_shared-module_64-Dh5oNTNO.js',
]);

const readText = (file) => fs.readFile(file, 'utf8');
const noop = () => {};
const toPosix = (p) => p.split(path.sep).join('/');

/** Every file under dir, sorted. */
async function listFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

/** Has a CJK ideograph — what makes a label Chinese for the contributors. */
const hasChinese = (text) => /[\u4e00-\u9fff]/.test(text);

/** Values of every `src="…"` / `href="…"` attribute in an HTML document. */
const resourceRefs = (html) => [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);

/** Has a scheme (http:, https:, data:, …) or is protocol-relative (//host/…). */
const isRemote = (ref) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

// ---------------------------------------------------------------------------
// Reading admin/config.yml — three line-oriented helpers, not a YAML parser
//
// The file is kept in one fixed shape: one key per line, two-space indents,
// list items start with "- ", strings are bare or single-quoted, comments
// are whole lines. The repo has no npm dependencies, and a parser would be
// more code than the file it reads. A line that does not fit the shape
// fails the test that stumbled over it; nothing is guessed.
// ---------------------------------------------------------------------------

/** A block: the lines under one key, comments and blank lines removed. */
const blockOf = (text) => {
  const block = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '' || raw.trim().startsWith('#')) return;
    const [, indent, body] = /^(\s*)(.*)$/.exec(raw);
    assert.ok(!indent.includes('\t'), `config.yml line ${i + 1}: tab indentation is not part of the file's shape`);
    block.push({ indent: indent.length, text: body, no: i + 1 });
  });
  return block;
};

const baseIndent = (block) => Math.min(...block.map((line) => line.indent));

/** The lines under `key:` inside `block`, or null when `block` has no such key. */
function subBlock(block, key) {
  const base = baseIndent(block);
  const start = block.findIndex((line) => line.indent === base && line.text === `${key}:`);
  if (start < 0) return null;
  const out = [];
  for (const line of block.slice(start + 1)) {
    if (line.indent <= base) break;
    out.push(line);
  }
  return out;
}

/**
 * The text after `key:` on the block's own level, quotes and all — `true`
 * stays `true`, so a quoted 'true' (a string, not the flag) does not pass
 * for the flag. undefined when the key is absent or opens a sub-block.
 */
function value(block, key) {
  const base = baseIndent(block);
  for (const line of block) {
    if (line.indent !== base) continue;
    const match = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line.text);
    if (match !== null && match[1] === key) return match[2];
  }
  return undefined;
}

const has = (block, key) => value(block, key) !== undefined || subBlock(block, key) !== null;

/** The items of a block whose lines start with "- ": each item is a block of its own. */
function listItems(block) {
  assert.ok(block !== null, 'config.yml: the block to list is missing');
  const base = baseIndent(block);
  const items = [];
  for (const line of block) {
    if (line.indent > base) {
      assert.ok(items.length > 0, `config.yml line ${line.no}: unexpected indentation`);
      items.at(-1).push(line);
      continue;
    }
    assert.ok(line.text.startsWith('- '), `config.yml line ${line.no}: expected a list item, got "${line.text}"`);
    items.push([{ indent: base + 2, text: line.text.slice(2), no: line.no }]);
  }
  return items;
}

/** A config string as written: single quotes are the YAML kind ('' is one '), bare text is itself. */
function unquote(raw) {
  assert.equal(typeof raw, 'string', 'config.yml: expected a value, found none');
  if (raw.startsWith("'")) {
    assert.ok(raw.length >= 2 && raw.endsWith("'"), `config.yml: unterminated single-quoted string "${raw}"`);
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  assert.ok(!raw.startsWith('"'), `config.yml: double-quoted strings are not part of the file's shape ("${raw}")`);
  return raw;
}

const readConfig = async () => blockOf(await readText(CONFIG_PATH));
const collection = (config, name) => listItems(subBlock(config, 'collections')).find((coll) => value(coll, 'name') === name);
const fieldsOf = (coll) => listItems(subBlock(coll, 'fields'));
const fieldNames = (coll) => fieldsOf(coll).map((field) => unquote(value(field, 'name')));

test('J — PROVENANCE.md records exactly the vendored files, one sha256 line each, and every file matches it', async () => {
  const provenance = await readText(PROVENANCE_PATH);

  // One explicit line per file — `sha256(<path under admin/vendor/>) = `<hex>``
  // — so a digest cannot be confused with the tarball's sha1 or the
  // registry's base64 integrity value on the same page.
  const recorded = new Map();
  for (const [, rel, hex] of provenance.matchAll(/^sha256\(([^`\r\n]+)\) = `([0-9a-f]{64})`\r?$/gm)) {
    assert.ok(!recorded.has(rel), `PROVENANCE.md records ${rel} twice`);
    recorded.set(rel, hex);
  }
  assert.deepEqual([...recorded.keys()].sort(), [...VENDORED].sort(),
    'PROVENANCE.md must carry one `sha256(<file>) = `<64 hex digits>`` line for every vendored file, and for nothing else');

  const onDisk = (await listFiles(VENDOR_DIR))
    .map((file) => toPosix(path.relative(VENDOR_DIR, file)))
    .filter((rel) => rel !== PROVENANCE_REL)
    .sort();
  assert.deepEqual(onDisk, [...VENDORED].sort(), `admin/vendor/ must hold exactly the vendored files (and ${PROVENANCE_REL})`);

  for (const rel of VENDORED) {
    const digest = createHash('sha256').update(await fs.readFile(path.join(VENDOR_DIR, ...rel.split('/')))).digest('hex');
    assert.equal(digest, recorded.get(rel), `${VENDOR_REL}/${rel} differs from the vendored (official) bytes`);
  }
});

test('J — .gitattributes keeps every vendored file unconverted (-text), so no platform rewrites its line endings on checkout', async () => {
  // Only the two shapes this file uses: a literal path, or a directory
  // pattern ending in "/**". Not a gitattributes parser.
  const rules = (await readText(GITATTRIBUTES_PATH))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      const [pattern, ...attrs] = line.split(/\s+/);
      return { pattern, attrs };
    });

  // "admin/vendor/chunks/**" minus its trailing "**" is "admin/vendor/chunks/":
  // everything under that directory.
  const matches = (pattern, file) => (pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : pattern === file);
  for (const rel of VENDORED) {
    const file = `${VENDOR_REL}/${rel}`;
    const matching = rules.filter(({ pattern }) => matches(pattern, file));
    assert.ok(matching.length > 0, `.gitattributes has no rule for ${file}`);
    assert.ok(matching.some(({ attrs }) => attrs.includes('-text')),
      `${file}: expected a rule carrying the -text attribute, got ${JSON.stringify(matching)}`);
    assert.ok(!matching.some(({ attrs }) => attrs.includes('text')), `${file}: a rule turns text conversion back on`);
  }
});

test('index.html loads only the local bundle, as a classic script — no remote script or stylesheet', async () => {
  const html = await readText(INDEX_PATH);

  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  const srcOf = (attrs) => /\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
  assert.deepEqual(scripts.map(srcOf), ['./vendor/sveltia-cms.js'],
    'exactly one script, pointing at the vendored bundle next to this page');
  for (const attrs of scripts) {
    assert.doesNotMatch(attrs, /\btype\s*=/i, 'the bundle is a classic script, not an ES module');
  }

  const remote = resourceRefs(html).filter(isRemote);
  assert.deepEqual(remote, [], 'the CMS page must not load anything over the network to get started');
});

test('index.html tells search engines not to index the CMS', async () => {
  const html = await readText(INDEX_PATH);
  assert.match(html, /<meta\s+name\s*=\s*["']robots["']\s+content\s*=\s*["']noindex["']\s*\/?\s*>/i);
});

// ---------------------------------------------------------------------------
// config.yml
// ---------------------------------------------------------------------------

test('L — the 物品 dropdown of the items collection offers exactly the real item ids, and the file is named after the choice', async () => {
  const items = collection(await readConfig(), 'items');
  assert.ok(items, 'config.yml has an items collection');

  // The file name is the item id (render.js opens content/items/<id>.md and
  // the build lints it), so the slug is picked, never typed.
  assert.equal(unquote(value(items, 'slug')), '{{fields.slug}}', 'the entry file is named after the slug field');
  const slugField = fieldsOf(items).find((field) => value(field, 'name') === 'slug');
  assert.ok(slugField, 'the items collection has a slug field');
  assert.equal(value(slugField, 'widget'), 'select', 'the slug is chosen from a list');

  const options = listItems(subBlock(slugField, 'options'));
  for (const option of options) {
    assert.ok(value(option, 'label') !== undefined, `config.yml line ${option[0].no}: an option without a label`);
  }
  const ids = options.map((option) => unquote(value(option, 'value')));
  assert.equal(new Set(ids).size, ids.length, `the dropdown lists an id twice: ${JSON.stringify(ids)}`);

  const realIds = FIXTURE_DATA.items.map((item) => item.id);
  assert.deepEqual([...ids].sort(), [...realIds].sort(),
    'the dropdown must list every real item id (aliases are not ids) and nothing else');
});

test('K — config skeleton: GitHub backend with the additions sign-in and its service URL, a placeholder media folder; both collections can be created and deleted', async () => {
  const config = await readConfig();

  const backend = subBlock(config, 'backend');
  assert.ok(backend, 'config.yml has a backend block');
  assert.equal(value(backend, 'name'), 'github');
  assert.equal(value(backend, 'auth_type'), 'additions');
  // Sveltia CMS 0.271.0 refuses to start without a global media folder, so
  // one is declared as a placeholder. No page's image goes there, and the
  // build never reads that directory — pages keep their images beside them.
  assert.equal(unquote(value(config, 'media_folder')), 'assets/uploads');
  // The sign-in service: Sveltia CMS Additions, a Worker on Cloudflare. The
  // CMS refuses to start without its URL. Written as the service's own
  // documentation writes it, with no trailing slash.
  assert.equal(unquote(value(backend, 'base_url')), 'https://sveltia-cms-additions.xiaoxuannocare.workers.dev');

  for (const [name, folder] of [['items', 'content/items'], ['mechanics', 'content/mechanics']]) {
    const coll = collection(config, name);
    assert.ok(coll, `config.yml has a ${name} collection`);
    assert.equal(value(coll, 'folder'), folder, `the ${name} collection reads ${folder}`);
    assert.equal(value(coll, 'create'), 'true', `${name}: contributors can create entries`);
    assert.equal(value(coll, 'delete'), 'true', `${name}: contributors can delete entries`);
  }
});

test('images beside the pages: each collection keeps them in its own images/ folder and references them relatively; uploads get URL-safe, unique names and a size cap', async () => {
  const config = await readConfig();
  // A relative media_folder (no leading slash) is entry-relative in Sveltia
  // CMS: the file goes to <collection folder>/images/, and the body refers to
  // it as `images/x.png` — a relative path, which works online and from
  // file://. An absolute public folder would break the offline zip. The build
  // publishes those folders beside the pages (content-images.js).
  for (const [name, route] of [['items', 'item'], ['mechanics', 'mechanics']]) {
    const coll = collection(config, name);
    assert.equal(unquote(value(coll, 'media_folder')), 'images', `${name}: images are stored in its images/ folder`);
    assert.equal(unquote(value(coll, 'public_folder')), 'images', `${name}: and referenced relative to the page`);
    assert.equal(route, PAGE_FOLDERS.find(([folder]) => folder === name)?.[1], `${name}: the build publishes that folder beside its pages`);
  }
  // The global media folder is a placeholder the CMS requires; no page's image
  // goes there, so the build does not read it.
  assert.equal(unquote(value(config, 'media_folder')), 'assets/uploads');

  const all = subBlock(subBlock(config, 'media_libraries'), 'all');
  assert.ok(all, 'config.yml has media_libraries.all');
  assert.equal(value(all, 'slugify_filename'), 'true', 'file names become URL-friendly');
  assert.equal(unquote(value(all, 'filename_template')), '{{filename}}-{{uuid_short}}',
    'the original name, then a unique suffix, so one page never reuses the same-named image of another');
  const maxFileSize = Number(value(all, 'max_file_size'));
  assert.ok(Number.isInteger(maxFileSize) && maxFileSize > 0 && maxFileSize <= 10 * 1024 * 1024,
    `a size cap that keeps the repository small: ${maxFileSize}`);
});

test('every collection and field a contributor sees has a Chinese label; the fields that need explaining have a Chinese hint', async () => {
  const config = await readConfig();
  const collections = listItems(subBlock(config, 'collections'));
  assert.ok(collections.length > 0, 'config.yml defines collections');

  for (const coll of collections) {
    const name = value(coll, 'name');
    const label = unquote(value(coll, 'label'));
    assert.ok(hasChinese(label), `the ${name} collection has no Chinese label, got "${label}"`);
    for (const field of fieldsOf(coll)) {
      const fieldLabel = unquote(value(field, 'label'));
      assert.ok(hasChinese(fieldLabel), `${name}.${value(field, 'name')} has no Chinese label, got "${fieldLabel}"`);
    }
  }

  // The one field whose value becomes a file name, and the one that must
  // stay empty on all but a single page: both need a word of explanation.
  for (const [collName, fieldName] of [['items', 'slug'], ['mechanics', 'nav_label']]) {
    const field = fieldsOf(collection(config, collName)).find((f) => value(f, 'name') === fieldName);
    assert.ok(field, `the ${collName} collection has a ${fieldName} field`);
    assert.ok(hasChinese(unquote(value(field, 'hint'))), `${collName}.${fieldName}: no hint in Chinese`);
  }
});

test('S — every front matter key of content/mechanics/*.md is a field of the mechanics collection', async () => {
  const mechanics = collection(await readConfig(), 'mechanics');
  assert.ok(mechanics, 'config.yml has a mechanics collection');
  const editable = new Set([...fieldNames(mechanics), 'body']);

  const dir = path.join(REPO_ROOT, 'content', 'mechanics');
  const files = (await fs.readdir(dir)).filter((name) => /\.md$/i.test(name)).sort();
  assert.ok(files.length > 0, 'sanity: the repo has mechanic pages to check');
  for (const name of files) {
    const { fm } = splitFrontmatter(await readText(path.join(dir, name)));
    const outside = Object.keys(fm).filter((key) => !editable.has(key));
    assert.deepEqual(outside, [],
      `content/mechanics/${name}: front matter keys that are not fields of the collection, hence not editable in the CMS: ${outside.join(', ')}`);
  }
  // Only mechanic pages are checked. The renderer reads nothing of an item
  // page's front matter — render.js takes the body of content/items/<id>.md
  // and names the page after the file — so the items collection declares
  // just the slug that names the file and the body, and the keys the
  // fixture entry carries beyond those (title, fixture-fm-key, related)
  // stay as they are: Sveltia CMS 0.271.0 writes keys it does not know
  // back unchanged when an entry is saved.
});

test('V — both bodies are Markdown fields, the last field of their collection, opened in raw mode only', async () => {
  const config = await readConfig();
  for (const name of ['items', 'mechanics']) {
    const fields = fieldsOf(collection(config, name));
    const body = fields.at(-1);
    assert.equal(value(body, 'name'), 'body', `${name}: the body is the last field`);
    assert.equal(value(body, 'widget'), 'markdown', `${name}.body is a Markdown field`);
    const modes = listItems(subBlock(body, 'modes')).map((mode) => mode.map((line) => line.text));
    assert.deepEqual(modes, [['raw']], `${name}.body: raw mode only`);
  }
});

test('the body hints carry the ruled link and image policy: external links are fine, images are inserted and kept beside the page, as bitmaps only', async () => {
  const config = await readConfig();
  for (const name of ['items', 'mechanics']) {
    const body = fieldsOf(collection(config, name)).find((field) => value(field, 'name') === 'body');
    const hint = unquote(value(body, 'hint'));
    assert.match(hint, /Markdown/, `${name}.body hint: says the body is Markdown`);
    assert.match(hint, /外部链接/, `${name}.body hint: external links are allowed`);
    assert.match(hint, /图片/, `${name}.body hint: images can be inserted`);
    assert.match(hint, /images/, `${name}.body hint: says where the images are kept`);
    assert.match(hint, /SVG/, `${name}.body hint: SVG is called out as not allowed`);
    assert.doesNotMatch(hint, /暂不支持插入图片/, `${name}.body hint: images are supported now`);
  }
});

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `admin-config-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry is still pending — the tests' own cleanup
  // failing, not the test. fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/** Run fn while capturing the process.exitCode it leaves behind, then restore the runner's own exit status. */
async function capturingExitCode(fn) {
  const before = process.exitCode;
  try {
    return { result: await fn(), exitCode: process.exitCode, before };
  } catch (err) {
    return { err, exitCode: process.exitCode, before };
  } finally {
    process.exitCode = before;
  }
}

test('the default build injects the shell: dist/admin/ holds index.html, config.yml and every vendored file', async (t) => {
  // buildSkeleton's default adminDir is the relative path "admin", resolved
  // against the cwd — the repository root when the tests run via `npm test`.
  assert.equal(path.resolve('admin'), ADMIN_DIR, 'the tests must run from the repository root, as `npm test` does');

  const distDir = await tmpDir(t, 'inject');
  const { result, exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null, warn: noop })); // adminDir is NOT passed: the default has to find admin/

  assert.equal(result.adminInjected, true, 'the default adminDir is injected');
  assert.equal(exitCode, before, 'a build that injects the shell is not a failure');

  const injected = path.join(distDir, 'admin');
  const files = (await listFiles(injected)).map((file) => toPosix(path.relative(injected, file)));
  for (const rel of ['index.html', 'config.yml', ...VENDORED.map((vendored) => `vendor/${vendored}`)]) {
    assert.ok(files.includes(rel), `dist/admin/${rel} is missing after the build; dist/admin holds ${JSON.stringify(files)}`);
  }

  // …and the vendored files are still the official bytes once they are in dist.
  for (const rel of VENDORED) {
    const [source, copy] = await Promise.all([
      fs.readFile(path.join(VENDOR_DIR, ...rel.split('/'))),
      fs.readFile(path.join(injected, 'vendor', ...rel.split('/'))),
    ]);
    assert.ok(source.equals(copy), `dist/admin/vendor/${rel} differs from ${VENDOR_REL}/${rel}`);
  }
  // The offline zip never carries dist/admin/: tests/pack.test.js, "packSite:
  // a fresh build + one zip that holds exactly dist minus admin/".
});

// ---------------------------------------------------------------------------
// Task 6b D10 — regression pins for config.yml
//
// The cases above pin the shape of the configuration. These pin its values —
// the ones a later edit could change without any test going red:
//   • nav_label is optional (the hint tells every contributor to leave it
//     empty): `required: false`
//   • the two collections have exactly their fields, each with its widget
//   • backend.branch, backend.repo and site_url, exactly as written today.
//     backend.repo and site_url name the organisation the site lives in:
//     probably-documented. A wrong name here is an editor who cannot sign in.
//   • an option of the 物品 dropdown is labelled with the item's name
// Nothing under admin/ changes for this file.
// ---------------------------------------------------------------------------

test('D10 — nav_label 不是必填项:required 为 false', async () => {
  const navLabel = fieldsOf(collection(await readConfig(), 'mechanics')).find((field) => value(field, 'name') === 'nav_label');
  assert.equal(value(navLabel, 'required'), 'false', 'a contributor is told to leave it empty on every page but one');
});

test('D10 — items 与 mechanics 的字段恰为清单(按顺序),widget 各就各位', async () => {
  const config = await readConfig();
  const expect = (collName, expected) => {
    const fields = fieldsOf(collection(config, collName));
    assert.deepEqual(fields.map((field) => unquote(value(field, 'name'))), expected.map(([name]) => name),
      `${collName}: field names, in order`);
    assert.deepEqual(fields.map((field) => value(field, 'widget')), expected.map(([, widget]) => widget),
      `${collName}: widgets, in the same order`);
  };
  expect('items', [['slug', 'select'], ['body', 'markdown']]);
  expect('mechanics', [['title', 'string'], ['nav_label', 'string'], ['body', 'markdown']]);
});

test('D10 — backend.branch、backend.repo、site_url 指向本仓库:probably-documented/probably-stolen-mod-wiki', async () => {
  const config = await readConfig();
  const backend = subBlock(config, 'backend');
  assert.equal(value(backend, 'branch'), 'main');
  assert.equal(value(backend, 'repo'), 'probably-documented/probably-stolen-mod-wiki');
  assert.equal(value(config, 'site_url'), 'https://probably-documented.github.io/probably-stolen-mod-wiki/');
});

test('D10 — 物品下拉里,fixture 数据中有名字的物品,选项 label 就是它的名字', async () => {
  const items = collection(await readConfig(), 'items');
  const slugField = fieldsOf(items).find((field) => value(field, 'name') === 'slug');
  const labelOf = new Map(listItems(subBlock(slugField, 'options'))
    .map((option) => [unquote(value(option, 'value')), unquote(value(option, 'label'))]));

  const named = FIXTURE_DATA.items.filter((item) => item.name !== null);
  assert.ok(named.length >= 1, 'sanity: the fixture has named items');
  for (const item of named) {
    assert.ok(labelOf.has(item.id), `${item.id} is in the dropdown`);
    assert.equal(labelOf.get(item.id), item.name, `${item.id}: labelled with its name`);
  }
  // …and an item with no name — a real case in the data — is listed by its id, never as "null"
  for (const item of FIXTURE_DATA.items.filter((it) => it.name === null)) {
    assert.equal(labelOf.get(item.id), item.id, `${item.id}: listed by its id`);
  }
});
