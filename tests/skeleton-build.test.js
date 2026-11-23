'use strict';

// Task 4 tests: fixture-only build pipeline (FIXTURE_DATA → renderSite →
// dist files → repo assets → external-link audit). No game directory, no
// decompile cache — `npm run build` runs this very entry, so the tests drive
// buildSkeleton against tmp directories instead of the real dist/.
//
// Two rules are pinned here on top of the flow itself (controller rulings):
//   A — repo-shipped static assets land at the exact paths the pages reference
//   B — dist never references a file it does not ship (icons degrade to the
//       无图 fallback, the 关于本站 nav target exists as a mechanic page)
//
// Task 5 adds (same file: they extend the same build entry):
//   C — content/items/<name>.md is only accepted for real item ids (CMS
//       contributors can rename a file to any slug; a fake id never renders)
//   D — the recursive rm of distDir refuses the repo root and its ancestors
//   E — admin/ is copied into dist AFTER the external-link audit
//   F — failures discoverable up front (id lint, missing asset source) hit
//       before rm dist, so the previous dist survives them

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  buildSkeleton, validateItemContentIds, isUnsafeDistDir,
} = require('../tools/build/skeleton-build.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');
const { auditExternalLinks, BWIKI_CREDIT_URL } = require('../tools/build/audit.js');
const { splitFrontmatter } = require('../tools/extract/frontmatter.js');

const REPO_ROOT = path.join(__dirname, '..');
const REPO_CONTENT = path.join(REPO_ROOT, 'content');
const REPO_ASSETS = path.join(REPO_ROOT, 'assets-src');
const FIXTURE_ITEM_ID = FIXTURE_DATA.items[0].id; // brief Step 4: <id> = items[0].id
const DATA_JS_PREFIX = 'window.WIKI_DATA = ';

/**
 * Repo asset → dist path, as referenced by the rendered pages / theme.css.
 * Written out here independently of the build's own table so a wrong mapping
 * in either place is caught.
 */
const EXPECTED_ASSETS = [
  ['theme.css', 'css/theme.css'], // layout: <link rel="stylesheet" href="…css/theme.css">
  ['search.js', 'assets/js/search.js'], // search.html: <script src="assets/js/search.js">
  ['bwiki/emblem.jpg', 'assets/bwiki/emblem.jpg'], // layout: .ps-site__emblem <img src>
  ['bwiki/bg.png', 'assets/bwiki/bg.png'], // theme.css: body background url(../assets/bwiki/bg.png)
  ['bwiki/fonts/PSNotoSansSC.woff2', 'assets/fonts/PSNotoSansSC.woff2'], // theme.css @font-face
  ['bwiki/fonts/PSLubrifontSC.woff2', 'assets/fonts/PSLubrifontSC.woff2'], // theme.css @font-face
  ['bwiki/fonts/PSTektur.woff2', 'assets/fonts/PSTektur.woff2'], // theme.css @font-face
];

const noop = () => {};

/**
 * buildSkeleton with the admin injection switched off, for every test that is
 * not about admin/. buildSkeleton's default adminDir is the repo's `admin`
 * (relative to cwd); once Task 6 ships it, tests that did not ask for it must
 * not gain a dist/admin/ (and its extra .html files) behind their back.
 */
const build = (options) => buildSkeleton({ adminDir: null, ...options });

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `skeleton-${label}-`));
  // Windows may answer ENOTEMPTY to the final rmdir of a recursive rm while a
  // just-deleted entry is still pending (seen about once in 14 full runs).
  // That is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/**
 * Run fn while capturing the process.exitCode it leaves behind, then restore
 * the runner's own exit status (buildSkeleton sets 1 on failure — that must
 * not leak into the node --test process exit).
 */
async function capturingExitCode(fn) {
  const before = process.exitCode;
  try {
    const result = await fn();
    return { result, exitCode: process.exitCode, before };
  } catch (err) {
    return { err, exitCode: process.exitCode, before };
  } finally {
    process.exitCode = before;
  }
}

const toPosix = (p) => p.split(path.sep).join('/');

async function listFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out.sort();
}

/**
 * Everything about a directory tree that "rm + recreate" would change: the
 * top directory's identity (ino) and mtime, plus every file's relative path
 * and bytes. Used to prove a failed build left the previous dist untouched.
 */
async function snapshotTree(dir) {
  const { ino, mtimeMs } = await fs.stat(dir);
  const files = [];
  for (const file of await listFiles(dir)) {
    files.push([toPosix(path.relative(dir, file)), await fs.readFile(file)]);
  }
  return { ino, mtimeMs, files };
}

/** Rendered pages + data.js (i.e. what buildSkeleton's `pages` counts). */
async function countRenderedFiles(distDir) {
  const files = await listFiles(distDir);
  return files.filter((f) => /\.html$/i.test(f) || toPosix(path.relative(distDir, f)) === 'data.js').length;
}

