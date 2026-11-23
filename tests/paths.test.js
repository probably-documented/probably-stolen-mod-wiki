'use strict';

// Task 5 D → Task 5b D1 → Task 6b D6/D7 tests: tools/build/paths.js — the
// containment guards buildSkeleton's recursive `rm dist` rests on.
//
// D1 (ruling P): the rm guard is a positive allow-list. A resolved distDir
// is allowed only when it is a directory INSIDE the repo or INSIDE the system
// temp directory; everything else is refused — before, any path outside the
// repo could be removed.
//
// D6 (task 6b): inside the repo the list has exactly one entry — the repo's
// own `dist` directory. Before, any subdirectory of the repo would do (.git,
// content, …), and a build pointed there would delete it.
//
// Pure functions only: paths are built as strings and nothing is touched on
// disk. The real repo root is never used — the stand-in below is a path
// that is never created.
//
// A rule of ONE path model is checked in that model, not on the machine that
// happens to run the suite: the guards take the model as their last argument
// (paths.js) — path.win32 or path.posix, the platform's own when it is not
// given, as the build calls them. Nothing in this file asks which platform it
// runs on, and nothing returns early. It used to: the win32 rules sat behind
// `process.platform === 'win32'`, and the D7 case returned on POSIX — passing
// with nothing checked there.

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { isInsideDir, isAllowedDistDir } = require('../tools/build/paths.js');

const FS_ROOT = path.parse(os.tmpdir()).root; // 'C:\' or '/'
const TMP = path.resolve(os.tmpdir());
/** A stand-in repo root: under the filesystem root, NOT under the temp dir. */
const REPO = path.join(FS_ROOT, 'somewhere', 'task5b-stand-in-repo');

// The stand-ins of each model, built with that model's own functions, so that
// nothing in them depends on the platform either. (FS_ROOT, TMP and REPO above
// are those of THIS platform: what the build itself will be given.)
const WIN = path.win32;
const POSIX = path.posix;
const WIN_TMP = WIN.join('C:\\', 'tmp');
const WIN_REPO = WIN.join('C:\\', 'somewhere', 'task5b-stand-in-repo');
const POSIX_TMP = POSIX.join('/', 'tmp');
const POSIX_REPO = POSIX.join('/', 'somewhere', 'task5b-stand-in-repo');

test('the stand-in repo root is neither inside nor above the temp dir (test precondition)', () => {
  assert.notEqual(isInsideDir(TMP, REPO), true, 'the stand-in repo is not under os.tmpdir()');
  assert.notEqual(isInsideDir(REPO, TMP), true, 'os.tmpdir() is not under the stand-in repo');
});

test('isInsideDir: p is dir itself or underneath it; resolved first; another drive or an ancestor is not "inside"', () => {
  assert.equal(isInsideDir(REPO, REPO), true, 'the directory itself');
  assert.equal(isInsideDir(REPO, path.join(REPO, 'dist')), true);
  assert.equal(isInsideDir(REPO, path.join(REPO, 'a', '..', 'b')), true, 'resolved first');
  assert.equal(isInsideDir(REPO, `${REPO}${path.sep}`), true, 'trailing separator');
  assert.equal(isInsideDir(REPO, path.dirname(REPO)), false, 'an ancestor');
  assert.equal(isInsideDir(REPO, `${REPO}-copy`), false, "a sibling whose name extends the dir's");
  // The rules of one path model, read in that model — checked on every platform
  assert.equal(isInsideDir(WIN_REPO, WIN_REPO.toUpperCase(), WIN), true, 'win32 paths compare case-insensitively, like the file system');
  assert.equal(isInsideDir('C:\\a', 'D:\\a\\b', WIN), false, 'win32: another drive');
  assert.equal(isInsideDir(POSIX_REPO, POSIX_REPO.toUpperCase(), POSIX), false, 'posix paths compare case-sensitively: that is another directory');
});

test('isAllowedDistDir: the repo root and its ancestors are refused', () => {
  const cases = [
    [REPO, 'the repo root itself'],
    [`${REPO}${path.sep}`, 'the repo root, trailing separator'],
    [path.join(REPO, 'dist', '..'), 'a path that normalizes back to the repo root'],
    [path.join(REPO, 'a', '..', '..'), 'a path that normalizes to the parent of the repo root'],
    [path.dirname(REPO), 'the parent of the repo root'],
    [path.dirname(path.dirname(REPO)), 'the grandparent of the repo root'],
    [FS_ROOT, 'the filesystem root'],
  ];
  for (const [distDir, what] of cases) {
    assert.equal(isAllowedDistDir(distDir, REPO), false, what);
  }
});

