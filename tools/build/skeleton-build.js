'use strict';

// Task 4 + Task 5: fixture-only build entry — what `npm run build` (and
// therefore GitHub Actions) runs. Task 6b widened its checks for the online,
// many-contributor site: every failure a contributor can trigger is a
// BuildError that tells them which file to edit and how.
//
// Unlike modwiki's full builder this never touches the game directory or the
// decompile cache: the site is rendered from the data files (tests inject the frozen FIXTURE_DATA literal)
// plus the hand-written content/ layer. Flow (task contract + rulings C, 4a):
//   0. pre-flight, nothing on disk touched:
//      rm guard → CMS shell source → item id lint → item slug lint → mechanic
//      page name lint → image formats → table rows wider than their header
//      → asset sources
//   1. data prep (drop missing icons, merge content/mechanics — mechanics.js,
//      at most one page declaring the top-nav about entry)
//   2. render
//   3. rm dist → 4. write files → 5. copy repo assets
//   6. dangling references (dangling-refs.js: pages + stylesheet must only
//      link at files dist ships; admin/ is not the site's own)
//   7. site audit (audit.js)
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
// and delete pages, so many checks exist only to tell THEM what to fix —
// the rm guard's refusal, a content/items file that is not named after an
// item or does not declare the slug it is named after, a mechanic page
// with a file name that is not its address, an image that is not a bitmap,
// two pages declaring the top-nav label, a table row wider than its header,
// a dangling link, an audit violation. Their message is the
// whole report — in Chinese: the files, what is wrong, what to do — and
// main() prints it without a stack trace.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { renderSite } = require('./render.js');
const { loadWikiData } = require('./wiki-data.js');
const { mergeSupplements } = require('./supplements.js');
const { resolveItemId } = require('./item-ids.js');
const { auditExternalLinks, HEAD_ONLY_TAGS } = require('./audit.js');
const { dropMissingIcons } = require('./item-textures.js');
const { findUnsupportedImages, copyPageImages } = require('./content-images.js');
const { readContentLayout } = require('./content-layout.js');
const { writeCmsAssets } = require('./cms-assets.js');
const { findWideTableRows, formatWideTableRows } = require('./wide-tables.js');
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
 * Item textures are kept in the repo as a mirror of the game's layout:
 * `<assetsDir>/mods/<mod id>/Textures/Items/<file>`. That is the path
 * dropMissingIcons probes (item-textures.js, verbatim from the real build;
 * its MOD_DIRS is id → id here), so a declared icon keeps its texture when
 * the file is there, and takes the 无图 fallback when it is not.
 */
const TEXTURES_DIR = 'mods';

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/**
 * Lint content/items/: every markdown file there must be named exactly
 * `<item.id>.md`. render.js reads content/items/<item.id>.md and nothing
 * else, so a file with any other name (a slug the CMS derived from a title,
 * an alias, a typo, a case-variant suffix) is committed happily and then
 * silently never renders. The build goes red instead. A name that differs from
 * the real id by case only is accepted: Sveltia CMS lowercases entry file names
 * when it saves, and every lookup goes through resolveItemId.
 * @param {string} contentItemsDir the content/items directory
 * @param {Iterable<string>} validIds the real item ids (aliases are not ids)
 * @returns {Promise<string[]>} offending file names, sorted. Empty when every
 *   markdown file is named after an id, when the directory does not exist, or
 *   when it holds only non-.md files / directories (not id claims).
 * @throws {Error} rethrown as is when the directory cannot be listed for a
 *   reason other than "missing" (e.g. EACCES).
 */
