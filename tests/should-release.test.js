'use strict';

// should-release.js: what the release workflow asks before it tests, builds and publishes.
// The commands are replaced by a stand-in, so what these assertions pin is how the API answer
// and git are read into the policy's input — and that a failure to read them stops the run
// instead of being taken for "no release yet".

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { latestFromApi, collectState, decide, main } = require('../tools/should-release.js');

const API = JSON.stringify({ tag_name: 'offline-2026-11-26', published_at: '2026-11-26T03:17:00Z' });
const NOT_FOUND = Object.assign(new Error('gh exited 1'), { stderr: 'gh: Not Found (HTTP 404)' });
const GIT = { 'rev-list -n 1 offline-2026-11-26^{commit}': 'tagsha\n', 'rev-parse HEAD': 'headsha\n' };

/** A stand-in for runFile: records the calls, answers gh and git from the given tables. */
function fakeRun({ api = API, git = GIT } = {}) {
  const calls = [];
  const runFile = async (file, args) => {
    calls.push([file, ...args]);
    if (file === 'gh') {
      if (api instanceof Error) throw api;
      return api;
    }
    if (args.join(' ') in git) return git[args.join(' ')];
    throw new Error(`unexpected call: git ${args.join(' ')}`);
  };
  return { calls, runFile };
}

test('latestFromApi: the tag name and the publish time come out of the API answer', () => {
  assert.deepEqual(latestFromApi(API), { tagName: 'offline-2026-11-26', publishedAt: new Date('2026-11-26T03:17:00Z') });
});

test('latestFromApi: an answer without a tag name or a parseable publish time is refused', () => {
  assert.throws(() => latestFromApi(JSON.stringify({ published_at: '2026-11-26T03:17:00Z' })), /tag_name/);
  assert.throws(() => latestFromApi(JSON.stringify({ tag_name: 'x', published_at: 'not a date' })), /published_at/);
  assert.throws(() => latestFromApi('not json'), /JSON/);
});

test('collectState: the latest release, its commit and HEAD, read with three commands', async () => {
  const { calls, runFile } = fakeRun();
  assert.deepEqual(await collectState({ runFile, repo: 'o/r', now: 123 }), {
    latest: { tagName: 'offline-2026-11-26', sha: 'tagsha', publishedAt: new Date('2026-11-26T03:17:00Z') },
    headSha: 'headsha',
    now: 123,
  });
  assert.deepEqual(calls, [
    ['gh', 'api', 'repos/o/r/releases/latest'],
    ['git', 'rev-list', '-n', '1', 'offline-2026-11-26^{commit}'],
    ['git', 'rev-parse', 'HEAD'],
  ]);
});

test('collectState: a 404 from the API means there is no release yet, and the tag commit is not asked for', async () => {
  const { calls, runFile } = fakeRun({ api: NOT_FOUND });
  assert.deepEqual(await collectState({ runFile, repo: 'o/r', now: 1 }),
    { latest: null, headSha: 'headsha', now: 1 });
  assert.equal(calls.some((c) => c[1] === 'rev-list'), false);
});

test('collectState: any other API failure, and any git failure, is thrown with the command in the message', async () => {
  const api = fakeRun({ api: Object.assign(new Error('gh exited 1'), { stderr: 'gh: HTTP 500 (Internal Server Error)' }) });
  await assert.rejects(collectState({ runFile: api.runFile, repo: 'o/r' }), /500/);
  const git = fakeRun({ git: {} });
  await assert.rejects(collectState({ runFile: git.runFile, repo: 'o/r' }), /rev-list/);
});

test('decide: no release yet → publish, with the first tag and zip named after today', async () => {
  const { runFile } = fakeRun({ api: NOT_FOUND });
  assert.deepEqual(await decide({ runFile, repo: 'o/r', now: Date.UTC(2026, 10, 26, 3, 17) }), {
    release: true,
    reason: 'first release: there is no release yet',
    tag: 'offline-2026-11-26',
    zip: 'offline-wiki-2026-11-26.zip',
    previousTag: '',
  });
});

test('decide: nothing changed since the last release → skip, and the previous tag is reported', async () => {
  const { runFile } = fakeRun({ git: { ...GIT, 'rev-parse HEAD': 'tagsha\n' } });
  const result = await decide({ runFile, repo: 'o/r', now: Date.UTC(2026, 10, 26, 12) });
  assert.equal(result.release, false);
  assert.equal(result.previousTag, 'offline-2026-11-26');
});

test('main: the decision is appended to the GitHub output file, one key per line', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'should-release-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const githubOutput = path.join(dir, 'output.txt');
  const { runFile } = fakeRun({ api: NOT_FOUND });
  const result = await main({ runFile, repo: 'o/r', now: Date.UTC(2026, 10, 26, 3, 17), githubOutput });
  assert.equal(result.release, true);
  assert.equal(await fs.readFile(githubOutput, 'utf8'),
    'release=true\nreason=first release: there is no release yet\ntag=offline-2026-11-26\nzip=offline-wiki-2026-11-26.zip\nprevious_tag=\n');
});
