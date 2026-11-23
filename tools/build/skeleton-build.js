'use strict';

// Task 4 + Task 5: fixture-only build entry — what `npm run build` (and
// therefore GitHub Actions) runs.
//
// Unlike modwiki's full builder this never touches the game directory or the
// decompile cache: the site is rendered from the frozen FIXTURE_DATA literal
// plus the hand-written content/ layer. Flow (task contract + rulings C, 4a):
//   0. pre-flight, nothing on disk touched:
//      rm guard → CMS shell source → id lint → asset sources
//   1. data prep (drop missing icons, merge content/mechanics — mechanics.js,
//      at most one page declaring the top-nav about entry)
//   2. render
//   3. rm dist → 4. write files → 5. copy repo assets
//   6. dangling references (dangling-refs.js: pages + stylesheet must only
//      link at files dist ships; admin/ is not the site's own)
//   7. auditExternalLinks(dist)
//   8. admin/ → dist/admin, strictly after the audit (online-only CMS shell)
// Steps 0–2 come BEFORE the old dist is removed (step 3), so every failure
// they can spot leaves the previous output in place. Steps 6–7 need the
// written site, so their failures happen after rm dist — a broken site is
// then on disk, but never deployed (non-zero exit).
//
// Failure discipline: any lint/render/write/asset/admin-copy failure, a
// dangling reference or an external-link audit violation throws with
// process.exitCode = 1, so a broken build can never deploy silently
// (file:// offline discipline).
//
// Contributor-facing failures (BuildError): the CMS lets contributors edit
// and delete pages, so several checks exist only to tell THEM what to fix.
// Their message is the whole report — the files, and what to do — and main()
// prints it without a stack trace.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { renderSite } = require('./render.js');
const { auditExternalLinks } = require('./audit.js');
const { dropMissingIcons } = require('./item-textures.js');
const { isInsideDir, isAllowedDistDir } = require('./paths.js');
const { mergeMechanicsContent, mechanicsWithNavLabel } = require('./mechanics.js');
const { findDanglingRefs, formatDanglingRefs } = require('./dangling-refs.js');
const { FIXTURE_DATA } = require('../../data/fixture-model.js');

const DEFAULT_ASSETS_DIR = path.join(__dirname, '..', '..', 'assets-src');

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * A failure the build itself diagnosed for a contributor. The message is the
 * complete, readable report (which files, what to do), so the CLI prints it
 * as is — a stack trace after the last line of advice would only bury it.
 */
class BuildError extends Error {}

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

/** Absolute path of an ASSET_MAP source inside assetsDir. */
const assetSource = (assetsDir, src) => path.join(assetsDir, ...src.split('/'));

/**
 * Fail now — before anything is rendered, let alone removed — when an
 * ASSET_MAP source is absent. A missing source is a certain build failure
 * (copyAssets needs every entry), so it must not cost the previous dist
 * (ruling 4a). Existence only: a source that exists but cannot be copied is
 * left for copyAssets to report with its real cause.
 */
async function assertAssetSources(assetsDir) {
  for (const [src, dest] of ASSET_MAP) {
    const from = assetSource(assetsDir, src);
    try {
      await fs.access(from);
    } catch (err) {
      if (isMissing(err)) throw new Error(`required asset missing: ${from} → ${dest} (${err.message})`, { cause: err });
      throw err;
    }
  }
}

/** Is `file` really absent (ENOENT / ENOTDIR)? Any other answer is rethrown. */
async function sourceIsMissing(file) {
  try {
    await fs.access(file);
    return false;
  } catch (err) {
    if (isMissing(err)) return true;
    throw err;
  }
}

/**
 * Copy every ASSET_MAP entry into distDir.
 * @throws {Error} "required asset missing" only when the source file really
 *   is absent. Any other failure — permissions, disk full, a source that is a
 *   directory, an unwritable target — is rethrown untouched (ruling 4b).
 */