/**
 * Every relative href/src in dist/*.html and url() in dist/*.css that does not
 * resolve to a file inside dist. Skipped: schemes (http:, mailto:, data: …),
 * root-relative and protocol-relative refs, fragment-only refs.
 */
async function findDanglingRefs(distDir) {
  const files = await listFiles(distDir);
  const shipped = new Set(files.map((f) => path.resolve(f)));
  const dangling = [];
  for (const file of files) {
    let refs;
    if (/\.html$/i.test(file)) {
      refs = [...(await fs.readFile(file, 'utf8')).matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)]
        .map((m) => m[1]);
    } else if (/\.css$/i.test(file)) {
      refs = [...(await fs.readFile(file, 'utf8')).matchAll(/url\(\s*["']?([^"')]*)["']?\s*\)/g)]
        .map((m) => m[1].trim());
    } else {
      continue;
    }
    for (const ref of refs) {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(ref)) continue;
      const clean = ref.split(/[?#]/)[0];
      if (clean === '') continue;
      if (!shipped.has(path.resolve(path.dirname(file), clean))) {
        dangling.push(`${toPosix(path.relative(distDir, file))} → ${ref}`);
      }
    }
  }
  return dangling;
}

async function readDataJs(distDir) {
  const dataJs = await fs.readFile(path.join(distDir, 'data.js'), 'utf8');
  assert.ok(dataJs.startsWith(DATA_JS_PREFIX), 'data.js assigns window.WIKI_DATA');
  return JSON.parse(dataJs.slice(DATA_JS_PREFIX.length).replace(/;\s*$/, ''));
}

test('buildSkeleton renders the fixture site to distDir', async (t) => {
  const distDir = await tmpDir(t, 'site');
  // A stale page from a previous build must not survive (flow step: rm dist).
  await fs.writeFile(path.join(distDir, 'stale.html'), '<title>stale</title>');

  const { result, exitCode, before } = await capturingExitCode(() =>
    build({ distDir, contentDir: null, warn: noop }));

  // 1) dist/index.html exists and is a real HTML document
  const index = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  assert.match(index, /<title>/);
  // The whitelisted BWIKI footer credit is on every page — and the build is
  // still audit-clean, i.e. the whitelist really is a whitelist.
  assert.ok(index.includes(`href="${BWIKI_CREDIT_URL}"`), 'footer credit href present');
  await assert.rejects(fs.access(path.join(distDir, 'stale.html')), 'stale file removed by rm dist');

  // 2) dist/data.js exists with the search index inlined
  const payload = await readDataJs(distDir);
  assert.equal(payload.items.length, FIXTURE_DATA.items.length);
  assert.equal(
    payload.search.docs.length,
    FIXTURE_DATA.items.length + FIXTURE_DATA.mechanics.length,
    'search index inlined (one doc per item + mechanic)',
  );

  // 3) returned page count = rendered pages + data.js (assets are not pages)
  assert.ok(Number.isInteger(result.pages) && result.pages >= 1, `expected pages >= 1, got ${result.pages}`);
  assert.equal(await countRenderedFiles(distDir), result.pages, 'pages === rendered files in dist');

  // Ruling A: repo-shipped static assets land at the referenced dist paths,
  // byte-identical to assets-src/.
  for (const [src, dest] of EXPECTED_ASSETS) {
    const [from, to] = await Promise.all([
      fs.readFile(path.join(REPO_ASSETS, ...src.split('/'))),
      fs.readFile(path.join(distDir, ...dest.split('/'))),
    ]);
    assert.ok(from.equals(to), `${src} → ${dest}: missing or not byte-identical`);
  }
  // …and only referenced bwiki files were migrated into the repo.
  const bwikiInRepo = (await listFiles(path.join(REPO_ASSETS, 'bwiki')))
    .map((f) => toPosix(path.relative(path.join(REPO_ASSETS, 'bwiki'), f))).sort();
  const bwikiReferenced = EXPECTED_ASSETS.filter(([s]) => s.startsWith('bwiki/'))
    .map(([s]) => s.slice('bwiki/'.length)).sort();
  assert.deepEqual(bwikiInRepo, bwikiReferenced, 'assets-src/bwiki holds exactly the referenced files');

  // A clean build must not mark the process as failed.
  assert.equal(exitCode, before, 'successful build leaves process.exitCode untouched');
});