test('isAllowedDistDir (D6): inside the repo, only the dist directory of the repo is allowed', () => {
  assert.equal(isAllowedDistDir(path.join(REPO, 'dist'), REPO), true, 'the dist directory of the repo');
  assert.equal(isAllowedDistDir(path.join(REPO, 'dist', '..', 'dist'), REPO), true, 'resolved first');
  assert.equal(isAllowedDistDir(`${path.join(REPO, 'dist')}${path.sep}`, REPO), true, 'trailing separator');
  assert.equal(isAllowedDistDir(WIN.join(WIN_REPO, 'DIST').toUpperCase(), WIN_REPO.toUpperCase(), WIN_TMP, WIN), true, 'win32: case does not matter');
  assert.equal(isAllowedDistDir(POSIX.join(POSIX_REPO, 'DIST'), POSIX_REPO, POSIX_TMP, POSIX), false, 'posix: case does matter — DIST is a directory inside the repo, not its dist');
});

test('isAllowedDistDir (D6): any other directory inside the repo is refused — a build pointed there would delete it', () => {
  const cases = [
    [['out'], 'an ordinary subdirectory'],
    [[path.join('out', 'nested', 'deeper')], 'a nested subdirectory'],
    [['content'], 'the content directory'],
    [[path.join('content', 'mechanics')], 'inside the content directory'],
    [['.git'], '.git'],
    [['tools'], 'the tools directory'],
    [[path.join('dist', '..', 'out')], 'a path that normalizes to another subdirectory'],
    [[path.join('dist', 'deeper')], 'a directory INSIDE dist: not dist itself'],
    [[path.join('dist-sibling')], 'a sibling whose name extends "dist"'],
    [[path.join('tools', '..', 'content', '..', '.git', 'objects')], 'deeper, after normalizing'],
  ];
  for (const [segments, what] of cases) {
    assert.equal(isAllowedDistDir(path.join(REPO, ...segments), REPO), false, what);
  }
  assert.equal(isAllowedDistDir(WIN_REPO.toUpperCase(), WIN_REPO, WIN_TMP, WIN), false, '…and the repo root is still recognised (win32: written in another case)');
});

test('isAllowedDistDir: a path outside the repo and outside the temp directory is refused', () => {
  assert.equal(isAllowedDistDir(path.join(FS_ROOT, 'elsewhere', 'dist'), REPO), false, 'a sibling tree of the repo');
  assert.equal(isAllowedDistDir(path.join(FS_ROOT, 'elsewhere'), REPO), false, 'a directory that merely is not related to the repo');
  assert.equal(isAllowedDistDir(`${REPO}-copy`, REPO), false, "a sibling whose name extends the repo's");
  assert.equal(isAllowedDistDir(path.join(path.dirname(REPO), 'dist'), REPO), false, 'next to the repo (its parent is not the temp dir)');
  // …whatever temp root is assumed
  const scratch = path.join(FS_ROOT, 'scratch');
  assert.equal(isAllowedDistDir(path.join(FS_ROOT, 'elsewhere', 'dist'), REPO, scratch), false);
});

test('isAllowedDistDir: under os.tmpdir() is allowed; the temp dir itself is not', () => {
  assert.equal(isAllowedDistDir(path.join(TMP, 'skeleton-x-1234', 'dist'), REPO), true, 'a test temp dir');
  assert.equal(isAllowedDistDir(path.join(TMP, 'dist'), REPO), true, 'directly under the temp dir');
  assert.equal(isAllowedDistDir(TMP, REPO), false, 'os.tmpdir() itself: removing the whole temp directory is never the intent');
  assert.equal(isAllowedDistDir(WIN_TMP.toUpperCase(), WIN_REPO, WIN_TMP, WIN), false, '…not under a case variant of its name either (win32)');
  // the temp root is a parameter, so the branch is testable with a made-up one
  const scratch = path.join(FS_ROOT, 'scratch');
  assert.equal(isAllowedDistDir(path.join(scratch, 'a', 'b'), REPO, scratch), true);
  assert.equal(isAllowedDistDir(scratch, REPO, scratch), false, 'the temp root itself');
  assert.equal(isAllowedDistDir(path.join(scratch, 'a'), REPO, path.join(scratch, 'deeper')), false, 'not under the given temp root');
});

