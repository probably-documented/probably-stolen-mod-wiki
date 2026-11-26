'use strict';

// Task 4 tests: fixture-only build pipeline (FIXTURE_DATA → renderSite →
// dist files → repo assets → external-link audit). No game directory, no
// decompile cache — `npm run build` runs this very entry, so the tests drive
// buildSkeleton against tmp directories instead of the real dist/.
//
// Two rules are pinned here on top of the flow itself (controller rulings):
//   A — repo-shipped static assets land at the exact paths the pages reference
//   B — dist never references a file it does not ship (icons degrade to the
//       无图 fallback) — since Task 5b the build itself checks it (step 6)
//
// Task 5 adds (same file: they extend the same build entry):
//   C — an item entry (content/mods/<modId>/items/<物品ID>.md) is only
//       accepted for real item ids (CMS contributors can hand-type any id; a
//       made-up id never renders) — since the per-mod layout one of the
//       checks of tools/build/content-lint.js, run in the same pre-flight
//   D — the recursive rm of distDir only hits a directory inside the repo or
//       inside the temp dir (task 5b D1; the pure function: tests/paths.test.js)
//   E — admin/ is copied into dist AFTER the external-link audit
//   F — failures discoverable up front (id lint, missing asset source) hit
//       before rm dist, so the previous dist survives them
//
// Task 5b adds — the build as a contributor meets it (the CMS will let them
// edit and delete pages):
//   nav_label   — the top-nav 关于本站 entry is declared by a site page
//                 (content/site/<文件名>.md);
//                 delete the page and the entry is gone, the build still passes
//   dangling    — a link to a file dist does not ship fails the build with a
//                 Chinese report naming the file to edit (tests/dangling-refs.test.js
//                 for the check itself)
//   retries     — the rm of dist asks fs.rm for retries (D2)
//
// Task 6b adds — the site is online and written by many contributors: every
// failure one of them can trigger tells them what to do, and the audit sees
// what they can write:
//   audit       — external links are allowed; external resources,
//                 root-relative paths and dangerous HTML (an inline <script>,
//                 an on*= attribute, a javascript: URL …) fail the build with
//                 a Chinese report naming the content file (C1) — or saying
//                 it is a build or template problem when no content file is
//                 behind it (C2). The rules themselves: tests/audit.test.js
//   rm guard    — its refusal is a Chinese BuildError as well (C3)
//   content     — every check of the per-mod content directory
//                 (tools/build/content-lint.js): where a page is filed, what
//                 its front matter says, what a file may be named, …
//   retries     — one policy object, the same pack.js uses (D4)
//   dist        — inside the repo, only the repo's own dist may be removed
//                 (D6; the pure function: tests/paths.test.js)

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildSkeleton, formatAuditViolations, RETRY } = require('../tools/build/skeleton-build.js');
const { findDanglingRefs } = require('../tools/build/dangling-refs.js');
const { lintContent, formatContentIssues } = require('../tools/build/content-lint.js');
const { readContentLayout } = require('../tools/build/content-layout.js');
const { loadWikiData } = require('../tools/build/wiki-data.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');
const { auditExternalLinks, CODES } = require('../tools/build/audit.js');
const { splitFrontmatter } = require('../tools/extract/frontmatter.js');
const { findWideTableRows } = require('../tools/build/wide-tables.js');
const { queryIndex } = require('../tools/build/search-index.js');

/** The footer credit link templates.js writes on every page (templates.js keeps its own copy). */
const BWIKI_CREDIT_URL = 'https://wiki.biligame.com/probablystolen';

const REPO_ROOT = path.join(__dirname, '..');
const REPO_CONTENT = path.join(REPO_ROOT, 'tests', 'fixtures', 'content');
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
  ['js/nav-home.js', 'assets/js/nav-home.js'], // index.html: <script src="assets/js/nav-home.js"> (stage 3, task 2)
  ['js/item-filter.js', 'assets/js/item-filter.js'], // a section's item gallery: <script src="../../assets/js/item-filter.js"> (stage 5, task 4)
  ['bwiki/emblem.jpg', 'assets/bwiki/emblem.jpg'], // layout: .ps-site__emblem <img src>
  ['bwiki/bg.png', 'assets/bwiki/bg.png'], // theme.css: body background url(../assets/bwiki/bg.png)
  ['bwiki/fonts/PSNotoSansSC.woff2', 'assets/fonts/PSNotoSansSC.woff2'], // theme.css @font-face
  ['bwiki/fonts/PSLubrifontSC.woff2', 'assets/fonts/PSLubrifontSC.woff2'], // theme.css @font-face
  ['bwiki/fonts/PSTektur.woff2', 'assets/fonts/PSTektur.woff2'], // theme.css @font-face
];

const noop = () => {};

/** The mod directory every page of the fixture content lives in. */
const FIXTURE_MOD = 'lewd_meme';
/** A mechanic page of a content tree that is laid out like the fixture's. */
const pageIn = (contentDir, slug) => path.join(contentDir, 'mods', FIXTURE_MOD, 'mechanics', `${slug}.md`);
/** An item entry of such a tree. */
const entryIn = (contentDir, id) => path.join(contentDir, 'mods', FIXTURE_MOD, 'items', `${id}.md`);
/** A mechanic page / an item entry of the repo's fixture content. */
const fixturePage = (slug) => pageIn(REPO_CONTENT, slug);
const fixtureEntry = (id) => entryIn(REPO_CONTENT, id);

/**
 * content/mods/<mod>/mechanics/<name>: `mod:` and the given front matter
 * lines between --- markers, then the body — a page the content lint accepts.
 * @returns {Promise<string>} the file
 */
async function writePage(contentDir, name, fmLines, body = '正文。\n', mod = FIXTURE_MOD) {
  const file = path.join(contentDir, 'mods', mod, 'mechanics', name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, ['---', `mod: ${mod}`, ...fmLines, '---', '', body].join('\n'));
  return file;
}

/**
 * content/mods/<mod>/items/<id>.md: an item entry the content lint accepts —
 * it is named after an exported item and says so in `item_id`.
 * @returns {Promise<string>} the file
 */
async function writeItemEntry(contentDir, id, fmLines = [], body = '', mod = FIXTURE_MOD) {
  const file = path.join(contentDir, 'mods', mod, 'items', `${id}.md`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, ['---', `item_id: ${id}`, `mod: ${mod}`, ...fmLines, '---', '', body].join('\n'));
  return file;
}

/**
 * buildSkeleton with the admin injection switched off, for every test that is
 * not about admin/. buildSkeleton's default adminDir is the repo's `admin`
 * (relative to cwd); once Task 6 ships it, tests that did not ask for it must
 * not gain a dist/admin/ (and its extra .html files) behind their back.
 */
const build = (options) => buildSkeleton({ adminDir: null, data: structuredClone(FIXTURE_DATA), ...options });

/** Write FIXTURE_DATA as a data dir (data/mods/*.json + data/wiki.json) under dir. */
async function writeFixtureData(dir) {
  const modsDir = path.join(dir, 'mods');
  await fs.mkdir(modsDir, { recursive: true });
  for (const mod of FIXTURE_DATA.mods) {
    const items = FIXTURE_DATA.items.filter((it) => it.mod === mod.id);
    await fs.writeFile(path.join(modsDir, `${mod.id}.json`),
      JSON.stringify({ ...mod, itemCount: items.length, items }));
  }
  await fs.writeFile(path.join(dir, 'wiki.json'), JSON.stringify({
    baseline: FIXTURE_DATA.baseline,
    facets: FIXTURE_DATA.facets,
    news: FIXTURE_DATA.news,
    changelog: FIXTURE_DATA.changelog,
  }));
}

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
 * top directory's identity (ino) and mtime, plus every file's relative path,
 * size and sha256. Used to prove a failed build left the previous dist
 * untouched. Files are summarised rather than returned as raw bytes on
 * purpose: a failing deepEqual over multi-megabyte Buffers makes node:assert
 * build a per-byte diff that takes minutes and dies with "Array buffer
 * allocation failed" — unreadable, and not the failure we want to see.
 */
async function snapshotTree(dir) {
  const { ino, mtimeMs } = await fs.stat(dir);
  const files = [];
  for (const file of await listFiles(dir)) {
    const bytes = await fs.readFile(file);
    const digest = createHash('sha256').update(bytes).digest('hex');
    files.push(`${toPosix(path.relative(dir, file))}  ${bytes.length} bytes  sha256=${digest}`);
  }
  return { ino, mtimeMs, files };
}

/** Rendered pages + the build's data scripts (i.e. what buildSkeleton's `pages` counts). */
async function countRenderedFiles(distDir) {
  const files = await listFiles(distDir);
  return files.filter((f) => /\.html$/i.test(f) || ['data.js', 'nav-search.js'].includes(toPosix(path.relative(distDir, f)))).length;
}

/**
 * A page's address prefix: one `../` per directory it sits below dist. Counted, not guessed
 * from "is there a slash": a section's galleries sit two directories deep (stage 5).
 */
const relPrefix = (distDir, file) => '../'.repeat(path.relative(distDir, file).split(path.sep).length - 1);

// The dangling-reference check is the build's own (tools/build/dangling-refs.js,
// task 5b B) — these tests reuse it, there is no second implementation here.
// Its own unit tests live in tests/dangling-refs.test.js.

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
  // The BWIKI footer credit — an external link — is on every page, and the
  // build is still audit-clean: since task 6b A1 an external link is allowed
  // and there is no whitelist (tests/audit.test.js pins the rule).
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
  const entryPath = fixtureEntry(FIXTURE_ITEM_ID);
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