test('fixture content entry follows the brief Step 4 shape', async () => {
  const entryPath = path.join(REPO_CONTENT, 'items', `${FIXTURE_ITEM_ID}.md`);
  const raw = await fs.readFile(entryPath, 'utf8');
  const { fm, body } = splitFrontmatter(raw);

  // frontmatter: Task 3 CMS-native YAML subset, incl. ≥1 block (multi-line) list
  const blockListKeys = Object.entries(fm).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
  assert.ok(blockListKeys.length >= 1, 'frontmatter must carry a multi-line list field');
  for (const key of blockListKeys) {
    assert.ok(
      new RegExp(`^${key}:[ \\t]*\\r?\\n[ \\t]+-[ \\t]\\S`, 'm').test(raw),
      `"${key}" must be a block list (empty value + indented "- item" lines), not a flow list`,
    );
  }

  // body: [[<another fixture item id>]]
  const wikilinks = [...body.matchAll(/\[\[([^\[\]]+?)\]\]/g)].map((m) => m[1]);
  assert.ok(wikilinks.length >= 1, 'body must reference another fixture item via [[id]]');
  for (const id of wikilinks) {
    assert.notEqual(id, FIXTURE_ITEM_ID, '[[id]] must point at ANOTHER fixture item');
    assert.ok(
      FIXTURE_DATA.items.some((it) => it.id === id || (it.aliases ?? []).includes(id)),
      `[[${id}]] is not a fixture item id/alias`,
    );
  }

  // body: one ```html passthrough fence
  assert.match(body, /```html[ \t]*\r?\n[\s\S]*?\r?\n```/);
});

test('buildSkeleton merges the content/items hand-written layer into item pages', async (t) => {
  const distDir = await tmpDir(t, 'content');

  const result = await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  const page = await fs.readFile(path.join(distDir, 'item', `${FIXTURE_ITEM_ID}.html`), 'utf8');
  assert.match(page, /<h2 class="sec">详解<\/h2>/, 'hand-written body lands in the 详解 section');
  // body [[id]] resolved to an inline link of the other item's page
  const raw = await fs.readFile(path.join(REPO_CONTENT, 'items', `${FIXTURE_ITEM_ID}.md`), 'utf8');
  const { body } = splitFrontmatter(raw);
  for (const [, id] of body.matchAll(/\[\[([^\[\]]+?)\]\]/g)) {
    assert.ok(page.includes(`href="../item/${id}.html"`), `[[${id}]] → ../item/${id}.html`);
  }
  // ```html passthrough fence reached the page verbatim
  const fence = body.match(/```html[ \t]*\r?\n([\s\S]*?)\r?\n```/);
  assert.ok(fence !== null && fence[1].trim() !== '');
  assert.ok(page.includes(fence[1]), 'html fence body is verbatim on the page');
  // frontmatter (incl. the multi-line list) must NOT leak into the body
  const fmBlock = raw.slice(0, raw.indexOf('---', 3) + 3);
  assert.ok(fmBlock.includes('fixture-fm-key'), 'sentinel key is inside the frontmatter block');
  assert.ok(!page.includes(fmBlock), 'raw frontmatter block leaked into the page');
  assert.ok(!page.includes('fixture-fm-key'), 'frontmatter key leaked into the page');
  // every fixture item got its page
  for (const it of FIXTURE_DATA.items) {
    await fs.access(path.join(distDir, 'item', `${it.id}.html`));
  }
  assert.equal(result.pages, await countRenderedFiles(distDir));
});

