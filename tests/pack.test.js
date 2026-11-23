'use strict';

// Task 5 tests: pack entry — the offline zip. `npm run pack` = build + one
// zip of dist that lives NEXT TO the repo's dist (never inside it) and does
// not carry admin/. Simplified from modwiki tools/pack.js; the pieces this
// file pins:
//   G — one bsdtar command, the executable resolved per platform (ruling 1:
//       CI runs on Linux, where GNU tar cannot write a zip)
//   H — the zip is named after package.json's version, path-safe or refused
//   I — size gate (< 100 MB) and the self-inclusion guard are kept
//   J — zip entries are clean relative paths, cover dist, and never admin/
//
// Task 5b adds (task 5 review minors + ruling P): J's "clean" is asserted on
// bsdtar's RAW listing (E1); the missing-bsdtar branch (E2) and "every failed
// pack exits 1" (E3) are tested without needing bsdtar; the rm/rename retry
// policy (D2).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');

const {
  resolveBsdtar, BSDTAR, readVersion, zipName, MAX_ZIP_BYTES, assertUnderSizeLimit,
  createZip, listZipEntries, leakedAdminEntries, packSite, renameWithRetries, runBsdtar,
} = require('../tools/pack.js');

const REPO_ROOT = path.join(__dirname, '..');
const execFileP = promisify(execFile);
const noop = () => {};

/** Run fn while capturing the process.exitCode it leaves behind, then restore it. */
async function capturingExitCode(fn) {
  const before = process.exitCode;
  try {
    return { result: await fn(), exitCode: process.exitCode, before };
  } catch (err) {
    return { err, exitCode: process.exitCode, before };
  } finally {
    process.exitCode = before;
  }
}

// ---------- G — bsdtar executable per platform ----------

