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

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const { isInsideDir, isAllowedDistDir } = require('../tools/build/paths.js');

const FS_ROOT = path.parse(os.tmpdir()).root; // 'C:\' or '/'
const TMP = path.resolve(os.tmpdir());
/** A stand-in repo root: under the filesystem root, NOT under the temp dir. */
const REPO = path.join(FS_ROOT, 'somewhere', 'task5b-stand-in-repo');

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
  if (process.platform === 'win32') {
    assert.equal(isInsideDir(REPO, REPO.toUpperCase()), true, 'win32 paths compare case-insensitively, like the file system');
    assert.equal(isInsideDir('C:\\a', 'D:\\a\\b'), false, 'another drive');
  }
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
  if (process.platform === 'win32') {
    assert.equal(isAllowedDistDir(path.join(REPO, 'DIST').toUpperCase(), REPO.toUpperCase()), true, 'win32: case does not matter');
  }
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
  if (process.platform === 'win32') {
    assert.equal(isAllowedDistDir(REPO.toUpperCase(), REPO), false, '…and the repo root is still recognised');
  }
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
  if (process.platform === 'win32') {
    assert.equal(isAllowedDistDir(TMP.toUpperCase(), REPO), false, '…not under a case variant of its name either');
  }
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
