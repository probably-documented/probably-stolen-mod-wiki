'use strict';

// Task 4: fixture-only build entry — what `npm run build` (and therefore
// GitHub Actions) runs.
//
// Unlike modwiki's full builder this never touches the game directory or the
// decompile cache: the site is rendered from the frozen FIXTURE_DATA literal
// plus the hand-written content/ layer. Flow (task contract + rulings C, 4a):
//   0. pre-flight, nothing on disk touched: rm guard → id lint
//   1. drop missing icons → merge content/mechanics → renderSite
//   2. rm dist → write files → copy repo assets → auditExternalLinks(dist)
// Step 0 and the rendering in step 1 come BEFORE the old dist is removed, so
// every failure they can spot leaves the previous output in place.
//
// Failure discipline: any lint/render/write/asset failure or external-link
// audit violation throws with process.exitCode = 1, so a broken build can never
// deploy silently (file:// offline discipline).

const fs = require('node:fs/promises');
const path = require('node:path');

const { renderSite } = require('./render.js');
const { auditExternalLinks } = require('./audit.js');
const { dropMissingIcons } = require('./item-textures.js');
const { splitFrontmatter } = require('../extract/frontmatter.js');
const { FIXTURE_DATA } = require('../../data/fixture-model.js');

const DEFAULT_ASSETS_DIR = path.join(__dirname, '..', '..', 'assets-src');

/** The repo this builder ships in — the tree `rm -rf distDir` must never eat. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Repo-shipped static assets → dist path. Each dest is exactly the path the
 * rendered pages or theme.css reference (templates.js layout, render.js
 * search.html, theme.css @font-face + body background): dist must ship every
 * file it points at (rulings A + B). Every entry is required — the pages
 * reference it, so a missing one is a dangling reference, never a graceful
 * degradation.
 */
const ASSET_MAP = Object.freeze([
  ['theme.css', 'css/theme.css'],
  ['search.js', 'assets/js/search.js'],
  ['bwiki/emblem.jpg', 'assets/bwiki/emblem.jpg'],
  ['bwiki/bg.png', 'assets/bwiki/bg.png'],
  ['bwiki/fonts/PSNotoSansSC.woff2', 'assets/fonts/PSNotoSansSC.woff2'],
  ['bwiki/fonts/PSLubrifontSC.woff2', 'assets/fonts/PSLubrifontSC.woff2'],
  ['bwiki/fonts/PSTektur.woff2', 'assets/fonts/PSTektur.woff2'],
]);

/**
 * Fixture builds have no item-texture source (they never read the game's
 * Mods/ directory). Pointing dropMissingIcons at a path that cannot exist
 * makes every declared icon take the real build's missing-texture path:
 * warn → item.icon = null → the templates' 无图 fallback.
 */
const NO_TEXTURES_DIR = path.join(__dirname, '.no-item-textures-in-fixture-builds');

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/**
 * Would the recursive `rm distDir` take the repo with it? True when the
 * resolved distDir is the repo root itself or one of its ancestors.
 *
 * Pure (no fs access) so it can be unit-tested against a stand-in repo root —
 * the real one must never be passed to buildSkeleton to prove the guard.
 * Both paths are resolved first, so `.`, `..`, `''` (all cwd-relative),
 * trailing separators and `dist/..` segments normalize before the comparison:
 * `distDir: '.'` run from the repo root IS the repo root. The question asked
 * is literally the dangerous one — does repoRoot lie inside distDir — so a
 * sibling whose name merely extends the repo's (`<repo>-copy`) stays allowed.
 * path.relative compares case-insensitively on win32, like the file system.
 *
 * Not covered: aliases of the same directory through symlinks/junctions or
 * 8.3 short names (that would need fs.realpath, i.e. I/O).
 *
 * @param {string} distDir
 * @param {string} repoRoot
 * @returns {boolean}
 */
function isUnsafeDistDir(distDir, repoRoot) {
  const dist = path.resolve(distDir);
  const rel = path.relative(dist, path.resolve(repoRoot));
  // '' → same directory. A bare relative path (not '..', not '../…', and not
  // absolute — which is what another drive comes back as) → repoRoot is
  // underneath distDir.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Lint content/items/: every markdown file there must be named exactly
 * `<item.id>.md`. render.js reads content/items/<item.id>.md and nothing
 * else, so a file with any other name (a slug the CMS derived from a title,
 * an alias, a typo, a case-variant suffix) is committed happily and then
 * silently never renders. The build goes red instead.
 * @param {string} contentItemsDir the content/items directory
 * @param {Iterable<string>} validIds the real item ids (aliases are not ids)
 * @returns {Promise<string[]>} offending file names, sorted. Empty when every
 *   markdown file is named after an id, when the directory does not exist, or
 *   when it holds only non-.md files / directories (not id claims).
 * @throws {Error} rethrown as is when the directory cannot be listed for a
 *   reason other than "missing" (e.g. EACCES).
 */
async function validateItemContentIds(contentItemsDir, validIds) {
  const legalFiles = new Set([...validIds].map((id) => `${id}.md`));
  let entries;
  try {
    entries = await fs.readdir(contentItemsDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const violations = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    // Byte-for-byte "<id>.md" or it is a violation. A case-variant suffix
    // (.MD) counts too, even behind a real id: render.js opens <id>.md, which
    // finds that file on Windows (case-insensitive) and misses it on Linux
    // (CI), so the site would silently differ per platform.
    if (/\.md$/i.test(entry.name) && !legalFiles.has(entry.name)) violations.push(entry.name);
  }
  return violations.sort();
}

/** frontmatter `title` > first ATX h1 > slug (modwiki merge.js readMechanics order). */
function mechanicTitle(source, slug) {
  const { fm, body } = splitFrontmatter(source);
  const fromFm = fm.title;
  if (typeof fromFm === 'string' && fromFm.trim() !== '') return fromFm.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : slug;
}

/**
 * content/mechanics/<slug>.md → mechanic pages (the hand-written layer). Same
 * contract as modwiki merge.js readMechanics: slug = file name, title =
 * frontmatter `title` > first ATX h1 > slug, source = the file as written. A
 * slug already present in `mechanics` is replaced by the file; new slugs are
 * appended in file-name order. A missing directory leaves `mechanics` as is.
 * @returns {Promise<Array<{slug: string, title: string, source: string}>>}
 */
async function mergeMechanicsContent(mechanics, contentDir) {
  if (contentDir == null) return mechanics;
  const dir = path.join(contentDir, 'mechanics');
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return mechanics;
    throw err;
  }
  const bySlug = new Map((mechanics ?? []).map((m) => [m.slug, m]));
  const names = entries
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    const slug = name.replace(/\.md$/i, '');
    bySlug.set(slug, { slug, title: mechanicTitle(source, slug), source });
  }
  return [...bySlug.values()];
}

