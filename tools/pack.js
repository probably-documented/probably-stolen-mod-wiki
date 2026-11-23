'use strict';

// Task 5: pack entry — `npm run pack` = a fresh build + ONE offline zip of
// dist: `<repo>/offline-wiki-<package.json version>.zip`. Simplified from
// modwiki tools/pack.js; what is kept from it, and why:
//
//   • The build runs through the same buildSkeleton that `npm run build`
//     runs, so the archive is always made from a fresh, audit-passed dist/
//     and a failed build (exit code 1) aborts packing.
//   • Size gate: the delivered zip must stay under 100 MB (spec §9).
//   • Self-inclusion guard: the zip is written OUTSIDE dist. bsdtar archives
//     while it walks dist, so a zip created inside dist could archive its own
//     half-written bytes. Here the final location is outside dist to begin
//     with (next to it, in the repo root), and the file is still written to a
//     temporary name first and renamed into place — an interrupted pack never
//     leaves a truncated file under the delivered name.
//
// What differs from modwiki, on purpose:
//
//   • Cross-platform (ruling 1). One bsdtar command; only the executable is
//     resolved per platform: CI runs on Linux, where GNU tar cannot write a
//     zip, so Linux uses `bsdtar` (libarchive-tools). A missing executable is
//     an explicit error.
//   • admin/ is never packed (ruling 2, whether or not the directory exists):
//     the CMS shell is online-only (OAuth callbacks), and the offline zip must
//     stay double-clickable via file://. bsdtar is handed the top-level
//     entries of dist EXCEPT `admin` instead of `.` + --exclude: explicit
//     names are matched by no pattern on any platform, and they come out as
//     clean relative paths (no `./` prefix). The produced archive is then
//     read back and refused if it carries admin/ anyway.
//   • The zip lives in the repo root instead of dist, so stale-zip cleanup
//     inside dist no longer applies (`*.zip` is git-ignored).

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { buildSkeleton } = require('./build/skeleton-build.js');
const { isInsideDir } = require('./build/paths.js');

const execFileP = promisify(execFile);

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// bsdtar
// ---------------------------------------------------------------------------

/**
 * The bsdtar executable for a platform. Same command on every platform; only
 * this differs. Pure, so the mapping is unit-testable from any OS.
 * @param {string} [platform] defaults to process.platform
 * @param {Record<string, string|undefined>} [env] defaults to process.env
 * @returns {string} absolute path on win32, a bare name resolved via PATH
 *   elsewhere
 * @throws {Error} on a platform without a mapping
 */
function resolveBsdtar(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    // Windows 10 1803+ bundles bsdtar as tar.exe (libarchive).
    return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  }
  if (platform === 'darwin') return 'tar'; // /usr/bin/tar is bsdtar
  if (platform === 'linux') return 'bsdtar'; // libarchive-tools; GNU tar cannot write zip
  throw new Error(`[pack] no bsdtar mapping for platform "${platform}" (supported: win32, darwin, linux)`);
}

const BSDTAR = resolveBsdtar();

// ---------------------------------------------------------------------------
// Name and size
// ---------------------------------------------------------------------------

/** spec §9: delivered zip must stay under 100 MB. */
const MAX_ZIP_BYTES = 100 * 1024 * 1024;

/** Version strings become file names — keep them path-safe. */
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

