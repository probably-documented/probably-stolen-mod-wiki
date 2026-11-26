'use strict';

// The CMS shell (admin/) and its Sveltia CMS configuration, for the per-mod
// content layout (content/home.md, sections/, mods/<modId>/…, site/, and the
// read-only templates/ at the repository root).
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
//   index.html — the CMS page sets CMS_MANUAL_INIT, then loads the vendored
//       bundle and the build's own admin.js, as classic scripts and nothing
//       else: no remote script or stylesheet (the shell is the only part of
//       dist that may talk to the network, and even it must start from files
//       the site ships), and it tells search engines not to index it.
//
// config.yml — every key below was tried on Sveltia CMS 0.271.0 (Test
// backend) before it was written here; a key that is not in this list is not
// known to work:
//   order      — the collections in the order of the side bar, with the
//                dividers between them, and an icon on each
//   home       — one file, content/home.md
//   sections   — content/sections/<别名>.md; which mods a section holds is
//                written in the section file and nowhere else
//   mods       — content/mods/<别名>/_index.md (nested, depth 2: a mod can
//                never be created inside another mod); the alias IS the mod
//                id, i.e. its directory name
//   mechanics,
//   items      — content/mods/{{fields.mod}}/mechanics|items/<…>.md; the
//                alias of a mechanic page is editable, the file name of an
//                item entry is its item_id field
//   redirects  — content/mods/{{fields.mod}}/redirects.yaml
//   site       — content/site/<别名>.md
//   templates  — the repository's templates/, read-only
//   alias      — an editable alias may only use what the build accepts as a
//                file name (content-lint.js NAME_RE): the two rules are one
//   relations  — value_field is the '{{slug}}' template tag (a bare `slug`
//                is refused by the configuration check)
//   K — the skeleton: the GitHub backend with the additions sign-in, a
//       placeholder media folder (Sveltia CMS 0.271.0 refuses to start
//       without one; the build never reads it), the URL of the sign-in
//       service, and the top-level slug.lowercase: false (without it even
//       the directory segment {{fields.mod}} is lower-cased on save)
//   images     — every collection keeps them in the images/ folder the
//                build publishes (content-images.js)
//   S — every front matter key of the repository's content is a field of
//       the collection that edits it
//   V — every body is a Markdown field that opens in rich text, with raw
//       Markdown one switch away: the first of `modes` is the mode the
//       editor opens in. Tables, images and code blocks are on in the
//       editor, captioned images are off (the site does not render a
//       <figure>), and the fields that are not the body stay out of the
//       preview pane.
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
const { TEMPLATE_CATEGORIES } = require('../tools/build/cms-assets.js');
const { NAME_RE } = require('../tools/build/content-lint.js');
const { readContentLayout } = require('../tools/build/content-layout.js');
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
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');

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
  'chunks/react-dom.js',
  'chunks/assets/rolldown-runtime-BWaJ3C7D.js',
]);

/** The collections as the side bar lists them; a divider shows as a line. */
const SIDEBAR = Object.freeze(['home', 'sections', '—', 'mods', '—', 'mechanics', 'items', 'redirects', '—', 'site', 'templates']);

/** Every collection with a body, and its field names and widgets, in order. */
const COLLECTIONS = Object.freeze({
  home: [['title', 'string'], ['body', 'markdown']],
  sections: [['title', 'string'], ['order', 'number'], ['mods', 'relation'], ['body', 'markdown']],
  mods: [
    ['title', 'string'], ['filename_hint', 'filename-hint'], ['summary', 'text'], ['author', 'string'],
    ['version', 'string'], ['prerequisites', 'list'], ['body', 'markdown'],
  ],
  mechanics: [
    ['title', 'string'], ['filename_hint', 'filename-hint'], ['mod', 'relation'],
    ['template_starter', 'template-starter'], ['body', 'markdown'],
  ],
  items: [
    ['item_id', 'item-id'], ['mod', 'relation'], ['title', 'string'], ['description', 'string'], ['flavor', 'string'],
    ['notes', 'string'], ['usage', 'list'], ['sources', 'list'], ['related', 'list'], ['categories', 'list'],
    ['price', 'number'], ['icon', 'image'], ['shape', 'list'], ['template_starter', 'template-starter'], ['body', 'markdown'],
  ],
  redirects: [['mod', 'relation'], ['aliases', 'list'], ['keywords', 'list']],
  site: [['title', 'string'], ['nav_label', 'string'], ['body', 'markdown']],
  templates: [['title', 'string'], ['category', 'select'], ['applies_to', 'select'], ['description', 'text'], ['body', 'markdown']],
});
/** The collections whose entries a contributor may create and delete. */
const EDITABLE = Object.freeze(['sections', 'mods', 'mechanics', 'items', 'redirects', 'site']);
/** The kinds of entry a template can be started from (the applies_to options). */
const ENTRY_TYPES = Object.freeze([
  ['mechanics', '机制词条'], ['items', '物品词条'], ['mods', 'Mod 导航页'], ['sections', '分区导航页'],
]);

