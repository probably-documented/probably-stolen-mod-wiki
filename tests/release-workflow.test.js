'use strict';

// The release workflow. The workflow itself is exercised by CI — that is where it either
// publishes an offline package or not. What these assertions pin is the part that must not be
// dropped by accident: three triggers and one rule, the decision before anything runs, nothing
// tested, built or published unless the decision says so, and the zip never carrying the CMS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'release-offline.yml');
const workflow = () => fs.readFileSync(WORKFLOW, 'utf8');

/** The lines of one named step, from its `- name:` to the next step. */
function step(name) {
  const text = workflow();
  const start = text.indexOf(`- name: ${name}`);
  assert.ok(start !== -1, `the step "${name}" is there`);
  const end = text.indexOf('\n      - ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

test('release workflow: it runs on every push to main, every third day, and by hand', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n\s+push:\r?\n\s+branches:\s*\[main\]/m);
  assert.match(text, /^\s+schedule:\r?\n\s+- cron:\s*'[\d*]+ [\d*]+ \*\/3 [\d*]+ [\d*]+'/m);
  assert.match(text, /^\s+workflow_dispatch:/m);
});

test('release workflow: only contents is writeable — the release and its tag are all it creates', () => {
  const block = /^permissions:\r?\n((?:[ \t]+[^\r\n]+\r?\n)+)/m.exec(workflow());
  assert.ok(block, 'a permissions block is there');
  assert.deepEqual([...block[1].matchAll(/[ \t]+([^\s:]+):\s*(\S+)/g)].map((m) => `${m[1]}: ${m[2]}`), ['contents: write']);
});

test('release workflow: the decision comes first, from the one policy, made on the full history', () => {
  const text = workflow();
  const decide = text.indexOf('node tools/should-release.js --github-output "$GITHUB_OUTPUT"');
  assert.ok(decide !== -1, 'should-release.js decides and writes the step outputs');
  for (const later of ['npm test', 'node tools/pack.js', 'gh release create']) {
    assert.ok(text.indexOf(later) > decide, `${later} comes after the decision`);
  }
  assert.match(text, /fetch-depth:\s*0/);
});

test('release workflow: nothing is tested, built or published unless the decision says so', () => {
  for (const name of ['Test', 'Build and pack', 'Check the offline zip', 'Write the release notes', 'Publish the release']) {
    assert.match(step(name), /if:\s*steps\.decide\.outputs\.release == 'true'/, `"${name}" is gated on the decision`);
  }
});

test('release workflow: the zip is named by the decision, refused if it carries the CMS, attached to this commit', () => {
  assert.match(step('Build and pack'), /node tools\/pack\.js "\$ZIP"/);
  assert.match(step('Build and pack'), /ZIP:\s*\$\{\{ steps\.decide\.outputs\.zip \}\}/);
  assert.ok(step('Check the offline zip').includes('bsdtar -tf "$ZIP" | grep -qiE \'^(\\./)?admin/\''),
    'the zip is listed and an admin/ entry fails the run');
  const publish = step('Publish the release');
  assert.match(publish, /gh release create "\$TAG" "\$ZIP"/);
  assert.match(publish, /--target "\$\(git rev-parse HEAD\)"/);
});

test('release workflow: every reference to the decision is one of its five outputs, spelled in full', () => {
  // A typo in one of these — a missing dot, a misspelt key — is silent in a workflow file:
  // the expression just expands to nothing, and the step runs with an empty name. So every
  // expression that mentions steps is read, the malformed ones included, and each has to be
  // one of the decision's outputs. (The `if:` lines carry no braces; another test pins them.)
  const refs = [...workflow().matchAll(/\$\{\{([^}]*)\}\}/g)].map((m) => m[1].trim()).filter((expr) => /\bsteps\b/.test(expr));
  assert.ok(refs.length >= 6, `REASON, three ZIP, PREVIOUS_TAG and TAG travel as expressions; got ${refs.length}`);
  for (const ref of refs) {
    assert.match(ref, /^steps\.decide\.outputs\.(reason|tag|zip|previous_tag)$/, `${ref} is one of the decision's outputs`);
  }
});

test('release workflow: Node 22 and bsdtar, one release at a time, every action held to a released major version', () => {
  const text = workflow();
  assert.match(text, /node-version:\s*22/);
  assert.match(text, /libarchive-tools/);
  assert.match(text, /concurrency:\r?\n\s+group:\s*release-offline\r?\n\s+cancel-in-progress:\s*false/);
  const used = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(used.length >= 2, 'the actions are there');
  for (const action of used) assert.match(action, /@v\d+$/, `${action} is pinned to a major`);
});