/** Human-readable byte count. */
function fmtBytes(n) {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function assertPathSafeVersion(version) {
  if (typeof version !== 'string' || !VERSION_RE.test(version)) {
    throw new Error(`[pack] version missing or not path-safe (it becomes a file name): ${JSON.stringify(version)}`);
  }
}

/** package.json text → its `version`, refused unless path-safe. */
function readVersion(packageJsonText) {
  const version = JSON.parse(packageJsonText)?.version;
  assertPathSafeVersion(version);
  return version;
}

/** `<version>` → `offline-wiki-<version>.zip`. */
function zipName(version) {
  assertPathSafeVersion(version);
  return `offline-wiki-${version}.zip`;
}

/** Throw unless `size` is strictly under MAX_ZIP_BYTES. */
function assertUnderSizeLimit(size) {
  if (!Number.isInteger(size) || size < 0) throw new Error(`[pack] not a byte size: ${size}`);
  if (size >= MAX_ZIP_BYTES) {
    throw new Error(`[pack] FAIL — zip is ${fmtBytes(size)}: not under the 100 MB limit (spec §9)`);
  }
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/** The one top-level dist entry the offline zip never carries. */
const EXCLUDED_TOP_LEVEL = 'admin';

/**
 * Self-inclusion guard: the zip must live OUTSIDE dist. bsdtar archives while
 * it walks, so a zip inside dist could end up holding its own half-written
 * bytes. Pure (no I/O) — called before anything is built or written.
 * @throws {Error} when zipPath is distDir itself or underneath it
 */
function assertZipOutsideDist(distDir, zipPath) {
  if (isInsideDir(distDir, zipPath)) {
    throw new Error(`[pack] refusing to write the zip inside dist: ${path.resolve(zipPath)} — it must be outside dist so bsdtar can never archive its own output`);
  }
}

/**
 * Run bsdtar; a missing executable becomes an explicit, actionable error.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
async function runBsdtar(args) {
  try {
    return await execFileP(BSDTAR, args, { maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`[pack] bsdtar not found: ${BSDTAR} (install libarchive-tools on Debian/Ubuntu)`, { cause: err });
    }
    throw err;
  }
}

/**
 * Archive distDir into zipPath (zip format, selected by the .zip extension).
 *
 * bsdtar is handed the top-level entries of dist EXCEPT `admin`, by name:
 * explicit names are subject to no `--exclude` pattern matching (which differs
 * between bsdtar versions and platforms) and are stored as given, i.e. as
 * clean relative paths without the `./` prefix that `-C dist .` produces.
 * The exclusion holds whether or not dist/admin exists.
 *
 * Guards, both before bsdtar runs:
 *   - zipPath must live OUTSIDE distDir (assertZipOutsideDist)
 *   - at least one entry must remain; with no operands some bsdtar builds fall
 *     back to archiving the whole -C directory, admin/ included
 */
async function createZip(distDir, zipPath) {
  const dist = path.resolve(distDir);
  const zip = path.resolve(zipPath);
  assertZipOutsideDist(dist, zip);
  let names;
  try {
    names = await fs.readdir(dist);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      throw new Error(`[pack] nothing to pack: no dist at ${dist}`, { cause: err });
    }
    throw err;
  }
  const entries = names.filter((name) => name !== EXCLUDED_TOP_LEVEL).sort();
  if (entries.length === 0) {
    throw new Error(`[pack] nothing to pack: ${dist} holds no entries besides ${EXCLUDED_TOP_LEVEL}/`);
  }
  // `--` ends the options: an entry name may never be read as a flag.
  await runBsdtar(['-a', '-c', '-f', zip, '-C', dist, '--', ...entries]);
}

/**
 * Entries of an archive as bsdtar lists them, normalized: `./` prefixes
 * dropped, posix separators, blank lines removed. Directory entries keep
 * their trailing `/`.
 * @returns {Promise<string[]>}
 */
async function listZipEntries(zipPath) {
  const { stdout } = await runBsdtar(['-tf', path.resolve(zipPath)]);
  return stdout
    .split(/\r?\n/)
    .map((entry) => entry.replace(/^\.\//, '').replace(/\\/g, '/'))
    .filter((entry) => entry !== '' && entry !== '.');
}

/**
 * Entries that would leak the CMS shell: the top-level `admin` entry itself
 * or anything under it. Case-insensitive on purpose — on win32 `ADMIN/` IS
 * `admin/`, and the zip must not carry the shell under any spelling. Names
 * that merely contain the word (`admin.html`, `item/admin.html`) are fine.
 * @param {string[]} entries as returned by listZipEntries
 * @returns {string[]}
 */
function leakedAdminEntries(entries) {
  return entries.filter((entry) => /^admin(?:\/|$)/i.test(entry));
}

// ---------------------------------------------------------------------------
// Retries (task 5b D2, ruling P)
// ---------------------------------------------------------------------------

/**
 * fs.rm's own retry options (3 tries, 100 ms, linear backoff), as the tests'
 * cleanup already uses them: on Windows an operation on a file that was just
 * written can answer EBUSY/EPERM/ENOTEMPTY while a handle is still being
 * released.
 */
const RETRY = Object.freeze({ maxRetries: 3, retryDelay: 100 });

/** The error codes Node's fs.rm retries — the same set, for the rename below. */
const RETRYABLE_RENAME_ERRORS = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * fs.rename with fs.rm's retry policy. fs.rename takes no maxRetries /
 * retryDelay of its own (it is not a recursive removal), and the one rename
 * in packSite — the verified temporary zip moved onto the delivered name,
 * replacing the previous zip — is exactly the kind of operation that meets a
 * handle another process still holds on Windows. So the policy is applied
 * by hand: the error codes fs.rm retries, a linear backoff of
 * retryDelay × attempt, at most maxRetries extra attempts, then the error is
 * thrown as it was.
 * @param {string} from
 * @param {string} to
 * @param {{maxRetries?: number, retryDelay?: number,
 *   rename?: (from: string, to: string) => Promise<void>,
 *   pause?: (ms: number) => Promise<void>}} [options] rename and pause are
 *   injectable for the tests; production uses fs.rename and a real timer.
 */
async function renameWithRetries(from, to, { maxRetries = RETRY.maxRetries, retryDelay = RETRY.retryDelay, rename = fs.rename, pause = sleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (!RETRYABLE_RENAME_ERRORS.has(err?.code) || attempt >= maxRetries) throw err;
      await pause((attempt + 1) * retryDelay);
    }
  }
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const DEFAULT_PACKAGE_JSON = path.join(ROOT, 'package.json');

/**
 * Build + pack: a fresh, audit-passed dist, then one offline zip of it.
 *
 * The build goes through buildSkeleton — the very function `npm run build`
 * runs — so the archive is always made from the site that would be deployed,
 * and a failed build (it sets process.exitCode = 1 and throws) aborts before
 * any archive is touched.
 *
 * The archive is first written under a temporary name beside the final one
 * (it has to end in `.zip`: bsdtar -a picks the format from the extension),
 * read back, and only then renamed into place. So nothing is ever delivered
 * under the final name unless it passed: no admin/ entry, under 100 MB. The
 * temporary file is removed whatever happens. Both the removal and the
 * rename retry on the transient errors Windows answers while a handle is
 * still held (task 5b D2).
 *
 * @param {{distDir?: string, zipPath?: string, packageJsonPath?: string,
 *   contentDir?: string|null, assetsDir?: string, adminDir?: string|null,
 *   warn?: (message: string) => void}} [options]
 *   zipPath defaults to `<dir of package.json>/offline-wiki-<version>.zip`,
 *   i.e. the repo root — outside dist. The other options go to buildSkeleton
 *   unchanged (assetsDir undefined = the repo's assets-src).
 * @returns {Promise<{zipPath: string, size: number, entries: string[],
 *   build: {pages: number, iconsDropped: number, assetsCopied: number,
 *   adminInjected: boolean}}>}
 * @throws {Error} on a failed build, a zip path inside dist, a leaked admin/
 *   entry, or a zip that is not under 100 MB; process.exitCode is 1 when the
 *   cause is a failed build.
 */
async function packSite({
  distDir = 'dist',
  zipPath,
  packageJsonPath = DEFAULT_PACKAGE_JSON,
  contentDir = 'content',
  assetsDir,
  adminDir = 'admin',
  warn = console.warn,
} = {}) {
  const version = readVersion(await fs.readFile(packageJsonPath, 'utf8'));
  const zip = path.resolve(zipPath ?? path.join(path.dirname(path.resolve(packageJsonPath)), zipName(version)));
  // 0. Self-inclusion guard first: a mis-placed zip must not cost a rebuild.
  assertZipOutsideDist(distDir, zip);

  // 1. Fresh build — logs and failure semantics exactly those of `npm run build`.
  const build = await buildSkeleton({ distDir, contentDir, assetsDir, adminDir, warn });

  // 2. Pack to a temporary name, verify, then put it under the final name.
  const tmpZip = `${zip}.tmp.zip`;
  try {
    await createZip(distDir, tmpZip);
    const entries = await listZipEntries(tmpZip);
    const leaked = leakedAdminEntries(entries);
    if (leaked.length > 0) {
      throw new Error(`[pack] FAIL — the offline zip carries admin/ (${leaked.length} entr${leaked.length === 1 ? 'y' : 'ies'}, e.g. ${leaked[0]})`);
    }
    const size = (await fs.stat(tmpZip)).size;
    assertUnderSizeLimit(size);
    await renameWithRetries(tmpZip, zip);
    return { zipPath: zip, size, entries, build };
  } finally {
    // recursive: true is what switches Node's retries on for a single file
    // too (maxRetries is ignored without it) — Windows may still hold a
    // handle on the freshly written zip (EBUSY/EPERM), as in the tests'
    // own cleanup.
    await fs.rm(tmpZip, { force: true, recursive: true, ...RETRY });
  }
}

async function main() {
  const result = await packSite();
  const { build, entries } = result;
  console.log(`[pack] build: ${build.pages} files rendered, ${build.assetsCopied} assets copied, audit OK, `
    + `admin ${build.adminInjected ? 'injected into dist' : 'not found'}`);
  const files = entries.filter((entry) => !entry.endsWith('/')).length;
  console.log(`[pack] zip ready — ${result.zipPath}`);
  console.log(`[pack] zip size: ${fmtBytes(result.size)} (${result.size} bytes, ${files} files, admin/ excluded)`);
  console.log('[pack] size check: OK (< 100 MB)');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[pack] fatal:', err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  BSDTAR, MAX_ZIP_BYTES, resolveBsdtar, readVersion, zipName, assertUnderSizeLimit,
  createZip, listZipEntries, leakedAdminEntries, packSite, renameWithRetries,
};