/** Every collection with a body — `redirects` is plain YAML and has none. */
const WITH_BODY = Object.freeze(Object.keys(COLLECTIONS).filter((name) => COLLECTIONS[name].some(([field]) => field === 'body')));

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

/** An emoji or pictograph — interface copy does not use them. */
const hasEmoji = (text) => /\p{Extended_Pictographic}/u.test(text);

// ---------------------------------------------------------------------------
// Reading admin/config.yml — three line-oriented helpers, not a YAML parser
//
// The file is kept in one fixed shape: one key per line, two-space indents,
// list items start with "- ", strings are bare or single-quoted, comments
// are whole lines; no flow forms ([a, b], {a: b}). The repo has no npm
// dependencies, and a parser would be more code than the file it reads. A
// line that does not fit the shape fails the test that stumbled over it;
// nothing is guessed.
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

/** A block list of scalars, each as written. */
const listOf = (block, key) => listItems(subBlock(block, key)).map((item) => item.map((line) => line.text));

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

/** Every item of the collections list, dividers included. */
const sidebarOf = (config) => listItems(subBlock(config, 'collections'));
/** The collection called `name`, or undefined (there is no such collection). */
const collection = (config, name) => sidebarOf(config).find((coll) => value(coll, 'name') === name);
/** The one file of a single-file collection. */
const fileOf = (coll) => listItems(subBlock(coll, 'files'))[0];
/** The fields of a folder collection — or of the one file of a single-file collection. */
const fieldsOf = (coll) => listItems(subBlock(has(coll, 'files') ? fileOf(coll) : coll, 'fields'));
const fieldNames = (coll) => fieldsOf(coll).map((field) => unquote(value(field, 'name')));
const field = (coll, name) => fieldsOf(coll).find((f) => value(f, 'name') === name);

/** The object form of a collection's `slug`: the editable alias. */
const aliasOf = (coll) => subBlock(coll, 'slug');

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

// ---------------------------------------------------------------------------
// index.html
// ---------------------------------------------------------------------------

test('index.html sets CMS_MANUAL_INIT first, then loads the vendored bundle and the build\'s admin.js — classic scripts, nothing remote', async () => {
  const html = await readText(INDEX_PATH);

  // Every <script> in order: what it loads (null = inline), and its own text when inline.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({
    attrs: m[1],
    src: /\bsrc\s*=\s*["']([^"']*)["']/i.exec(m[1])?.[1] ?? null,
    text: m[2],
  }));
  assert.deepEqual(scripts.map((script) => script.src), [null, './vendor/sveltia-cms.js', './admin.js'],
    'first the one-line inline script, then the bundle, then the scripts the build writes (tools/cms/)');
  for (const script of scripts) {
    assert.doesNotMatch(script.attrs, /\btype\s*=/i, 'every script is a classic script, not an ES module');
  }
  // The flag has to be there before the bundle runs: with it the CMS waits, and admin.js calls
  // CMS.init() once the custom field controls are registered.
  assert.match(scripts[0].text, /^\s*window\.CMS_MANUAL_INIT\s*=\s*true;\s*$/, 'the inline script does exactly one thing');

  const remote = resourceRefs(html).filter(isRemote);
  assert.deepEqual(remote, [], 'the CMS page must not load anything over the network to get started');
});