test('isAllowedDistDir: relative paths resolve against the cwd like the fs call they guard (the repo root taken to be the cwd)', () => {
  const cwd = path.resolve('.');
  assert.equal(isAllowedDistDir('.', cwd), false, '"." from the repo root is the repo root');
  assert.equal(isAllowedDistDir('', cwd), false, '"" resolves to the cwd as well');
  assert.equal(isAllowedDistDir('..', cwd), false, '".." from the repo root is its parent — an ancestor, wherever the repo lives');
  assert.equal(isAllowedDistDir('dist', cwd), true, 'the relative "dist" of the npm scripts: the dist directory of the repo');
  assert.equal(isAllowedDistDir('out', cwd), false, '(D6) any other relative subdirectory of the repo');
  assert.equal(isAllowedDistDir(path.join('dist', 'x'), cwd), false, '(D6) not a directory inside dist either');
});

test('isAllowedDistDir: a repo that itself lives under the temp dir (this test suite\'s stand-in copies) — its ancestors stay refused, the temp branch never overrides that', () => {
  const repoInTmp = path.join(TMP, 'skeleton-rm-guard-wiring-XXXX', 'repo');
  assert.equal(isAllowedDistDir(path.join(repoInTmp, 'dist'), repoInTmp), true, 'inside the repo');
  assert.equal(isAllowedDistDir(path.dirname(repoInTmp), repoInTmp), false, 'its parent directory, although under the temp dir');
  assert.equal(isAllowedDistDir(TMP, repoInTmp), false, 'the temp dir itself: an ancestor of the repo');
  assert.equal(isAllowedDistDir(path.join(TMP, 'some-unrelated-dir'), repoInTmp), true, 'an unrelated temp directory');
});

// D7 (task 6b): a path on another drive. path.relative answers with an
// absolute path for two paths on different drives — the one case where "is it
// inside?" must not be read off that string.
//
// That is a rule of the win32 path model, not of the machine running this
// suite: so the guards are given that model (their last argument, paths.js)
// and every path here is built with path.win32. Nothing is touched on disk —
// the other drive does not have to exist — and the assertions are the same on
// POSIX. They used not to be: the test returned early there and passed with
// nothing checked.

test('isAllowedDistDir (D7): a path on another drive is neither inside the repo nor inside the temp directory; a temp root given on another drive behaves like any other', () => {
  const thisDrive = 'C:\\';
  const otherDrive = 'D:\\';
  const there = (...segments) => WIN.join(otherDrive, ...segments);
  const repo = WIN.join(thisDrive, 'somewhere', 'task5b-stand-in-repo');
  const temp = WIN.join(thisDrive, 'tmp');
  const allowed = (distDir, repoRoot = repo, tmpRoot = temp) => isAllowedDistDir(distDir, repoRoot, tmpRoot, WIN);

  // Outside the repo and outside the temp directory → refused, whatever temp root is assumed.
  assert.equal(allowed(there('elsewhere', 'dist')), false, 'a directory on another drive');
  assert.equal(allowed(there()), false, 'the root of another drive');
  assert.equal(allowed(there('elsewhere', 'dist'), repo, WIN.join(thisDrive, 'scratch')), false, '…with a made-up temp root too');

  // The same path as the temp directory, on another drive: not "under the temp directory".
  const tempTail = WIN.relative(thisDrive, temp); // e.g. 'tmp'
  assert.notEqual(tempTail, '', 'sanity: the temp directory is not the root of its drive');
  assert.equal(allowed(there(tempTail, 'x')), false, 'the temp directory\'s path, on another drive');

  // The temp root is a parameter: on another drive it behaves like any other.
  const scratch = there('scratch');
  assert.equal(allowed(there('scratch', 'a', 'b'), repo, scratch), true, 'under the given temp root, on another drive');
  assert.equal(allowed(scratch, repo, scratch), false, 'the temp root itself');
  assert.equal(allowed(there('elsewhere', 'a'), repo, scratch), false, 'not under the given temp root');
  assert.equal(allowed(there('scratch', 'a')), false, '…and not under the temp directory either, which is on this drive');

  // A repo on another drive, with the temp directory on this one.
  const repoThere = there('somewhere', 'repo');
  assert.equal(allowed(there('somewhere', 'repo', 'dist'), repoThere), true, 'its own dist directory');
  assert.equal(allowed(repoThere, repoThere), false, 'the repo root');
  assert.equal(allowed(there('somewhere'), repoThere), false, 'the parent of the repo root');
  assert.equal(allowed(there('somewhere', 'repo', 'out'), repoThere), false, '(D6) another directory inside that repo');
  assert.equal(allowed(WIN.join(temp, 'unrelated'), repoThere), true, 'the temp directory is on another drive from that repo — still allowed under it');
});
