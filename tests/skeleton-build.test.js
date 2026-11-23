'use strict';

// Task 4 tests: fixture-only build pipeline (FIXTURE_DATA → renderSite →
// dist files → external-link audit). No game directory, no decompile cache —
// `npm run build` runs this very entry, so the tests drive buildSkeleton
// against tmp directories instead of the real dist/.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { buildSkeleton } = require('../tools/build/skeleton-build.js');
const { FIXTURE_DATA } = require('../data/fixture-model.js');
const { BWIKI_CREDIT_URL } = require('../tools/build/audit.js');
const { splitFrontmatter } = require('../tools/extract/frontmatter.js');

const REPO_CONTENT = path.join(__dirname, '..', 'content');
const FIXTURE_ITEM_ID = FIXTURE_DATA.items[0].id; // brief Step 4: <id> = items[0].id
const DATA_JS_PREFIX = 'window.WIKI_DATA = ';

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `skeleton-${label}-`));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
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

async function countFiles(dir) {
  let n = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

test('buildSkeleton renders the fixture site to distDir', async (t) => {
  const distDir = await tmpDir(t, 'site');
  // A stale page from a previous build must not survive (flow step 1: rm dist).
  await fs.writeFile(path.join(distDir, 'stale.html'), '<title>stale</title>');

  const { result, exitCode, before } = await capturingExitCode(() =>
    buildSkeleton({ distDir, contentDir: null }));

  // 1) dist/index.html exists and is a real HTML document
  const index = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
  assert.match(index, /<title>/);
  // The whitelisted BWIKI footer credit is on every page — and the build is
  // still audit-clean, i.e. the whitelist really is a whitelist.
  assert.ok(index.includes(`href="${BWIKI_CREDIT_URL}"`), 'footer credit href present');
  await assert.rejects(fs.access(path.join(distDir, 'stale.html')), 'stale file removed by rm dist');

  // 2) dist/data.js exists with the search index inlined
  const dataJs = await fs.readFile(path.join(distDir, 'data.js'), 'utf8');
  assert.ok(dataJs.startsWith(DATA_JS_PREFIX), 'data.js assigns window.WIKI_DATA');
  const payload = JSON.parse(dataJs.slice(DATA_JS_PREFIX.length).replace(/;\s*$/, ''));
  assert.equal(payload.items.length, FIXTURE_DATA.items.length);
  assert.equal(
    payload.search.docs.length,
    FIXTURE_DATA.items.length + FIXTURE_DATA.mechanics.length,
    'search index inlined (one doc per item + mechanic)',
  );

  // 3) returned page count
  assert.ok(Number.isInteger(result.pages) && result.pages >= 1, `expected pages >= 1, got ${result.pages}`);
  assert.equal(await countFiles(distDir), result.pages, 'pages === files written to dist');

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

  const result = await buildSkeleton({ distDir, contentDir: REPO_CONTENT });

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
  assert.equal(result.pages, await countFiles(distDir));
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

  const { err, exitCode } = await capturingExitCode(() => buildSkeleton({ distDir, contentDir }));

  assert.ok(err instanceof Error, `expected the audit violation to throw, got ${err}`);
  assert.match(err.message, /\[audit\] FAIL/);
  assert.match(err.message, /src-http/);
  assert.match(err.message, new RegExp(`item/${FIXTURE_ITEM_ID}\\.html`));
  assert.equal(exitCode, 1);
  // Flow: write files → audit. The offending page is on disk (not swallowed).
  await fs.access(path.join(distDir, 'item', `${FIXTURE_ITEM_ID}.html`));
});

test('buildSkeleton throws and sets exitCode 1 when rendering fails', async (t) => {
  const distDir = await tmpDir(t, 'render-fail');
  const contentDir = await tmpDir(t, 'render-fail-content');
  // content/items/<id>.md as a DIRECTORY: fs.readFile → EISDIR, which is
  // neither ENOENT nor ENOTDIR, so renderSite's optional read rethrows.
  await fs.mkdir(path.join(contentDir, 'items', `${FIXTURE_ITEM_ID}.md`), { recursive: true });

  const { err, exitCode } = await capturingExitCode(() => buildSkeleton({ distDir, contentDir }));

  assert.ok(err instanceof Error, `expected the render failure to throw, got ${err}`);
  assert.equal(err.code, 'EISDIR');
  assert.doesNotMatch(err.message, /\[audit\]/);
  assert.equal(exitCode, 1);
});