test('content/mechanics/*.md become mechanic pages (nav 关于本站 → mechanics/install-compat.html)', async (t) => {
  const distDir = await tmpDir(t, 'mechanics');
  await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  // The nav is the hard-coded NAV_ITEMS list in templates.js; its only target
  // outside the fixture data is mechanics/install-compat.html.
  const entryPath = path.join(REPO_CONTENT, 'mechanics', 'install-compat.md');
  const raw = await fs.readFile(entryPath, 'utf8');
  const { fm, body } = splitFrontmatter(raw);
  assert.equal(typeof fm.title, 'string', 'frontmatter title: (Task 3 YAML subset)');
  assert.ok(fm.title.length > 0, 'frontmatter title is non-empty');

  const page = await fs.readFile(path.join(distDir, 'mechanics', 'install-compat.html'), 'utf8');
  assert.ok(page.includes(`<title>${fm.title} · `), 'page title comes from the frontmatter');
  assert.ok(page.includes('<h1 class="page-title">' + fm.title + '</h1>'), 'page-title from the frontmatter');
  assert.ok(page.includes('提取自 content/mechanics/install-compat.md'), 'rendered as a mechanic page');
  // body text and ## sections of the md file are on the page
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
  const firstPara = lines.find((l) => !/^#/.test(l));
  assert.ok(firstPara !== undefined, 'fixture page has body text');
  assert.ok(page.includes(firstPara), 'first paragraph rendered on the page');
  const headings = lines.filter((l) => /^##\s+/.test(l)).map((l) => l.replace(/^##\s+/, ''));
  assert.ok(headings.length >= 1, 'fixture page carries at least one ## section');
  for (const h of headings) assert.ok(page.includes(`>${h}</h2>`), `## ${h} rendered`);

  // FIXTURE_DATA's own mechanic pages are still there, side by side
  for (const m of FIXTURE_DATA.mechanics) {
    await fs.access(path.join(distDir, 'mechanics', `${m.slug}.html`));
  }
  const mechanicsIndex = await fs.readFile(path.join(distDir, 'mechanics.html'), 'utf8');
  assert.ok(mechanicsIndex.includes(`href="mechanics/install-compat.html"`), 'listed on the mechanics index');
});

test('content/mechanics: same-slug file replaces the fixture entry; title falls back h1 → slug', async (t) => {
  const distDir = await tmpDir(t, 'mechanics-override');
  const contentDir = await tmpDir(t, 'mechanics-override-content');
  const dir = path.join(contentDir, 'mechanics');
  await fs.mkdir(dir, { recursive: true });
  const replaced = FIXTURE_DATA.mechanics[0];
  await fs.writeFile(path.join(dir, `${replaced.slug}.md`), '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n'); // no fm title → first h1
  await fs.writeFile(path.join(dir, 'bare.md'), '无标题页正文。\n'); // no fm, no h1 → slug

  await build({ distDir, contentDir, warn: noop });

  const replacedPage = await fs.readFile(path.join(distDir, 'mechanics', `${replaced.slug}.html`), 'utf8');
  assert.match(replacedPage, /<h1 class="page-title">手写替换标题<\/h1>/, 'title from the first h1');
  assert.ok(replacedPage.includes('手写替换正文。'), 'hand-written body on the page');
  assert.ok(!replacedPage.includes('每晚的产出与疲劳运算'), 'fixture source of that slug is replaced, not merged');
  const barePage = await fs.readFile(path.join(distDir, 'mechanics', 'bare.html'), 'utf8');
  assert.match(barePage, /<h1 class="page-title">bare<\/h1>/, 'title falls back to the slug');

  // one page per slug: fixture order kept, new slugs appended
  const payload = await readDataJs(distDir);
  const slugs = payload.mechanics.map((m) => m.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'no duplicate slug');
  assert.deepEqual(slugs.slice(0, FIXTURE_DATA.mechanics.length), FIXTURE_DATA.mechanics.map((m) => m.slug));
  assert.deepEqual(slugs.slice(FIXTURE_DATA.mechanics.length), ['bare']);
});

test('declared item icons degrade to the 无图 fallback (dropMissingIcons; no texture source)', async (t) => {
  const distDir = await tmpDir(t, 'icons');
  const warnings = [];
  await build({ distDir, contentDir: null, warn: (m) => warnings.push(m) });

  // every item page: no <img> pointing at an unshipped texture, 无图 shown
  for (const item of FIXTURE_DATA.items) {
    const page = await fs.readFile(path.join(distDir, 'item', `${item.id}.html`), 'utf8');
    assert.doesNotMatch(page, /<img[^>]*\ssrc="[^"]*assets\/items\//, `${item.id}: <img> points at an unshipped texture`);
    assert.match(page, /class="no-icon">无图</, `${item.id}: 无图 fallback rendered`);
  }
  // same degradation everywhere else items are drawn
  for (const rel of ['index.html', 'items.html', ...FIXTURE_DATA.mods.map((m) => `mods/${m.id}.html`)]) {
    const page = await fs.readFile(path.join(distDir, rel), 'utf8');
    assert.doesNotMatch(page, /src="[^"]*assets\/items\//, `${rel}: references an unshipped texture`);
  }
  // data.js ships the degraded icons too (client search draws the same cards)
  const payload = await readDataJs(distDir);
  for (const it of payload.items) assert.equal(it.icon, null, `${it.id}.icon in data.js`);

  // …via the real build's missing-texture path: one drop warning per declared icon
  const declared = FIXTURE_DATA.items.filter((it) => it.icon != null && it.icon !== '');
  assert.ok(declared.length >= 1, 'fixture declares at least one icon');
  const drops = warnings.filter((m) => m.includes('icon dropped'));
  assert.equal(drops.length, declared.length);
  for (const it of declared) {
    assert.ok(drops.some((m) => m.includes(`icon dropped: ${it.icon} (`)), `drop warning for ${it.icon}`);
  }
});

test('dist never references a file it does not ship (html href/src + css url)', async (t) => {
  const distDir = await tmpDir(t, 'dangling');
  await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  const dangling = await findDanglingRefs(distDir);
  assert.deepEqual(dangling, [], 'every relative href/src/url() in dist must resolve to a shipped file');
});

test('dropMissingIcons (migrated): existing icon kept, missing → null, already-null untouched', async (t) => {
  // Required lazily so a missing module fails this test alone instead of
  // taking the whole file down with it.
  const { dropMissingIcons } = require('../tools/build/item-textures.js');

  const modsDir = await tmpDir(t, 'textures');
  await fs.mkdir(path.join(modsDir, 'mod-a', 'Textures', 'Items'), { recursive: true });
  await fs.writeFile(path.join(modsDir, 'mod-a', 'Textures', 'Items', 'real.png'), 'png');
  const warnings = [];
  const items = [
    { id: 'i1', mod: 'modA', icon: 'items/modA/real.png' }, // exists: kept
    { id: 'i2', mod: 'modA', icon: 'items/modA/ghost.png' }, // missing: null
    { id: 'i3', mod: 'modZ', icon: 'items/modZ/real.png' }, // no dir mapping: null
    { id: 'i4', mod: 'modA', icon: null }, // already icon-less: untouched
  ];

  const dropped = await dropMissingIcons(items, {
    modsDir,
    modDirs: new Map([['modA', 'mod-a']]),
    warn: (m) => warnings.push(m),
  });

  assert.equal(dropped, 2, 'ghost + unmapped dropped');
  assert.deepEqual(items.map((it) => it.icon), ['items/modA/real.png', null, null, null]);
  assert.equal(warnings.length, 2, 'one warning per dropped icon');
});

test('buildSkeleton throws and sets exitCode 1 when the audit finds an external link', async (t) => {
  const distDir = await tmpDir(t, 'audit');
  const contentDir = await tmpDir(t, 'audit-content');
  await fs.mkdir(path.join(contentDir, 'items'), { recursive: true });
  // A ```html passthrough fence carrying an http src flows verbatim into
  // item/<id>.html — exactly what auditExternalLinks must catch.
  await fs.writeFile(
    path.join(contentDir, 'items', `${FIXTURE_ITEM_ID}.md`),
    [
      '---',
      '---',
      '',
      '```html',
      `<img src="http://evil.example/${FIXTURE_ITEM_ID}.png" alt=""/>`,
      '```',
      '',
    ].join('\n'),
  );

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violation to throw, got ${err}`);
  assert.match(err.message, /\[audit\] FAIL/);
  assert.match(err.message, /src-http/);
  assert.match(err.message, new RegExp(`item/${FIXTURE_ITEM_ID}\\.html`));
  assert.equal(exitCode, 1);
  // Flow: write files → audit. The offending page is on disk (not swallowed).
  await fs.access(path.join(distDir, 'item', `${FIXTURE_ITEM_ID}.html`));
});

test('buildSkeleton throws, sets exitCode 1 and keeps the previous dist when rendering fails', async (t) => {
  const distDir = await tmpDir(t, 'render-fail');
  const contentDir = await tmpDir(t, 'render-fail-content');
  // Ruling C (render → rm dist → write): a sentinel from an earlier build
  // must survive a failed one.
  const sentinel = path.join(distDir, 'sentinel-from-previous-build.html');
  await fs.writeFile(sentinel, '<title>previous build</title>');
  // content/items/<id>.md as a DIRECTORY: fs.readFile → EISDIR, which is
  // neither ENOENT nor ENOTDIR, so renderSite's optional read rethrows.
  await fs.mkdir(path.join(contentDir, 'items', `${FIXTURE_ITEM_ID}.md`), { recursive: true });

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the render failure to throw, got ${err}`);
  assert.equal(err.code, 'EISDIR');
  assert.doesNotMatch(err.message, /\[audit\]/);
  assert.equal(exitCode, 1);
  assert.equal(await fs.readFile(sentinel, 'utf8'), '<title>previous build</title>', 'sentinel survives');
  assert.deepEqual((await fs.readdir(distDir)).sort(), ['sentinel-from-previous-build.html'], 'dist otherwise untouched');
});

test('buildSkeleton throws and sets exitCode 1 when a required asset is missing', async (t) => {
  const distDir = await tmpDir(t, 'asset-missing');
  const assetsDir = await tmpDir(t, 'assets-empty'); // ships nothing

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir: null, assetsDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the missing asset to throw, got ${err}`);
  assert.match(err.message, /required asset missing/);
  assert.equal(exitCode, 1);
});

// ---------------------------------------------------------------------------
// Task 5 C — content/items id lint
//
// CMS contributors may create or rename content/items/<slug>.md. renderSite
// only ever reads content/items/<item.id>.md, so a file named after anything
// else is accepted by the CMS and then silently never renders. The lint turns
// that silent loss into a red build. The legal set is the item ids — aliases
// are not: nothing reads content/items/<alias>.md either.
// ---------------------------------------------------------------------------

test('validateItemContentIds: a file per real item id → no violations; a missing directory has nothing to violate', async (t) => {
  const itemsDir = path.join(await tmpDir(t, 'lint-ok'), 'items');
  await fs.mkdir(itemsDir, { recursive: true });
  for (const it of FIXTURE_DATA.items) {
    await fs.writeFile(path.join(itemsDir, `${it.id}.md`), '---\n---\n\n正文。\n');
  }
  const validIds = FIXTURE_DATA.items.map((it) => it.id);

  assert.deepEqual(await validateItemContentIds(itemsDir, validIds), []);
  assert.deepEqual(
    await validateItemContentIds(path.join(itemsDir, '..', 'no-such-dir'), validIds), [],
    'no content/items directory → no entry files → no violations',
  );
});

test('validateItemContentIds: a file whose name is not a real item id is reported by file name', async (t) => {
  const itemsDir = path.join(await tmpDir(t, 'lint-bad'), 'items');
  await fs.mkdir(itemsDir, { recursive: true });
  const legal = FIXTURE_DATA.items[0];
  const withAlias = FIXTURE_DATA.items.find((it) => (it.aliases ?? []).length > 0);
  assert.ok(withAlias != null, 'fixture has an aliased item (needed for the alias case)');
  const aliasFile = `${withAlias.aliases[0]}.md`;
  // A second real id, without a lower-case twin: on a case-insensitive file
  // system <id>.MD would overwrite <id>.md, so the variant needs its own id.
  const upperCased = FIXTURE_DATA.items.find((it) => it !== legal && it !== withAlias).id;

  await fs.writeFile(path.join(itemsDir, `${legal.id}.md`), 'legal'); // real id → fine
  await fs.writeFile(path.join(itemsDir, 'fake_id.md'), 'nope'); // the brief's fake id
  await fs.writeFile(path.join(itemsDir, aliasFile), 'nope'); // an alias is not an id: render.js reads <id>.md only
  await fs.writeFile(path.join(itemsDir, 'FAKE_UPPER.MD'), 'nope'); // case-variant suffix: nothing reads it on a case-sensitive fs
  await fs.writeFile(path.join(itemsDir, `${upperCased}.MD`), 'nope'); // real id, case-variant suffix: renders on Windows, silently lost on Linux
  await fs.writeFile(path.join(itemsDir, '.DS_Store'), 'ignored'); // not an .md entry file
  await fs.writeFile(path.join(itemsDir, 'notes.txt'), 'ignored');
  await fs.mkdir(path.join(itemsDir, 'drafts')); // a directory is not an entry file either

  const violations = await validateItemContentIds(itemsDir, FIXTURE_DATA.items.map((it) => it.id));

  assert.deepEqual(violations, ['FAKE_UPPER.MD', 'fake_id.md', aliasFile, `${upperCased}.MD`].sort());
  assert.ok(violations.includes('fake_id.md'), 'violations carry the offending file name');
  assert.ok(!violations.includes(`${legal.id}.md`), 'legal files are not reported');
});

test('buildSkeleton throws, sets exitCode 1 and keeps the previous dist when content/items holds a file that is not a real item id', async (t) => {
  const distDir = await tmpDir(t, 'lint-fail');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'lint-fail-content');
  await fs.mkdir(path.join(contentDir, 'items'), { recursive: true });
  // One legal entry (the repo's own fixture entry) next to a slug nobody renders.
  await fs.copyFile(
    path.join(REPO_CONTENT, 'items', `${FIXTURE_ITEM_ID}.md`),
    path.join(contentDir, 'items', `${FIXTURE_ITEM_ID}.md`),
  );
  await fs.writeFile(path.join(contentDir, 'items', 'fake_id.md'), '---\n---\n\n按标题生成的 slug,不是真实物品。\n');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the id lint violation to throw, got ${err}`);
  assert.match(err.message, /fake_id\.md/, 'the offending file is named in the error');
  assert.doesNotMatch(err.message, new RegExp(`\\b${FIXTURE_ITEM_ID}\\b`), 'legal entry files are not listed as violations');
  assert.doesNotMatch(err.message, /\[audit\]/, 'fails at the lint, long before the audit');
  assert.equal(exitCode, 1);
  // Ruling 4(a): the lint is a pre-rm check — the previous dist is untouched.
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched');
});

