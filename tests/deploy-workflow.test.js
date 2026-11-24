'use strict';

// Task 7: the deploy workflow. The workflow itself is exercised by CI — that is
// where it either deploys the site or not. What these assertions pin is the
// part that must not be dropped by accident: the tests run before anything is
// published, the offline zip is built the same way as locally, and every
// action is held to a released major version.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml');
const workflow = () => fs.readFileSync(WORKFLOW, 'utf8');

test('deploy workflow: the site is built on every push to main, and by hand', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n\s+push:\r?\n\s+branches:\s*\[main\]/m);
  assert.match(text, /^\s+workflow_dispatch:/m);
});

test('deploy workflow: the whole test suite runs before anything is built or uploaded', () => {
  const text = workflow();
  const tested = text.indexOf('npm test');
  const packed = text.indexOf('npm run pack');
  const uploaded = text.indexOf('actions/upload-pages-artifact@');
  assert.ok(tested >= 0, 'the workflow runs npm test');
  assert.ok(packed > tested, 'npm run pack comes after npm test');
  assert.ok(uploaded > packed, 'the site is uploaded only after test and pack');
});

test('deploy workflow: the site is dist, and the offline zip is a separate artifact', () => {
  const text = workflow();
  assert.match(text, /actions\/upload-pages-artifact@v\d+\r?\n\s+with:\r?\n\s+path:\s*dist\r?\n/);
  assert.match(text, /actions\/upload-artifact@v\d+\r?\n\s+with:\r?\n\s+name:\s*offline-wiki\r?\n\s+path:\s*offline-wiki-\*\.zip/);
});

test('deploy workflow: an offline zip that carries the CMS fails the run', () => {
  // dist/admin/ is the CMS shell: it is served online, and left out of the zip.
  assert.ok(
    workflow().includes("bsdtar -tf offline-wiki-*.zip | grep -qiE '^(\\./)?admin/'"),
    'the run fails when the zip holds admin/',
  );
});

test('deploy workflow: Pages needs its two permissions, and nothing else is writeable', () => {
  const block = /^permissions:\r?\n((?:[ \t]+[^\r\n]+\r?\n)+)/m.exec(workflow());
  assert.ok(block, 'a permissions block is there');
  const granted = [...block[1].matchAll(/[ \t]+([^\s:]+):\s*(\S+)/g)].map((m) => `${m[1]}: ${m[2]}`).sort();
  assert.deepEqual(
    granted,
    ['contents: read', 'id-token: write', 'pages: write'],
  );
});

test('deploy workflow: the run needs Node 22 and bsdtar, as the pack step does locally', () => {
  const text = workflow();
  assert.match(text, /node-version:\s*22/);
  assert.match(text, /libarchive-tools/);
});

test('deploy workflow: deployment is the Pages deploy action, under the pages environment, one at a time', () => {
  const text = workflow();
  assert.match(text, /actions\/deploy-pages@v\d+/);
  assert.match(text, /environment:\r?\n\s+name:\s*github-pages/);
  assert.match(text, /concurrency:\r?\n\s+group:\s*pages/);
});

test('deploy workflow: every action is held to a released major version', () => {
  const used = [...workflow().matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 6, 'the actions are there');
  for (const action of used) assert.match(action, /@v\d+$/, `${action} is pinned to a major`);
});