test('resolveBsdtar: one bsdtar command, the executable resolved per platform', () => {
  assert.equal(resolveBsdtar('win32', { SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\tar.exe');
  assert.equal(resolveBsdtar('win32', {}), 'C:\\Windows\\System32\\tar.exe', 'no SystemRoot → the standard location');
  assert.equal(resolveBsdtar('win32', { SystemRoot: '' }), 'C:\\Windows\\System32\\tar.exe', 'empty SystemRoot → same');
  assert.equal(resolveBsdtar('darwin', {}), 'tar', 'macOS ships bsdtar as /usr/bin/tar');
  assert.equal(resolveBsdtar('linux', {}), 'bsdtar', 'libarchive-tools on CI; GNU tar cannot write zip');
  assert.throws(() => resolveBsdtar('sunos', {}), /sunos/, 'an unsupported platform is an error, not a silent guess');

  // Defaults follow the running process.
  assert.equal(resolveBsdtar(), BSDTAR);
  assert.equal(resolveBsdtar(process.platform, process.env), BSDTAR);
});

test('runBsdtar: a missing executable is an explicit, actionable error, not a raw ENOENT (task 5b E2)', async () => {
  // Built as a string, never created — under a directory that does not exist.
  const nowhere = path.join(os.tmpdir(), 'task5b-no-such-dir', 'bsdtar-nowhere');
  await assert.rejects(runBsdtar(nowhere, ['--version']), (err) => {
    assert.match(err.message, /^\[pack\] bsdtar not found: /);
    assert.ok(err.message.includes(nowhere), `names the executable that was tried, got: ${err.message}`);
    assert.match(err.message, /libarchive-tools/, '…and what to install');
    assert.equal(err.cause?.code, 'ENOENT', 'the original error is kept as the cause');
    return true;
  });
});

// ---------- H — zip name from package.json ----------

test('readVersion / zipName: the zip is named after package.json — path-safe or refused', async () => {
  assert.equal(readVersion('{"version":"0.1.0"}'), '0.1.0');
  assert.equal(zipName('0.1.0'), 'offline-wiki-0.1.0.zip');
  const pkg = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(zipName(readVersion(JSON.stringify(pkg))), `offline-wiki-${pkg.version}.zip`, 'the real package.json passes');

  assert.throws(() => readVersion('{'), SyntaxError, 'not JSON');
  assert.throws(() => readVersion('{"name":"x"}'), /version/, 'no version field');
  assert.throws(() => readVersion('{"version":1}'), /version/, 'version must be a string');
  // The version becomes a file name in the repo root: no path injection shapes.
  for (const bad of ['0.1.0/../../evil', '../../x', '0.1 0', '.', '..']) {
    assert.throws(() => readVersion(JSON.stringify({ version: bad })), /path-safe/, `version ${JSON.stringify(bad)}`);
    assert.throws(() => zipName(bad), /path-safe/, `zipName(${JSON.stringify(bad)})`);
  }
});

// ---------- I — size gate ----------

test('size gate: the delivered zip must stay under 100 MB (spec §9)', () => {
  assert.equal(MAX_ZIP_BYTES, 100 * 1024 * 1024);
  assert.doesNotThrow(() => assertUnderSizeLimit(0));
  assert.doesNotThrow(() => assertUnderSizeLimit(MAX_ZIP_BYTES - 1));
  assert.throws(() => assertUnderSizeLimit(MAX_ZIP_BYTES), /100 MB/, 'the limit itself is over: strictly under');
  assert.throws(() => assertUnderSizeLimit(MAX_ZIP_BYTES * 3), /100 MB/);
});

// ---------- J — the archive itself ----------

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `pack-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry (a fresh zip, say) is still held or pending.
  // That is the cleanup failing, not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

/** A stand-in dist: a few rendered-looking files, css/, and an admin/ tree. */
async function makeDist(root) {
  const dist = path.join(root, 'dist');
  for (const sub of ['css', 'item', path.join('admin', 'vendor')]) {
    await fs.mkdir(path.join(dist, sub), { recursive: true });
  }
  await fs.writeFile(path.join(dist, 'index.html'), '<html></html>');
  await fs.writeFile(path.join(dist, 'data.js'), 'window.WIKI_DATA = {};\n');
  await fs.writeFile(path.join(dist, 'css', 'theme.css'), 'body{}\n');
  await fs.writeFile(path.join(dist, 'item', 'wondrous_milk.html'), '<html></html>');
  await fs.writeFile(path.join(dist, 'admin', 'index.html'), '<a href="https://example.com/login">sign in</a>');
  await fs.writeFile(path.join(dist, 'admin', 'vendor', 'cms.js'), '// cms\n');
  return dist;
}

const FILES_OF_DIST = ['css/theme.css', 'data.js', 'index.html', 'item/wondrous_milk.html'];

/**
 * The entries as bsdtar itself lists them — NOT normalized: a `./` prefix,
 * a backslash, a `dist/` prefix all survive here. listZipEntries normalizes
 * (`./` dropped, backslashes → /), so a "clean path" assertion on its result
 * says nothing about the archive (task 5b E1).
 */
async function rawZipEntries(zipPath) {
  const { stdout } = await execFileP(BSDTAR, ['-tf', path.resolve(zipPath)]);
  return stdout.split(/\r?\n/).filter((line) => line !== '');
}

/** Every file under dir (posix paths), for before/after comparisons. */
async function listFiles(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full.split(path.sep).join('/'));
  }
  return out;
}

/**
 * bsdtar present? On win32 BSDTAR is an absolute path, elsewhere a bare name
 * resolved through PATH — so "can it run?" is the only portable question.
 */
const hasBsdtar = (() => {
  try {
    execFileSync(BSDTAR, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
})();

test('createZip: self-inclusion guard and "nothing to pack" refuse before bsdtar runs', async (t) => {
  const root = await tmpDir(t, 'zip-guard');
  const dist = await makeDist(root);
  const before = (await listFiles(dist)).sort();
  // A zip path inside dist could end up archiving its own half-written bytes.
  await assert.rejects(createZip(dist, path.join(dist, 'offline-wiki-test.zip')), /outside dist/, 'directly inside dist');
  await assert.rejects(createZip(dist, path.join(dist, 'sub', 'x.zip')), /outside dist/, 'nested inside dist');
  assert.deepEqual((await listFiles(dist)).sort(), before, 'nothing was written into dist');

  // A dist that holds nothing but admin/: no operands must reach bsdtar —
  // handed none, some bsdtar builds fall back to the whole -C directory.
  const adminOnly = path.join(root, 'admin-only');
  await fs.mkdir(path.join(adminOnly, 'admin'), { recursive: true });
  await fs.writeFile(path.join(adminOnly, 'admin', 'index.html'), 'x');
  const zipPath = path.join(root, 'empty.zip');
  await assert.rejects(createZip(adminOnly, zipPath), /nothing to pack/);
  await assert.rejects(fs.access(zipPath), 'no archive is written');
});

test('createZip: every file of dist except admin/, under clean relative paths', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'zip');
  const dist = await makeDist(root);
  const zipPath = path.join(root, 'offline-wiki-test.zip'); // outside dist, like the real one

  await createZip(dist, zipPath);

  const entries = await listZipEntries(zipPath);
  assert.deepEqual(entries.filter((e) => !e.endsWith('/')).sort(), FILES_OF_DIST, 'files: all of dist minus admin/');
  assert.ok(!entries.some((e) => e === 'admin' || e.startsWith('admin/')), `no admin/ entry, got ${JSON.stringify(entries)}`);
  // Task 5b E1: the "clean relative paths" claim is about what bsdtar WROTE,
  // so it is asserted on its raw listing. listZipEntries normalizes (`./`
  // dropped, backslashes → /), and the same assertions on its result were
  // always true: a zip built with `-C dist . --exclude admin` passed them.
  const raw = await rawZipEntries(zipPath);
  assert.deepEqual(raw.filter((e) => !e.endsWith('/')).sort(), FILES_OF_DIST,
    `as written by bsdtar: the files under clean relative paths, got ${JSON.stringify(raw)}`);
  assert.deepEqual(raw.filter((e) => e.endsWith('/')).sort(), ['css/', 'item/'], `directory entries are relative and unprefixed too, got ${JSON.stringify(raw)}`);
  assert.ok((await fs.stat(zipPath)).size > 0, 'the archive is non-empty');
});

test('createZip → extract: the archive unpacks back to dist minus admin/', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'zip-roundtrip');
  const dist = await makeDist(root);
  const zipPath = path.join(root, 'offline-wiki-test.zip');
  await createZip(dist, zipPath);

  const out = path.join(root, 'unpacked');
  await fs.mkdir(out);
  await execFileP(BSDTAR, ['-xf', zipPath, '-C', out]);

  assert.equal(await fs.readFile(path.join(out, 'index.html'), 'utf8'), '<html></html>');
  assert.equal(await fs.readFile(path.join(out, 'css', 'theme.css'), 'utf8'), 'body{}\n');
  await assert.rejects(fs.access(path.join(out, 'admin')), 'admin/ did not travel');
});

// ---------- J₂ — reading the archive back: the second line of defence ----------

test('leakedAdminEntries: admin itself and anything under it is a leak; look-alikes are not', () => {
  assert.deepEqual(
    leakedAdminEntries(['admin', 'admin/index.html', 'admin/vendor/cms.js']),
    ['admin', 'admin/index.html', 'admin/vendor/cms.js'],
  );
  assert.deepEqual(leakedAdminEntries(['ADMIN/index.html']), ['ADMIN/index.html'], 'case-insensitive: on win32 ADMIN/ is admin/');
  assert.deepEqual(
    leakedAdminEntries(['index.html', 'admin.html', 'item/admin.html', 'css/admin/x.css', 'assets/js/search.js']),
    [],
    'only the top-level admin/ tree counts',
  );
});

// ---------- K — the whole thing: build + pack ----------

/** posix paths of every file under dir, relative to dir. */
async function relativeFiles(dir) {
  return (await listFiles(dir)).map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
}

test('packSite: a fresh build + one zip that holds exactly dist minus admin/ and lives outside dist', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'pack');
  const distDir = path.join(root, 'dist');
  const zipPath = path.join(root, 'offline-wiki-test.zip');
  // An admin/ tree the audit would reject (it loads an outside image; an
  // outside <a href> stopped being a violation with task 6b A1): it must
  // reach dist (injected after the audit) and must NOT reach the zip.
  const adminDir = path.join(root, 'admin');
  await fs.mkdir(path.join(adminDir, 'vendor'), { recursive: true });
  await fs.writeFile(path.join(adminDir, 'index.html'), '<a href="https://example.com/login">sign in</a><img src="https://example.com/logo.png" alt=""/>');
  await fs.writeFile(path.join(adminDir, 'vendor', 'cms.js'), '// cms\n');
  await fs.writeFile(zipPath, 'stale zip from an earlier pack');

  const result = await packSite({ distDir, zipPath, contentDir: path.join(REPO_ROOT, 'content'), adminDir, warn: noop });

  // built: the site, and the shell injected after the audit
  await fs.access(path.join(distDir, 'index.html'));
  await fs.access(path.join(distDir, 'css', 'theme.css'));
  await fs.access(path.join(distDir, 'admin', 'index.html'));
  assert.equal(result.build.adminInjected, true, 'the build result is passed through');
  // packed: exactly the files of dist minus admin/, under clean relative paths
  const expected = (await relativeFiles(distDir)).filter((f) => !f.startsWith('admin/'));
  assert.ok(expected.includes('index.html') && expected.includes('css/theme.css'), 'sanity: the built site is in dist');
  assert.deepEqual(result.entries.filter((e) => !e.endsWith('/')).sort(), expected, 'zip files === dist files minus admin/');
  assert.deepEqual(leakedAdminEntries(result.entries), [], 'no admin/ entry of any kind');
  // E1: clean relative paths as WRITTEN (listZipEntries would normalize them)
  const raw = await rawZipEntries(zipPath);
  assert.deepEqual(raw.filter((e) => !e.endsWith('/')).sort(), expected, `raw listing: the files, unprefixed, got ${JSON.stringify(raw.slice(0, 5))}…`);
  for (const entry of raw) {
    assert.ok(entry !== '.' && !entry.startsWith('./') && !entry.startsWith('/') && !entry.startsWith('../') && !entry.includes('\\'),
      `relative posix path without ./ prefix, got ${JSON.stringify(entry)}`);
  }
  // placed: outside dist, no zip (and no temp file) inside it
  assert.equal(result.zipPath, zipPath);
  assert.notEqual(await fs.readFile(zipPath, 'utf8'), 'stale zip from an earlier pack', 'the stale zip was replaced');
  assert.ok(path.relative(distDir, zipPath).startsWith('..'), 'the zip lives outside dist');
  assert.deepEqual((await relativeFiles(distDir)).filter((f) => f.endsWith('.zip')), [], 'no zip inside dist');
  assert.deepEqual((await fs.readdir(root)).filter((n) => n.endsWith('.zip')), ['offline-wiki-test.zip'], 'no temp zip left behind');
  assert.ok(Number.isInteger(result.size) && result.size > 0 && result.size < MAX_ZIP_BYTES, `size ${result.size}`);
});

test('packSite: by default the zip is named after package.json and lands beside dist, not inside it', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'pack-default');
  const packageJsonPath = path.join(root, 'package.json');
  await fs.writeFile(packageJsonPath, '{ "version": "0.0.0-test" }\n');
  const distDir = path.join(root, 'dist');

  const result = await packSite({ distDir, packageJsonPath, contentDir: null, adminDir: null, warn: noop });

  assert.equal(result.zipPath, path.join(root, 'offline-wiki-0.0.0-test.zip'));
  assert.equal(path.dirname(result.zipPath), path.dirname(distDir), 'same parent as dist — beside it');
  await fs.access(result.zipPath);
  assert.deepEqual((await relativeFiles(distDir)).filter((f) => f.endsWith('.zip')), [], 'no zip inside dist');
});

test('packSite: a failed build aborts packing — no zip is written and a previous one is left alone', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'pack-build-fail');
  const zipPath = path.join(root, 'offline-wiki-test.zip');
  await fs.writeFile(zipPath, 'previous zip');
  const contentDir = path.join(root, 'content'); // an id-lint violation: the build must go red before anything else
  await fs.mkdir(path.join(contentDir, 'items'), { recursive: true });
  await fs.writeFile(path.join(contentDir, 'items', 'fake_id.md'), 'x');

  const { err, exitCode } = await capturingExitCode(() =>
    packSite({ distDir: path.join(root, 'dist'), zipPath, contentDir, adminDir: null, warn: noop }));

  assert.ok(err instanceof Error, `expected the failed build to abort packing, got ${err}`);
  assert.match(err.message, /fake_id\.md/);
  assert.equal(exitCode, 1, 'non-zero exit, never a silent skip');
  assert.equal(await fs.readFile(zipPath, 'utf8'), 'previous zip', 'the previous zip is untouched');
  await assert.rejects(fs.access(path.join(root, 'dist')), 'dist was not even created');
});

test('packSite: a zip path inside dist is refused before the build — the previous dist is left alone, exitCode 1', async (t) => {
  const root = await tmpDir(t, 'pack-guard');
  const distDir = path.join(root, 'dist');
  await fs.mkdir(distDir, { recursive: true });
  const sentinel = path.join(distDir, 'sentinel-from-previous-build.html');
  await fs.writeFile(sentinel, '<title>previous build</title>');

  // E3: every packSite failure sets process.exitCode, like buildSkeleton's.
  const { err, exitCode } = await capturingExitCode(() => packSite(
    { distDir, zipPath: path.join(distDir, 'offline-wiki-test.zip'), contentDir: null, adminDir: null, warn: noop }));

  assert.ok(err instanceof Error, `expected the self-inclusion guard to throw, got ${err}`);
  assert.match(err.message, /outside dist/, 'the self-inclusion guard fires');
  assert.equal(exitCode, 1, 'refusing is a failed pack, never a silent skip');
  assert.equal(await fs.readFile(sentinel, 'utf8'), '<title>previous build</title>', 'refused before the build touched dist');
  assert.deepEqual((await fs.readdir(distDir)).sort(), ['sentinel-from-previous-build.html'], 'dist otherwise untouched');
});

// ---------- Task 5b E2 + E3 — the missing-bsdtar branch, and a failed pack always exits 1 ----------

test('packSite: no bsdtar → "[pack] bsdtar not found", exitCode 1, the previous zip untouched, no temp zip left', async (t) => {
  const root = await tmpDir(t, 'pack-no-bsdtar');
  const zipPath = path.join(root, 'offline-wiki-test.zip');
  await fs.writeFile(zipPath, 'previous zip');
  // The executable is injectable, so the branch is testable on a machine
  // that HAS bsdtar — and this test does not depend on having it.
  const executable = path.join(root, 'no-such-dir', 'bsdtar');
  const distDir = path.join(root, 'dist');

  const { err, exitCode } = await capturingExitCode(() =>
    packSite({ distDir, zipPath, contentDir: null, adminDir: null, warn: noop, executable }));

  assert.ok(err instanceof Error, `expected the missing bsdtar to fail the pack, got ${err}`);
  assert.match(err.message, /^\[pack\] bsdtar not found: /);
  assert.ok(err.message.includes(executable), `names the executable, got: ${err.message}`);
  assert.equal(exitCode, 1, 'E3: a pack-stage failure sets process.exitCode, as buildSkeleton does');
  assert.equal(await fs.readFile(zipPath, 'utf8'), 'previous zip', 'the previous zip was not replaced');
  assert.deepEqual((await fs.readdir(root)).filter((n) => n.endsWith('.zip')), ['offline-wiki-test.zip'], 'no temp zip left behind');
  await assert.doesNotReject(fs.access(path.join(distDir, 'index.html')), 'the build itself had succeeded — only the packing failed');
});

test('packSite: an unreadable package.json is a failed pack too — exitCode 1, nothing built or written', async (t) => {
  const root = await tmpDir(t, 'pack-bad-package');
  const packageJsonPath = path.join(root, 'package.json');
  await fs.writeFile(packageJsonPath, '{ not json');

  const { err, exitCode } = await capturingExitCode(() =>
    packSite({ distDir: path.join(root, 'dist'), packageJsonPath, contentDir: null, adminDir: null, warn: noop }));

  assert.ok(err instanceof SyntaxError, `expected the JSON error, got ${err}`);
  assert.equal(exitCode, 1);
  await assert.rejects(fs.access(path.join(root, 'dist')), 'no dist was built');
  assert.deepEqual((await fs.readdir(root)).filter((n) => n.endsWith('.zip')), [], 'no zip was written');
});

// ---------- Task 5b D2 — retries ----------
//
// Windows answers EBUSY/EPERM/ENOTEMPTY to a file operation while another
// process (or a just-exited one) still holds a handle — the tests' own
// cleanup ran into it (task 5 report). Those transient failures cannot be
// produced deterministically, let alone portably, so what is pinned here is
// the policy: the options the build hands to fs.rm, and the retry loop
// around the one rename.

/** A rename that fails the first `failures` calls with `code`, then works. Counts its calls. */
function flakyRename(failures, code) {
  let left = failures;
  const calls = [];
  return {
    calls,
    rename: async (from, to) => {
      calls.push([from, to]);
      if (left > 0) {
        left -= 1;
        throw Object.assign(new Error(`${code}: busy`), { code });
      }
    },
  };
}

test('renameWithRetries: EBUSY/EPERM/ENOTEMPTY… are retried with a linear backoff (fs.rm\'s policy); other codes, or too many, are thrown as is', async () => {
  const pauses = [];
  const pause = async (ms) => { pauses.push(ms); };

  for (const code of ['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']) {
    pauses.length = 0;
    const flaky = flakyRename(2, code);
    await renameWithRetries('tmp.zip', 'final.zip', { rename: flaky.rename, pause });
    assert.deepEqual(flaky.calls, [['tmp.zip', 'final.zip'], ['tmp.zip', 'final.zip'], ['tmp.zip', 'final.zip']], `${code}: recovers on the 3rd attempt`);
    assert.deepEqual(pauses, [100, 200], `${code}: retryDelay × attempt, like fs.rm`);
  }

  pauses.length = 0;
  const hopeless = flakyRename(99, 'EBUSY');
  await assert.rejects(renameWithRetries('a', 'b', { rename: hopeless.rename, pause }), { code: 'EBUSY' });
  assert.equal(hopeless.calls.length, 4, 'maxRetries 3 → at most 4 attempts');
  assert.deepEqual(pauses, [100, 200, 300]);

  pauses.length = 0;
  const gone = flakyRename(99, 'ENOENT');
  await assert.rejects(renameWithRetries('a', 'b', { rename: gone.rename, pause }), { code: 'ENOENT' });
  assert.equal(gone.calls.length, 1, 'an error fs.rm would not retry either is not retried');
  assert.deepEqual(pauses, [], '…and costs no waiting');
});

test('renameWithRetries: underneath it is fs.rename — a real file moves, once, with nothing to retry', async (t) => {
  const root = await tmpDir(t, 'rename-real');
  const from = path.join(root, 'from.txt');
  const to = path.join(root, 'to.txt');
  await fs.writeFile(from, 'x');
  let attempts = 0;
  const realRename = fs.rename;
  fs.rename = async (a, b) => { attempts += 1; return realRename(a, b); };
  t.after(() => { fs.rename = realRename; });

  await renameWithRetries(from, to, { pause: async () => { assert.fail('a working rename never waits'); } });

  assert.equal(attempts, 1);
  assert.equal(await fs.readFile(to, 'utf8'), 'x');
  await assert.rejects(fs.access(from));
});

test('packSite: the temporary zip is renamed onto the final name through the retrying rename, and cleaned up with fs.rm retries', { skip: !hasBsdtar }, async (t) => {
  const root = await tmpDir(t, 'pack-retries');
  const distDir = path.join(root, 'dist');
  const zipPath = path.join(root, 'offline-wiki-test.zip');
  const tmpZip = `${zipPath}.tmp.zip`;
  // fs/promises is one module object: record what packSite hands to it.
  const seen = { rm: [], rename: [] };
  const real = { rm: fs.rm, rename: fs.rename };
  fs.rm = async (p, opts) => { seen.rm.push({ p: path.resolve(p), opts }); return real.rm(p, opts); };
  fs.rename = async (a, b) => { seen.rename.push([path.resolve(a), path.resolve(b)]); return real.rename(a, b); };
  t.after(() => { fs.rm = real.rm; fs.rename = real.rename; });

  await packSite({ distDir, zipPath, contentDir: null, adminDir: null, warn: noop });

  assert.deepEqual(seen.rename, [[tmpZip, zipPath]], 'exactly one rename: the verified temp zip → the final name');
  const rmOfTmp = seen.rm.find((call) => call.p === path.resolve(tmpZip));
  assert.ok(rmOfTmp !== undefined, 'fs.rm was called for the temp zip (the finally cleanup)');
  assert.ok(Number.isInteger(rmOfTmp.opts.maxRetries) && rmOfTmp.opts.maxRetries >= 1, `maxRetries, got ${JSON.stringify(rmOfTmp.opts)}`);
  assert.ok(Number.isInteger(rmOfTmp.opts.retryDelay) && rmOfTmp.opts.retryDelay > 0, `retryDelay, got ${JSON.stringify(rmOfTmp.opts)}`);
  await assert.rejects(fs.access(tmpZip), 'no temp zip left behind');
});

// ---------- Task 6b D4 — the retry policy lives in ONE place ----------
//
// There used to be two copies of { maxRetries: 3, retryDelay: 100 }: one in
// pack.js, one spelled out in the fs.rm call of the build entry. Equal values
// in two places are exactly what drifts apart. The build entry now owns the
// object and exports it; pack.js uses that same object.

test('D4 — the retry policy is one object: what pack.js uses is the very object buildSkeleton hands to fs.rm', async (t) => {
  const { RETRY } = require('../tools/pack.js');
  const { RETRY: buildRetry } = require('../tools/build/skeleton-build.js');
  assert.equal(typeof buildRetry, 'object', 'the build entry exports its retry policy');
  assert.ok(Object.isFrozen(buildRetry), '…frozen: a policy is not edited at run time');
  assert.deepEqual({ ...buildRetry }, { maxRetries: 3, retryDelay: 100 }, 'the values the tests above pin, unchanged');
  assert.equal(RETRY, buildRetry, 'pack.js re-exports that same object — there is no second copy to drift');

  // …and both entries really hand it to the fs: what reaches fs.rm is
  // { recursive, force, …RETRY } / { force, recursive, …RETRY }, to the letter.
  const seen = { rm: [] };
  const real = { rm: fs.rm, rename: fs.rename };
  fs.rm = async (p, opts) => { seen.rm.push({ p: path.resolve(p), opts: { ...opts } }); return real.rm(p, opts); };
  fs.rename = async (a, b) => real.rename(a, b);
  t.after(() => { fs.rm = real.rm; fs.rename = real.rename; });
  const root = await tmpDir(t, 'one-retry-policy');
  const distDir = path.join(root, 'dist');
  const zipPath = path.join(root, 'offline-wiki-test.zip');

  const { err } = await capturingExitCode(() => packSite({
    distDir, zipPath, contentDir: null, adminDir: null, warn: noop,
    executable: path.join(root, 'no-such-dir', 'bsdtar'), // not there: the build runs, the packing fails — both get observed
  }));
  assert.ok(err instanceof Error, `the packing fails for want of bsdtar, after the build ran, got ${err}`);
  assert.match(err.message, /bsdtar not found/);

  const rmOfDist = seen.rm.find((call) => call.p === path.resolve(distDir));
  const rmOfTmpZip = seen.rm.find((call) => call.p === path.resolve(`${zipPath}.tmp.zip`));
  assert.ok(rmOfDist !== undefined && rmOfTmpZip !== undefined, `fs.rm was called for dist and for the temp zip, got ${JSON.stringify(seen.rm)}`);
  assert.deepEqual(rmOfDist.opts, { recursive: true, force: true, ...buildRetry }, 'the build entry: fs.rm(dist, { recursive, force, …RETRY })');
  assert.deepEqual(rmOfTmpZip.opts, { force: true, recursive: true, ...buildRetry }, 'pack.js: fs.rm(tmp zip, { force, recursive, …RETRY })');
});