test('buildSkeleton with contentDir: null has no content/items to lint and builds as before', async (t) => {
  const distDir = await tmpDir(t, 'lint-skip');
  const { exitCode, before, result } = await capturingExitCode(() => build({ distDir, contentDir: null, warn: noop }));

  assert.equal(result.pages, await countRenderedFiles(distDir));
  assert.equal(exitCode, before);
});

// ---------------------------------------------------------------------------
// Task 5 D — rm guard
//
// buildSkeleton removes distDir recursively. `buildSkeleton({ distDir: '.' })`
// run from the repo root would wipe the repo. The judgement is a pure function
// so the tests never hand the REAL repo root (nor any of its real ancestors)
// to buildSkeleton: a stand-in tree inside a temp dir plays the repo.
// ---------------------------------------------------------------------------

test('isUnsafeDistDir: the repo root and its ancestors are refused; subdirectories and unrelated dirs are allowed', async (t) => {
  const tmp = await tmpDir(t, 'rm-guard');
  const repoRoot = path.join(tmp, 'repo'); // stand-in repo root (never created, never removed)
  const parent = path.dirname(repoRoot);
  const cases = [
    [repoRoot, true, 'the repo root itself'],
    [path.join(repoRoot, 'dist', '..'), true, 'a path that normalizes back to the repo root'],
    [`${repoRoot}${path.sep}`, true, 'trailing separator'],
    [parent, true, 'parent of the repo root'],
    [path.dirname(parent), true, 'grandparent of the repo root'],
    [path.parse(repoRoot).root, true, 'filesystem root'],
    [path.join(repoRoot, 'dist'), false, 'ordinary subdirectory'],
    [path.join(repoRoot, 'out', 'nested', 'deeper'), false, 'nested subdirectory'],
    [path.join(parent, 'dist'), false, 'sibling directory'],
    [path.join(parent, `${path.basename(repoRoot)}-copy`), false, "sibling whose name extends the repo's"],
  ];
  for (const [distDir, expected, what] of cases) {
    assert.equal(isUnsafeDistDir(distDir, repoRoot), expected, what);
  }
  assert.equal(isUnsafeDistDir(await tmpDir(t, 'rm-guard-unrelated'), repoRoot), false, 'an unrelated temp dir');

  if (process.platform === 'win32') {
    assert.equal(isUnsafeDistDir(repoRoot.toUpperCase(), repoRoot), true, 'win32 paths compare case-insensitively');
  }
});

