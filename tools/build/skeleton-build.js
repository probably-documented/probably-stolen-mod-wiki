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
// dangling reference or a site-audit violation (audit.js: external resources,
// root-relative paths, dangerous HTML) throws with process.exitCode = 1, so
// a broken build can never deploy silently (file:// offline discipline —
// and, now that any contributor can write a page, nothing dangerous either).
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
const { splitFrontmatter } = require('../extract/frontmatter.js');
const { FIXTURE_DATA } = require('../../data/fixture-model.js');

const DEFAULT_ASSETS_DIR = path.join(__dirname, '..', '..', 'assets-src');

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * A failure the build itself diagnosed for a contributor. The message is the
 * complete, readable report (which files, what to do), so the CLI prints it
 * as is — a stack trace after the last line of advice would only bury it.
 */
class BuildError extends Error {
  // `BuildError: …` rather than `Error: …`, should one ever reach a log.
  name = 'BuildError';
}

/** The repo this builder ships in — the tree `rm -rf distDir` must never eat. */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The retry policy for file operations that meet a handle another process
 * still holds on Windows (EBUSY / EPERM / ENOTEMPTY, typically on something
 * just written): fs.rm's own options — 3 more tries, 100 ms, linear backoff —
 * as the tests' cleanup uses them too. The ONE copy (task 6b D4): the rm of
 * distDir below spreads it, and tools/pack.js spreads the same object into
 * its own rm and reads it for its retrying rename.
 */
const RETRY = Object.freeze({ maxRetries: 3, retryDelay: 100 });

/**
 * Repo-shipped static assets → dist path. Each dest is exactly the path the
 * rendered pages or theme.css reference (templates.js layout, render.js
 * search.html + items.html, theme.css @font-face + body background): dist
 * must ship every file it points at (rulings A + B). Every entry is required
 * — the pages reference it, so a missing one is a dangling reference, never a
 * graceful degradation. item-filter.js is the chip filter of items.html: it
 * used to be an inline <script> there until task 6b A8 moved it into a file
 * (the audit now refuses executable inline scripts, audit.js A4).
 */