async function copyAssets(assetsDir, distDir) {
  let copied = 0;
  for (const [src, dest] of ASSET_MAP) {
    const from = assetSource(assetsDir, src);
    const to = path.join(distDir, ...dest.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    try {
      await fs.copyFile(from, to);
    } catch (err) {
      // "Missing" is a claim about the SOURCE, and ENOENT alone does not
      // establish it: copyFile reports ENOENT for a broken target path too.
      if (isMissing(err) && await sourceIsMissing(from)) {
        throw new Error(`required asset missing: ${from} → ${dest} (${err.message})`, { cause: err });
      }
      throw err;
    }
    copied += 1;
  }
  return copied;
}

/**
 * The file a contributor edits to change the links of a dist page — shown in
 * brackets in the dangling-reference report — or null when no such file
 * exists: the structural pages are generated by the build, the stylesheet
 * and assets come from the repo. Pure string work on posix paths.
 *   mechanics/<slug>.html ← <contentDir>/mechanics/<slug>.md
 *   item/<id>.html        ← <contentDir>/items/<id>.md(its 详解 section)
 * @param {string} distFile posix path relative to dist
 * @param {string|null} contentDir
 * @returns {string|null}
 */
function editableSourceOf(distFile, contentDir) {
  const content = toPosix(contentDir ?? 'content');
  const mechanic = /^mechanics\/([^/]+)\.html$/.exec(distFile);
  if (mechanic !== null) return `${content}/mechanics/${mechanic[1]}.md`;
  const item = /^item\/([^/]+)\.html$/.exec(distFile);
  if (item !== null) return `${content}/items/${item[1]}.md`;
  return null;
}

/**
 * Pre-flight for the CMS shell: decide now — before anything is rendered,
 * let alone removed — whether there is a shell to inject. Every answer here
 * is one path comparison or one stat away, so none of them may cost the
 * previous dist (ruling 4a):
 *
 *   adminDir null               → null: skip on purpose
 *   adminDir inside distDir     → throws. rm dist would delete the shell
 *                                  before step 7 reads it — and a deleted
 *                                  shell reads as "missing", i.e. as the
 *                                  skip-silently case.
 *   missing (ENOENT / ENOTDIR)  → null. Not an error: the repo ships without
 *                                  admin/ until Task 6 creates it.
 *   exists, not a directory     → throws. fs.cp would happily copy that file
 *                                  to dist/admin, and /admin/ would 404.
 *   exists, a directory         → its absolute path, copied in step 7.
 *
 * Any other stat failure (unreadable directory, …) is rethrown as is.
 *
 * @param {string|null} adminDir
 * @param {string} distDir resolved dist path
 * @returns {Promise<string|null>} the directory to inject, or null to skip
 */
async function resolveAdminSource(adminDir, distDir) {
  if (adminDir == null) return null;
  if (isInsideDir(distDir, adminDir)) {
    throw new Error(`[build:skeleton] refusing: adminDir ${path.resolve(adminDir)} is inside distDir ${distDir} `
      + '(rm dist would delete the CMS shell before it is injected)');
  }
  let stat;
  try {
    stat = await fs.stat(adminDir);
  } catch (err) {
    if (isMissing(err)) return null;
    throw err;
  }
  if (!stat.isDirectory()) {
    throw new Error(`[build:skeleton] adminDir is not a directory: ${adminDir}`);
  }
  return path.resolve(adminDir);
}

/**
 * Copy the CMS shell into distDir/admin — strictly AFTER the external-link
 * audit. The shell is online-only by design (OAuth callbacks, a vendored
 * bundle that talks to the network), so it is exactly what the audit must
 * never see; being left out of the audit on purpose is also why the offline
 * zip leaves it out (tools/pack.js).
 *
 * Whether there is a shell to copy was settled in the pre-flight
 * (resolveAdminSource); this only copies. A copy failure (unreadable
 * directory, a full disk) fails the build: a deployed site whose /admin/
 * silently went missing is worse than a red build.
 * @param {string} adminSource the shell directory, as resolveAdminSource returned it
 * @returns {Promise<true>}
 */
async function injectAdmin(adminSource, distDir) {
  await fs.cp(adminSource, path.join(distDir, 'admin'), { recursive: true });
  return true;
}

/**
 * Render the fixture site into distDir.
 * @param {{distDir?: string, contentDir?: string|null, assetsDir?: string,
 *   adminDir?: string|null, warn?: (message: string) => void}} [options]
 *   contentDir supplies the hand-written content/items/<id>.md and
 *   content/mechanics/<slug>.md layers (null skips both).
 *   assetsDir is the repo's assets-src/ tree; warn receives the
 *   dropped-icon notices (defaults to console.warn).
 *   adminDir is the CMS shell, copied to distDir/admin after the audit
 *   (relative paths resolve against cwd, like distDir/contentDir). A missing
 *   directory skips the injection; null skips it on purpose.
 * @returns {Promise<{pages: number, iconsDropped: number, assetsCopied: number,
 *   adminInjected: boolean}>}
 *   pages = rendered pages + data.js (assets and admin/ are not pages).
 *   adminInjected = whether an admin tree was copied into dist.
 * @throws {Error} when distDir is neither a directory inside the repo nor
 *   one inside the system temp directory (in particular the repo root or
 *   one of its ancestors — paths.js isAllowedDistDir), when adminDir lies
 *   inside distDir or is not a directory (all three refused before anything
 *   is removed), when a content/items markdown
 *   file is not named `<item.id>.md`, when an asset source is missing, when
 *   more than one mechanics page declares a top-nav label (`nav_label`), on
 *   any render/write/asset-copy/admin-copy failure, when a page or the
 *   stylesheet references a file dist does not ship, or on an external-link
 *   audit violation; process.exitCode is set to 1 before the throw.
 *   Contributor-facing failures (id lint, nav_label conflict, dangling
 *   references) are BuildErrors whose message names the files to edit.
 *   The pre-flight (step 0), data-prep and render failures happen before the
 *   old dist is removed, which therefore stays as it was; the dangling-
 *   reference and audit failures need the written site and come after.
 */
async function buildSkeleton({
  distDir = 'dist',
  contentDir = 'content',
  assetsDir = DEFAULT_ASSETS_DIR,
  adminDir = 'admin',
  warn = console.warn,
} = {}) {
  try {
    // 0. Pre-flight — nothing on disk has changed yet.
    //    rm guard (paths.js isAllowedDistDir): the recursive rm in step 3
    //    may only ever hit a directory inside the repo, or inside the system
    //    temp directory — and never the repo root or one of its ancestors.
    const distPath = path.resolve(distDir);
    if (!isAllowedDistDir(distPath, REPO_ROOT)) {
      throw new Error(`[build:skeleton] refusing to remove distDir ${distPath}: it must be a directory inside the repo `
        + `(${REPO_ROOT}) or inside the system temp directory (${os.tmpdir()}), and never the repo root or one of its ancestors`);
    }
    //    CMS shell source — all three answers known up front (see
    //    resolveAdminSource): inside dist → refused (step 3 would delete it
    //    before step 7 reads it); missing → nothing to inject; not a
    //    directory → refused (fs.cp would copy that file to dist/admin).
    const adminSource = await resolveAdminSource(adminDir, distPath);
    //    id lint (the CMS can create content/items files under any slug).
    if (contentDir != null) {
      const violations = await validateItemContentIds(
        path.join(contentDir, 'items'), FIXTURE_DATA.items.map((it) => it.id));
      if (violations.length > 0) {
        // Paths from the real contentDir (a contributor is told where the
        // file is), in Chinese, one actionable hint last — like the other
        // contributor-facing reports.
        const itemsDir = toPosix(path.join(contentDir, 'items'));
        throw new BuildError(
          `[lint] FAIL — ${violations.length} 个文件的文件名不是真实物品的 ID`
          + '(只有「<物品ID>.md」会被渲染成该物品页的「详解」,其它文件名会被静默忽略):\n'
          + violations.map((v) => `  ${itemsDir}/${v}`).join('\n')
          + '\n提示:请把文件改名为真实物品的 ID(物品详情页的「物品ID」一栏可以查到),扩展名保持 .md;不需要的文件请删除。');
      }
    }
    //    asset sources: a missing one is a certain failure, known right now.
    await assertAssetSources(assetsDir);

    // 1. Data prep — touches only a private clone of the frozen literal.
    const data = structuredClone(FIXTURE_DATA);
    const iconsDropped = await dropMissingIcons(data.items, { modsDir: NO_TEXTURES_DIR, warn });
    data.mechanics = await mergeMechanicsContent(data.mechanics, contentDir);

    //    The top-nav about entry is declared by a page (frontmatter
    //    `nav_label`, task 5b A). Exactly one page may declare it: two would
    //    be two 关于本站 entries. Known right now, before rm dist.
    const aboutPages = mechanicsWithNavLabel(data.mechanics);
    if (aboutPages.length > 1) {
      const files = aboutPages.map((m) => `  ${toPosix(path.join(contentDir ?? 'content', 'mechanics', `${m.slug}.md`))}(nav_label: ${m.navLabel})`);
      throw new BuildError(
        `[nav] FAIL — ${aboutPages.length} 个机制页都设置了 nav_label,顶部导航只能有一个这样的入口`
        + `(${aboutPages.map((m) => m.slug).join('、')})。\n`
        + '请只保留其中一个页面的 nav_label,删掉下面其余文件 frontmatter 里的 `nav_label` 这一行:\n'
        + files.join('\n'));
    }

    // 2. Render — before rm, so a failed build keeps the previous dist.
    const rendered = await renderSite(data, { contentDir });

    // 3. Clean rebuild → idempotent file list (no stale pages survive).
    //    Retries: on Windows the rm of a directory that was just written
    //    can answer ENOTEMPTY/EBUSY while handles are still being released
    //    (seen in the tests' own cleanup) — the same retry policy as there.
    await fs.rm(distPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });

    // 4. Write pages (posix rel paths from renderSite → platform paths).
    for (const [rel, content] of rendered) {
      const dest = path.join(distPath, ...rel.split('/'));
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content);
    }

    // 5. Repo assets → the paths the pages reference.
    const assetsCopied = await copyAssets(assetsDir, distPath);

    // 6. Dangling references (dangling-refs.js): pages and assets are both on
    //    disk now, so this is the first moment the whole site can be asked
    //    whether it references a file it does not ship. A contributor may
    //    have deleted a page another one still links at. admin/ is not
    //    injected yet, and the check skips it anyway (not the site's own).
    const links = await findDanglingRefs(distPath);
    if (links.dangling.length > 0) {
      throw new BuildError(formatDanglingRefs(links, {
        sourceOf: (file) => editableSourceOf(file, contentDir),
      }));
    }

    // 7. External-link audit (offline discipline): any violation fails the build.
    const violations = await auditExternalLinks(distPath);
    if (violations.length > 0) {
      const lines = violations.map((v) => `  ${v.file}:${v.line} [${v.code}] ${v.detail}`);
      throw new Error(`[audit] FAIL — ${violations.length} external-link violation(s):\n${lines.join('\n')}`);
    }

    // 8. CMS shell → dist/admin. Strictly the step after the audit: the shell
    //    is online-only and would fail it by design. Whether there is one was
    //    settled in the pre-flight; here it is only copied.
    const adminInjected = adminSource != null && await injectAdmin(adminSource, distPath);

    return { pages: rendered.size, iconsDropped, assetsCopied, adminInjected };
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
  console.log(result.adminInjected
    ? '[build:skeleton] admin: injected → dist/admin/ (after the audit)'
    : '[build:skeleton] admin: none found, skipped');
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof BuildError) console.error(`[build:skeleton] fatal: ${err.message}`);
    else console.error('[build:skeleton] fatal:', err);
    process.exitCode = 1; // belt and braces: buildSkeleton already sets it
  });
}

module.exports = { buildSkeleton, validateItemContentIds };
