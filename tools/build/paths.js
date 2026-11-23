'use strict';

// Path-containment guards shared by the build entry (skeleton-build.js) and
// the pack entry (../pack.js).
//
// One implementation on purpose. This single predicate is what three safety
// guards rest on:
//   - the rm guard — buildSkeleton refuses a distDir that is the repo root or
//     one of its ancestors;
//   - the CMS-shell guard — an adminDir inside distDir would be deleted by rm
//     dist before it is injected;
//   - the self-inclusion guard — a zip written inside dist could archive its
//     own half-written bytes.
// With two copies, a fix to the comparison (win32 case folding, 8.3 short
// names, another drive) could land in one guard and miss the others, leaving
// the guards to disagree about the same pair of paths.

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

module.exports = { isInsideDir };