test('index.html tells search engines not to index the CMS', async () => {
  const html = await readText(INDEX_PATH);
  assert.match(html, /<meta\s+name\s*=\s*["']robots["']\s+content\s*=\s*["']noindex["']\s*\/?\s*>/i);
});

test('index.html 隐藏预览面板里的字段名,编辑区的不受影响', async () => {
  const html = await readText(INDEX_PATH);
  assert.ok(html.includes('[data-field-type][data-key-path] > h4 { display: none !important; }'));
});

// ---------------------------------------------------------------------------
// config.yml — the collections
// ---------------------------------------------------------------------------

test('the collections are in the order of the side bar, with a divider where the design puts one', async () => {
  const sideBar = sidebarOf(await readConfig()).map((coll) => (value(coll, 'divider') === 'true' ? '—' : value(coll, 'name')));
  assert.deepEqual(sideBar, [...SIDEBAR]);
  for (const entry of sideBar.filter((entry) => entry !== '—')) assert.ok(entry in COLLECTIONS, `${entry}: a collection this file knows`);
});

test('every collection has an icon and a label in Chinese', async () => {
  for (const coll of sidebarOf(await readConfig())) {
    if (value(coll, 'divider') === 'true') continue;
    const name = value(coll, 'name');
    assert.ok(has(coll, 'icon') && unquote(value(coll, 'icon')) !== '', `${name}: no icon`);
    const label = unquote(value(coll, 'label'));
    if (name === 'mods') {
      // The name the design gives this collection (spec §10): the word is the project's own (Mod ID, mod 导航页).
      assert.equal(label, 'Mod');
    } else {
      assert.ok(hasChinese(label), `${name}: no Chinese label, got "${label}"`);
    }
    if (has(coll, 'label_singular')) {
      assert.equal(unquote(value(coll, 'label_singular')), label, `${name}: label_singular is the same name in the singular`);
    }
  }
});

test('home — the main navigation page is one file, content/home.md', async () => {
  const home = collection(await readConfig(), 'home');
  const file = fileOf(home);
  assert.equal(value(file, 'file'), 'content/home.md', 'the one file of the collection');
  assert.equal(has(home, 'folder'), false, 'not a folder collection: there is exactly one such page');
  assert.equal(has(home, 'create'), false, '…so it cannot be created');
  assert.equal(has(home, 'delete'), false, '…nor deleted');
});

test('sections — a folder of section pages; which mods a section holds is a relation written in the section file', async () => {
  const sections = collection(await readConfig(), 'sections');
  assert.equal(value(sections, 'folder'), 'content/sections');
  const mods = field(sections, 'mods');
  assert.equal(value(mods, 'widget'), 'relation');
  assert.equal(value(mods, 'collection'), 'mods');
  assert.equal(value(mods, 'multiple'), 'true', 'a section holds several mods');
  assert.equal(value(mods, 'required'), 'false', 'a section may be empty');
  assert.equal(value(field(sections, 'order'), 'required'), 'false', 'the order is optional');
});

test('mods — content/mods/<别名>/_index.md: the alias is the mod id; depth 2 keeps a mod out of another mod; no 「所属分区」 field', async () => {
  const mods = collection(await readConfig(), 'mods');
  assert.equal(value(mods, 'folder'), 'content/mods');
  assert.equal(unquote(value(mods, 'path')), '{{slug}}/_index');
  const nested = subBlock(mods, 'nested');
  assert.equal(value(nested, 'depth'), '2', 'with depth 2 neither the new page nor the edit page offers a parent folder');
  assert.equal(value(nested, 'subfolders'), 'true');
  assert.equal(value(subBlock(subBlock(mods, 'meta'), 'path'), 'index_file'), '_index');
  assert.equal(unquote(value(aliasOf(mods), 'editable')), 'true', 'the alias — the directory name — can be set by hand');
  assert.match(unquote(value(aliasOf(mods), 'hint')), /目录名/, 'the hint says what the alias is');
  // A mod's sections live in the section files only (J of the content lint reads them there).
  assert.ok(!fieldNames(mods).some((name) => /section|分区/.test(name)), `mods has no field for its sections: ${fieldNames(mods)}`);
});

test('mechanics — content/mods/{{fields.mod}}/mechanics/<别名>.md, filed under its mod, grouped by mod', async () => {
  const mechanics = collection(await readConfig(), 'mechanics');
  assert.equal(value(mechanics, 'folder'), 'content/mods');
  assert.equal(unquote(value(mechanics, 'path')), '{{fields.mod}}/mechanics/{{slug}}');
  assert.equal(unquote(value(aliasOf(mechanics), 'editable')), 'true', 'the file name of a mechanic page can be set by hand');
  const mod = field(mechanics, 'mod');
  assert.equal(value(mod, 'collection'), 'mods');
  assert.ok(value(mod, 'required') !== 'false', 'a mechanic page has to say which mod it is in');
  const groups = listItems(subBlock(subBlock(mechanics, 'view_groups'), 'groups'));
  assert.equal(value(groups[0], 'field'), 'mod');
  assert.equal(value(groups[0], 'collapsed'), 'true');
  assert.equal(value(subBlock(mechanics, 'view_groups'), 'default'), value(groups[0], 'name'), 'the grouped view is what the list opens in');
});

test('items — content/mods/{{fields.mod}}/items/<物品ID>.md: the file IS the item_id field, picked from the exported items or typed', async () => {
  const items = collection(await readConfig(), 'items');
  assert.equal(value(items, 'folder'), 'content/mods');
  assert.equal(unquote(value(items, 'path')), '{{fields.mod}}/items/{{slug}}');
  assert.equal(unquote(value(items, 'slug')), '{{fields.item_id}}', 'the file name comes from the 物品 ID field');
  assert.equal(aliasOf(items), null, 'not the editable alias: the alias panel would disagree with the field');
  const id = field(items, 'item_id');
  assert.equal(value(id, 'widget'), 'item-id', 'the control with the list of the mod\'s exported items');
  assert.ok(value(id, 'required') !== 'false', 'an item entry has to say which item it is');
  assert.equal(value(field(items, 'mod'), 'collection'), 'mods');
  assert.ok(value(field(items, 'mod'), 'required') !== 'false');
});

test('redirects — content/mods/{{fields.mod}}/redirects.yaml: pure YAML, extension .yaml', async () => {
  const redirects = collection(await readConfig(), 'redirects');
  assert.equal(value(redirects, 'folder'), 'content/mods');
  assert.equal(unquote(value(redirects, 'path')), '{{fields.mod}}/redirects');
  assert.equal(value(redirects, 'format'), 'yaml');
  assert.equal(value(redirects, 'extension'), 'yaml', 'format yaml alone would name the file .yml');
  assert.equal(unquote(value(redirects, 'slug')), 'redirects', 'a fixed alias: no random alias for a file without a title');
  for (const name of ['aliases', 'keywords']) {
    assert.equal(value(field(redirects, name), 'required'), 'false', `${name}: may be left empty`);
  }
});

test('site — content/site/<别名>.md, the pages that belong to no mod', async () => {
  const site = collection(await readConfig(), 'site');
  assert.equal(value(site, 'folder'), 'content/site');
  assert.equal(unquote(value(aliasOf(site), 'editable')), 'true');
  assert.equal(value(field(site, 'nav_label'), 'required'), 'false', 'a site page may stay off the top nav');
});

test('templates — the repository\'s templates/, read-only: no creating, deleting or duplicating', async () => {
  const templates = collection(await readConfig(), 'templates');
  assert.equal(value(templates, 'folder'), 'templates', 'at the repository root, not under content/');
  assert.equal(value(templates, 'readonly'), 'true');
  for (const key of ['create', 'delete', 'duplicate']) {
    assert.equal(value(templates, key), 'false', `templates.${key}`);
  }
});

test('templates — a template is filed by category, and the categories are exactly the build\'s TEMPLATE_CATEGORIES', async () => {
  const templates = collection(await readConfig(), 'templates');
  const options = (name) => listItems(subBlock(field(templates, name), 'options'))
    .map((option) => [unquote(value(option, 'value')), unquote(value(option, 'label'))]);
  assert.deepEqual(options('category'), TEMPLATE_CATEGORIES.map(({ value, label }) => [value, label]),
    'the picker (tools/build/cms-assets.js) and the collection must name the same categories');
  assert.equal(value(field(templates, 'applies_to'), 'multiple'), 'true', 'a template can apply to several kinds of entry');
  assert.deepEqual(options('applies_to'), [...ENTRY_TYPES]);
});

test('both entries with a body get the 「从模板开始」 control, told which kind of entry it is on', async () => {
  const config = await readConfig();
  for (const [name, appliesTo] of [['mechanics', 'mechanics'], ['items', 'items']]) {
    const starter = field(collection(config, name), 'template_starter');
    assert.equal(value(starter, 'widget'), 'template-starter');
    assert.equal(unquote(value(starter, 'applies_to')), appliesTo, `${name}: the picker shows the templates for this kind of entry`);
    assert.equal(value(starter, 'required'), 'false', `${name}: it holds no value`);
  }
});

test('every relation points at a defined collection and takes its value from the \'{{slug}}\' template tag', async () => {
  const config = await readConfig();
  const defined = new Set(sidebarOf(config).map((coll) => value(coll, 'name')));
  for (const coll of sidebarOf(config)) {
    if (value(coll, 'divider') === 'true') continue;
    for (const f of fieldsOf(coll).filter((candidate) => value(candidate, 'widget') === 'relation')) {
      const where = `${value(coll, 'name')}.${value(f, 'name')}`;
      assert.ok(defined.has(value(f, 'collection')), `${where}: points at a defined collection`);
      assert.equal(unquote(value(f, 'value_field')), '{{slug}}', `${where}: a bare slug is refused by the configuration check`);
      assert.deepEqual(listOf(f, 'search_fields').map((item) => unquote(item[0])), ['{{slug}}', 'title'], `${where}`);
      assert.deepEqual(listOf(f, 'display_fields').map((item) => unquote(item[0])), ['title'], `${where}: listed by title`);
    }
  }
});

test('an editable alias accepts exactly what the build accepts as a file name', async () => {
  const config = await readConfig();
  for (const name of Object.keys(COLLECTIONS)) {
    const alias = aliasOf(collection(config, name));
    if (alias === null) continue;
    assert.equal(unquote(value(alias, 'template')), '{{slug}}', `${name}`);
    assert.equal(unquote(value(alias, 'editable')), 'true', `${name}`);
    const [pattern, message] = listOf(alias, 'pattern');
    assert.equal(unquote(pattern[0]), NAME_RE.source, `${name}: the CMS and the content lint (NAME_RE) must agree on what a file name may be`);
    assert.ok(hasChinese(unquote(message[0])), `${name}: the refusal is said in Chinese`);
  }
  assert.deepEqual(
    sidebarOf(config).filter((coll) => aliasOf(coll) !== null).map((coll) => value(coll, 'name')),
    ['sections', 'mods', 'mechanics', 'site'],
    'these collections, and only these, have an editable alias',
  );
});

test('the fields of every collection are exactly this list, in this order, each with its widget', async () => {
  const config = await readConfig();
  for (const [name, expected] of Object.entries(COLLECTIONS)) {
    const fields = fieldsOf(collection(config, name));
    assert.deepEqual(fields.map((f) => unquote(value(f, 'name'))), expected.map(([fieldName]) => fieldName), `${name}: field names, in order`);
    assert.deepEqual(fields.map((f) => value(f, 'widget')), expected.map(([, widget]) => widget), `${name}: widgets, in the same order`);
  }
});

test('the item\'s icon is a picture that can be uploaded (stage 3, task 4): an image control with no way to paste an outside address', async () => {
  const icon = field(collection(await readConfig(), 'items'), 'icon');
  assert.equal(value(icon, 'widget'), 'image');
  assert.equal(value(icon, 'choose_url'), 'false', 'no URL to type: the picture is stored in the mod\'s own images/ folder');
  assert.equal(value(icon, 'required'), 'false', 'an item with no picture shows 无图');
  // …and the collection's images are the mod's (media_folder ../../images), which is where the build looks for them
  assert.equal(unquote(value(collection(await readConfig(), 'items'), 'media_folder')), '../../images');
});

// ---------------------------------------------------------------------------
// config.yml — the skeleton, images, copy
// ---------------------------------------------------------------------------

test('K — config skeleton: GitHub backend with the additions sign-in and its service URL, a placeholder media folder; the editable collections can be created and deleted', async () => {
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

  for (const name of EDITABLE) {
    const coll = collection(config, name);
    assert.equal(value(coll, 'create'), 'true', `${name}: contributors can create entries`);
    assert.equal(value(coll, 'delete'), 'true', `${name}: contributors can delete entries`);
  }
});

test('images: every collection stores them in the images/ folder the build publishes, and refers to them the way its pages do; uploads get URL-safe, unique names and a size cap', async () => {
  const config = await readConfig();
  // [collection, media_folder, public_folder]: a relative media_folder (no
  // leading slash) is entry-relative in Sveltia CMS.
  //   home, a section, a site page — the file is in <folder>/, its images in
  //   <folder>/images/, referred to as images/x.png (the page sits beside it);
  //   a mod's _index.md — <mod>/images/, referred to as images/x.png;
  //   an entry in <mod>/mechanics/ or <mod>/items/ — the images are the mod's,
  //   two levels up: '../../images', referred to as ../images/x.png (the page
  //   sits one level deep). media_folder cannot take {{fields.*}}, so it is a
  //   literal climb — the one way that lands in the mod's folder.
  // The build publishes each of those folders where the pages look
  // (content-images.js, from the layout's imageFolders).
  for (const [name, mediaFolder, publicFolder] of [
    ['home', 'images', 'images'], ['sections', 'images', 'images'], ['mods', 'images', 'images'],
    ['mechanics', '../../images', '../images'], ['items', '../../images', '../images'], ['site', 'images', 'images'],
  ]) {
    const coll = collection(config, name);
    assert.equal(unquote(value(coll, 'media_folder')), mediaFolder, `${name}: where images are stored`);
    assert.equal(unquote(value(coll, 'public_folder')), publicFolder, `${name}: how the page refers to them`);
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
  for (const coll of sidebarOf(config)) {
    if (value(coll, 'divider') === 'true') continue;
    const name = value(coll, 'name');
    for (const f of fieldsOf(coll)) {
      const fieldLabel = unquote(value(f, 'label'));
      assert.ok(hasChinese(fieldLabel), `${name}.${value(f, 'name')} has no Chinese label, got "${fieldLabel}"`);
    }
  }

  // The fields whose value becomes a file or a directory name, the ones that
  // must stay empty on all but a page or two, and the one that decides where
  // an entry is filed: each needs a word of explanation.
  for (const [collName, fieldName] of [
    ['sections', 'mods'], ['mods', 'summary'], ['mechanics', 'mod'], ['site', 'nav_label'],
    ['items', 'item_id'], ['items', 'mod'], ['templates', 'applies_to'],
  ]) {
    const f = field(collection(config, collName), fieldName);
    assert.ok(f, `the ${collName} collection has a ${fieldName} field`);
    assert.ok(hasChinese(unquote(value(f, 'hint'))), `${collName}.${fieldName}: no hint in Chinese`);
  }
  for (const name of ['sections', 'mods', 'mechanics', 'site']) {
    assert.ok(hasChinese(unquote(value(aliasOf(collection(config, name)), 'hint'))), `${name}: the alias needs a hint`);
  }
});

test('S — every front matter key of the repository\'s content is a field of the collection that edits it', async () => {
  const config = await readConfig();
  const editableOf = (collName) => new Set([...fieldNames(collection(config, collName)), 'body']);
  const layout = await readContentLayout(CONTENT_DIR);

  /** The keys of `file`'s front matter that the collection `collName` cannot edit. */
  const outside = async (file, collName) => {
    const text = await readText(file);
    const keys = file.endsWith('.yaml')
      ? text.split(/\r?\n/).filter((line) => /^[A-Za-z_][\w-]*:/.test(line)).map((line) => line.replace(/:.*$/, '')) // redirects.yaml: plain YAML, top-level keys only
      : Object.keys(splitFrontmatter(text).fm);
    return { file: toPosix(path.relative(REPO_ROOT, file)), outside: keys.filter((key) => !editableOf(collName).has(key)) };
  };

  const checked = [
    ['home', layout.home === null ? [] : [layout.home]],
    ['sections', layout.sections.map((page) => page.file)],
    ['mods', layout.mods.map((mod) => mod.indexFile).filter((file) => file !== null)],
    ['mechanics', layout.mods.flatMap((mod) => mod.mechanics.map((page) => page.file))],
    ['items', layout.mods.flatMap((mod) => mod.items.map((entry) => entry.file))],
    ['redirects', layout.mods.map((mod) => mod.redirectsFile).filter((file) => file !== null)],
    ['site', layout.site.map((page) => page.file)],
    ['templates', (await listFiles(TEMPLATES_DIR)).filter((file) => /\.md$/i.test(file))],
  ];
  const counts = Object.fromEntries(checked.map(([name, files]) => [name, files.length]));
  assert.ok(counts.mechanics >= 12 && counts.items >= 65 && counts.mods >= 6 && counts.templates >= 7,
    `sanity: the repository has content of every kind to check: ${JSON.stringify(counts)}`);

  for (const [collName, files] of checked) {
    for (const file of files) {
      const { file: rel, outside: unknown } = await outside(file, collName);
      assert.deepEqual(unknown, [], `${rel}: front matter keys that are not fields of the ${collName} collection, hence not editable in the CMS: ${unknown.join(', ')}`);
    }
  }
});

test('对象列表字段:usage 与 sources 是 list,子字段各就各位', async () => {
  const items = collection(await readConfig(), 'items');
  const subFields = (name) => listItems(subBlock(field(items, name), 'fields'))
    .map((sub) => [unquote(value(sub, 'name')), value(sub, 'widget')]);
  assert.deepEqual(subFields('usage'), [['type', 'string'], ['text', 'string'], ['source', 'string']]);
  assert.deepEqual(subFields('sources'), [['source', 'string'], ['detail', 'string'], ['probability', 'string']]);
});

test('V — 每个正文都是 Markdown 字段、所在集合(或文件)的最后一个字段,打开时是富文本,可以切回原文', async () => {
  const config = await readConfig();
  for (const name of WITH_BODY) {
    const body = fieldsOf(collection(config, name)).at(-1);
    assert.equal(value(body, 'name'), 'body', `${name}: the body is the last field`);
    assert.equal(value(body, 'widget'), 'markdown', `${name}.body is a Markdown field`);
    assert.deepEqual(listOf(body, 'modes'), [['rich_text'], ['raw']], `${name}.body: rich text first — the mode the editor opens in — then raw`);
  }
});

test('the body hints are the ruled text (spec D): raw Markdown is one switch away, an image goes on its own line, the table menu is named, source is shown from an XML or plain-text code block, external links are fine, images are bitmaps only', async () => {
  const config = await readConfig();
  for (const name of WITH_BODY) {
    const hint = unquote(value(field(collection(config, name), 'body'), 'hint'));
    assert.match(hint, /Markdown/, `${name}.body hint: says the body is Markdown`);
    assert.match(hint, /以 Markdown 编辑/, `${name}.body hint: names the switch back to raw Markdown`);
    assert.match(hint, /外部链接/, `${name}.body hint: external links are allowed`);
    assert.match(hint, /图片/, `${name}.body hint: images can be inserted`);
    assert.match(hint, /单独占一行/, `${name}.body hint: an image goes on its own line`);
    assert.match(hint, /删除表格/, `${name}.body hint: says where the table menu is`);
    assert.match(hint, /XML/, `${name}.body hint: source is shown from an XML code block`);
    assert.match(hint, /HTML/, `${name}.body hint: …and names the HTML code block, which does not show source`);
    assert.match(hint, /SVG/, `${name}.body hint: SVG is called out as not allowed`);
    assert.doesNotMatch(hint, /暂不支持插入图片/, `${name}.body hint: images are supported now`);
  }
});

test('每个正文都启用图片、表格、代码块三个编辑器组件,并关闭带说明文字的图片', async () => {
  const config = await readConfig();
  for (const name of WITH_BODY) {
    const body = field(collection(config, name), 'body');
    assert.deepEqual(listOf(body, 'editor_components'), [['image'], ['table'], ['code-block']], `${name}.body`);
    assert.equal(value(body, 'captioned_images'), 'false', `${name}.body`);
  }
});

test('不是正文的字段不进预览面板', async () => {
  const config = await readConfig();
  for (const name of Object.keys(COLLECTIONS)) {
    for (const f of fieldsOf(collection(config, name)).filter((candidate) => value(candidate, 'name') !== 'body')) {
      assert.equal(value(f, 'preview'), 'false', `${name}.${value(f, 'name')}`);
    }
  }
});

test('正文要不要必填:Mod 导航页和物品词条可以为空,其余的页面就是它的正文', async () => {
  const config = await readConfig();
  const bodyOf = (name) => field(collection(config, name), 'body');
  for (const name of ['mods', 'items']) {
    assert.equal(value(bodyOf(name), 'required'), 'false', `${name}.body: saves with an empty body`);
  }
  for (const name of ['home', 'sections', 'mechanics', 'site', 'templates']) {
    assert.equal(value(bodyOf(name), 'required'), undefined, `${name}.body: still required`);
  }
});

test('「关于本站」由站点页面声明(stage 3): site 有 nav_label(非必填),机制词条没有这个字段', async () => {
  const config = await readConfig();
  assert.equal(value(field(collection(config, 'site'), 'nav_label'), 'required'), 'false', 'site: a contributor is told to leave it empty on every page but one');
  assert.ok(hasChinese(unquote(value(field(collection(config, 'site'), 'nav_label'), 'hint'))), 'site.nav_label has a hint in Chinese');
  // A mechanic page can no longer put itself on the top bar: since stage 3 the four entries it used to ride
  // (玩法指南, 机制说明…) live on in each mod's own page, and 关于本站 is a site page's to declare.
  assert.equal(field(collection(config, 'mechanics'), 'nav_label'), undefined, 'mechanics has no nav_label field');
  assert.equal(field(collection(config, 'items'), 'nav_label'), undefined);
  for (const name of ['home', 'sections', 'mods', 'items', 'redirects', 'templates']) {
    assert.equal(field(collection(config, name), 'nav_label'), undefined, `${name} has no nav_label field either`);
  }
});

test('D10 — backend.branch、backend.repo、site_url 指向本仓库:probably-documented/probably-stolen-mod-wiki', async () => {
  const config = await readConfig();
  const backend = subBlock(config, 'backend');
  assert.equal(value(backend, 'branch'), 'main');
  assert.equal(value(backend, 'repo'), 'probably-documented/probably-stolen-mod-wiki');
  assert.equal(value(config, 'site_url'), 'https://probably-documented.github.io/probably-stolen-mod-wiki/');
});

test('物品的手写字段都不是必填:留空就用数据里的值', async () => {
  const items = collection(await readConfig(), 'items');
  const hand = ['title', 'description', 'flavor', 'notes', 'usage', 'sources', 'related', 'categories', 'price', 'icon', 'shape'];
  for (const name of hand) {
    assert.equal(value(field(items, name), 'required'), 'false', `${name}: not required`);
  }
});

test('Mod 导航页的简介、作者、版本、前置都不是必填:只填标题就能建出一个 Mod', async () => {
  const mods = collection(await readConfig(), 'mods');
  for (const name of ['summary', 'author', 'version', 'prerequisites']) {
    assert.equal(value(field(mods, name), 'required'), 'false', `${name}: not required`);
  }
  assert.equal(value(field(mods, 'title'), 'required'), undefined, 'the title is what a mod is named by');
});

test('备注的提示不说反话:留空是沿用现有数据里的值,不是不显示', async () => {
  const notes = field(collection(await readConfig(), 'items'), 'notes');
  const hint = unquote(value(notes, 'hint'));
  assert.match(hint, /现有数据/, hint);
  assert.doesNotMatch(hint, /留空就不显示/, hint);
});

test('顶层 slug.lowercase 为 false:没有它,保存时文件名和 {{fields.mod}} 目录名都会被转成小写', async () => {
  const config = await readConfig();
  const slug = subBlock(config, 'slug');
  assert.ok(slug !== null, 'config.yml has a top-level slug block');
  assert.equal(value(slug, 'lowercase'), 'false', 'the CMS keeps gear.maidDress and claude.lewdMemeBrood as written');
});

test('config.yml 和 index.html 里没有 emoji 表情字符', async () => {
  for (const [file, text] of [['config.yml', await readText(CONFIG_PATH)], ['index.html', await readText(INDEX_PATH)]]) {
    const found = [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]);
    assert.deepEqual(found, [], `admin/${file}: interface copy does not use emoji`);
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

test('the default build injects the shell: dist/admin/ holds index.html, config.yml, admin.js and every vendored file', async (t) => {
  // buildSkeleton's default adminDir is the relative path "admin", resolved
  // against the cwd — the repository root when the tests run via `npm test`.
  assert.equal(path.resolve('admin'), ADMIN_DIR, 'the tests must run from the repository root, as `npm test` does');

  const distDir = await tmpDir(t, 'inject');
  const { result, exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null, data: structuredClone(FIXTURE_DATA), warn: noop })); // adminDir is NOT passed: the default has to find admin/

  assert.equal(result.adminInjected, true, 'the default adminDir is injected');
  assert.equal(exitCode, before, 'a build that injects the shell is not a failure');

  const injected = path.join(distDir, 'admin');
  const files = (await listFiles(injected)).map((file) => toPosix(path.relative(injected, file)));
  // …index.html, config.yml, every vendored file, and the CMS's own scripts and catalogs,
  // which the build writes once the shell is in (tools/build/cms-assets.js).
  for (const rel of ['index.html', 'config.yml', 'admin.js', 'templates.json', 'items-by-mod.json', ...VENDORED.map((vendored) => `vendor/${vendored}`)]) {
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