test('buildSkeleton merges the item entries (content/mods/<modId>/items/<物品ID>.md) into item pages', async (t) => {
  const distDir = await tmpDir(t, 'content');

  const result = await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  const page = await fs.readFile(path.join(distDir, 'item', `${FIXTURE_ITEM_ID}.html`), 'utf8');
  assert.match(page, /<h2 class="sec">详解<\/h2>/, 'hand-written body lands in the 详解 section');
  // body [[id]] resolved to an inline link of the other item's page
  const raw = await fs.readFile(fixtureEntry(FIXTURE_ITEM_ID), 'utf8');
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

test('the mechanic pages of a mod directory (content/mods/<modId>/mechanics/*.md) become mechanic pages — reached through their mod\'s page, since there is no all-site index any more', async (t) => {
  const distDir = await tmpDir(t, 'mechanics');
  await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  const entryPath = fixturePage('install-compat');
  const raw = await fs.readFile(entryPath, 'utf8');
  const { fm, body } = splitFrontmatter(raw);
  assert.equal(typeof fm.title, 'string', 'frontmatter title: (Task 3 YAML subset)');
  assert.ok(fm.title.length > 0, 'frontmatter title is non-empty');
  assert.equal(fm.nav_label, undefined, 'a mechanic page declares no nav_label (stage 3): 安装与兼容性 is lewd_meme\'s install page, nothing more');

  const page = await fs.readFile(path.join(distDir, 'mechanics', 'install-compat.html'), 'utf8');
  assert.ok(page.includes(`<title>${fm.title} · `), 'page title comes from the frontmatter');
  assert.ok(page.includes('<h1 class="page-title">' + fm.title + '</h1>'), 'page-title from the frontmatter');
  assert.ok(page.includes('提取自 content/mods/lewd_meme/mechanics/install-compat.md'), 'rendered as a mechanic page: the line names the file under its mod');
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
  // …and the all-site index is gone: the page is listed where it belongs, on its mod's own page
  await assert.rejects(fs.access(path.join(distDir, 'mechanics.html')), 'no mechanics.html');
  await assert.rejects(fs.access(path.join(distDir, 'items.html')), 'no items.html');
  const modPage = await fs.readFile(path.join(distDir, 'mods', `${FIXTURE_MOD}.html`), 'utf8');
  assert.ok(modPage.includes('<a href="../mechanics/install-compat.html">安装与兼容性</a>'), 'listed on its mod\'s page, with its title');
  // A6: a mechanic page is not a top-bar destination of its own — nothing is highlighted on it
  assert.equal((page.match(/class="active"/g) || []).length, 0, 'no top-bar entry stands for mechanic pages');
});

// ---------------------------------------------------------------------------
// Stage 3, task 5 — the top-nav about entry is declared by a SITE PAGE
//
// `nav_label` in the front matter of content/site/<文件名>.md makes that page
// the top nav's 关于本站 entry (a mechanic page can no longer declare it). So
// deleting the page — which the CMS lets contributors do — deletes the
// entry: the build passes, nothing is left pointing at the removed page.
// More than one page declaring a label is the one thing that cannot be
// rendered unambiguously — the build goes red and names the pages.
// ---------------------------------------------------------------------------

/** A site page of a content tree that is laid out like the fixture's. */
const siteIn = (contentDir, slug) => path.join(contentDir, 'site', `${slug}.md`);
/** The fixture's own site page, which declares 关于本站. */
const fixtureSitePage = (slug) => siteIn(REPO_CONTENT, slug);

/** content/site/<name>: the given front matter lines between --- markers, then the body. */
async function writeSitePage(contentDir, name, fmLines, body = '正文。\n') {
  const file = siteIn(contentDir, name.replace(/\.md$/, ''));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, ['---', ...fmLines, '---', '', body].join('\n'));
  return file;
}

test('A1 — the 关于本站 a site page declares is the last entry of both nav spots on every page, linking at site/<slug>.html; on its own page it is the highlighted entry', async (t) => {
  const distDir = await tmpDir(t, 'about');
  await build({ distDir, contentDir: REPO_CONTENT, warn: noop });

  // The about entry is no hard-coded NAV_ITEMS row: it exists because
  // tests/fixtures/content/site/about.md declares `nav_label: 关于本站`.
  assert.equal(splitFrontmatter(await fs.readFile(fixtureSitePage('about'), 'utf8')).fm.nav_label, '关于本站');
  const page = await fs.readFile(path.join(distDir, 'site', 'about.html'), 'utf8');
  assert.ok(page.includes('<h1 class="page-title">关于本站</h1>'), 'the site page is rendered');
  for (const file of (await listFiles(distDir)).filter((f) => /\.html$/i.test(f))) {
    const html = await fs.readFile(file, 'utf8');
    const prefix = relPrefix(distDir, file);
    for (const spot of ['menu-row', 'ps-site__links']) {
      const inner = html.split(`class="${spot}"`)[1].split('</div>')[0];
      // The entry is highlighted on the page it leads to (checked right below), plain everywhere else.
      const last = inner.slice(inner.lastIndexOf('<a ')).replace(' class="active"', '');
      assert.equal(last, `<a href="${prefix}site/about.html">关于本站</a>`,
        `${toPosix(path.relative(distDir, file))} ${spot}: ends with the about entry`);
    }
  }
  // A6: on the about page itself that entry is the highlighted one, in both spots, and nothing else is
  for (const spot of ['menu-row', 'ps-site__links']) {
    assert.ok(page.split(`class="${spot}"`)[1].split('</div>')[0].includes(`<a href="../site/about.html" class="active">关于本站</a>`), `${spot}: 关于本站 is active on its own page`);
  }
  assert.equal((page.match(/class="active"/g) || []).length, 2, 'exactly the two nav spots, one active entry each');
  assert.ok(page.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; 关于本站</div>'));
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

test('A2 — 删掉带 nav_label 的站点页面后构建照常通过:顶部导航没有「关于本站」,dist 零悬空引用', async (t) => {
  const distDir = await tmpDir(t, 'nav-none');
  // A copy of the repo's content/ without the about page — what a
  // contributor deleting the page in the CMS ends up with.
  const contentDir = await tmpDir(t, 'nav-none-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.rm(siteIn(contentDir, 'about'));

  const { result, exitCode, before } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(result != null, 'the build passes');
  assert.equal(exitCode, before, 'a build without an about page is not a failure');
  await assert.rejects(fs.access(path.join(distDir, 'site', 'about.html')), 'the page itself is gone');
  assert.equal(await countRenderedFiles(distDir), result.pages);
  for (const file of (await listFiles(distDir)).filter((f) => /\.html$/i.test(f))) {
    const html = await fs.readFile(file, 'utf8');
    assert.ok(!html.includes('关于本站</a>'), `${toPosix(path.relative(distDir, file))}: the nav has no about entry`);
    assert.ok(!html.includes('site/about.html'), `${toPosix(path.relative(distDir, file))}: nothing refers to the deleted page`);
  }
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, [], 'zero dangling references after deleting the page');
});

test('A3 — 多于一个站点页面带 nav_label → 构建失败(exitCode 1),中文报错列出这些页面;上一个 dist 保留', async (t) => {
  const distDir = await tmpDir(t, 'nav-two');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'nav-two-content');
  await writeSitePage(contentDir, 'first.md', ['title: 第一页', 'nav_label: 关于本站']);
  await writeSitePage(contentDir, 'second.md', ['title: 第二页', 'nav_label: 关于本站']);
  await writeSitePage(contentDir, 'third.md', ['title: 第三页', 'nav_label: "  "']); // blank → not set

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the nav_label conflict to throw, got ${err}`);
  assert.equal(exitCode, 1);
  assert.match(err.message, /nav_label/);
  // 中文 + names every offending page by its file
  assert.match(err.message, /[\u4e00-\u9fff]/, 'the message is in Chinese');
  for (const slug of ['first', 'second']) {
    assert.ok(err.message.includes(toPosix(siteIn(contentDir, slug))), `${slug}.md is named`);
  }
  assert.doesNotMatch(err.message, /third/, 'a blank nav_label counts as not set');
  assert.doesNotMatch(err.message, /\[audit\]/, 'fails long before the audit');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (refused before rm dist)');
});

// ---------------------------------------------------------------------------
// Task 5b B — the dangling-reference check is part of the build
//
// Deleting a page is safe when nothing else links at it (A2). When
// something does, the link must not deploy — and the contributor who
// deleted the page (or typed the link) has to learn WHICH file to edit.
// The check runs on what was written (pages + assets), skips the CMS shell
// (admin/, which is not the site's own content), and fails the build with
// a Chinese, file-naming report.
// ---------------------------------------------------------------------------

/** A copy of the repo's content/ with one more line appended to a mechanics page. */
async function contentWithLink(t, label, slug, markdownLink) {
  const contentDir = await tmpDir(t, `${label}-content`);
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.appendFile(pageIn(contentDir, slug), `\n## 相关阅读\n\n${markdownLink}\n`);
  return contentDir;
}

test('B1/B2 — 机制页正文里一个指向不存在页面的链接 → 构建失败(exitCode 1),报错是面向贡献者的中文清单,每行「页面 → 缺失的目标」', async (t) => {
  const distDir = await tmpDir(t, 'links-fail');
  const contentDir = await contentWithLink(t, 'links-fail', 'install-compat', '见 [不存在的页面](no-such-page.html)。');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the dangling link to fail the build, got ${err}`);
  assert.equal(exitCode, 1);
  assert.match(err.message, /^\[links\] FAIL — 1 处链接指向不存在的文件:/, 'the report starts with a count');
  const source = toPosix(pageIn(contentDir, 'install-compat'));
  assert.equal(
    err.message.split('\n')[1],
    `  mechanics/install-compat.html → mechanics/no-such-page.html(编辑 ${source})`,
    'page path → missing target path, and the file the contributor edits',
  );
  const lines = err.message.split('\n');
  assert.match(lines.at(-1), /^提示:/, 'the report ENDS with one actionable hint');
  for (const word of ['删除', '恢复', '修正']) assert.ok(lines.at(-1).includes(word), `the hint mentions ${word}`);
  assert.doesNotMatch(err.message, /\[audit\]/, 'not the external-link audit');
  // Flow: the check runs on what was written — the offending page is on disk.
  await fs.access(path.join(distDir, 'mechanics', 'install-compat.html'));
  await assert.rejects(fs.access(path.join(distDir, 'mechanics', 'no-such-page.html')), '…and the missing target really is missing');
});

test('B2 — 每个悬空引用一行;同一次构建里的所有断链一次报完', async (t) => {
  const distDir = await tmpDir(t, 'links-many');
  const contentDir = await tmpDir(t, 'links-many-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.appendFile(pageIn(contentDir, 'install-compat'), `\n[a](a.html) [b](../b.html) [ok](../mods/${FIXTURE_MOD}.html)\n`);
  await writePage(contentDir, 'other.md', ['title: 另一页'], '[c](c.html)\n');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the dangling links to fail the build, got ${err}`);
  assert.equal(exitCode, 1);
  assert.equal(err.message.split('\n')[0], '[links] FAIL — 3 处链接指向不存在的文件:');
  assert.deepEqual(err.message.split('\n').slice(1, -1), [
    `  mechanics/install-compat.html → mechanics/a.html(编辑 ${toPosix(pageIn(contentDir, 'install-compat'))})`,
    `  mechanics/install-compat.html → b.html(编辑 ${toPosix(pageIn(contentDir, 'install-compat'))})`,
    `  mechanics/other.html → mechanics/c.html(编辑 ${toPosix(pageIn(contentDir, 'other'))})`,
  ]);
});

test('B1 — admin/ 不参与断链检查:CMS 壳里的断链不会让构建失败', async (t) => {
  const distDir = await tmpDir(t, 'links-admin');
  const adminDir = await tmpDir(t, 'links-admin-src');
  await fs.writeFile(path.join(adminDir, 'index.html'), '<a href="missing.html">dangling link inside the shell</a>\n');
  await fs.mkdir(path.join(adminDir, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(adminDir, 'vendor', 'cms.css'), 'a{background:url(../missing.png)}\n');

  const { exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: REPO_CONTENT, adminDir, data: structuredClone(FIXTURE_DATA), warn: noop }));

  assert.equal(exitCode, before, 'the build passes');
  assert.ok((await fs.readFile(path.join(distDir, 'admin', 'index.html'), 'utf8')).includes('missing.html'), 'the shell IS in dist');
  // Asked about this very dist (shell included), the check still reports nothing.
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

test('B2 — the CLI:stderr 是中文清单加提示,提示是最后一行,后面没有堆栈', async (t) => {
  // The real entry point, run with a temp dir as cwd: distDir/contentDir/
  // adminDir default to paths relative to the cwd, so `npm run build` there
  // is exactly what a contributor's failing build looks like.
  const cwd = await tmpDir(t, 'links-cli');
  await fs.cp(REPO_CONTENT, path.join(cwd, 'content'), { recursive: true });
  await fs.appendFile(pageIn(path.join(cwd, 'content'), 'install-compat'), '\n见 [不存在的页面](no-such-page.html)。\n');
  await writeFixtureData(path.join(cwd, 'data'));

  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'build', 'skeleton-build.js')], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 1, `exit code 1\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  assert.match(run.stderr, /\[build:skeleton\] fatal: \[links\] FAIL — 1 处链接指向不存在的文件:/);
  assert.ok(run.stderr.includes('  mechanics/install-compat.html → mechanics/no-such-page.html(编辑 content/mods/lewd_meme/mechanics/install-compat.md)'), run.stderr);
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.match(lines.at(-1), /^提示:/, `the last stderr line is the hint, got: ${lines.at(-1)}`);
  assert.ok(!run.stderr.includes('    at '), `no stack trace after the report:\n${run.stderr}`);
});

test('mechanic pages: a same-slug file replaces the fixture entry; title falls back h1 → slug', async (t) => {
  const distDir = await tmpDir(t, 'mechanics-override');
  const contentDir = await tmpDir(t, 'mechanics-override-content');
  const replaced = FIXTURE_DATA.mechanics[0];
  await writePage(contentDir, `${replaced.slug}.md`, [], '# 手写替换标题\n\n手写替换正文。\n'); // no fm title → first h1
  await writePage(contentDir, 'bare.md', [], '无标题页正文。\n'); // no fm title, no h1 → slug

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

test('an item whose texture is in assets-src/mods/<mod>/Textures/Items/ keeps its icon, and the texture ships under dist/assets/items/<mod>/', async (t) => {
  const distDir = await tmpDir(t, 'icons-kept');
  const result = await build({ distDir, contentDir: null, warn: noop });

  // Declared icons split in two: those with a texture in the repo's mirror of the game's
  // Textures/Items tree, and those without — the fixture keeps a few of the latter on
  // purpose (names the game has no texture for), so the 无图 fallback stays exercised.
  const declared = FIXTURE_DATA.items.filter((it) => it.icon != null && it.icon !== '');
  const inMirror = async (it) => {
    const file = path.join(REPO_ASSETS, 'mods', it.mod, 'Textures', 'Items', it.icon.split('/').pop());
    return fs.access(file).then(() => true, () => false);
  };
  const withTexture = [];
  const withoutTexture = [];
  for (const it of declared) ((await inMirror(it)) ? withTexture : withoutTexture).push(it);
  assert.ok(withTexture.length >= 1, 'the fixture declares at least one icon with a texture');
  assert.ok(withoutTexture.length >= 1, 'the fixture declares at least one icon without a texture');
  assert.equal(result.iconsDropped, withoutTexture.length, 'only the icons without a texture are dropped');

  for (const it of withTexture) {
    // shipped byte for byte, from where the build looks for textures
    const shipped = path.join(distDir, 'assets', ...it.icon.split('/'));
    const source = path.join(REPO_ASSETS, 'mods', it.mod, 'Textures', 'Items', it.icon.split('/').pop());
    const [built, original] = await Promise.all([fs.readFile(shipped), fs.readFile(source)]);
    assert.ok(built.equals(original), `${it.id}: dist/assets/${it.icon} is the texture from assets-src/mods`);

    // the item page points at it
    const page = await fs.readFile(path.join(distDir, 'item', `${it.id}.html`), 'utf8');
    assert.ok(page.includes(`assets/${it.icon}"`), `${it.id}: the page references its texture`);
  }

  // data.js carries the kept icons too (client search draws the same cards)
  const payload = await readDataJs(distDir);
  for (const it of withTexture) {
    assert.equal(payload.items.find((x) => x.id === it.id).icon, it.icon, `${it.id}.icon in data.js`);
  }

  // no texture — or no icon declared at all → still the 无图 fallback
  const bare = FIXTURE_DATA.items.filter((it) => it.icon == null || it.icon === '');
  for (const it of [...withoutTexture, ...bare]) {
    const page = await fs.readFile(path.join(distDir, 'item', `${it.id}.html`), 'utf8');
    assert.match(page, /class="no-icon">无图</, `${it.id}: 无图 fallback rendered`);
  }
});

test('declared item icons degrade to the 无图 fallback (dropMissingIcons; no texture source)', async (t) => {
  const distDir = await tmpDir(t, 'icons');
  // The repo's assets without their textures: nothing for a declared icon to resolve to.
  const assetsDir = await tmpDir(t, 'assets-no-textures');
  await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
  await fs.rm(path.join(assetsDir, 'mods'), { recursive: true, force: true });
  const warnings = [];
  await build({ distDir, contentDir: null, assetsDir, warn: (m) => warnings.push(m) });

  // every item page: no <img> pointing at an unshipped texture, 无图 shown
  for (const item of FIXTURE_DATA.items) {
    const page = await fs.readFile(path.join(distDir, 'item', `${item.id}.html`), 'utf8');
    assert.doesNotMatch(page, /<img[^>]*\ssrc="[^"]*assets\/items\//, `${item.id}: <img> points at an unshipped texture`);
    assert.match(page, /class="no-icon">无图</, `${item.id}: 无图 fallback rendered`);
  }
  // same degradation everywhere else items are drawn (the home page and each mod's own page)
  for (const rel of ['index.html', ...FIXTURE_DATA.mods.map((m) => `mods/${m.id}.html`)]) {
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

// ---------------------------------------------------------------------------
// 阶段 5(分区页与分区级页面)Task 3 — 每个分区自动生成一页机制说明。
// 夹具的分区 content/sections/series.md 列了 lewd_meme,它的机制页是 install-compat。
// ---------------------------------------------------------------------------

test('每个分区自动生成一页机制说明:sections/<slug>/mechanics.html,地址上两级,列的是这个分区的 mod 的机制页,零悬空引用', async (t) => {
  const distDir = await tmpDir(t, 'section-mechanics');
  const { result, exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir: REPO_CONTENT, warn: noop }));
  assert.equal(exitCode, before, err && err.message);

  const html = await fs.readFile(path.join(distDir, 'sections', 'series', 'mechanics.html'), 'utf8');
  assert.ok(html.includes('<title>淫色深空系列 · 机制说明 · '), 'the fixture section, titled by its file');
  assert.ok(html.includes('<a href="../series.html">淫色深空系列</a>'), 'back to the section page, one level up');
  assert.ok(html.includes('<a href="../../mechanics/install-compat.html">安装与兼容性</a>'), "the mechanic page of the section's mod, two levels up");
  assert.ok(html.includes('href="../../css/theme.css"'));
  assert.equal(await countRenderedFiles(distDir), result.pages, 'counted like every other page');
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

// 阶段 5 Task 4 — 每个分区自动生成一页物品图鉴,带筛选。

test('每个分区自动生成一页物品图鉴:sections/<slug>/items.html,卡片地址上两级,筛选脚本随站点发出;资源表里有它;零悬空引用', async (t) => {
  const distDir = await tmpDir(t, 'section-items');
  const { result, exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir: REPO_CONTENT, warn: noop }));
  assert.equal(exitCode, before, err && err.message);

  const html = await fs.readFile(path.join(distDir, 'sections', 'series', 'items.html'), 'utf8');
  assert.ok(html.includes('<title>淫色深空系列 · 物品图鉴 · '), 'the fixture section, titled by its file');
  assert.ok(html.includes('<a href="../series.html">淫色深空系列</a>'), 'back to the section page, one level up');
  assert.ok(/<a class="item-card" data-mod="lewd_meme"[^>]*href="\.\.\/\.\.\/item\/wondrous_milk\.html">/.test(html), "a card of the section's mod, two levels up");
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['../../assets/js/item-filter.js'], 'the filter is the one script of the page');
  assert.ok((await fs.stat(path.join(distDir, 'assets', 'js', 'item-filter.js'))).isFile(), 'and the site ships it');
  assert.equal(await countRenderedFiles(distDir), result.pages, 'counted like every other page');
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

// 阶段 5 Task 5 — 分区的两个概述:写在分区页的深度,显示在深一层的两页上。

test('分区的概述:概述里的图片和站内链接是按分区页的深度写的,到物品图鉴页上地址都上去了,不断链;分区页上不显示', async (t) => {
  const distDir = await tmpDir(t, 'section-intro');
  const contentDir = await tmpDir(t, 'section-intro-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.mkdir(path.join(contentDir, 'sections', 'images'), { recursive: true });
  await fs.writeFile(path.join(contentDir, 'sections', 'images', 'one.png'), PNG_1PX);
  await fs.writeFile(path.join(contentDir, 'sections', 'series.md'), [
    '---', 'title: 淫色深空系列', 'mods:', '  - lewd_meme',
    "items_intro: '一张图 ![图](images/one.png),一个站内链接 [安装](../mechanics/install-compat.html)。'",
    "mechanics_intro: '先读安装说明。'", '---', '', '正文。', '',
  ].join('\n'));

  const { exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));
  assert.equal(exitCode, before, err && err.message);
  const items = await fs.readFile(path.join(distDir, 'sections', 'series', 'items.html'), 'utf8');
  assert.ok(items.includes('<img src="../images/one.png"'), 'the image sits in sections/images/: one level up from here');
  assert.ok(items.includes('<a href="../../mechanics/install-compat.html">安装</a>'), 'a link written for the section page: two levels up from here');
  assert.ok(items.includes('<h2 class="sec">概述</h2>'));
  const mechanics = await fs.readFile(path.join(distDir, 'sections', 'series', 'mechanics.html'), 'utf8');
  assert.ok(mechanics.includes('<h2 class="sec">概述</h2>') && mechanics.includes('先读安装说明。'));
  const page = await fs.readFile(path.join(distDir, 'sections', 'series.html'), 'utf8');
  assert.ok(!page.includes('先读安装说明') && !page.includes('一张图'), 'the section page shows neither');
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

test('概述写错了,报告指向分区文件:一张不存在的图是断链,一个 onclick 是审计违规,页面是分区自己的那一页', async (t) => {
  const contentDir = await tmpDir(t, 'section-intro-bad');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  const file = path.join(contentDir, 'sections', 'series.md');
  const source = toPosix(file);

  await fs.writeFile(file, "---\ntitle: 淫色深空系列\nmods:\n  - lewd_meme\nitems_intro: |-\n  ![没有的图](images/nope.png)\n---\n");
  const brokenDist = await tmpDir(t, 'section-intro-broken');
  const broken = await capturingExitCode(() => build({ distDir: brokenDist, contentDir, warn: noop }));
  assert.equal(broken.exitCode, 1);
  assert.match(broken.err.message, /^\[links\] FAIL/);
  // 从 sections/series/ 出发,../images/nope.png 指向 sections/images/nope.png:提升后的地址,解析出来就是它在站里的位置
  assert.ok(broken.err.message.includes(`sections/series/items.html → sections/images/nope.png(编辑 ${source})`), broken.err.message);

  await fs.writeFile(file, "---\ntitle: 淫色深空系列\nmods:\n  - lewd_meme\nitems_intro: |-\n  ```html\n  <div onclick=\"alert(1)\">点我</div>\n  ```\n---\n");
  const auditedDist = await tmpDir(t, 'section-intro-audited');
  const audited = await capturingExitCode(() => build({ distDir: auditedDist, contentDir, warn: noop }));
  assert.equal(audited.exitCode, 1);
  assert.match(audited.err.message, /^\[audit\] FAIL/);
  assert.ok(audited.err.message.includes(`文件:${source}(生成页面 sections/series/items.html 第`), audited.err.message);
});

test('dist never references a file it does not ship (html href/src + css url) — and the build itself now checks it', async (t) => {
  const distDir = await tmpDir(t, 'dangling');
  // A clean build passing IS the check passing: since task 5b B a dangling
  // reference fails buildSkeleton, so reaching this line means none was found.
  const { exitCode, before } = await capturingExitCode(() => build({ distDir, contentDir: REPO_CONTENT, warn: noop }));
  assert.equal(exitCode, before, 'a site without dangling references builds');

  // B3: the check tells "0 dangling" apart from "0 scanned" — assert a floor.
  const { scanned, dangling } = await findDanglingRefs(distDir);
  assert.deepEqual(dangling, [], 'every relative href/src/url() in dist resolves to a shipped file');
  assert.ok(scanned >= 20, `the check really scanned the site (21 pages + theme.css), got ${scanned}`);
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

test('buildSkeleton throws and sets exitCode 1 when the audit finds an external resource', async (t) => {
  const distDir = await tmpDir(t, 'audit');
  const contentDir = await tmpDir(t, 'audit-content');
  // A ```html passthrough fence carrying an http src flows verbatim into
  // item/<id>.html — exactly what auditExternalLinks must catch.
  await writeItemEntry(contentDir, FIXTURE_ITEM_ID, [], [
    '```html',
    `<img src="http://evil.example/${FIXTURE_ITEM_ID}.png" alt=""/>`,
    '```',
    '',
  ].join('\n'));

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violation to throw, got ${err}`);
  assert.match(err.message, /\[audit\] FAIL/);
  // Since task 6b C1 the report is for a contributor: Chinese, and it quotes
  // the offending tag instead of naming the audit's internal code.
  assert.match(err.message, /不允许加载外部资源/);
  assert.ok(err.message.includes(`<img src="http://evil.example/${FIXTURE_ITEM_ID}.png" alt=""/>`), err.message);
  assert.match(err.message, new RegExp(`item/${FIXTURE_ITEM_ID}\\.html`));
  assert.equal(exitCode, 1);
  // Flow: write files → audit. The offending page is on disk (not swallowed).
  await fs.access(path.join(distDir, 'item', `${FIXTURE_ITEM_ID}.html`));
});

test('buildSkeleton throws, sets exitCode 1 and keeps the previous dist when rendering fails', async (t) => {
  const distDir = await tmpDir(t, 'render-fail');
  // Ruling C (render → rm dist → write): a sentinel from an earlier build
  // must survive a failed one.
  const sentinel = path.join(distDir, 'sentinel-from-previous-build.html');
  await fs.writeFile(sentinel, '<title>previous build</title>');
  // The failure sits in the rendering step: an item whose `related` is not a
  // list (renderItemPage maps it). It used to be an item file that was a
  // directory — EISDIR on read — but the layout lists regular files only, so
  // such an entry never reaches the render any more.
  const data = structuredClone(FIXTURE_DATA);
  data.items[0].related = 'tentacle_body';

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir: null, data, warn: noop }));

  assert.ok(err instanceof Error, `expected the render failure to throw, got ${err}`);
  assert.ok(err instanceof TypeError, `a renderer that cannot make sense of the item: ${err}`);
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
// The content lint (tools/build/content-lint.js) as the build runs it: a
// pre-flight check, before rm dist, whose failure is a BuildError carrying
// the lint's own report. What each check means is pinned by
// tests/content-lint.test.js; what is pinned HERE is the wiring — the build
// fails, says what the lint says, and the previous dist survives it.
// ---------------------------------------------------------------------------

test('a hand-written item entry with no title → the build fails (exitCode 1), names the file, says to fill in the title, and keeps the previous dist', async (t) => {
  const distDir = await tmpDir(t, 'lint-fail');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'lint-fail-content');
  // One legal entry (the repo's own fixture entry) next to an entry that names no exported item
  // and gives its item no title — the one thing a hand-written item has to do.
  const legal = await writeItemEntry(contentDir, FIXTURE_ITEM_ID);
  await fs.copyFile(fixtureEntry(FIXTURE_ITEM_ID), legal);
  const fake = await writeItemEntry(contentDir, 'fake_id', [], '按标题生成的 slug,不是真实物品。\n');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the content lint to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  assert.match(err.message, /^\[content\] FAIL — 发现 1 处问题:/);
  assert.ok(err.message.includes(`  1. 文件:${toPosix(fake)}`), `the offending file, by its real path:\n${err.message}`);
  assert.match(err.message, /没有填标题/);
  assert.match(err.message, /「标题」/, 'says which box to fill in');
  assert.doesNotMatch(err.message, new RegExp(`\\b${FIXTURE_ITEM_ID}\\b`), 'the legal entry is not listed as a violation');
  assert.doesNotMatch(err.message, /\[audit\]/, 'fails at the lint, long before the audit');
  // Ruling 4(a): the lint is a pre-rm check — the previous dist is untouched.
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched');
});

test('a hand-written item entry with a title builds: the item gets a page of its own, with no table of sources', async (t) => {
  const distDir = await tmpDir(t, 'handwritten-ok');
  const contentDir = await tmpDir(t, 'handwritten-ok-content');
  await writeItemEntry(contentDir, 'made_up_thing', ["title: '自己起的名字'"], '一把没人导出过的东西。\n');

  const { result, exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));
  assert.equal(exitCode, before, err && err.message);

  const page = await fs.readFile(path.join(distDir, 'item', 'made_up_thing.html'), 'utf8');
  assert.ok(page.includes('<h1 class="page-title">自己起的名字</h1>'), 'named by its title');
  assert.ok(page.includes('一把没人导出过的东西。'), "the entry's body is the item's 详解");
  assert.ok(!page.includes('数据来源'), 'nothing was taken from the game files');
  assert.ok(!page.includes('适用于 '), 'no data baseline to cite');
  assert.equal(result.pages, await countRenderedFiles(distDir));
});

test('an uploaded icon is published with the item: content/mods/<mod>/images/<文件名> → dist/assets/items/<mod>/<文件名>, and the item shows it', async (t) => {
  const distDir = await tmpDir(t, 'uploaded-icon');
  const contentDir = await tmpDir(t, 'uploaded-icon-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  // The picture the CMS stored and the entry as the CMS wrote it — both read off the lab site.
  const picture = '冒烟-图标-3d8794085559.png';
  await fs.mkdir(path.join(contentDir, 'mods', FIXTURE_MOD, 'images'), { recursive: true });
  await fs.writeFile(path.join(contentDir, 'mods', FIXTURE_MOD, 'images', picture), PNG_1PX);
  await fs.writeFile(entryIn(contentDir, 'smoke-icon-item'),
    `---\nitem_id: smoke-icon-item\nmod: ${FIXTURE_MOD}\ntitle: 冒烟图标物品\nicon: ../images/${picture}\n---\n`);
  const warnings = [];

  const { result, exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, warn: (line) => warnings.push(line) }));
  assert.equal(exitCode, before, err && err.message);

  // …published where item pages look for icons, byte for byte…
  assert.deepEqual(await fs.readFile(path.join(distDir, 'assets', 'items', FIXTURE_MOD, picture)), PNG_1PX);
  // …and beside the pages too, as every picture of a mod is.
  assert.deepEqual(await fs.readFile(path.join(distDir, 'images', picture)), PNG_1PX);
  const page = await fs.readFile(path.join(distDir, 'item', 'smoke-icon-item.html'), 'utf8');
  assert.ok(page.includes(`src="../assets/items/${FIXTURE_MOD}/${picture}"`), 'the item shows its uploaded icon');
  assert.ok(!page.includes('无图'), 'not the placeholder');
  assert.ok(!warnings.some((line) => /icon dropped/.test(line) && line.includes(picture)), 'not taken for a missing texture: its home is not the game files');
  assert.equal(result.uploadedIconsCopied, 1);
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, []);
});

test('an uploaded icon whose picture is gone → the build fails before rm dist, names the entry and the picture, and keeps the previous dist', async (t) => {
  const distDir = await tmpDir(t, 'uploaded-icon-lost');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'uploaded-icon-lost-content');
  await writeItemEntry(contentDir, 'smoke-icon-item', ['title: 冒烟图标物品', 'icon: ../images/gone.png']);

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the content lint to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  assert.match(err.message, /^\[content\] FAIL — 发现 1 处问题:/);
  assert.match(err.message, /gone\.png/, 'names the picture');
  assert.match(err.message, /重新上传/, 'says what to do');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (a pre-flight check, before rm dist)');
});

test('buildSkeleton with contentDir: null has no content to lint and builds as before', async (t) => {
  const distDir = await tmpDir(t, 'lint-skip');
  const { exitCode, before, result } = await capturingExitCode(() => build({ distDir, contentDir: null, warn: noop }));

  assert.equal(result.pages, await countRenderedFiles(distDir));
  assert.equal(exitCode, before);
});

test('the content lint finds problems → the build fails (exitCode 1) with the lint\'s own report, and the previous dist is kept', async (t) => {
  const distDir = await tmpDir(t, 'lint-message');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'lint-message-content');
  const zzz = await writeItemEntry(contentDir, 'zzz_fake', [], '按标题生成的 slug。\n');
  const aaa = await writeItemEntry(contentDir, 'aaa_fake', [], '另一个。\n');
  const legal = await writeItemEntry(contentDir, FIXTURE_ITEM_ID);
  await fs.copyFile(fixtureEntry(FIXTURE_ITEM_ID), legal); // a legal entry next to them: not listed

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the content lint to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError', 'contributor-facing: the CLI prints the message without a stack trace');
  assert.equal(exitCode, 1);
  // The report is the lint's own, to the character: the build adds nothing and reformats nothing.
  const layout = await readContentLayout(contentDir);
  assert.equal(err.message, formatContentIssues(await lintContent({ layout, data: structuredClone(FIXTURE_DATA), handwrittenItems: true })));
  assert.ok(!contentDir.endsWith('content') && toPosix(contentDir) !== 'content', 'sanity: this content dir is NOT the default "content"');
  const lines = err.message.split('\n');
  assert.equal(lines.length, 8, err.message);
  assert.match(lines[0], /^\[content\] FAIL — 发现 2 处问题:$/, 'a heading in Chinese, with the count');
  assert.equal(lines[1], `  1. 文件:${toPosix(aaa)}`, 'the real path, sorted');
  assert.equal(lines[4], `  2. 文件:${toPosix(zzz)}`);
  assert.match(lines[2], /^     问题:.*[\u4e00-\u9fff]/);
  assert.match(lines[3], /^     怎么改:.*[\u4e00-\u9fff]/);
  assert.match(lines[7], /^提示:.*[\u4e00-\u9fff]。$/, 'the report ends with one actionable hint');
  assert.doesNotMatch(err.message, new RegExp(`\\b${FIXTURE_ITEM_ID}\\b`), 'the legal entry file is not listed');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (a pre-flight check, before rm dist)');
});

test('a mechanic page filed under another mod than the one it names (「所属 mod」 changed in the CMS, the file did not move) → the build fails, and the report says which mod it is in', async (t) => {
  const distDir = await tmpDir(t, 'mech-moved');
  const contentDir = await tmpDir(t, 'mech-moved-content');
  // The page sits in lewd_meme_remake's directory but says `mod: lewd_meme` …
  const page = await writePage(contentDir, 'barrel-system.md', ['title: 桶装系统'], '正文。\n', 'lewd_meme_remake');
  await fs.writeFile(page, (await fs.readFile(page, 'utf8')).replace('mod: lewd_meme_remake', 'mod: lewd_meme'));
  // … and lewd_meme is a mod of this content tree too, so the mod it names does exist.
  await writePage(contentDir, 'one.md', []);

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the content lint to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  const lines = err.message.split('\n');
  assert.equal(lines[0], '[content] FAIL — 发现 1 处问题:');
  assert.equal(lines[1], `  1. 文件:${toPosix(page)}`);
  assert.equal(lines[2], '     问题:这一篇机制页写在 lewd_meme_remake 的目录下,但开头的 mod: 写的是 lewd_meme');
  assert.match(lines[3], /^     怎么改:把开头那一行改成 `mod: lewd_meme_remake`。.*新建一篇.*$/);
  assert.match(lines[4], /^提示:/);
  for (const line of lines) assert.ok(hasChinese(line), `in Chinese: ${line}`);
  await assert.rejects(fs.access(path.join(distDir, 'mechanics')), 'nothing was built');
});

test("the repository's own content passes every check of the content lint (and so does the fixture content)", async () => {
  const real = path.join(REPO_ROOT, 'content');
  const issues = await lintContent({ layout: await readContentLayout(real), data: await loadWikiData(path.join(REPO_ROOT, 'data')) });
  assert.deepEqual(issues.map((i) => `${i.code} ${toPosix(path.relative(REPO_ROOT, i.file))}: ${i.problem}`), [],
    'every page says the mod it is filed under; every item entry is an exported item and says its own id');
  assert.deepEqual(await lintContent({ layout: await readContentLayout(REPO_CONTENT), data: structuredClone(FIXTURE_DATA) }), []);
});

test('what the CMS writes passes the build: a mechanic page with an uploaded image, an item entry left blank, a mod with a title only, a redirects.yaml', async (t) => {
  // The four shapes below are the files Sveltia CMS 0.271.0 wrote in the browser smoke test of
  // stage 2b, copied from the virtual repository: every declared field is written, a blank one
  // as an empty string or an empty list; an uploaded image gets a slugified name with a short
  // uuid and is referenced URL-encoded.
  const distDir = await tmpDir(t, 'cms-output');
  const contentDir = await tmpDir(t, 'cms-output-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });

  // Uploaded as 冒烟 图片.PNG in a mechanic page of lewd_meme: stored in the mod's images/.
  const images = path.join(contentDir, 'mods', FIXTURE_MOD, 'images');
  await fs.mkdir(images);
  await fs.writeFile(path.join(images, '冒烟-图片-639ef49482e0.png'), PNG_1PX);
  await fs.writeFile(pageIn(contentDir, 'smoke-mechanic'),
    `---\ntitle: 冒烟测试 机制页\nmod: ${FIXTURE_MOD}\n---\n\n正文。![](../images/%E5%86%92%E7%83%9F-%E5%9B%BE%E7%89%87-639ef49482e0.png)\n`);

  // An item entry saved with nothing typed but the id and the mod.
  await fs.writeFile(entryIn(contentDir, 'tentacle_body'), [
    '---', 'item_id: tentacle_body', `mod: ${FIXTURE_MOD}`, "title: ''", "description: ''", "flavor: ''", "notes: ''",
    'usage: []', 'sources: []', 'related: []', 'categories: []', 'price: null', "icon: ''", 'shape: []', '---', '',
  ].join('\n'));

  // A mod created from a title only; its directory name is the alias set by hand.
  const newMod = path.join(contentDir, 'mods', 'smoke-Mod.X');
  await fs.mkdir(newMod);
  await fs.writeFile(path.join(newMod, '_index.md'), "---\ntitle: 冒烟测试Mod\nsummary: ''\nauthor: ''\nversion: ''\nprerequisites: []\n---\n");

  // A redirects file of a mod this content tree had no folder for yet: plain YAML, no front matter.
  const withRedirects = path.join(contentDir, 'mods', 'lewd_meme_remake');
  await fs.mkdir(withRedirects);
  await fs.writeFile(path.join(withRedirects, 'redirects.yaml'), 'mod: lewd_meme_remake\naliases:\n  - 暗流\nkeywords: []\n');

  // A section page once it has been saved: the relation is the mods' directory names, and the
  // number field that was left alone is written as null (the pages sort it last).
  const sections = path.join(contentDir, 'sections');
  await fs.mkdir(sections, { recursive: true }); // the fixture has a section of its own now
  await fs.writeFile(path.join(sections, 'smoke-section.md'),
    `---\ntitle: 冒烟分区\norder: null\nmods:\n  - ${FIXTURE_MOD}\n  - smoke-Mod.X\n---\n\n分区的介绍正文。\n`);

  // A site page created from its title: the file is named after it, nav_label is written blank.
  // (The fixture's own site/about.md is already there — a site page is a page like any other.)
  await fs.mkdir(path.join(contentDir, 'site'), { recursive: true });
  await fs.writeFile(path.join(contentDir, 'site', '冒烟站点页.md'), "---\ntitle: 冒烟站点页\nnav_label: ''\n---\n\n这是一页不属于任何 mod 的站点页面。\n");

  const { result, exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));
  assert.equal(exitCode, before, err && err.message);
  // …and the content lint, run on its own, has nothing to say about any of them either.
  assert.deepEqual(await lintContent({ layout: await readContentLayout(contentDir), data: structuredClone(FIXTURE_DATA) }), []);

  // The mod's image is published to both places its pages look, and the page keeps the reference as
  // the CMS wrote it — the build finds the file behind the encoded name.
  assert.equal(result.imagesPublished, 2);
  for (const dest of ['images', path.join('mods', 'images')]) {
    assert.deepEqual(await fs.readFile(path.join(distDir, dest, '冒烟-图片-639ef49482e0.png')), PNG_1PX, `${dest}/`);
  }
  const page = await fs.readFile(path.join(distDir, 'mechanics', 'smoke-mechanic.html'), 'utf8');
  assert.ok(page.includes('<img src="../images/%E5%86%92%E7%83%9F-%E5%9B%BE%E7%89%87-639ef49482e0.png"'), 'the reference as written');
  assert.deepEqual((await findDanglingRefs(distDir)).dangling, [], 'nothing dangles: the build itself checked, and so does this');
});

// ---------------------------------------------------------------------------
// Task 5 D → Task 5b D1 — rm guard
//
// buildSkeleton removes distDir recursively. `buildSkeleton({ distDir: '.' })`
// run from the repo root would wipe the repo; since D1 the guard is a
// positive allow-list (tools/build/paths.js isAllowedDistDir: inside the
// repo, or inside the system temp directory — nothing else). The judgement
// is a pure function with its own tests (tests/paths.test.js, string-built
// paths, nothing on disk). What is pinned HERE is the wiring — that
// buildSkeleton really asks it before rm — and it is pinned without ever
// handing the REAL repo root to buildSkeleton: a throwaway copy of the
// build's inputs plays the repo.
// ---------------------------------------------------------------------------

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

  // (D6, task 6b) a directory inside the repo that is not dist is refused too —
  // nothing is created there, the guard decides on the path alone.
  const insideRepo = path.join(standIn, 'content', 'drafts');
  for (const [target, what] of [[standIn, 'the repo root'], [copyRoot, 'its parent directory'], [insideRepo, 'a directory inside the repo that is not dist']]) {
    const { err, exitCode } = await capturingExitCode(() =>
      buildStandIn({ distDir: target, contentDir: null, warn: noop }));

    assert.ok(err instanceof Error, `expected buildSkeleton to refuse ${what}, got ${err}`);
    // C3 (task 6b): the refusal is a BuildError — Chinese, saying what the
    // build does clean, with one hint as its last line.
    assert.equal(err.name, 'BuildError', `${what}: a refusal meant for a human being`);
    assert.match(err.message, /^\[dist\] FAIL — /, `${what}: a heading`);
    assert.ok(err.message.includes(target), `${what}: names the directory it refused`);
    assert.match(err.message, /dist/, `${what}: says what the build does clean`);
    assert.match(err.message, /临时目录/, `${what}: …and what else`);
    const lines = err.message.split('\n');
    assert.match(lines.at(-1), /^提示:/, `${what}: the last line is a hint, got: ${lines.at(-1)}`);
    for (const line of lines) assert.ok(hasChinese(line), `${what}: in Chinese: ${line}`);
    assert.equal(exitCode, 1, `exitCode after refusing ${what}`);
  }

  assert.deepEqual(await snapshotTree(standIn), before, 'nothing inside the repo was removed');
  assert.deepEqual((await fs.readdir(copyRoot)).sort(), parentBefore, 'nothing inside its parent was removed');
});

test('buildSkeleton removes the old dist with fs.rm retries (maxRetries / retryDelay), like the tests\' own cleanup', async (t) => {
  const distDir = await tmpDir(t, 'rm-retries');
  await fs.writeFile(path.join(distDir, 'stale.html'), '<title>stale</title>');
  // fs/promises is one module object: recording what the build hands to
  // fs.rm is the observable part of "it asks for retries". The transient
  // Windows failures themselves (ENOTEMPTY/EBUSY while a handle is still
  // open) cannot be produced deterministically, let alone portably.
  const seen = [];
  const realRm = fs.rm;
  fs.rm = async (p, opts) => { seen.push({ p: path.resolve(p), opts }); return realRm(p, opts); };
  t.after(() => { fs.rm = realRm; });

  await build({ distDir, contentDir: null, warn: noop });

  const rmOfDist = seen.find((call) => call.p === path.resolve(distDir));
  assert.ok(rmOfDist !== undefined, 'fs.rm was called for dist');
  assert.equal(rmOfDist.opts.recursive, true);
  assert.equal(rmOfDist.opts.force, true);
  // D4 (task 6b): to the letter the one retry policy, the same object pack.js uses.
  assert.deepEqual({ ...rmOfDist.opts }, { recursive: true, force: true, ...RETRY },
    `fs.rm(dist, { recursive, force, …RETRY }), got ${JSON.stringify(rmOfDist.opts)}`);
  await assert.rejects(fs.access(path.join(distDir, 'stale.html')), '…and the rm still does its job');
});

// ---------------------------------------------------------------------------
// Task 5 F — the previous dist survives every failure that can be spotted up
// front, and copyAssets names the real cause of a failure.
//   (4a) a missing asset source is known before anything renders: check it
//        before rm dist, not after the previous dist is already gone
//   (4b) "required asset missing" is only said when the source really is
//        missing; permission/disk/target failures propagate unchanged
// ---------------------------------------------------------------------------

test('buildSkeleton keeps the previous dist when a required asset source is missing — every one of the 9 sources, checked before rm dist', async (t) => {
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

test('E5 — "required asset missing" reads the same wherever it is found: the pre-flight and the copy report one source, one dist path, one format', async (t) => {
  const MESSAGE = /^required asset missing: (.+) → (assets\/bwiki\/bg\.png) \(.+\)$/;
  const assetsDir = await tmpDir(t, 'asset-format');
  await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
  const source = path.join(assetsDir, ...'bwiki/bg.png'.split('/'));
  const restore = () => fs.copyFile(path.join(REPO_ASSETS, ...'bwiki/bg.png'.split('/')), source);

  // Found by the pre-flight: the source is gone before anything runs.
  await fs.rm(source);
  const preflightDist = await tmpDir(t, 'asset-format-precheck-dist');
  const preflight = await capturingExitCode(() =>
    build({ distDir: preflightDist, contentDir: null, assetsDir, warn: noop }));
  assert.ok(preflight.err instanceof Error, `expected the missing source to throw, got ${preflight.err}`);
  const preflightMatch = MESSAGE.exec(preflight.err.message);
  assert.ok(preflightMatch !== null, `pre-flight message format, got: ${preflight.err.message}`);
  assert.equal(toPosix(preflightMatch[1]), toPosix(source), 'names the source that is missing');
  assert.equal(preflight.exitCode, 1);

  // Found by the copy: the same source, this time passing the pre-flight
  // and disappearing between then and its turn to be copied.
  await restore();
  const realCopyFile = fs.copyFile;
  let armed = true;
  fs.copyFile = async (src, dest, ...rest) => {
    if (armed && toPosix(String(src)).endsWith('/bwiki/emblem.jpg')) { // copied right before bg.png (ASSET_MAP order)
      armed = false;
      await fs.rm(source);
    }
    return realCopyFile(src, dest, ...rest);
  };
  t.after(() => { fs.copyFile = realCopyFile; });
  const copyDist = await tmpDir(t, 'asset-format-copy-dist');
  const copy = await capturingExitCode(() =>
    build({ distDir: copyDist, contentDir: null, assetsDir, warn: noop }));
  assert.ok(copy.err instanceof Error, `expected the copy-time missing source to throw, got ${copy.err}`);
  assert.equal(armed, false, 'sanity: the source was removed during the copy phase');
  assert.equal(copy.exitCode, 1);
  const copyMatch = MESSAGE.exec(copy.err.message);
  assert.ok(copyMatch !== null, `copy-time message format, got: ${copy.err.message}`);

  // One format: identical up to the underlying error in parentheses.
  assert.equal(copyMatch[1], preflightMatch[1], 'same source');
  assert.equal(copyMatch[2], preflightMatch[2], 'same dist path');
  assert.equal(
    copy.err.message.replace(/\([^)]*\)$/, ''),
    preflight.err.message.replace(/\([^)]*\)$/, ''),
    'the two places build the message the same way',
  );
  assert.notEqual(copy.err.message, preflight.err.message, '…while the underlying error still is the real one (access vs copyfile)');
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

test('buildSkeleton injects adminDir into dist/admin after the audit — an external resource there must not fail the build', async (t) => {
  const distDir = await tmpDir(t, 'admin');
  const adminDir = await tmpDir(t, 'admin-src');
  // An image from outside: still a violation after task 6b A1 (an external
  // <a href> no longer is), and exactly what the online shell is full of.
  const shell = '<!doctype html>\n<a href="https://example.com/login">sign in</a>\n<img src="https://example.com/logo.png" alt=""/>\n';
  await fs.writeFile(path.join(adminDir, 'index.html'), shell);
  await fs.writeFile(path.join(adminDir, 'config.yml'), 'backend: { name: github }\n');
  await fs.mkdir(path.join(adminDir, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(adminDir, 'vendor', 'cms.js'), '// vendored bundle\n');

  // What the audit says about that tree on its own — i.e. what would happen
  // to the build if admin/ were ever copied in before the audit ran.
  const standalone = await auditExternalLinks(adminDir);
  assert.deepEqual(standalone.map((v) => `${v.file}:${v.line} [${v.code}]`), ['index.html:3 [external-url]']);

  const { exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: REPO_CONTENT, adminDir, data: structuredClone(FIXTURE_DATA), warn: noop }));

  assert.equal(exitCode, before, 'the build passes: dist/admin did not exist yet when the audit ran');
  assert.equal(await fs.readFile(path.join(distDir, 'admin', 'index.html'), 'utf8'), shell);
  const injected = (await listFiles(path.join(distDir, 'admin')))
    .map((f) => toPosix(path.relative(path.join(distDir, 'admin'), f))).sort();
  // The shell as it was copied, plus the CMS's own script and catalogs, which the build
  // writes once the shell is in (tools/build/cms-assets.js).
  assert.deepEqual(injected,
    ['admin.js', 'config.yml', 'index.html', 'items-by-mod.json', 'templates.json', 'vendor/cms.js'],
    'the whole tree, nested directories included');
});

test('buildSkeleton skips the admin injection when adminDir does not exist (or is null)', async (t) => {
  const distDir = await tmpDir(t, 'no-admin');
  const adminDir = path.join(await tmpDir(t, 'no-admin-src'), 'admin'); // never created

  for (const [option, what] of [[adminDir, 'a path that does not exist'], [null, 'null']]) {
    const { exitCode, before, result } = await capturingExitCode(() =>
      buildSkeleton({ distDir, contentDir: REPO_CONTENT, adminDir: option, data: structuredClone(FIXTURE_DATA), warn: noop }));

    assert.ok(result != null, `${what}: expected the build to pass`);
    assert.equal(exitCode, before, `${what}: a skipped injection is not a failure`);
    await assert.rejects(fs.access(path.join(distDir, 'admin')), `${what}: no dist/admin is created`);
  }
});

test('buildSkeleton fails loudly when adminDir exists but is not a directory (instead of copying a file to dist/admin)', async (t) => {
  const distDir = await tmpDir(t, 'admin-file');
  // A stand-in for the previous build. Ruling 4(a): a non-directory adminDir
  // is known from one stat, so refusing it must not cost the previous dist.
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const adminDir = path.join(await tmpDir(t, 'admin-file-src'), 'admin');
  await fs.writeFile(adminDir, 'not a directory');

  const { err, exitCode } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null, adminDir, data: structuredClone(FIXTURE_DATA), warn: noop }));

  assert.ok(err instanceof Error, `expected the non-directory adminDir to throw, got ${err}`);
  assert.match(err.message, /adminDir is not a directory/);
  assert.equal(exitCode, 1);
  await assert.rejects(fs.access(path.join(distDir, 'admin')), 'nothing is copied');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (checked before rm dist)');
});

test('buildSkeleton refuses an adminDir inside distDir instead of letting rm dist delete the shell and then "skip" it', async (t) => {
  const distDir = await tmpDir(t, 'admin-inside-dist');
  const adminDir = path.join(distDir, 'admin'); // the CMS shell living inside the output directory
  await fs.mkdir(adminDir);
  await fs.writeFile(path.join(adminDir, 'index.html'), 'shell');

  const { err, exitCode } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null, adminDir, data: structuredClone(FIXTURE_DATA), warn: noop }));

  assert.ok(err instanceof Error, `expected the adminDir-inside-distDir build to be refused, got ${err}`);
  assert.match(err.message, /adminDir .*inside distDir/);
  assert.equal(exitCode, 1);
  // Refused up front: rm dist has not run, the shell is still where it was.
  assert.equal(await fs.readFile(path.join(adminDir, 'index.html'), 'utf8'), 'shell', 'the shell source was not deleted');
});

// ---------------------------------------------------------------------------
// Task 6b C — a failure a contributor can trigger has to tell THEM what to do
//
// The site audit (audit.js, task 6b A) fails the build on what a contributor
// wrote in a ```html block or a link. Its report is Chinese, one entry per
// violation with the four things a non-programmer needs — which file, where
// on the page, what is wrong, what to do — and one actionable hint last. It
// is a BuildError: the CLI prints it as is, with no stack trace after it.
// A violation on something no contributor can edit (a generated page, the
// stylesheet, data.js) fails the build just the same, but says so: that is
// a build or template problem, ask the maintainers (C2).
// ---------------------------------------------------------------------------

/** Every code audit.js can report. A new one needs advice in the report: a problem and a fix. */
test('C1 — 每一种违规 code 都有中文的「问题」与「怎么改」(code 全集取自 audit.js 的导出;那份全集由审计自己的测试对照过实现)', () => {
  assert.ok(CODES.length >= 15, `sanity: the audit exports its codes (${CODES.length})`);
  for (const code of CODES) {
    const report = formatAuditViolations([{ file: 'mechanics/a.html', line: 7, code, detail: '<x>' }], {
      sourceOf: () => 'content/mods/lewd_meme/mechanics/a.md',
    });
    const lines = report.split('\n');
    assert.match(lines[0], /^\[audit\] FAIL — 发现 1 处不允许的写法:$/, code);
    // A file the build could not read is never a content problem (C2), whatever sourceOf says.
    assert.equal(lines[1], code === 'unreadable'
      ? '  1. 文件:(构建生成的)mechanics/a.html 第 7 行附近'
      : '  1. 文件:content/mods/lewd_meme/mechanics/a.md(生成页面 mechanics/a.html 第 7 行附近)', code);
    assert.match(lines[2], /^     问题:[^\n]*[\u4e00-\u9fff]/, `${code}: a problem in Chinese`);
    assert.match(lines[3], /^     怎么改:[^\n]*[\u4e00-\u9fff]/, `${code}: a fix in Chinese`);
    assert.equal(lines.length, 5, code);
    assert.match(lines[4], /^提示:/, code);
  }
});

const hasChinese = (text) => /[\u4e00-\u9fff]/.test(text);

/** A copy of the repo's content/ with extra text appended to one mechanics page. */
async function contentWithAppend(t, label, slug, extra) {
  const contentDir = await tmpDir(t, `${label}-content`);
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.appendFile(pageIn(contentDir, slug), extra);
  return contentDir;
}

test('C1 — 审计失败走 BuildError:中文,逐条「文件 → 页面第几行附近 → 问题 → 怎么改」,末尾一句提示;exitCode 1', async (t) => {
  const distDir = await tmpDir(t, 'audit-report');
  const contentDir = await contentWithAppend(t, 'audit-report', 'install-compat', [
    '',
    '## 外部资源',
    '',
    '```html',
    '<img src="https://example.com/x.png" alt=""/>',
    '```',
    '',
    '[回到首页](/index.html)',
    '',
  ].join('\n'));

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violations to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError', 'contributor-facing: the CLI prints the message without a stack trace');
  assert.equal(exitCode, 1);

  const source = toPosix(pageIn(contentDir, 'install-compat'));
  const lines = err.message.split('\n');
  assert.equal(lines.length, 8, err.message);
  assert.match(lines[0], /^\[audit\] FAIL — 发现 2 处不允许的写法/, 'a heading in Chinese, with the count');
  assert.match(lines[1], new RegExp(`^  1\\. 文件:${source}\\(生成页面 mechanics/install-compat\\.html 第 \\d+ 行附近\\)$`));
  assert.match(lines[2], /^     问题:.*外部.*$/);
  assert.match(lines[3], /^     怎么改:.+$/);
  assert.match(lines[4], new RegExp(`^  2\\. 文件:${source}\\(生成页面 mechanics/install-compat\\.html 第 \\d+ 行附近\\)$`));
  assert.match(lines[5], /^     问题:.*根相对.*$/);
  assert.match(lines[6], /^     怎么改:.+$/);
  assert.match(lines[7], /^提示:.*[\u4e00-\u9fff]。$/, 'the report ENDS with one actionable hint');
  for (const line of lines.slice(1)) assert.ok(hasChinese(line), `in Chinese: ${line}`);

  // "第 N 行附近" really is where it is on the written page.
  const page = (await fs.readFile(path.join(distDir, 'mechanics', 'install-compat.html'), 'utf8')).split('\n');
  const at = [...err.message.matchAll(/第 (\d+) 行附近/g)].map((m) => Number(m[1]));
  assert.equal(at.length, 2);
  assert.ok(at[0] < at[1], 'in page order');
  assert.ok(page[at[0] - 1].includes('src="https://example.com/x.png"'), `line ${at[0]}: ${page[at[0] - 1]}`);
  assert.ok(page[at[1] - 1].includes('href="/index.html"'), `line ${at[1]}: ${page[at[1] - 1]}`);
  // The offending text is quoted, so it can be searched for in the source file.
  assert.ok(err.message.includes('src="https://example.com/x.png"'), 'the offending snippet is in the report');
  // Flow: the audit runs on the written site — the page is on disk.
  await fs.access(path.join(distDir, 'mechanics', 'install-compat.html'));
});

test('C1 — 物品页上的违规指向 content/mods/<modId>/items/<物品ID>.md;一处违规一个条目,同一次构建全部报完', async (t) => {
  const distDir = await tmpDir(t, 'audit-report-items');
  const contentDir = await tmpDir(t, 'audit-report-items-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  await fs.appendFile(entryIn(contentDir, FIXTURE_ITEM_ID), [
    '',
    '```html',
    '<script>alert(1)</script>',
    '<div onclick="alert(2)">点我</div>',
    '<a href="javascript:alert(3)">链接</a>',
    '```',
    '',
  ].join('\n'));

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violations to fail the build, got ${err}`);
  assert.equal(exitCode, 1);
  const source = toPosix(entryIn(contentDir, FIXTURE_ITEM_ID));
  const lines = err.message.split('\n');
  assert.match(lines[0], /^\[audit\] FAIL — 发现 3 处不允许的写法:$/);
  const where = new RegExp(`^  ([123])\\. 文件:${source}\\(生成页面 item/${FIXTURE_ITEM_ID}\\.html 第 (\\d+) 行附近\\)$`);
  const places = lines.slice(1, -1).filter((_, i) => i % 3 === 0).map((line) => where.exec(line));
  assert.ok(places.every((m) => m !== null), `one entry per violation, each naming the item content file:\n${lines.join('\n')}`);
  const at = places.map((m) => Number(m[2]));
  assert.deepEqual(places.map((m) => m[1]), ['1', '2', '3']);
  assert.deepEqual(at, [at[0], at[0] + 1, at[0] + 2], 'the three tags sit on three consecutive lines of the page, in order');
  const problems = lines.slice(1, -1).filter((_, i) => i % 3 === 1);
  assert.match(problems[0], /脚本/);
  assert.match(problems[1], /onclick=/);
  assert.match(problems[2], /javascript:/);
  assert.match(lines.at(-1), /^提示:/);
});

test('C2 — 违规出现在没人能编辑的文件上(样式表):照样失败,但说明这是构建或模板的问题,请联系维护者', async (t) => {
  const distDir = await tmpDir(t, 'audit-report-template');
  const assetsDir = await tmpDir(t, 'audit-report-template-assets');
  await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
  // A stylesheet that pulls a font from outside — nothing a contributor wrote.
  await fs.appendFile(path.join(assetsDir, 'theme.css'), '@import url(https://fonts.example.com/x.css);\n');

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir: REPO_CONTENT, assetsDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violation to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1, 'a template problem fails the build just the same');
  const lines = err.message.split('\n');
  assert.equal(lines.length, 5, err.message);
  assert.match(lines[0], /^\[audit\] FAIL — 发现 1 处不允许的写法:$/);
  const cssLines = (await fs.readFile(path.join(distDir, 'css', 'theme.css'), 'utf8')).split('\n');
  assert.equal(lines[1], `  1. 文件:(构建生成的)css/theme.css 第 ${cssLines.length - 1} 行附近`, '…at the line it is on');
  assert.match(lines[2], /^     问题:.*外部.*$/);
  assert.equal(lines[3], '     怎么改:这不是内容文件里能改的:这是构建或模板的问题,请联系维护者。');
  assert.match(lines[4], /^提示:.*构建或模板的问题.*联系维护者。$/);
  assert.doesNotMatch(err.message, /请打开上面列出的文件/, 'nobody is told to edit a file for this one');
});

test('C2 — 内容与模板同时违规:内容条目给出文件与改法,模板条目说联系维护者;提示两种都说', async (t) => {
  const distDir = await tmpDir(t, 'audit-report-mixed');
  const assetsDir = await tmpDir(t, 'audit-report-mixed-assets');
  await fs.cp(REPO_ASSETS, assetsDir, { recursive: true });
  await fs.appendFile(path.join(assetsDir, 'theme.css'), 'a{background:url(//cdn.example.com/x.png)}\n');
  // One content violation that is no path (a path the site does not ship would
  // be caught earlier, by the dangling-link check) and makes exactly one entry.
  const contentDir = await contentWithAppend(t, 'audit-report-mixed', 'install-compat', '\n```html\n<div onclick="alert(1)">点我</div>\n```\n');

  const { err, exitCode } = await capturingExitCode(() =>
    build({ distDir, contentDir, assetsDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violations to fail the build, got ${err}`);
  assert.equal(exitCode, 1);
  const lines = err.message.split('\n');
  assert.match(lines[0], /^\[audit\] FAIL — 发现 2 处不允许的写法:$/);
  assert.match(lines[1], /^  1\. 文件:\(构建生成的\)css\/theme\.css 第 \d+ 行附近$/);
  assert.equal(lines[3], '     怎么改:这不是内容文件里能改的:这是构建或模板的问题,请联系维护者。');
  const source = toPosix(pageIn(contentDir, 'install-compat'));
  assert.match(lines[4], new RegExp(`^  2\\. 文件:${source}\\(生成页面 mechanics/install-compat\\.html 第 \\d+ 行附近\\)$`));
  assert.match(lines[6], /^     怎么改:(?!这不是内容文件).+$/);
  assert.match(lines[7], /^提示:.*请打开上面列出的文件.*构建或模板的问题.*联系维护者。$/);
});

test('C1 — the CLI:stderr 是中文清单加提示,提示是最后一行,后面没有堆栈', async (t) => {
  // The real entry point, with a temp dir as cwd: distDir / contentDir default
  // to paths relative to the cwd, so `npm run build` there is what a
  // contributor's failing build looks like.
  const cwd = await tmpDir(t, 'audit-cli');
  await fs.cp(REPO_CONTENT, path.join(cwd, 'content'), { recursive: true });
  await fs.appendFile(pageIn(path.join(cwd, 'content'), 'install-compat'), '\n```html\n<script>alert(1)</script>\n```\n');
  await writeFixtureData(path.join(cwd, 'data'));

  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'build', 'skeleton-build.js')], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 1, `exit code 1\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  assert.match(run.stderr, /fatal: \[audit\] FAIL — 发现 1 处不允许的写法/);
  assert.ok(run.stderr.includes('文件:content/mods/lewd_meme/mechanics/install-compat.md(生成页面 mechanics/install-compat.html 第'), run.stderr);
  assert.ok(run.stderr.includes('     问题:') && run.stderr.includes('     怎么改:'), run.stderr);
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.match(lines.at(-1), /^提示:/, `the last stderr line is the hint, got: ${lines.at(-1)}`);
  assert.ok(!run.stderr.includes('    at '), `no stack trace after the report:\n${run.stderr}`);
});

test('C1 — 读不出来的文件:不是内容文件能改的——不写行号,按构建问题处理', () => {
  const report = formatAuditViolations([{ file: 'x.html', line: 0, code: 'unreadable', detail: 'EACCES: permission denied' }], { sourceOf: () => 'content/mods/lewd_meme/mechanics/x.md' });
  assert.equal(report.split('\n')[1], '  1. 文件:(构建生成的)x.html');
  assert.equal(report.split('\n')[3], '     怎么改:这不是内容文件里能改的:这是构建或模板的问题,请联系维护者。');
});

test('C3 — the CLI:rm guard 的拒绝也是中文,提示是 stderr 的最后一行,后面没有堆栈', async (t) => {
  // The guard is decided on paths alone, and the CLI takes no output-directory
  // argument: its default is `dist`, relative to the cwd. So the one way a
  // real `node tools/build/skeleton-build.js` runs into the guard is a cwd
  // whose `dist` directory contains the repo. A throwaway copy of the build's
  // inputs plays the repo, placed inside a directory called dist — the real
  // repo root is never passed to buildSkeleton.
  const outer = await tmpDir(t, 'rm-guard-cli');
  const standIn = path.join(outer, 'dist', 'repo');
  for (const dir of ['tools', 'data', 'assets-src']) {
    await fs.cp(path.join(REPO_ROOT, dir), path.join(standIn, dir), { recursive: true });
  }
  await fs.writeFile(path.join(standIn, 'package.json'), '{ "version": "0.0.0" }\n');
  const before = await snapshotTree(standIn);

  const run = spawnSync(process.execPath, [path.join(standIn, 'tools', 'build', 'skeleton-build.js')], {
    cwd: outer, encoding: 'utf8',
  });

  assert.equal(run.status, 1, `exit code 1\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  assert.match(run.stderr, /fatal: \[dist\] FAIL — /, run.stderr);
  assert.ok(run.stderr.includes(path.join(outer, 'dist')), 'names the directory it refused');
  assert.match(run.stderr, /临时目录/, 'says what else the build does clean');
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.match(lines.at(-1), /^提示:/, `the last stderr line is the hint, got: ${lines.at(-1)}`);
  for (const line of lines.filter((l) => l.includes('[dist]') || /^(构建|提示)/.test(l))) {
    assert.ok(hasChinese(line), `in Chinese: ${line}`);
  }
  assert.ok(!run.stderr.includes('    at '), `no stack trace after the report:\n${run.stderr}`);
  assert.deepEqual(await snapshotTree(standIn), before, 'nothing inside the repo copy was removed');
});

test("the content lint's CLI: a page with a space in its file name → exit 1, stderr is the Chinese report, its hint is the last line, and no stack trace follows", async (t) => {
  // The real entry point, with a temp dir as cwd: content/ defaults to the
  // cwd's, so `npm run build` there is what a contributor's failing build looks like.
  const cwd = await tmpDir(t, 'content-lint-cli');
  const content = path.join(cwd, 'content');
  await fs.cp(REPO_CONTENT, content, { recursive: true });
  // Named after its title, with a space in it — what a contributor can end up with in the CMS.
  await fs.rename(pageIn(content, 'install-compat'), path.join(content, 'mods', FIXTURE_MOD, 'mechanics', '安装 指南.md'));
  await writeFixtureData(path.join(cwd, 'data'));

  const run = spawnSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'build', 'skeleton-build.js')], { cwd, encoding: 'utf8' });
  assert.equal(run.status, 1, `exit code 1\n--- stderr ---\n${run.stderr}\n--- stdout ---\n${run.stdout}`);
  assert.match(run.stderr, /fatal: \[content\] FAIL — 发现 1 处问题:/);
  assert.ok(run.stderr.includes('  1. 文件:content/mods/lewd_meme/mechanics/安装 指南.md'), run.stderr);
  assert.ok(run.stderr.includes('文件名「安装 指南」不合规'), run.stderr);
  const lines = run.stderr.trim().split(/\r?\n/);
  assert.equal(lines.at(-1), '提示:在文件里找不到上面说的内容时,请联系维护者。改好之前,网站不会更新。', `the last stderr line is the hint, got: ${lines.at(-1)}`);
  assert.ok(!run.stderr.includes('    at '), `no stack trace after the report:\n${run.stderr}`);
});

// ---------------------------------------------------------------------------
// Images of a mod (task 10b, the per-mod layout). The CMS stores an image an
// editor inserts in the mod's own images/ folder —
// content/mods/<modId>/images/ — and a page references it relative to the
// file: `![alt](../images/file.png)` from a mechanic page or an item entry
// (both sit one level deeper than the folder). The build publishes the folder
// to dist/images/ and dist/mods/images/, so the same relative reference works
// online and from file://.
// ---------------------------------------------------------------------------

/** A 1×1 transparent PNG. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

/** The repo's content/ with two images in the mod's own images/ folder: one referenced from a mechanic page, one from an item entry. */
async function contentWithImages(t) {
  const contentDir = await tmpDir(t, 'content-images');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  const images = path.join(contentDir, 'mods', FIXTURE_MOD, 'images');
  await fs.mkdir(images);
  await fs.writeFile(path.join(images, 'loop.png'), PNG_1PX);
  await fs.writeFile(path.join(images, 'usage.png'), PNG_1PX);
  // Both pages sit one level deep (mechanics/<slug>.html, item/<id>.html), so the file is ../images/… from them.
  await fs.appendFile(pageIn(contentDir, 'install-compat'), '\n\n![吞噬循环](../images/loop.png)\n');
  await fs.appendFile(entryIn(contentDir, FIXTURE_ITEM_ID), '\n\n![用法](../images/usage.png)\n');
  return contentDir;
}

test("an image of a mod is published with its pages: mods/<mod>/images/x.png → dist/images/ and dist/mods/images/, and the pages reference ../images/x.png", async (t) => {
  const distDir = await tmpDir(t, 'content-images-dist');
  const contentDir = await contentWithImages(t);
  const result = await build({ distDir, contentDir, warn: noop });

  assert.equal(result.imagesPublished, 4, 'two images, two places each');
  for (const [file, alt, route, pageName] of [
    ['loop.png', '吞噬循环', 'mechanics', 'install-compat'],
    ['usage.png', '用法', 'item', FIXTURE_ITEM_ID],
  ]) {
    for (const dest of ['images', 'mods/images']) {
      const published = path.join(distDir, ...dest.split('/'), file);
      assert.deepEqual(await fs.readFile(published), PNG_1PX, `${dest}/${file} is published byte for byte`);
    }
    const page = await fs.readFile(path.join(distDir, route, `${pageName}.html`), 'utf8');
    assert.ok(page.includes(`<img src="../images/${file}" alt="${alt}">`), `${pageName}.html references the image relative to the page`);
  }
});

test('an image that is not a bitmap (an SVG can hold a script) → the build fails before rm dist, names each file, and says which formats are fine', async (t) => {
  const distDir = await tmpDir(t, 'content-images-fail');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await contentWithImages(t);
  await fs.writeFile(
    path.join(contentDir, 'mods', FIXTURE_MOD, 'images', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  await fs.writeFile(path.join(contentDir, 'mods', FIXTURE_MOD, 'images', 'diagram.SVG'), '<svg/>');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the image format check to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  const lines = err.message.split('\n');
  assert.equal(lines.length, 4, err.message);
  assert.match(lines[0], /^\[images\] FAIL — 2 个图片文件不是支持的格式:$/, 'a heading in Chinese, with the count');
  assert.deepEqual(
    lines.slice(1, -1),
    [
      `  ${toPosix(path.join(contentDir, 'mods', FIXTURE_MOD, 'images', 'diagram.SVG'))}`,
      `  ${toPosix(path.join(contentDir, 'mods', FIXTURE_MOD, 'images', 'logo.svg'))}`,
    ].sort(),
    'one line per file, by its real path, whatever the letter case of the extension',
  );
  assert.match(lines[3], /^提示:/);
  for (const word of ['png', 'webp', 'SVG', 'PNG']) assert.ok(lines[3].includes(word), `the hint says it: ${word}`);
  // The heading and the hint are prose, in Chinese; the two lines between are paths.
  assert.ok(hasChinese(lines[0]) && hasChinese(lines[3]), 'in Chinese');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (a pre-flight check, before rm dist)');
});

// Found in the self-review at the end of task 6b: this report — a failure a
// contributor triggers by filling in 顶部导航上的名字 on a second page — was
// Chinese, named the files and printed no stack, but listed the files AFTER
// its "please keep one" sentence, so the last line on stderr was a path, not
// the hint. Every other contributor-facing report ends with its hint.

test('nav_label 冲突的报告也以提示结尾:标题 → 文件 → 提示(与其余面向贡献者的报告同一格式)', async (t) => {
  const distDir = await tmpDir(t, 'nav-format');
  const contentDir = await tmpDir(t, 'nav-format-content');
  await writeSitePage(contentDir, 'first.md', ['title: 第一页', 'nav_label: 关于本站']);
  await writeSitePage(contentDir, 'second.md', ['title: 第二页', 'nav_label: 关于本站']);

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the nav_label conflict to throw, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  const lines = err.message.split('\n');
  assert.equal(lines.length, 4, err.message);
  assert.match(lines[0], /^\[nav\] FAIL — 2 个站点页面的 nav_label 都是「关于本站」,顶部导航会出现重复的入口\(first、second\)。$/);
  assert.equal(lines[1], `  ${toPosix(siteIn(contentDir, 'first'))}(nav_label: 关于本站)`);
  assert.equal(lines[2], `  ${toPosix(siteIn(contentDir, 'second'))}(nav_label: 关于本站)`);
  assert.match(lines[3], /^提示:.*nav_label.*[\u4e00-\u9fff]。$/, 'the report ENDS with the hint');
});

test('C1 — 违规的是一个 <img>(通常是图片写法生成的):报告说明在文件里要找的是那一段 ![…](…) 写法,而不是生成的标签;别的标签照旧', () => {
  const one = (detail) => formatAuditViolations([{ file: 'mechanics/a.html', line: 7, code: 'external-url', detail }], {
    sourceOf: () => 'content/mods/lewd_meme/mechanics/a.md',
  }).split('\n');

  const image = one('<img src="https://example.com/x.png" alt="图">');
  assert.match(image[2], /^     问题:有一个标签从外部地址\(http:\/\/ 或 https:\/\/ 开头\)加载资源.*本站不允许加载外部资源。页面里是这段\(它通常是用图片写法 !\[替代文字\]\(地址\) 写的:请在文件里找那一段图片写法\):<img src="https:\/\/example\.com\/x\.png" alt="图">$/);
  for (const line of image.slice(1)) assert.ok(hasChinese(line), `in Chinese: ${line}`);

  // …and only for an <img>: any other tag is in the file as the page shows it
  const frame = one('<iframe src="https://example.com/">');
  assert.match(frame[2], /^     问题:.*页面里是这段:<iframe src="https:\/\/example\.com\/">$/);
  assert.ok(!frame[2].includes('图片写法'));
});

// ---------------------------------------------------------------------------
// Reports, after the review of 2c486cd — the "how to fix" line names the
// kind of tag it is talking about
//
// The fix for an outside address said 本站暂不支持插入外部图片 whatever the
// tag was — a script or a stylesheet included. It now depends on the tag.
// And the check for javascript: stays on every attribute (ruling AB d): it
// is what catches <animate values="javascript:…">. Its fix says so.
// ---------------------------------------------------------------------------

const FIX_LINE = 3;

/** The report's "怎么改" line for one violation, as a contributor reads it. */
function fixLine(code, detail) {
  const report = formatAuditViolations([{ file: 'mechanics/a.html', line: 7, code, detail }], {
    sourceOf: () => 'content/mods/lewd_meme/mechanics/a.md',
  });
  return report.split('\n')[FIX_LINE];
}

test('文案 — an outside address: the fix names the kind of thing the tag is — an image, a script, a stylesheet, an embedded page, anything else', () => {
  const image = fixLine('external-url', '<img src="https://evil.example/x.png" alt="">');
  assert.match(image, /^     怎么改:.*图片。.*!\[说明\]\(地址\).*本站暂不支持插入外部图片。$/);
  assert.match(fixLine('external-url', '<img srcset="https://evil.example/x.png 1x" alt="">'), /^     怎么改:.*图片/, 'an <img> by its srcset too');
  assert.match(fixLine('external-url', '<source srcset="https://evil.example/x.png 1x">'), /^     怎么改:.*图片.*音视频/, 'a <source>: an image or a media file');
  assert.match(fixLine('external-url', '<video src="https://evil.example/v.mp4"></video>'), /^     怎么改:.*音视频/, 'a media file');
  assert.match(fixLine('external-url', '<audio src="https://evil.example/a.mp3"></audio>'), /^     怎么改:.*音视频/);

  const script = fixLine('external-url', '<script src="https://evil.example/x.js"></script>');
  assert.match(script, /^     怎么改:.*脚本/, 'a script');
  assert.match(fixLine('external-url', '<link rel="stylesheet" href="https://evil.example/x.css">'), /^     怎么改:.*样式/, 'a stylesheet');

  const embedded = fixLine('external-url', '<iframe src="https://evil.example/"></iframe>');
  assert.match(embedded, /^     怎么改:.*嵌入/, 'an embedded page');
  assert.match(fixLine('external-url', '<object data="https://evil.example/o.svg"></object>'), /^     怎么改:.*嵌入/);
  assert.match(fixLine('external-url', '<embed src="https://evil.example/e.svg">'), /^     怎么改:.*嵌入/);

  const other = fixLine('external-url', '<div data-x="https://evil.example/">x</div>');
  assert.match(other, /^     怎么改:删掉这个标签里以 http:\/\/ 或 https:\/\/ 开头的那一项。想链接到外部网页,请写成普通的链接:\[文字\]\(https:\/\/网址\)。$/);

  // …and "外部图片" is said for an image only
  for (const detail of ['<script src="https://evil.example/x.js"></script>', '<link rel="stylesheet" href="https://evil.example/x.css">',
    '<iframe src="https://evil.example/"></iframe>', '<div data-x="https://evil.example/">x</div>', '<video src="https://evil.example/v.mp4"></video>']) {
    assert.ok(!fixLine('external-url', detail).includes('插入外部图片'), `${detail}: not told about images`);
  }
});

test('ruling AB(d) — a javascript: address: the fix says that an attribute value must not start with javascript:', () => {
  const fix = fixLine('script-url', '<a href="javascript:alert(1)">');
  assert.match(fix, /^     怎么改:属性值不能以 javascript: 开头。.+。$/, fix);
  assert.ok(!fix.includes('链接'), 'it is not only links: any attribute');
  for (const detail of ['<div onclick="x()">t</div>', '<img src="x.png" alt="">', '<a href="https://evil.example/">']) {
    assert.ok(!fixLine('external-url', detail).includes('javascript:'), `${detail}: that is another matter`);
  }
});

test('修复轮 3·文案 — what to do about a <script> is true whether or not the tag closes itself, and is not read off the tail of the snippet', () => {
  // A <script/> closes itself only inside an <svg> or <math>. In HTML it does not: the `/` before `>` is nothing
  // there, and what follows is the script's text up to </script>. The audit reads a <script> by the HTML rules
  // wherever it stands (audit.js, scanHtml; ruling AE 3) — it cannot tell them apart — so one wording says both.
  // It is the same for a tag longer than the 160 characters of a snippet: a `/>` at its end is cut away, so
  // nothing is read off that tail.
  // (Round 2 said of a <script/> that it closes itself and there is no </script>: untrue in HTML, and read off a tail
  // that a long tag loses.)
  const long = `<script type="application/json" data-x="${'a'.repeat(200)}"/>`.slice(0, 160); // as the audit shows it: a snippet is at most 160 characters, and the `/>` at the end of this tag is cut away
  const details = ['<script/>', '<script src="x.js"/>', long, '<script>alert(1)</script>', '<script>alert(1)'];
  const fixes = details.map((detail) => fixLine('script-inline', detail));
  assert.equal(new Set(fixes).size, 1, `one wording for all of them, the long tag included:\n${fixes.join('\n')}`);
  const fix = fixes[0];
  assert.match(fix, /^     怎么改:[^\n]+。$/, fix);
  assert.ok(!fix.includes('后面没有 </script>'), 'it does not say that there is no </script>: in HTML there is one');
  assert.ok(fix.includes('<svg>') && fix.includes('<math>'), 'it says where a <script/> closes itself');
  assert.ok(fix.includes('反引号'), 'and what to do with code that is meant to be shown');
  // …and the advice is still this code's alone
  for (const code of ['external-url', 'script-src', 'inline-event-handler']) {
    assert.ok(!fixLine(code, '<script src="https://evil.example/x.js"></script>').includes('<svg>'), `${code}: that is another matter`);
  }
});

// ---------------------------------------------------------------------------
// 修复轮 4(ruling AE)— a tag that is not on the allow-list: `unsupported-tag`
//
// 直通 HTML 块里只能使用一组常见标签。What a contributor is told names the
// tag — it is read off the snippet the audit shows — and says what may be
// written instead; for the four elements that belong in the <head> it says
// where they belong. The rules themselves: tests/audit.test.js (ruling AE).
// ---------------------------------------------------------------------------

test('修复轮 4·文案 — an unsupported tag: the problem names the tag and says what a ```html block may hold; the fix depends on the tag', () => {
  const one = (detail) => formatAuditViolations([{ file: 'mechanics/a.html', line: 7, code: 'unsupported-tag', detail }], {
    sourceOf: () => 'content/mods/lewd_meme/mechanics/a.md',
  }).split('\n');
  const WHAT = '直通 HTML 块里只能使用一组常见标签(段落、标题、列表、表格、链接、图片、div/span 等);其它标签请改用图片,或联系维护者。';

  const svg = one('<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">');
  // (the problem and the snippet are one line: 问题:…页面里是这段:<the tag>)
  assert.ok(svg[2].startsWith(`     问题:页面正文里出现了不允许的标签 <svg>。${WHAT}页面里是这段:<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">`), svg[2]);
  assert.match(svg[3], /^     怎么改:删掉这个 <svg> 标签和它里面的全部内容\(从 <svg> 到 <\/svg>\)。.*图片写法 !\[替代文字\]\(地址\);.*做成图片,或联系维护者。$/);
  assert.ok(!svg[3].includes('页面头部'), 'an <svg> is not told to be moved into the head');

  // written in capitals: named as the page shows it
  const upper = one('<IFRAME src="https://example.com/">');
  assert.ok(upper[2].startsWith(`     问题:页面正文里出现了不允许的标签 <IFRAME>。${WHAT}`), upper[2]);
  assert.match(upper[3], /^     怎么改:删掉这个 <IFRAME> 标签和它里面的全部内容\(从 <IFRAME> 到 <\/IFRAME>\)。/);
  // the fix says where the tag begins and ends: written as the page shows it
  assert.ok(upper[3].includes('<IFRAME>') && upper[3].includes('</IFRAME>'), upper[3]);

  // the four that belong in the <head>: said so
  for (const name of ['title', 'meta', 'link', 'style']) {
    const lines = one(`<${name} charset="UTF-8">`);
    assert.ok(lines[2].startsWith(`     问题:页面正文里出现了不允许的标签 <${name}>。${WHAT}页面里是这段:<${name} charset="UTF-8">`), `${name}: ${lines[2]}`);
    assert.match(lines[3], new RegExp(`^     怎么改:删掉正文里的这个 <${name}> 标签.*只能由页面模板放在页面头部.*直通 HTML 块里不能写。$`), name);
    assert.ok(!lines[3].includes('图片'), `${name}: not told to make it an image`);
  }

  // a name longer than the 160 characters of a snippet is named as the snippet shows it
  const long = one(`<${'x'.repeat(300)} onclick="alert(1)">`);
  assert.match(long[2], /^     问题:页面正文里出现了不允许的标签 <x+>。/);
  assert.ok(!/onclick/.test(long[2].split('页面里是这段:')[0]), 'the attribute after the cut-off name is not read');

  // no tag to read off the snippet (the entry the C1 test makes for every code): still Chinese, still both sentences
  const none = one('');
  assert.match(none[2], /^     问题:.+[\u4e00-\u9fff]。页面里是这段:$/);
  assert.match(none[3], /^     怎么改:.+[\u4e00-\u9fff]。$/);
});

test('修复轮 4·C1 — 贡献者在直通 HTML 块里写了不允许的标签(<meta> 只能放在页面头部;<svg>、<iframe> 根本不允许):构建失败(exitCode 1),BuildError 的中文报告点名内容文件、页面上的位置和这个标签', async (t) => {
  const cases = [
    // [the tag as written in the ```html block, the 问题 line, the 怎么改 line]
    ['<meta name="author" content="someone">',
      /^     问题:页面正文里出现了不允许的标签 <meta>。直通 HTML 块里只能使用一组常见标签/,
      /^     怎么改:删掉正文里的这个 <meta> 标签.*只能由页面模板放在页面头部.+$/],
    ['<svg width="16" height="16">icon</svg>',
      /^     问题:页面正文里出现了不允许的标签 <svg>。直通 HTML 块里只能使用一组常见标签/,
      /^     怎么改:删掉这个 <svg> 标签和它里面的全部内容\(从 <svg> 到 <\/svg>\)。.+$/],
    ['<iframe src="https://example.com/embed"></iframe>', // two violations of one tag: the tag, and its outside address
      /^     问题:页面正文里出现了不允许的标签 <iframe>。直通 HTML 块里只能使用一组常见标签/,
      /^     怎么改:删掉这个 <iframe> 标签和它里面的全部内容\(从 <iframe> 到 <\/iframe>\)。.+$/],
  ];
  for (const [tag, problem, fix] of cases) {
    const distDir = await tmpDir(t, 'audit-unsupported-tag');
    const contentDir = await contentWithAppend(t, 'audit-unsupported-tag', 'install-compat', `\n\`\`\`html\n${tag}\n\`\`\`\n`);

    const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

    assert.ok(err instanceof Error, `expected the audit violation to fail the build, got ${err}`);
    assert.equal(err.name, 'BuildError', 'contributor-facing: the CLI prints the message without a stack trace');
    assert.equal(exitCode, 1);
    const source = toPosix(pageIn(contentDir, 'install-compat'));
    const lines = err.message.split('\n');
    const entries = tag.startsWith('<iframe') ? 2 : 1;
    assert.equal(lines.length, 3 * entries + 2, `${tag}\n${err.message}`); // a heading, three lines per entry, the hint
    assert.match(lines[0], new RegExp(`^\\[audit\\] FAIL — 发现 ${entries} 处不允许的写法:$`));
    assert.match(lines[1], new RegExp(`^  1\\. 文件:${source}\\(生成页面 mechanics/install-compat\\.html 第 (\\d+) 行附近\\)$`));
    assert.match(lines[2], problem);
    // the snippet is the tag as far as its start tag ends
    assert.ok(lines[2].endsWith(`页面里是这段:${/^<[^>]*>/.exec(tag)[0]}`), lines[2]);
    assert.match(lines[3], fix);
    assert.match(lines.at(-1), /^提示:.*[\u4e00-\u9fff]。$/);
    for (const line of lines.slice(1)) assert.ok(hasChinese(line), `in Chinese: ${line}`);
    // "第 N 行附近" is the line of the page the tag is on
    const at = Number(/第 (\d+) 行附近/.exec(lines[1])[1]);
    const page = (await fs.readFile(path.join(distDir, 'mechanics', 'install-compat.html'), 'utf8')).split('\n');
    assert.ok(page[at - 1].includes(tag), `line ${at}: ${page[at - 1]}`);
  }
});

test('a violation on a page written outside the mods is reported against that file: the home page, a section page, a mod page, a site page', async (t) => {
  const distDir = await tmpDir(t, 'audit-outside-mods');
  const contentDir = await tmpDir(t, 'audit-outside-mods-content');
  await fs.cp(REPO_CONTENT, contentDir, { recursive: true });
  const bad = '\n```html\n<div onclick="alert(1)">点我</div>\n```\n';
  const home = path.join(contentDir, 'home.md');
  const section = path.join(contentDir, 'sections', 'series.md');
  const modPage = path.join(contentDir, 'mods', FIXTURE_MOD, '_index.md');
  const sitePage = siteIn(contentDir, 'about'); // the fixture's own site page, the one that declares 关于本站
  await fs.writeFile(home, `---\ntitle: 首页\n---\n${bad}`);
  await fs.mkdir(path.dirname(section), { recursive: true }); // the fixture has sections/ of its own now
  await fs.writeFile(section, `---\ntitle: 分区\nmods:\n  - ${FIXTURE_MOD}\n---\n${bad}`);
  await fs.writeFile(modPage, `---\ntitle: 甲\n---\n${bad}`);
  await fs.appendFile(sitePage, bad);

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the audit violations to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  assert.match(err.message, /^\[audit\] FAIL — 发现 4 处不允许的写法:/);
  const entries = err.message.split('\n').filter((line) => /^\s+\d+\. 文件:/.test(line));
  for (const [generated, source] of [
    ['index.html', home], [`mods/${FIXTURE_MOD}.html`, modPage], ['sections/series.html', section], ['site/about.html', sitePage],
  ]) {
    assert.ok(entries.some((line) => line.includes(`文件:${toPosix(source)}(生成页面 ${generated} 第`)),
      `${generated} should be reported against its file:\n${err.message}`);
  }
  assert.equal(entries.length, 4, 'one entry per page');
});

test('source shown in a code block is text: the build passes, and neither the audit nor the dangling-reference check reads a link or a script in it', async (t) => {
  const distDir = await tmpDir(t, 'code-block-build');
  const contentDir = await tmpDir(t, 'code-block-content');
  // Two links to pages that do not exist, an external image, fetch( and a
  // <script> tag: every one of them is a build failure outside a code block.
  await writePage(contentDir, 'code-demo.md', ['title: 代码块'], [
    '```xml',
    '<a href="no-such-page.html">已删除的页面</a>',
    '<a href="also-gone.html">另一个不存在的页面</a>',
    '<img src="https://example.com/x.png">',
    'fetch("/api")',
    '<script>alert(1)</script>',
    '```', '',
  ].join('\n'));

  const { exitCode, before } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.equal(exitCode, before, 'the build passes');
  const page = await fs.readFile(path.join(distDir, 'mechanics', 'code-demo.html'), 'utf8');
  assert.ok(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'the source is in the page, escaped');
  assert.ok(page.includes('src="https://example.com/x.png"'), '…as text: the quotes are still there for a regex to find');
  assert.ok(!page.includes('<img src="https://'), 'and not as a real tag');
});

test('a table row wider than its header → the build fails before rm dist, names the file and line, and says what to do', async (t) => {
  const distDir = await tmpDir(t, 'wide-table-fail');
  await fs.writeFile(path.join(distDir, 'sentinel-from-previous-build.html'), '<title>previous build</title>');
  const before = await snapshotTree(distDir);
  const contentDir = await tmpDir(t, 'wide-table-content');
  // four lines of frontmatter (mod, title), a blank, the header, the delimiter — the wide row is line 8
  const page = await writePage(contentDir, 'wide.md', ['title: 宽表'], '| A | B |\n| --- | --- |\n| 1 | 2 |![](../images/x.png)\n');

  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));

  assert.ok(err instanceof Error, `expected the wide-table check to fail the build, got ${err}`);
  assert.equal(err.name, 'BuildError');
  assert.equal(exitCode, 1);
  const lines = err.message.split('\n');
  assert.equal(lines.length, 3, err.message);
  assert.match(lines[0], /^\[table\] FAIL — 1 处表格行比表头多出了单元格:$/, 'a heading in Chinese, with the count');
  assert.equal(lines[1], `  ${toPosix(page)} 第 8 行(表头 2 格,这一行 3 格)`);
  assert.match(lines[2], /^提示:.*单独占一行。$/);
  // Chinese + names the file: the hint tells them to open it
  assert.match(err.message, /[\u4e00-\u9fff]/, 'the message is in Chinese');
  assert.deepEqual(await snapshotTree(distDir), before, 'previous dist untouched (refused before rm dist)');
});

test('the repository\'s own content has no table row wider than its header', async () => {
  assert.deepEqual(await findWideTableRows(await readContentLayout(REPO_CONTENT), REPO_CONTENT), []);
  const real = path.join(REPO_ROOT, 'content');
  assert.deepEqual(await findWideTableRows(await readContentLayout(real), real), [], 'the real content pages too');
});

// ---------------------------------------------------------------------------
// Data files (import plan task 5): data/mods/*.json + data/wiki.json
// ---------------------------------------------------------------------------

/** A tiny data dir: one mod, one item, the global parts in wiki.json. */
async function writeDataDir(t, label) {
  const dir = await tmpDir(t, label);
  await fs.mkdir(path.join(dir, 'mods'));
  await fs.writeFile(path.join(dir, 'mods', 'mod_a.json'), JSON.stringify({
    id: 'mod_a', name: '模组 A', version: '1', author: 'x', prerequisites: [], description: '描述',
    itemCount: 1,
    items: [{
      id: 'data_item', aliases: [], name: '数据物品', mod: 'mod_a', price: 10, shape: [1, 1], icon: null,
      categories: [], tags: [], description: '来自数据', flavor: null, usage: [], sources: [], related: [],
      notes: null, provenance: {},
    }],
  }));
  await fs.writeFile(path.join(dir, 'wiki.json'), JSON.stringify({
    baseline: { date: '2026-11-18', versions: { mod_a: '1' } }, facets: { categories: [] }, news: [], changelog: [],
  }));
  return dir;
}

test('dataDir: 不注入 data 时,构建从 dataDir 的 mod 文件读数据', async (t) => {
  const distDir = await tmpDir(t, 'data-dir');
  const dataDir = await writeDataDir(t, 'data-src');
  const { exitCode, before } = await capturingExitCode(() => build({ distDir, contentDir: null, dataDir, data: null }));

  assert.equal(exitCode, before, 'the build passes');
  const page = await fs.readFile(path.join(distDir, 'item', 'data_item.html'), 'utf8');
  assert.ok(page.includes('数据物品'), 'the item page comes from the data file');
});

test('data: 注入的数据优先于 dataDir（dataDir 指向不存在的目录也不影响）', async (t) => {
  const distDir = await tmpDir(t, 'data-inject');
  const dataDir = path.join(os.tmpdir(), `no-such-data-${Date.now()}`);
  const { exitCode, before } = await capturingExitCode(() =>
    build({ distDir, contentDir: null, data: structuredClone(FIXTURE_DATA), dataDir }));

  assert.equal(exitCode, before, 'the build passes');
  for (const item of FIXTURE_DATA.items) {
    await fs.access(path.join(distDir, 'item', `${item.id}.html`));
  }
});

// ---------------------------------------------------------------------------
// An item entry whose file name differs from the real id by case only (a
// 物品 ID typed in by hand in the CMS). gear.maidDress is a real id;
// gear.maiddress.md must land on it everywhere: the content lint, the
// supplement merge and the body read. (Sveltia 0.271.0 honours the top-level
// slug.lowercase: false, so saving an entry does not change the case of its
// file name; what is left is ids typed in by hand.)
// ---------------------------------------------------------------------------

/** An item shaped like the data files, for the case-sensitivity tests. */
function caseItem(id, name) {
  return {
    id, aliases: [], name, mod: FIXTURE_DATA.mods[0].id, price: 1, shape: [1, 1], icon: null,
    categories: [], tags: [], description: null, flavor: null, usage: [], sources: [], related: [],
    notes: null, provenance: {},
  };
}

test('大小写:文件名与真实 id 只差大小写,构建仍把它归到真实 id(补充层与正文都读得到)', async (t) => {
  const distDir = await tmpDir(t, 'case-dist');
  const contentDir = await tmpDir(t, 'case-content');
  // The entry says the id it is named after — the two agree, as the CMS writes them.
  await writeItemEntry(contentDir, 'gear.maiddress', ["notes: '小写文件名里的备注'"], '这段正文也要出现。\n');

  const data = structuredClone(FIXTURE_DATA);
  data.items.push(caseItem('gear.maidDress', '女仆装'));
  const { exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, data }));

  assert.equal(exitCode, before, err && err.message);
  const page = await fs.readFile(path.join(distDir, 'item', 'gear.maidDress.html'), 'utf8');
  assert.ok(page.includes('小写文件名里的备注'), 'the supplement lands on the real item');
  assert.ok(page.includes('这段正文也要出现'), 'the body is read from the case-variant file');
});

