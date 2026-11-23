'use strict';

// Path-containment guards shared by the build entry (skeleton-build.js) and
// the pack entry (../pack.js).
//
// One comparison on purpose. This single predicate is what three safety
// guards rest on:
//   - the rm guard — buildSkeleton only removes a distDir that is the repo's
//     own dist directory, or a directory inside the system temp directory
//     (isAllowedDistDir below);
//   - the CMS-shell guard — an adminDir inside distDir would be deleted by rm
//     dist before it is injected;
//   - the self-inclusion guard — a zip written inside dist could archive its
//     own half-written bytes.
// With two copies, a fix to the comparison (win32 case folding, 8.3 short
// names, another drive) could land in one guard and miss the others, leaving
// the guards to disagree about the same pair of paths.

const os = require('node:os');
const path = require('node:path');

/**
 * Is `p` `dir` itself or somewhere underneath it? Both sides are resolved
 * first, so `.`, `..`, trailing separators and `x/..` segments all normalize
 * before the comparison. path.relative compares case-insensitively on win32,
 * like the file system; a `p` on another drive comes back as an absolute
 * path and is never "inside".
 *
 * Pure (no fs access). Not covered: aliases of the same directory through
 * symlinks/junctions or 8.3 short names (that would need fs.realpath).
 *
 * `pathImpl` is the path model both are read in — path.win32 or path.posix;
 * this platform's own `path` when it is not given, as the build calls it. It
 * is a parameter for the tests (tests/paths.test.js): a rule of ONE model —
 * win32 folds case and has several drives, POSIX does neither — is checked
 * in that model wherever the suite runs, instead of only on Windows. The
 * same parameter goes through every guard below, so they keep reading one
 * pair of paths the one way.
 *
 * @param {string} dir
 * @param {string} p
 * @param {object} [pathImpl] path.win32 / path.posix; the platform's `path` by default
 * @returns {boolean}
 */
function isInsideDir(dir, p, pathImpl = path) {
  const rel = pathImpl.relative(pathImpl.resolve(dir), pathImpl.resolve(p));
  // '' → same directory. A bare relative path (not '..', not '../…', not
  // absolute) → p is underneath dir.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${pathImpl.sep}`) && !pathImpl.isAbsolute(rel));
}

/**
 * Is `p` somewhere underneath `dir`, the directory itself not counting?
 * "The same directory" is asked through path.relative, so it agrees with
 * isInsideDir on win32 case folding. `pathImpl` as for isInsideDir.
 */
function isStrictlyInsideDir(dir, p, pathImpl = path) {
  return pathImpl.relative(pathImpl.resolve(dir), pathImpl.resolve(p)) !== '' && isInsideDir(dir, p, pathImpl);
}

/** Is `p` the directory `dir` itself? Asked the way isInsideDir asks, so win32 case folding agrees. `pathImpl` as for isInsideDir. */
function isSameDir(dir, p, pathImpl = path) {
  return pathImpl.relative(pathImpl.resolve(dir), pathImpl.resolve(p)) === '';
}

/** The one directory inside the repo a build may remove: the repo's own dist. */
const DIST_DIR_NAME = 'dist';

/**
 * May buildSkeleton remove `distDir` recursively? (task 5b D1, ruling P — a
 * positive allow-list; task 6b D6 — tightened inside the repo.) Only two
 * kinds of location are allowed:
 *
 *   - the repo's own `dist` directory — exactly that one, nothing else
 *     inside the repo (before D6 any subdirectory would do, and a build
 *     pointed at content/ or .git/ deleted it);
 *   - a directory inside the system temp directory — but not that directory
 *     itself (where the tests build).
 *
 * Everything else is refused: any other path outside the repo, any other
 * directory inside it, and — first of all, whatever else is true of the
 * path — the repo root and every one of its ancestors. The ancestor rule
 * outranks the temp rule on purpose: a repo checked out under the temp
 * directory (the test suite's stand-in copies) must not have its parent
 * directories become removable just because they lie under the temp
 * directory too.
 *
 * Pure (no fs access; os.tmpdir() reads the environment). Known limits, as
 * for isInsideDir: symlinks/junctions and 8.3 short names.
 *
 * @param {string} distDir
 * @param {string} repoRoot
 * @param {string} [tmpRoot] defaults to os.tmpdir(); a parameter so the
 *   temp branch is testable with a made-up root
 * @param {object} [pathImpl] path.win32 / path.posix; the platform's `path`
 *   by default — as for isInsideDir
 * @returns {boolean}
 */
function isAllowedDistDir(distDir, repoRoot, tmpRoot = os.tmpdir(), pathImpl = path) {
  const dist = pathImpl.resolve(distDir);
  // The repo, or a directory that contains it → never (repoRoot inside dist).
  if (isInsideDir(dist, repoRoot, pathImpl)) return false;
  // Inside the repo: the repo's dist directory, and nothing else.
  if (isInsideDir(repoRoot, dist, pathImpl)) return isSameDir(pathImpl.join(repoRoot, DIST_DIR_NAME), dist, pathImpl);
  // Inside the system temp directory, but not that directory itself.
  return isStrictlyInsideDir(tmpRoot, dist, pathImpl);
}

module.exports = { isInsideDir, isAllowedDistDir };