test('isUnsafeDistDir: "." (and "", "..") from inside the repo resolve against cwd and are refused too', async (t) => {
  const cwd = process.cwd();
  const repoRoot = path.join(await tmpDir(t, 'rm-guard-cwd'), 'repo');
  await fs.mkdir(repoRoot);
  process.chdir(repoRoot);
  try {
    assert.equal(isUnsafeDistDir('.', repoRoot), true, '"." from the repo root is the repo root');
    assert.equal(isUnsafeDistDir('', repoRoot), true, '"" resolves to cwd as well');
    assert.equal(isUnsafeDistDir('..', repoRoot), true, '".." from the repo root is its parent');
    assert.equal(isUnsafeDistDir('dist', repoRoot), false, 'a relative subdirectory is fine');
  } finally {
    process.chdir(cwd); // before tmpDir's cleanup: cwd must not sit inside the dir being removed
  }
});

test('buildSkeleton refuses a distDir that is the repo root or one of its ancestors, before touching anything', async (t) => {
  // A throwaway copy of the build's own inputs stands in for the repo: the
  // copy's tools/build/skeleton-build.js computes ITS repo root from ITS own
  // location, so the guard fires on the copy — the real repo root is never
  // passed to buildSkeleton (ruling 3). Worst case if the guard were broken:
  // a temp dir gets emptied.
  const copyRoot = await tmpDir(t, 'rm-guard-wiring');
  const standIn = path.join(copyRoot, 'repo');
  for (const dir of ['tools', 'data', 'assets-src', 'content']) {
    await fs.cp(path.join(REPO_ROOT, dir), path.join(standIn, dir), { recursive: true });
  }
  await fs.writeFile(path.join(standIn, 'package.json'), '{ "version": "0.0.0" }\n');
  const { buildSkeleton: buildStandIn } = require(path.join(standIn, 'tools', 'build', 'skeleton-build.js'));
  const before = await snapshotTree(standIn);
  const parentBefore = (await fs.readdir(copyRoot)).sort();

  for (const [target, what] of [[standIn, 'the repo root'], [copyRoot, 'its parent directory']]) {
    const { err, exitCode } = await capturingExitCode(() =>
      buildStandIn({ distDir: target, contentDir: null, warn: noop }));

    assert.ok(err instanceof Error, `expected buildSkeleton to refuse ${what}, got ${err}`);
    assert.match(err.message, /refus/i);
    assert.equal(exitCode, 1, `exitCode after refusing ${what}`);
  }

  assert.deepEqual(await snapshotTree(standIn), before, 'nothing inside the repo was removed');
  assert.deepEqual((await fs.readdir(copyRoot)).sort(), parentBefore, 'nothing inside its parent was removed');
});

