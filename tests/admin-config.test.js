'use strict';

// Task 6 tests: the CMS shell (admin/) and its Sveltia CMS configuration.
//
// admin/ is copied into dist/admin/ by buildSkeleton after the external-link
// audit, so none of it is covered by the file:// offline discipline — and
// none of the existing tests looked at it. What is pinned here:
//
//   J — the vendored bundle is the official artifact, byte for byte. The
//       proof that survives a clone is its sha256 recorded next to it
//       (admin/vendor/PROVENANCE.md), and the file must come out of git
//       unconverted on every platform (.gitattributes `-text`), or that
//       comparison would fail on a Windows checkout.
//   index.html — the CMS page loads the one local bundle as a classic
//       script and nothing else: no remote script or stylesheet (the shell
//       is the only part of dist that may talk to the network, and even it
//       must start from files the site ships), and it tells search engines
//       not to index it.
//
// Everything here is offline: no registry, no CDN — the bundle is compared
// with the digest that was written down when it was vendored.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..');
const ADMIN_DIR = path.join(REPO_ROOT, 'admin');
const BUNDLE_REL = 'admin/vendor/sveltia-cms.js';
const BUNDLE_PATH = path.join(REPO_ROOT, ...BUNDLE_REL.split('/'));
const PROVENANCE_PATH = path.join(ADMIN_DIR, 'vendor', 'PROVENANCE.md');
const GITATTRIBUTES_PATH = path.join(REPO_ROOT, '.gitattributes');
const INDEX_PATH = path.join(ADMIN_DIR, 'index.html');

const readText = (file) => fs.readFile(file, 'utf8');

/** Values of every `src="…"` / `href="…"` attribute in an HTML document. */
const resourceRefs = (html) => [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);

/** Has a scheme (http:, https:, data:, …) or is protocol-relative (//host/…). */
const isRemote = (ref) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);

test('J — vendored bundle: admin/vendor/sveltia-cms.js is byte-identical to the digest recorded in PROVENANCE.md', async () => {
  const [bundle, provenance] = await Promise.all([
    fs.readFile(BUNDLE_PATH),
    readText(PROVENANCE_PATH),
  ]);

  // One explicit line, so the digest cannot be confused with the tarball's
  // sha1 or the registry's base64 integrity value on the same page.
  const recorded = /^sha256\(sveltia-cms\.js\) = `([0-9a-f]{64})`$/m.exec(provenance);
  assert.ok(recorded !== null,
    'PROVENANCE.md must carry the line: sha256(sveltia-cms.js) = `<64 hex digits>`');

  const actual = createHash('sha256').update(bundle).digest('hex');
  assert.equal(actual, recorded[1], `${BUNDLE_REL} differs from the vendored (official) bytes`);
});

test('J — .gitattributes marks the bundle -text, so no platform converts its line endings on checkout', async () => {
  const rules = (await readText(GITATTRIBUTES_PATH))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  const rule = rules.find((line) => line.split(/\s+/)[0] === BUNDLE_REL);
  assert.ok(rule !== undefined, `.gitattributes has no rule for ${BUNDLE_REL}`);
  const attrs = rule.split(/\s+/).slice(1);
  assert.ok(attrs.includes('-text'), `${BUNDLE_REL}: expected the -text attribute, got ${JSON.stringify(attrs)}`);
});

test('index.html loads only the local bundle, as a classic script — no remote script or stylesheet', async () => {
  const html = await readText(INDEX_PATH);

  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  const srcOf = (attrs) => /\bsrc\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? null;
  assert.deepEqual(scripts.map(srcOf), ['./vendor/sveltia-cms.js'],
    'exactly one script, pointing at the vendored bundle next to this page');
  for (const attrs of scripts) {
    assert.doesNotMatch(attrs, /\btype\s*=/i, 'the bundle is a classic script, not an ES module');
  }

  const remote = resourceRefs(html).filter(isRemote);
  assert.deepEqual(remote, [], 'the CMS page must not load anything over the network to get started');
});

test('index.html tells search engines not to index the CMS', async () => {
  const html = await readText(INDEX_PATH);
  assert.match(html, /<meta\s+name\s*=\s*["']robots["']\s+content\s*=\s*["']noindex["']\s*\/?\s*>/i);
});