async function validateItemContentIds(contentItemsDir, validIds) {
  const ids = [...validIds];
  let entries;
  try {
    entries = await fs.readdir(contentItemsDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  return itemIdViolations(entries, ids);
}

/**
 * The id-lint findings for a directory listing (pure): a file name that names
 * no real item, or a second file that names an item another file already
 * names — gear.maidDress.md and gear.maiddress.md would silently split a
 * page's body and front matter between them.
 * @param {Array<{ name: string, isFile: () => boolean }>} entries
 * @param {Iterable<string>} ids the real item ids
 * @returns {string[]} offending file names, sorted
 */
function itemIdViolations(entries, ids) {
  const known = [...ids];
  const violations = [];
  const seen = new Map(); // realId -> the first file that names it
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/\.md$/i.test(entry.name)) continue;
    // The extension must be exactly .md (a .MD finds a file on Windows and
    // misses it on Linux/CI), and the id must name a real item — possibly
    // differing by case only (Sveltia CMS lowercases entry file names when it
    // saves). resolveItemId is the one rule the lints, the supplement merge
    // and the body read all use, so every platform agrees.
    const fileId = entry.name.replace(/\.md$/i, '');
    const realId = /\.md$/.test(entry.name) ? resolveItemId(fileId, known) : null;
    if (realId === null) {
      violations.push(entry.name);
      continue;
    }
    // Two files that name the same item — gear.maidDress.md and
    // gear.maiddress.md — would silently split the body and the front matter
    // between them. Report both.
    if (seen.has(realId)) {
      violations.push(seen.get(realId), entry.name);
      continue;
    }
    seen.set(realId, entry.name);
  }
  return [...new Set(violations)].sort();
}

/**
 * Lint content/items/ a second time (task 6b D8): every `<item.id>.md` must
 * declare `slug` in its front matter, equal to the file name without .md
 * (ignoring case: the CMS may have lowercased the file name).
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
    // Case-insensitive: the CMS may have lowercased the file name, while the
    // slug field keeps the real id (gear.maidDress in gear.maiddress.md).
    if (typeof slug !== 'string' || slug.toLowerCase() !== expected.toLowerCase()) {
      violations.push({ file: entry.name, slug: typeof slug === 'string' ? slug : null });
    }
  }
  return violations.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** A mechanic page's slug (its file name without .md): lowercase ASCII letters, digits, single hyphens between words. */
const MECHANIC_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Lint content/mechanics/ (task 6b D11): a page's slug is its file name
 * without .md, and it becomes mechanics/<slug>.html — the page's address on
 * the site. Only ^[a-z0-9]+(-[a-z0-9]+)*$ is allowed. In the CMS the file is
 * named after the title, so a contributor can end up with 安装指南.md.
 * Same pre-flight as the item lints, next to them.
 * @param {string} contentMechanicsDir the content/mechanics directory
 * @returns {Promise<string[]>} offending file names, sorted. Empty when
 *   every page has a legal name, when the directory does not exist, or when
 *   it holds only non-.md files / directories.
 * @throws {Error} rethrown as is when the directory cannot be listed for a
 *   reason other than "missing".
 */
