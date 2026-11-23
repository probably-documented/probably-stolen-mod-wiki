'use strict';

// Path-containment guards shared by the build entry (skeleton-build.js) and
// the pack entry (../pack.js).
//
// One comparison on purpose. This single predicate is what three safety
// guards rest on:
//   - the rm guard — buildSkeleton only removes a distDir that is inside the
//     repo or inside the system temp directory (isAllowedDistDir below);
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
 * @param {string} dir
 * @param {string} p
 * @returns {boolean}
 */
function isInsideDir(dir, p) {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  // '' → same directory. A bare relative path (not '..', not '../…', not
  // absolute) → p is underneath dir.
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Is `p` somewhere underneath `dir`, the directory itself not counting?
 * "The same directory" is asked through path.relative, so it agrees with
 * isInsideDir on win32 case folding.
 */
function isStrictlyInsideDir(dir, p) {
  return path.relative(path.resolve(dir), path.resolve(p)) !== '' && isInsideDir(dir, p);
}

/**
 * May buildSkeleton remove `distDir` recursively? (task 5b D1, ruling P — a
 * positive allow-list.) Only two kinds of location are allowed:
 *
 *   - a directory inside the repo — but not the repo root itself;
 *   - a directory inside the system temp directory — but not that directory
 *     itself (where the tests build).
 *
 * Everything else is refused: any other path outside the repo, and — first
 * of all, whatever else is true of the path — the repo root and every one of
 * its ancestors. The ancestor rule outranks the temp rule on purpose: a repo
 * checked out under the temp directory (the test suite's stand-in copies)
 * must not have its parent directories become removable just because they
 * lie under the temp directory too.
 *
 * Pure (no fs access; os.tmpdir() reads the environment). Known limits, as
 * for isInsideDir: symlinks/junctions and 8.3 short names.
 *
 * @param {string} distDir
 * @param {string} repoRoot
 * @param {string} [tmpRoot] defaults to os.tmpdir(); a parameter so the
 *   temp branch is testable with a made-up root
 * @returns {boolean}
 */
function isAllowedDistDir(distDir, repoRoot, tmpRoot = os.tmpdir()) {
  const dist = path.resolve(distDir);
  // The repo, or a directory that contains it → never (repoRoot inside dist).
  if (isInsideDir(dist, repoRoot)) return false;
  return isInsideDir(repoRoot, dist) || isStrictlyInsideDir(tmpRoot, dist);
}

module.exports = { isInsideDir, isAllowedDistDir };