// ---------------------------------------------------------------------------
// Task 5 F — the previous dist survives every failure that can be spotted up
// front, and copyAssets names the real cause of a failure.
//   (4a) a missing asset source is known before anything renders: check it
//        before rm dist, not after the previous dist is already gone
//   (4b) "required asset missing" is only said when the source really is
//        missing; permission/disk/target failures propagate unchanged
// ---------------------------------------------------------------------------

test('buildSkeleton keeps the previous dist when a required asset source is missing — every one of the 7 sources, checked before rm dist', async (t) => {
  const base = await tmpDir(t, 'asset-precheck');
  let i = 0;
  for (const [src, dest] of EXPECTED_ASSETS) {
    const distDir = path.join(base, `dist-${i}`);
    const assetsDir = path.join(base, `assets-${i}`);
    i += 1;
    await fs.mkdir(distDir);
    await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
    const before = await snapshotTree(distDir);
    await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
    await fs.rm(path.join(assetsDir, ...src.split('/'))); // exactly one source gone

    const { err, exitCode } = await capturingExitCode(() =>
      build({ distDir, contentDir: null, assetsDir, warn: noop }));

    assert.ok(err instanceof Error, `${src}: expected the missing source to throw, got ${err}`);
    assert.match(err.message, /required asset missing/, `${src}: attributed as a missing source`);
    assert.ok(err.message.includes(dest), `${src}: the error names the asset (${dest})`);
    assert.equal(exitCode, 1, `${src}: exitCode`);
    assert.deepEqual(await snapshotTree(distDir), before, `${src}: previous dist untouched`);
  }
});