async function validateMechanicSlugs(contentMechanicsDir) {
  let entries;
  try {
    entries = await fs.readdir(contentMechanicsDir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  // The files mergeMechanicsContent reads are the pages it judges: an .md
  // file of any suffix case (a .MD is a page too), by the name without it.
  return entries
    .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !MECHANIC_SLUG_RE.test(name.replace(/\.md$/i, '')))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
 * Copy every kept item texture from the repo's mirror of the game's
 * Textures/Items tree to the path the pages reference,
 * `dist/assets/items/<mod id>/<file>`. Run it after dropMissingIcons: an
 * icon that survived it has a file, found by the same lookup (the item's
 * own mod first, then the mod named in the icon path).
 * @returns {Promise<number>} Textures copied.
 */
async function copyItemTextures(items, assetsDir, distDir) {
  const texturesDir = path.join(assetsDir, TEXTURES_DIR);
  let copied = 0;
  for (const item of items ?? []) {
    const rel = item.icon;
    if (typeof rel !== 'string' || rel === '') continue;
    const segs = rel.split('/');
    const fileName = segs.pop();
    const iconMod = segs.length >= 2 && segs[0] === 'items' ? segs[1] : null;
    const from = await findTextureFile(texturesDir, item.mod, iconMod, fileName);
    if (from === null) {
      // Not a contributor's doing: dropMissingIcons has just kept this icon.
      throw new Error(`[build:skeleton] item texture not found after it was kept: ${rel}`);
    }
    const to = path.join(distDir, 'assets', ...rel.split('/'));
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    copied += 1;
  }
  return copied;
}

/** The texture file for an item's icon, wherever dropMissingIcons found it. */
async function findTextureFile(texturesDir, itemMod, iconMod, fileName) {
  for (const mod of [...new Set([itemMod, iconMod].filter((m) => m != null))]) {
    const candidate = path.join(texturesDir, mod, 'Textures', 'Items', fileName);
    if (!(await sourceIsMissing(candidate))) return candidate;
  }
  return null;
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
 * What to do about an outside address, by the kind of tag it sits in — read
 * off the tag the report quotes. One sentence for all of them said
 * 「暂不支持插入外部图片」 to a contributor who had written a script, a
 * stylesheet or an embedded page.
 */
function fixOutsideUrl(detail) {
  const tag = /^<([a-z][a-z0-9-]*)/i.exec(detail ?? '')?.[1].toLowerCase() ?? '';
  if (tag === 'img' || tag === 'picture') {
    return '删掉这张图片。如果它是由图片写法 ![说明](地址) 生成的,请删掉那一段图片写法。本站暂不支持插入外部图片。';
  }
  if (tag === 'source') return '删掉这个标签,或其中的地址。本站不支持加载外部的图片和音视频。';
  if (tag === 'video' || tag === 'audio' || tag === 'track') return '删掉这个标签,或其中的地址。本站不支持加载外部的音视频。';
  if (tag === 'script') return '删掉这个脚本标签。页面里只能引用本站自带的脚本。';
  if (tag === 'link') return '删掉这个标签。样式只能使用本站自带的样式表。';
  if (tag === 'iframe' || tag === 'frame' || tag === 'embed' || tag === 'object' || tag === 'portal') {
    return '删掉这个标签。本站不允许嵌入外部的网页。';
  }
  return '删掉这个标签里以 http:// 或 https:// 开头的那一项。想链接到外部网页,请写成普通的链接:[文字](https://网址)。';
}

/**
 * The tag a snippet shows, as the page writes it (`<IFRAME …` → `IFRAME`), or
 * '' when the snippet does not start with a tag. A name is read only from
 * where a snippet always shows it — its first characters: a snippet is at
 * most 160 characters, so a longer name is named as the snippet shows it,
 * and nothing is read off a tail the snippet may have lost.
 */
const tagOfSnippet = (detail) => /^<([a-zA-Z][^\t\n\f\r />]*)/.exec(detail ?? '')?.[1] ?? '';

/** What a ```html block may hold (ruling AE 1) — said to a contributor for every tag that is not on the allow-list. */
const WHAT_A_HTML_BLOCK_MAY_HOLD = '直通 HTML 块里只能使用一组常见标签(段落、标题、列表、表格、链接、图片、div/span 等);其它标签请改用图片,或联系维护者。';

/** An unsupported tag: the problem names the tag — what to search for in the file is the snippet right after. */
function unsupportedTagProblem(detail) {
  const tag = tagOfSnippet(detail);
  return (tag === '' ? '页面正文里出现了一个不允许的标签(见下面这一段)。' : `页面正文里出现了不允许的标签 <${tag}>。`) + WHAT_A_HTML_BLOCK_MAY_HOLD;
}

/** …and what to do depends on the tag: the four that belong in the <head> are told where, any other what to use instead. */
function fixUnsupportedTag(detail) {
  const tag = tagOfSnippet(detail);
  if (tag === '') return '删掉这个标签。需要插入图片,请用图片写法 ![替代文字](地址);其它内容请联系维护者。';
  if (HEAD_ONLY_TAGS.includes(tag.toLowerCase())) {
    return `删掉正文里的这个 <${tag}> 标签(从 <${tag}> 到 </${tag}>,如果后面有结束标签)。`
      + '这种标签只能由页面模板放在页面头部(<head>)里,直通 HTML 块里不能写。';
  }
  return `删掉这个 <${tag}> 标签和它里面的全部内容(从 <${tag}> 到 </${tag}>)。`
    + '需要插入图片,请用图片写法 ![替代文字](地址);矢量图、公式、嵌入的网页或音视频等,请先做成图片,或联系维护者。';
}

/**
 * What each audit code means and what to do, for a contributor who does not
 * program (task 6b C1). Keyed by the `code` of an audit.js violation, one
 * entry per code of the audit's CODES — tests/skeleton-build.test.js checks
 * that every code of that list has an entry here. `problem` and `fix` are
 * strings, or functions of the violation's `detail` when the right words
 * depend on the tag the snippet shows.
 */
const AUDIT_ADVICE = Object.freeze({
  'external-url': {
    problem: '有一个标签从外部地址(http:// 或 https:// 开头)加载资源,例如图片、视频、脚本或样式。本站不允许加载外部资源。',
    fix: fixOutsideUrl,
  },
  'protocol-relative-url': {
    problem: '有一个地址以 // 开头(例如 //cdn.example.com/x.png)。这种写法等同于从外部站点加载,本站不允许。',
    fix: '图片等资源请删掉;想链接到外部网页,请写完整的、以 https:// 开头的地址(只能用在普通链接里)。',
  },
  'root-relative-url': {
    problem: '有一个地址以 / 开头(这叫「根相对路径」)。这种地址在本站的网址下会指到错误的位置,离线打开时直接失效。',
    fix: '改成相对于当前页面的路径,例如 [物品图鉴](../items.html) 或 ../assets/图片名.png。',
  },
  'data-url': {
    problem: '这个标签里有一个以 data: 开头的地址——把一段数据(甚至一整段网页或矢量图)直接写在页面里。'
      + '放在嵌入网页的标签里,或者是一张矢量图时,读者打开页面它就会运行。本站不支持这种内嵌数据地址。',
    fix: '删掉这个地址,或整个标签。需要图片请等站点支持上传图片。',
  },
  'css-data-url': {
    problem: '样式里有一个以 data: 开头的地址——把图片或字体的内容直接写在样式里。本站不支持这种内嵌数据地址。',
    fix: '删掉这条样式里的地址,改用站内的图片或字体。',
  },
  'css-external-url': {
    problem: '样式里有一处引用了外部地址(以 http:// 或 https:// 开头,或以 // 开头),'
      + '例如 url(…)、@import "…"、image-set(…),或 @font-face 里 src 的字体地址。本站不允许加载外部资源。',
    fix: '删掉这条样式,或改成站内的相对路径。',
  },
  'css-root-relative': {
    problem: '样式里有一处地址以 / 开头(这叫「根相对路径」),例如 url(/…)、@import "/…"。这种地址在本站的网址下会指到错误的位置。',
    fix: '改成相对于当前样式表的路径,例如 ../assets/图片名.png。',
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
    // One wording, true whether or not the tag closes itself. A <script/> closes itself only inside an <svg> or
    // <math>; in HTML the `/` before `>` is nothing there, and what follows is the script's text up to </script>.
    // The audit reads a <script> by the HTML rules wherever it stands (audit.js, scanHtml; ruling AE 3), so it
    // cannot tell the two apart — and an <svg> or <math> is refused for its own sake anyway (unsupported-tag). A
    // tag longer than a snippet loses its tail, so nothing is read off that tail either (review rounds 2 and 3).
    fix: '删掉这个 <script> 标签和它里面的脚本:从 <script> 到 </script> 的全部内容;后面找不到 </script> 时,它后面的内容也算脚本,一并删掉。'
      + '写成 <script/> 的不一定自己闭合——只有写在 <svg> 或 <math> 里面才是,那时删掉标签本身就行;不闭合时,它后面的内容到 </script> 为止同样是脚本。'
      + '想展示一段代码,请把它写成普通文字(用反引号包起来)。',
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
    problem: '有一个属性的值以 javascript: 或 vbscript: 开头——不一定是链接,任何属性都算。读者一点、或者页面一加载,它就会执行脚本。',
    fix: '属性值不能以 javascript: 开头。请删掉这个属性,或把它改成一个普通的地址(例如以 https:// 开头的网页地址)。',
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
  'unsupported-tag': {
    problem: unsupportedTagProblem,
    fix: fixUnsupportedTag,
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
    const advice = AUDIT_ADVICE[v.code]
      ?? { problem: '构建发现了一处不允许的写法,但没有对应的说明。', fix: '' };
    // Either may be a function of the snippet: the words depend on the tag it shows.
    const said = (words) => (typeof words === 'function' ? words(v.detail) : words);
    const problem = said(advice.problem);
    const fix = said(advice.fix);
    const place = v.line > 0 ? ` 第 ${v.line} 行附近` : '';
    const where = source === null
      ? `文件:(构建生成的)${v.file}${place}`
      : `文件:${source}(生成页面 ${v.file}${place})`;
    const how = source === null ? NOT_A_CONTENT_FILE : fix;
    // What the page holds is not always what the file says: an <img> is
    // nearly always the build's rendering of ![替代文字](地址) (markdown.js,
    // B4). Say so, or the contributor searches for a tag that is not there.
    const shown = /^<img\b/i.test(v.detail)
      ? '页面里是这段(它通常是用图片写法 ![替代文字](地址) 写的:请在文件里找那一段图片写法):'
      : '页面里是这段:';
    return `  ${i + 1}. ${where}\n     问题:${problem}${shown}${v.detail}\n     怎么改:${how}`;
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
 *   texturesCopied: number, imagesPublished: number, adminInjected: boolean,
 *   cmsAssets: { templates: number, items: number } | null}>}
 *   pages = rendered pages + data.js (assets and admin/ are not pages).
 *   iconsDropped = declared icons with no texture file (→ 无图 fallback);
 *   texturesCopied = item textures copied from assets-src/mods/;
 *   imagesPublished = images copied from the pages' images/ folders.
 *   adminInjected = whether an admin tree was copied into dist.
 *   cmsAssets = the CMS's scripts and catalogs written after the shell ({ templates, items }),
 *   or null when no shell was injected.
 * @throws {Error} when distDir is neither the repo's own dist directory nor
 *   one inside the system temp directory (in particular the repo root, one
 *   of its ancestors, or any other directory inside the repo — paths.js
 *   isAllowedDistDir), when adminDir lies inside distDir or is not a directory (all three refused before anything
 *   is removed), when a content/items markdown file is not named
 *   `<item.id>.md`, when such a file does not declare `slug` equal to its
 *   own name (D8), when a content/mechanics file name is not a legal page
 *   slug (D11), when an asset source is missing, when more than one
 *   mechanics page declares a top-nav label (`nav_label`), when a table row
 *   of an edited page has more cells than its header (wide-tables.js), on any
 *   render/write/asset-copy/admin-copy failure, when a page or the
 *   stylesheet references a file dist does not ship, or on a site-audit
 *   violation; process.exitCode is set to 1 before the throw.
 *   Contributor-facing failures (the rm guard's refusal, the item id and
 *   slug lints, the mechanic page name lint, the nav_label conflict, a
 *   table row wider than its header, dangling references, the site audit)
 *   are BuildErrors whose message says what to do and names the files to edit.
 *   The pre-flight (step 0), data-prep and render failures happen before the
 *   old dist is removed, which therefore stays as it was; the dangling-
 *   reference and audit failures need the written site and come after.
 */
async function buildSkeleton({
  distDir = 'dist',
  contentDir = 'content',
  assetsDir = DEFAULT_ASSETS_DIR,
  adminDir = 'admin',
  data = null,
  dataDir = 'data',
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
    //    Site data: injected (tests, tools) or the repo's data/mods/*.json.
    //    Read-only, like everything else in this step; a broken data file is
    //    one Chinese line from loadWikiData.
    const payload = data != null ? structuredClone(data) : await loadWikiData(dataDir);
    const adminSource = await resolveAdminSource(adminDir, distPath);
    // The per-mod content layout, read here because it is read-only like everything else in the
    // pre-flight. The CMS's item catalog uses it to tell which items already have an entry; the
    // checks and the image publishing join when the build moves to the new layout.
    const layout = await readContentLayout(contentDir);
    //    id lint (the CMS can create content/items files under any slug),
    //    then the slug lint (task 6b D8): what a file declares in its front
    //    matter must be the item it is named after.
    if (contentDir != null) {
      const itemsPath = path.join(contentDir, 'items');
      const idViolations = await validateItemContentIds(itemsPath, payload.items.map((it) => it.id));
      if (idViolations.length > 0) {
        // Paths from the real contentDir (a contributor is told where the
        // file is), in Chinese, one actionable hint last — like the other
        // contributor-facing reports.
        const itemsDir = toPosix(itemsPath);
        throw new BuildError(
          `[lint] FAIL — ${idViolations.length} 个文件的文件名与真实物品的 ID 不一致,或两个文件指向同一件物品`
          + '(只有「<物品ID>.md」会被渲染成该物品页的「详解」;大小写可以不同,但不能重复):\n'
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
      //    Mechanic page names (task 6b D11): a page's file name is its
      //    address on the site — lowercase English words joined by hyphens.
      const badPageNames = await validateMechanicSlugs(path.join(contentDir, 'mechanics'));
      if (badPageNames.length > 0) {
        const mechanicsDir = toPosix(path.join(contentDir, 'mechanics'));
        throw new BuildError(
          `[slug] FAIL — ${badPageNames.length} 个机制页的文件名不合规:\n`
          + badPageNames.map((name) => `  ${mechanicsDir}/${name}`).join('\n')
          + '\n提示:机制页的文件名就是它在网站上的地址,只能用小写英文字母、数字和短横线。'
          + '请把文件名改成小写英文单词,单词之间用短横线,例如 `install-compat`。');
      }
      //    Image formats (task 10b): an image the CMS stored beside a page
      //    has to be a bitmap — an SVG can hold a script.
      const badImages = await findUnsupportedImages(contentDir);
      if (badImages.length > 0) {
        throw new BuildError(
          `[images] FAIL — ${badImages.length} 个图片文件不是支持的格式:\n`
          + badImages.map((file) => `  ${toPosix(file)}`).join('\n')
          + '\n提示:只支持 png、jpg、jpeg、gif、webp、avif 位图。SVG 等其它格式不能上传'
          + '(SVG 可以内嵌脚本,对所有读者都有风险),请把图片转成 PNG 后重新上传。');
      }
      //    Table rows wider than their header (rich text in the CMS): an
      //    image dropped at the end of a table row is written as one more
      //    cell, which the renderer drops. The page would lose the image
      //    without a word, so the contributor is told which line to fix.
      const wideRows = await findWideTableRows(contentDir);
      if (wideRows.length > 0) throw new BuildError(formatWideTableRows(wideRows, contentDir));
    }
    //    asset sources: a missing one is a certain failure, known right now.
    await assertAssetSources(assetsDir);

    // 1. Data prep — the payload (injected, or read from the data files) is a
    //    private clone; only it is mutated below.
    const modDirs = new Map(payload.mods.map(({ id }) => [id, id]));
    //    The hand-written layer first: its icon overrides must go through
    //    dropMissingIcons too, and its empty values never overwrite the data.
    await mergeSupplements(payload, contentDir, warn);
    // The category chips follow the merged items, as the offline build's
    // facets do: a category a contributor adds in the CMS shows up in the
    // filter without waiting for a data re-export.
    payload.facets = { categories: [...new Set(payload.items.flatMap((it) => it.categories ?? []))].sort() };
    const iconsDropped = await dropMissingIcons(payload.items, {
      modsDir: path.join(assetsDir, TEXTURES_DIR), modDirs, warn,
    });
    payload.mechanics = await mergeMechanicsContent(payload.mechanics, contentDir);

    //    The top-nav about entry is declared by a page (frontmatter
    //    `nav_label`, task 5b A). Exactly one page may declare it: two would
    //    be two 关于本站 entries. Known right now, before rm dist.
    const aboutPages = mechanicsWithNavLabel(payload.mechanics);
    if (aboutPages.length > 1) {
      // Heading, the pages, then the hint as the last line — the shape of
      // every contributor-facing report.
      const files = aboutPages.map((m) => `  ${toPosix(path.join(contentDir ?? 'content', 'mechanics', `${m.slug}.md`))}(nav_label: ${m.navLabel})`);
      throw new BuildError(
        `[nav] FAIL — ${aboutPages.length} 个机制页都设置了 nav_label,顶部导航只能有一个这样的入口`
        + `(${aboutPages.map((m) => m.slug).join('、')})。\n`
        + files.join('\n')
        + '\n提示:请只保留其中一个页面的 nav_label;其余文件请打开,把开头 frontmatter 里的 `nav_label` 这一行删掉。');
    }

    // 2. Render — before rm, so a failed build keeps the previous dist.
    const rendered = await renderSite(payload, { contentDir });

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

    // 5b. Item textures → the paths the item pages reference.
    const texturesCopied = await copyItemTextures(payload.items, assetsDir, distPath);

    // 5c. Images beside the pages → the folders the pages are published to.
    const imagesPublished = await copyPageImages(contentDir, distPath);

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

    // 8b. CMS scripts and catalogs, written after the shell is in dist/admin/: they are for
    // the online CMS only, exactly like the shell — after the audit, out of the offline zip.
    const cmsAssets = adminInjected
      ? await writeCmsAssets({ repoRoot: REPO_ROOT, distDir: distPath, layout, data: payload })
      : null;

    return { pages: rendered.size, iconsDropped, assetsCopied, texturesCopied, imagesPublished, adminInjected, cmsAssets };
  } catch (err) {
    process.exitCode = 1;
    throw err;
  }
}

async function main() {
  const result = await buildSkeleton();
  if (result.iconsDropped > 0) {
    console.log(`[build:skeleton] icons dropped: ${result.iconsDropped} (no texture file → 无图 fallback)`);
  }
  console.log(`[build:skeleton] rendered ${result.pages} files → dist/`);
  console.log(`[build:skeleton] assets copied: ${result.assetsCopied} → dist/`);
  console.log(`[build:skeleton] item textures copied: ${result.texturesCopied} → dist/assets/items/`);
  if (result.imagesPublished > 0) {
    console.log(`[build:skeleton] page images published: ${result.imagesPublished} (beside their pages)`);
  }
  console.log('[audit] OK — no violations (external resources, root-relative paths, dangerous HTML)');
  console.log(result.adminInjected
    ? '[build:skeleton] admin: injected → dist/admin/ (after the audit)'
    : '[build:skeleton] admin: none found, skipped');
  if (result.cmsAssets) {
    console.log(`[build:skeleton] cms: admin.js, ${result.cmsAssets.templates} templates, ${result.cmsAssets.items} items in the catalog → dist/admin/`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    if (err instanceof BuildError) console.error(`[build:skeleton] fatal: ${err.message}`);
    else console.error('[build:skeleton] fatal:', err);
    process.exitCode = 1; // belt and braces: buildSkeleton already sets it
  });
}

module.exports = {
  buildSkeleton, validateItemContentIds, itemIdViolations, validateItemContentSlugs, validateMechanicSlugs,
  formatAuditViolations, RETRY,
};