/** Copy every ASSET_MAP entry into distDir; a missing source fails the build. */
async function copyAssets(assetsDir, distDir) {
  let copied = 0;
  for (const [src, dest] of ASSET_MAP) {
    const from = path.join(assetsDir, ...src.split('/'));
    const to = path.join(distDir, ...dest.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to);
    } catch (err) {
      throw new Error(`required asset missing: ${from} → ${dest} (${err.message})`, { cause: err });
    }
    copied += 1;
  }
  return copied;
}

/**
 * Render the fixture site into distDir.
 * @param {{distDir?: string, contentDir?: string|null, assetsDir?: string,
 *   warn?: (message: string) => void}} [options]
 *   contentDir supplies the hand-written content/items/<id>.md and
 *   content/mechanics/<slug>.md layers (null skips both).
 *   assetsDir is the repo's assets-src/ tree; warn receives the
 *   dropped-icon notices (defaults to console.warn).
 * @returns {Promise<{pages: number, iconsDropped: number, assetsCopied: number}>}
 *   pages = rendered pages + data.js (assets are not pages).
 * @throws {Error} when distDir resolves to the repo root or one of its
 *   ancestors (nothing is removed), when a content/items markdown file is not
 *   named `<item.id>.md`, on any render/write/asset failure, or on an
 *   external-link audit violation; process.exitCode is set to 1 before the
 *   throw. The rm-guard, id-lint and render failures happen before the old
 *   dist is removed, which therefore stays as it was.
 */
async function buildSkeleton({
  distDir = 'dist',
  contentDir = 'content',
  assetsDir = DEFAULT_ASSETS_DIR,
  warn = console.warn,
} = {}) {
  try {
    // 0. Pre-flight — nothing on disk has changed yet.
    //    rm guard: the recursive rm in step 3 must never eat the repo.
    const distPath = path.resolve(distDir);
    if (isUnsafeDistDir(distPath, REPO_ROOT)) {
      throw new Error(`[build:skeleton] refusing to remove distDir ${distPath}: it is the repo root or one of its ancestors`);
    }
    //    id lint (CMS can create content/items files under any slug).
    if (contentDir != null) {
      const violations = await validateItemContentIds(
        path.join(contentDir, 'items'), FIXTURE_DATA.items.map((it) => it.id));
      if (violations.length > 0) {
        throw new Error(`[lint] FAIL — ${violations.length} content/items file(s) not named after a real item id `
          + '(only content/items/<item.id>.md is rendered, the rest would silently never appear):\n'
          + violations.map((v) => `  content/items/${v}`).join('\n'));
      }
    }

    // 1. Data prep — touches only a private clone of the frozen literal.
    const data = structuredClone(FIXTURE_DATA);
    const iconsDropped = await dropMissingIcons(data.items, { modsDir: NO_TEXTURES_DIR, warn });
    data.mechanics = await mergeMechanicsContent(data.mechanics, contentDir);

    // 2. Render — before rm, so a failed build keeps the previous dist.
    const rendered = await renderSite(data, { contentDir });

    // 3. Clean rebuild → idempotent file list (no stale pages survive).
    await fs.rm(distPath, { recursive: true, force: true });

    // 4. Write pages (posix rel paths from renderSite → platform paths).
    for (const [rel, content] of rendered) {
      const dest = path.join(distPath, ...rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
    }

    // 5. Repo assets → the paths the pages reference.
    const assetsCopied = await copyAssets(assetsDir, distPath);

    // 6. External-link audit (offline discipline): any violation fails the build.
    const violations = await auditExternalLinks(distPath);
    if (violations.length > 0) {
      const lines = violations.map((v) => `  ${v.file}:${v.line} [${v.code}] ${v.detail}`);
      throw new Error(`[audit] FAIL — ${violations.length} external-link violation(s):\n${lines.join('\n')}`);
    }

    return { pages: rendered.size, iconsDropped, assetsCopied };
  } catch (err) {
    process.exitCode = 1;
    throw err;
  }
}

async function main() {
  const result = await buildSkeleton();
  if (result.iconsDropped > 0) {
    console.log(`[build:skeleton] icons dropped: ${result.iconsDropped} (no fixture textures → 无图 fallback)`);
  }
  console.log(`[build:skeleton] rendered ${result.pages} files → dist/`);
  console.log(`[build:skeleton] assets copied: ${result.assetsCopied} → dist/`);
  console.log('[audit] OK — no external-link violations');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[build:skeleton] fatal:', err);
    process.exitCode = 1; // belt and braces: buildSkeleton already sets it
  });
}

module.exports = { buildSkeleton, validateItemContentIds, isUnsafeDistDir };