test('copyAssets says "required asset missing" only for a genuinely missing source; any other copy failure propagates unchanged', async (t) => {
  const distDir = await tmpDir(t, 'asset-other-failure');
  const assetsDir = await tmpDir(t, 'assets-dir-instead-of-file');
  await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
  // The source path exists (so an existence check passes) but is not a
  // regular file: copying it fails for a reason other than "missing".
  await fs.rm(path.join(assetsDir, 'theme.css'));
  await fs.mkdir(path.join(assetsDir, 'theme.css'));

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir: null, assetsDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the copy failure to throw, got ${err}`);
  assert.doesNotMatch(err.message, /required asset missing/, 'a failure whose source is present must not be labelled "missing"');
  // EISDIR on POSIX, EPERM (ERROR_ACCESS_DENIED) on Windows — the original
  // code either way, on the original error object (not wrapped).
  assert.ok(['EISDIR', 'EPERM', 'EACCES'].includes(err.code), `original error code kept, got ${err.code}`);
  assert.equal(err.cause, undefined, 'rethrown as is, not wrapped');
  assert.equal(exitCode, 1);
});

// ---------------------------------------------------------------------------
// Task 5 E — admin/ injection
//
// The CMS shell under admin/ is online-only by design (OAuth callbacks, and
// the vendored bundle talks to the network), while dist must stay
// double-clickable via file://. So admin/ is copied into dist AFTER the
// external-link audit — never before — and the offline zip leaves it out
// (tests/pack.test.js). A missing adminDir is not an error: the repo ships
// without admin/ until Task 6 creates it.
// ---------------------------------------------------------------------------

test('buildSkeleton injects adminDir into dist/admin after the audit — an external link there must not fail the build', async (t) => {
  const distDir = await tmpDir(t, 'admin');
  const adminDir = await tmpDir(t, 'admin-src');
  const shell = '<!doctype html>\n<a href="https://example.com/login">sign in</a>\n';
  await fs.writeFile(path.join(adminDir, 'index.html'), shell);
  await fs.writeFile(path.join(adminDir, 'config.yml'), 'backend: { name: github }\n');
  await fs.mkdir(path.join(adminDir, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(adminDir, 'vendor', 'cms.js'), '// vendored bundle\n');

  // What the audit says about that tree on its own — i.e. what would happen
  // to the build if admin/ were ever copied in before the audit ran.
  const standalone = await auditExternalLinks(adminDir);
  assert.deepEqual(standalone.map((v) => `${v.file}:${v.code}`), ['index.html:href-http']);

  const { exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: REPO_CONTENT, adminDir, warn: noop }));

  assert.equal(exitCode, before, 'the build passes: dist/admin did not exist yet when the audit ran');
  assert.equal(await fs.readFile(path.join(distDir, 'admin', 'index.html'), 'utf8'), shell);
  const injected = (await listFiles(path.join(distDir, 'admin')))
    .map((f) => toPosix(path.relative(path.join(distDir, 'admin'), f))).sort();
  assert.deepEqual(injected, ['config.yml', 'index.html', 'vendor/cms.js'], 'the whole tree, nested directories included');
});

test('buildSkeleton skips the admin injection when adminDir does not exist (or is null)', async (t) => {
  const distDir = await tmpDir(t, 'no-admin');
  const adminDir = path.join(await tmpDir(t, 'no-admin-src'), 'admin'); // never created

  for (const [option, what] of [[adminDir, 'a path that does not exist'], [null, 'null']]) {
    const { exitCode, before, result } = await capturingExitCode(() =>
      buildSkeleton({ distDir, contentDir: REPO_CONTENT, adminDir: option, warn: noop }));

    assert.ok(result != null, `${what}: expected the build to pass`);
    assert.equal(exitCode, before, `${what}: a skipped injection is not a failure`);
    await assert.rejects(fs.access(path.join(distDir, 'admin')), `${what}: no dist/admin is created`);
  }
});

test('buildSkeleton fails loudly when adminDir exists but is not a directory (instead of copying a file to dist/admin)', async (t) => {
  const distDir = await tmpDir(t, 'admin-file');
  const adminDir = path.join(await tmpDir(t, 'admin-file-src'), 'admin');
  await fs.writeFile(adminDir, 'not a directory');

  const { err, exitCode } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null, adminDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the non-directory adminDir to throw, got ${err}`);
  assert.match(err.message, /adminDir is not a directory/);
  assert.equal(exitCode, 1);
  await assert.rejects(fs.access(path.join(distDir, 'admin')), 'nothing is copied');
});
