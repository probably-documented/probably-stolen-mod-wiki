'use strict';

// Dangling-reference check (task 5b B): does dist reference a file it does
// not ship? Until now this was only asserted by a test (Task 4's
// findDanglingRefs in tests/skeleton-build.test.js); the build itself
// happily deployed a site with links to nothing.
//
// It matters because the CMS will let contributors delete pages. A link
// left pointing at a deleted page must not deploy — and the failure has to
// tell a non-programmer WHICH file to edit. Hence findDanglingRefs returns
// data ({ scanned, dangling: [{ file, ref }] }) and formatDanglingRefs turns
// it into the contributor-facing report; the build entry (skeleton-build.js)
// throws it as a BuildError.
//
// Rules (those of the Task 4 test, kept):
//   - every `*.html`: relative href / src
//     (/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)
//   - every `*.css`: url(...)
//   - skipped: anything with a scheme (http:, mailto:, data:, javascript: …),
//     root-relative (/x) and protocol-relative (//x) refs, fragment-only refs
//   - query and hash are stripped, the result is percent-decoded (a file may
//     be linked as `a%20b.png`), and must then resolve to a file dist ships
// "Ships" is membership in the list of files actually under distDir — so a
// path outside dist, a directory, or a case variant is dangling too, on every
// platform alike (a `Index.html` link opens on win32 and 404s on the Linux
// host the site is deployed to).
//
// admin/ — the online-only CMS shell, injected after the checks — is not the
// site's own content and never takes part. That is the top-level admin/ of
// dist and nothing else: an `admin` deeper down is the site's own (D5).

const fs = require('node:fs/promises');
const path = require('node:path');

/** The one top-level dist tree that is not the site's own. Matched case-insensitively: on win32 `ADMIN/` is `admin/`. */
const SKIPPED_TOP_LEVEL = 'admin';

const HTML_REF_RE = /\b(?:href|src)\s*=\s*["']([^"']*)["']/gi;
const CSS_URL_RE = /url\(\s*["']?([^"')]*)["']?\s*\)/g;
/** Has a scheme (http:, mailto:, data:, javascript: …), or is root-/protocol-relative, or a bare fragment. */
const NOT_A_SITE_FILE_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Every file under dir (absolute, sorted) — except the CMS shell.
 *
 * What is left out is exactly the TOP-LEVEL entry of dir named `admin`
 * (matched case-insensitively: on win32 `ADMIN/` is `admin/`), whole tree
 * included: the online-only shell, copied in after the checks. An `admin`
 * anywhere deeper down (`item/admin/`, `css/admin/`) is the site's own
 * file like any other and takes part. (Task 6b D5: the code used to skip an
 * `admin` at every depth, while this comment said "top-level" — a broken
 * link under a nested `admin` went unnoticed.)
 * @param {string} dir
 * @param {boolean} [isRoot] false below the first level — internal
 * @returns {Promise<string[]>}
 */
async function listSiteFiles(dir, isRoot = true) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (isRoot && entry.name.toLowerCase() === SKIPPED_TOP_LEVEL) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSiteFiles(full, false)));
    else out.push(full);
  }
  return out.sort();
}

/**
 * The site-file references of one file: href/src values of an .html page,
 * url() targets of a .css stylesheet, null for anything else.
 * @returns {Promise<string[]|null>}
 */
async function refsOf(file) {
  if (/\.html$/i.test(file)) {
    return [...(await fs.readFile(file, 'utf8')).matchAll(HTML_REF_RE)].map((m) => m[1]);
  }
  if (/\.css$/i.test(file)) {
    return [...(await fs.readFile(file, 'utf8')).matchAll(CSS_URL_RE)].map((m) => m[1]);
  }
  return null;
}

/**
 * Where a written reference points at, or null when it is not a reference to
 * a site file at all (see NOT_A_SITE_FILE_RE; an empty remainder counts as
 * none too). Query and hash are dropped and the remainder percent-decoded.
 * @param {string} baseDir the directory of the page/stylesheet
 * @param {string} ref as written in the file
 * @returns {string|null} absolute path
 */
function targetOf(baseDir, ref) {
  const written = ref.trim();
  if (NOT_A_SITE_FILE_RE.test(written)) return null;
  const pathPart = written.split(/[?#]/)[0];
  if (pathPart === '') return null;
  let decoded = pathPart;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    // Not valid percent-encoding (e.g. "%ZZ"): take it as written, like a
    // browser would, and let the existence check decide.
  }
  return path.resolve(baseDir, decoded);
}

/**
 * Every reference in dist that does not resolve to a file dist ships.
 * @param {string} distDir
 * @returns {Promise<{ scanned: number, dangling: Array<{ file: string, ref: string }> }>}
 *   scanned = the .html/.css files looked at (admin/ excluded), so that
 *   "0 dangling" and "0 scanned" are distinguishable;
 *   file = the page/stylesheet, ref = the resolved target — both relative
 *   to distDir, posix separators; dangling is ordered by file, then by
 *   position in the file.
 */
async function findDanglingRefs(distDir) {
  const root = path.resolve(distDir);
  const files = await listSiteFiles(root);
  const shipped = new Set(files);
  let scanned = 0;
  const dangling = [];
  for (const file of files) {
    const refs = await refsOf(file);
    if (refs === null) continue;
    scanned += 1;
    for (const ref of refs) {
      const target = targetOf(path.dirname(file), ref);
      if (target !== null && !shipped.has(target)) {
        dangling.push({ file: toPosix(path.relative(root, file)), ref: toPosix(path.relative(root, target)) });
      }
    }
  }
  return { scanned, dangling };
}

/**
 * The contributor-facing report (task 5b B2): a heading with the count, one
 * line per dangling reference — `页面路径 → 缺失的目标路径` — and one
 * actionable hint as the last line. `sourceOf` maps a dist page to the file
 * a contributor edits to change its links (null = the build generates the
 * page); it is shown in brackets after the line.
 *
 * The hint names no path (task 6b D3): every path of the report is the one
 * sourceOf put in the brackets. It used to spell a page-to-file mapping into
 * itself, with `content/` written in — a path that could disagree with the
 * contentDir the build was actually given.
 * @param {{ dangling: Array<{ file: string, ref: string }> }} result
 * @param {{ sourceOf?: (file: string) => string|null }} [options]
 * @returns {string}
 */
function formatDanglingRefs({ dangling }, { sourceOf = () => null } = {}) {
  const lines = dangling.map(({ file, ref }) => {
    const source = sourceOf(file);
    return `  ${file} → ${ref}${source == null ? '' : `(编辑 ${source})`}`;
  });
  return [
    `[links] FAIL — ${dangling.length} 处链接指向不存在的文件:`,
    ...lines,
    '提示:被链接的页面或资源可能已经被删除。想保留这条链接,请把被链接的文件恢复到原处;'
    + '不需要了,请打开上面括号里的文件,删掉或修正对应的链接。'
    + '没有括号的页面由构建自动生成,它的断链不是内容文件能改的,请联系站点维护者。',
  ].join('\n');
}

module.exports = { findDanglingRefs, formatDanglingRefs };