test('大小写:拼错的文件名(大小写也对不上)仍然是构建失败', async (t) => {
  const distDir = await tmpDir(t, 'case-typo-dist');
  const contentDir = await tmpDir(t, 'case-typo-content');
  await writeItemEntry(contentDir, 'gear.maidres');

  const data = structuredClone(FIXTURE_DATA);
  data.items.push(caseItem('gear.maidDress', '女仆装'));
  const { err, exitCode } = await capturingExitCode(() => build({ distDir, contentDir, data }));

  assert.ok(err instanceof Error, 'expected the content lint to fail the build');
  assert.equal(exitCode, 1);
  assert.match(err.message, /\[content\] FAIL/);
  assert.ok(err.message.includes('gear.maidres.md'), err.message);
});

test('品类跟着合并后的物品:content 里的新分类不用重新导出数据,检索器就能按它找到这件物品', async (t) => {
  const distDir = await tmpDir(t, 'chip-dist');
  const contentDir = await tmpDir(t, 'chip-content');
  await writeItemEntry(contentDir, FIXTURE_ITEM_ID, ['categories:', '  - 新分类']);

  const { exitCode, before, err } = await capturingExitCode(() => build({ distDir, contentDir, warn: noop }));
  assert.equal(exitCode, before, err && err.message);

  // The all-site 物品图鉴 with its category chips is gone (stage 3, task 5); the 物品检索器 is where
  // a category is searched by, on the data of data.js.
  const payload = await readDataJs(distDir);
  const item = payload.items.find((it) => it.id === FIXTURE_ITEM_ID);
  assert.ok(item.categories.includes('新分类'), "the item's categories come from the merged entry");
  assert.ok(payload.facets.categories.includes('新分类'), 'and so do the facets, computed from the merged items');
  const hits = queryIndex(payload.search, '新分类').map((r) => r.doc.id);
  assert.ok(hits.includes(FIXTURE_ITEM_ID), `the search index finds ${FIXTURE_ITEM_ID} by its new category (got ${hits.join(', ')})`);
});