const ASSET_MAP = Object.freeze([
  ['theme.css', 'css/theme.css'],
  ['search.js', 'assets/js/search.js'],
  ['item-filter.js', 'assets/js/item-filter.js'],
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

/**
 * Lint content/items/ a second time (task 6b D8): every `<item.id>.md` must
 * declare `slug` in its front matter, equal to the file name without .md.
 * In the CMS the 物品 dropdown is what an item file is NAMED after, and
 * render.js names the page after the FILE whatever the front matter says —
 * so a slug that disagrees with the file name usually means the wrong item
 * was picked while editing, and nothing would say so. A missing slug counts
 * the same as a disagreeing one. Runs right after validateItemContentIds,
 * in the same pre-flight.
 * @param {string} contentItemsDir the content/items directory
 * @returns {Promise<Array<{ file: string, slug: string|null }>>} offending
 *   file names with the slug each declares (null = none, or not a string),
 *   sorted. Empty when every entry file declares its own name, when the
 *   directory does not exist, or when it holds only non-.md files and
 *   directories.
 * @throws {Error} rethrown as is when a file cannot be read.
 */
async function validateItemContentSlugs(contentItemsDir) {
  let entries;
  try {
    entries = await fs.readdir(contentItemsDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const violations = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.md$/i.test(entry.name)) continue;
    const expected = entry.name.replace(/\.md$/i, '');
    const source = await fs.readFile(path.join(contentItemsDir, entry.name), 'utf8');
    const { slug } = splitFrontmatter(source).fm;
    if (typeof slug !== 'string' || slug !== expected) {
      violations.push({ file: entry.name, slug: typeof slug === 'string' ? slug : null });
    }
  }
  return violations.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Absolute path of an ASSET_MAP source inside assetsDir. */
const assetSource = (assetsDir, src) => path.join(assetsDir, ...src.split('/'));

/**
 * "required asset missing" — the sentence lives here, once (task 5b E5: the
 * pre-flight and the copy each used to build their own copy, free to drift).
 * `cause` is the error that established it; its message is quoted.
 */
const missingAssetError = (from, dest, cause) =>
  new Error(`required asset missing: ${from} → ${dest} (${cause.message})`, { cause });

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
      if (isMissing(err)) throw missingAssetError(from, dest, err);
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
        throw missingAssetError(from, dest, err);
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
 * What each audit code means and what to do, for a contributor who does not
 * program (task 6b C1). Keyed by the `code` of an audit.js violation — one
 * entry per code; tests/skeleton-build.test.js checks that the audit's own
 * tests never expect a code missing here.
 */
const AUDIT_ADVICE = Object.freeze({
  'src-http': {
    problem: '有一处 src="https://…" 从外部地址加载图片、脚本或音视频。本站不允许加载外部资源。',
    fix: '删掉这个标签。本站暂不支持插入图片。',
  },
  'href-http': {
    problem: '有一个不是普通链接的元素(link、area、image 等)用 href 指向外部地址。本站不允许加载外部资源。',
    fix: '删掉这个标签。想链接到外部网页,请写成普通的链接:[文字](https://网址)。',
  },
  'src-protocol-relative': {
    problem: '有一处 src 以 // 开头。这种写法等同于从外部地址加载资源,本站不允许。',
    fix: '改成站内的相对路径,或者删掉这个标签。',
  },
  'href-protocol-relative': {
    problem: '有一个链接的 href 以 // 开头,它指向外部站点,本站不允许这种写法。',
    fix: '想链接到外部网页,请写完整的地址,以 https:// 开头。',
  },
  'src-root-relative': {
    problem: '有一处 src 以 / 开头(这叫「根相对路径」)。这种地址在本站的网址下会指到错误的位置,离线打开时直接失效。',
    fix: '改成相对于当前页面的路径,例如 ../assets/图片名.png。',
  },
  'href-root-relative': {
    problem: '有一个链接的 href 以 / 开头(这叫「根相对路径」)。这种地址在本站的网址下会指到错误的位置,离线打开时直接失效。',
    fix: '改成相对于当前页面的路径,例如 [物品图鉴](../items.html)。',
  },
  'css-url-http': {
    problem: '样式里的 url(https://…) 从外部地址加载图片或字体。本站不允许加载外部资源。',
    fix: '删掉这条样式。',
  },
  'css-url-protocol-relative': {
    problem: '样式里的 url(//…) 等同于从外部地址加载图片或字体,本站不允许。',
    fix: '改成站内的相对路径,或者删掉这条样式。',
  },
  'css-url-root-relative': {
    problem: '样式里的 url(/…) 是「根相对路径」,在本站的网址下会指到错误的位置。',
    fix: '改成相对于当前页面的路径。',
  },
  fetch: {
    problem: '出现了 fetch( 。本站的页面不向网络发送请求。',
    fix: '删掉这段代码。',
  },
  xhr: {
    problem: '出现了 XMLHttpRequest。本站的页面不向网络发送请求。',
    fix: '删掉这段代码。',
  },
  'script-inline': {
    problem: '有一段可以执行的 <script> 脚本。页面里不允许出现脚本:任何编辑者都能写入,会影响所有读者。',
    fix: '删掉从 <script> 到 </script> 的全部内容。想展示一段代码,请把它写成普通文字(用反引号包起来)。',
  },
  'script-src': {
    problem: '引用了一个本站没有的脚本文件(<script src="…">)。页面里不允许引用清单之外的脚本。',
    fix: '删掉这一行。',
  },
  'inline-event-handler': {
    problem: '标签上有一个 onclick= 这样的事件属性(onload=、onerror= 等同理),它里面的内容会当作脚本执行。',
    fix: '删掉这个属性(从 on 开头,到它的值结束)。',
  },
  'script-url': {
    problem: '有一个链接的地址以 javascript: 或 vbscript: 开头,点开就会执行脚本。',
    fix: '改成普通的 https:// 网页地址,或者删掉这个链接。',
  },
  'base-tag': {
    problem: '页面里有 <base> 标签,它会改变整页所有相对地址的指向。',
    fix: '删掉这个标签。',
  },
  'meta-http-equiv': {
    problem: '有一个带 http-equiv 的 <meta> 标签,可以用来自动跳转或改变页面的行为。',
    fix: '删掉这个标签。',
  },
  srcdoc: {
    problem: '有一个 srcdoc 属性,它嵌入的页面里可以执行脚本。',
    fix: '删掉这个属性。',
  },
  unreadable: {
    problem: '构建读不了这个文件。',
    fix: '',
  },
});

/** Not something a contributor can edit (C2): a generated page, the stylesheet, data.js, an unreadable file. */
const NOT_A_CONTENT_FILE = '这不是内容文件里能改的:这是构建或模板的问题,请联系维护者。';

/**
 * The contributor-facing report of the site audit (task 6b C1/C2): a heading
 * with the count, then per violation three lines — the file to edit and where
 * it is on the page, what is wrong (with the offending snippet to search
 * for), what to do — and one hint as the last line. `sourceOf` maps a dist
 * file to the content file a contributor edits (null = generated by the
 * build): for those the entry says it is a build or template problem, and
 * the "how to fix" line tells them to ask the maintainers (C2).
 * @param {Array<{ file: string, line: number, code: string, detail: string }>} violations
 * @param {{ sourceOf?: (file: string) => string|null }} [options]
 * @returns {string}
 */
function formatAuditViolations(violations, { sourceOf = () => null } = {}) {
  // A file the build could not even read is never a content problem.
  const sourceOfEntry = (v) => (v.code === 'unreadable' ? null : sourceOf(v.file));
  const entries = violations.map((v, i) => {
    const source = sourceOfEntry(v);
    const { problem, fix } = AUDIT_ADVICE[v.code]
      ?? { problem: '构建发现了一处不允许的写法,但没有对应的说明。', fix: '' };
    const place = v.line > 0 ? ` 第 ${v.line} 行附近` : '';
    const where = source === null
      ? `文件:(构建生成的)${v.file}${place}`
      : `文件:${source}(生成页面 ${v.file}${place})`;
    const how = source === null ? NOT_A_CONTENT_FILE : fix;
    return `  ${i + 1}. ${where}\n     问题:${problem}页面里是这段:${v.detail}\n     怎么改:${how}`;
  });

  const hints = ['改好之前,网站不会更新。'];
  if (violations.some((v) => sourceOfEntry(v) !== null)) {
    hints.push('请打开上面列出的文件,搜索「页面里是这段」后面的内容,按「怎么改」修改后重新构建。');
  }
  if (violations.some((v) => sourceOfEntry(v) === null)) {
    hints.push('标着「构建生成的」的文件不是内容文件能改的:那是构建或模板的问题,请联系维护者。');
  } else {
    hints.push('在上面的文件里找不到那段内容时,也是构建或模板的问题,请联系维护者。');
  }
  return [
    `[audit] FAIL — 发现 ${violations.length} 处不允许的写法:`,
    ...entries,
    `提示:${hints.join('')}`,
  ].join('\n');
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
 * Copy the CMS shell into distDir/admin — strictly AFTER the site audit
 * (audit.js). The shell is online-only by design (OAuth callbacks, a vendored
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
 * @throws {Error} when distDir is neither the repo's own dist directory nor
 *   one inside the system temp directory (in particular the repo root, one
 *   of its ancestors, or any other directory inside the repo — paths.js
 *   isAllowedDistDir), when adminDir lies inside distDir or is not a directory (all three refused before anything
 *   is removed), when a content/items markdown file is not named
 *   `<item.id>.md`, when an asset source is missing, when more than one
 *   mechanics page declares a top-nav label (`nav_label`), on any
 *   render/write/asset-copy/admin-copy failure, when a page or the
 *   stylesheet references a file dist does not ship, or on a site-audit
 *   violation; process.exitCode is set to 1 before the throw.
 *   Contributor-facing failures (the rm guard's refusal, id lint, nav_label
 *   conflict, dangling references, the site audit) are BuildErrors whose
 *   message says what to do and names the files to edit.
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
    //    may only ever hit the repo's own dist directory, or a directory
    //    inside the system temp directory — never the repo root, one of its
    //    ancestors, or any other directory inside the repo (task 6b D6).
    const distPath = path.resolve(distDir);
    if (!isAllowedDistDir(distPath, REPO_ROOT)) {
      // A refusal meant for a human being (task 6b C3): what the build does
      // clean, what it never touches, and what to do — no English internals.
      throw new BuildError(
        `[dist] FAIL — 构建拒绝清理这个目录:${distPath}\n`
        + `构建只会清理两类目录:仓库自己的 dist 文件夹(${path.join(REPO_ROOT, 'dist')}),`
        + `或者系统临时目录之下的目录(${os.tmpdir()})。`
        + '仓库本身、仓库的上级目录、以及仓库里的其它文件夹(比如 content、tools、.git)都不会被清理。\n'
        + '提示:这是在保护仓库里的文件。请在仓库根目录直接运行 npm run build(不要指定别的输出目录);'
        + '如果什么都没有改却看到这条消息,请把它告诉站点维护者。');
    }
    //    CMS shell source — all three answers known up front (see
    //    resolveAdminSource): inside dist → refused (step 3 would delete it
    //    before step 7 reads it); missing → nothing to inject; not a
    //    directory → refused (fs.cp would copy that file to dist/admin).
    const adminSource = await resolveAdminSource(adminDir, distPath);
    //    id lint (the CMS can create content/items files under any slug),
    //    then the slug lint (task 6b D8): what a file declares in its front
    //    matter must be the item it is named after.
    if (contentDir != null) {
      const itemsPath = path.join(contentDir, 'items');
      const idViolations = await validateItemContentIds(itemsPath, FIXTURE_DATA.items.map((it) => it.id));
      if (idViolations.length > 0) {
        // Paths from the real contentDir (a contributor is told where the
        // file is), in Chinese, one actionable hint last — like the other
        // contributor-facing reports.
        const itemsDir = toPosix(itemsPath);
        throw new BuildError(
          `[lint] FAIL — ${idViolations.length} 个文件的文件名不是真实物品的 ID`
          + '(只有「<物品ID>.md」会被渲染成该物品页的「详解」,其它文件名会被静默忽略):\n'
          + idViolations.map((v) => `  ${itemsDir}/${v}`).join('\n')
          + '\n提示:请把文件改名为真实物品的 ID(物品详情页的「物品ID」一栏可以查到),扩展名保持 .md;不需要的文件请删除。');
      }
      const slugViolations = await validateItemContentSlugs(itemsPath);
      if (slugViolations.length > 0) {
        const itemsDir = toPosix(itemsPath);
        throw new BuildError(
          `[slug] FAIL — ${slugViolations.length} 个物品详解文件的 slug 与文件名不一致:\n`
          + slugViolations.map((v) => `  ${itemsDir}/${v.file}(${v.slug === null ? '开头没有 slug' : `开头写的是 slug: ${v.slug}`})`).join('\n')
          + '\n提示:slug 必须与文件名相同(去掉 .md)。这通常是在编辑器里编辑时选错了物品:'
          + '请打开文件,把开头 slug: 后面改成和文件名一样的物品 ID;不需要的文件请删除。');
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
    //    Retries (RETRY): on Windows the rm of a directory that was just
    //    written can answer ENOTEMPTY/EBUSY while handles are still being
    //    released — the same retry policy as the tests' own cleanup and as
    //    tools/pack.js.
    await fs.rm(distPath, { recursive: true, force: true, ...RETRY });

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

    // 7. Site audit (audit.js): external resources, root-relative paths,
    //    dangerous HTML. Any violation fails the build — with a report that
    //    names the content file to edit (C1), or says it is not a content
    //    problem (C2).
    const violations = await auditExternalLinks(distPath);
    if (violations.length > 0) {
      throw new BuildError(formatAuditViolations(violations, {
        sourceOf: (file) => editableSourceOf(file, contentDir),
      }));
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
  console.log('[audit] OK — no violations (external resources, root-relative paths, dangerous HTML)');
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

module.exports = {
  buildSkeleton, validateItemContentIds, validateItemContentSlugs, formatAuditViolations, RETRY,
};
