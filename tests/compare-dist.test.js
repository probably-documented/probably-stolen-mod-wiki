'use strict';

// compare-dist.js: the byte-for-byte comparison of two build outputs. The site and the
// offline package are the same dist, so after a change to the build this is what proves
// that the pages which were not meant to change did not change by a single byte.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { compareTrees } = require('../tools/compare-dist.js');

const CLI = path.join(__dirname, '..', 'tools', 'compare-dist.js');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `compare-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir while a just-written file is
  // still held: that is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

async function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), content);
  }
}

test('compareTrees: two identical trees → every file is the same, nothing anywhere else', async (t) => {
  const root = await tmpDir(t, 'same');
  const files = { 'a.html': 'a', 'css/x.css': 'x', 'data.js': 'window = 1;' };
  await write(path.join(root, 'A'), files);
  await write(path.join(root, 'B'), files);
  assert.deepEqual(await compareTrees(path.join(root, 'A'), path.join(root, 'B')),
    { onlyInA: [], onlyInB: [], differing: [], same: 3 });
});

test('compareTrees: a file only on one side, and a file with other bytes', async (t) => {
  const root = await tmpDir(t, 'diff');
  await write(path.join(root, 'A'), { 'same.html': 's', 'gone.html': 'g', 'changed.html': 'old' });
  await write(path.join(root, 'B'), { 'same.html': 's', 'new.html': 'n', 'changed.html': 'new' });
  assert.deepEqual(await compareTrees(path.join(root, 'A'), path.join(root, 'B')),
    { onlyInA: ['gone.html'], onlyInB: ['new.html'], differing: ['changed.html'], same: 1 });
});

test('compareTrees: paths under an ignored prefix take no part, on either side', async (t) => {
  const root = await tmpDir(t, 'ignore');
  await write(path.join(root, 'A'), { 'index.html': 'i', 'admin/config.yml': 'old', 'admin/vendor/x.js': 'x' });
  await write(path.join(root, 'B'), { 'index.html': 'i', 'admin/config.yml': 'changed', 'admin/new.json': '{}' });
  assert.deepEqual(await compareTrees(path.join(root, 'A'), path.join(root, 'B'), { ignore: ['admin/'] }),
    { onlyInA: [], onlyInB: [], differing: [], same: 1 });
});

test('the command line: exit 1 on a difference that is not allowed, 0 when --allow matches it', async (t) => {
  const root = await tmpDir(t, 'cli');
  await write(path.join(root, 'A'), { 'index.html': 'i', 'generated/data.js': 'a' });
  await write(path.join(root, 'B'), { 'index.html': 'i', 'generated/data.js': 'b' });
  const run = (args) => spawnSync(process.execPath, [CLI, path.join(root, 'A'), path.join(root, 'B'), ...args], { encoding: 'utf8' });

  const strict = run([]);
  assert.equal(strict.status, 1, strict.stderr);
  assert.match(strict.stdout, /generated\/data\.js/);

  const allowed = run(['--allow', '^generated/']);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /generated\/data\.js/, 'an allowed difference is still printed');
});
