'use strict';

// The offline release policy, as pure functions. Every trigger of the release workflow —
// push, schedule, by hand — goes through decideRelease, so what these assertions pin is
// the one rule: at most one release per 3 days, and only when main changed.

const test = require('node:test');
const assert = require('node:assert/strict');

const { COOLDOWN_MS, releaseTagName, zipNameFor, decideRelease } = require('../tools/release-policy.js');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 26, 3, 17, 0); // 2026-11-26T03:17:00Z

test('the cooldown is three days, and the tag and zip carry the UTC calendar date', () => {
  assert.equal(COOLDOWN_MS, 3 * DAY);
  assert.equal(releaseTagName(new Date('2026-12-01T23:59:59Z')), 'offline-2026-12-01');
  assert.equal(zipNameFor(new Date('2026-12-01T23:59:59Z')), 'offline-wiki-2026-12-01.zip');
});

test('decideRelease: no release yet → release, whatever the clock says', () => {
  assert.deepEqual(decideRelease({ latest: null, headSha: 'abc', now: T0 }),
    { release: true, reason: 'first release: there is no release yet' });
});

test('decideRelease: the head is the released commit → no release', () => {
  const latest = { tagName: 'offline-2026-11-20', sha: 'abc', publishedAt: new Date(T0 - 9 * DAY) };
  assert.deepEqual(decideRelease({ latest, headSha: 'abc', now: T0 }),
    { release: false, reason: 'nothing changed since offline-2026-11-20' });
});

test('decideRelease: changes inside the cooldown → no release, even two hours after the last one', () => {
  const latest = { tagName: 'offline-2026-11-26', sha: 'abc', publishedAt: new Date(T0 - 2 * 60 * 60 * 1000) };
  assert.deepEqual(decideRelease({ latest, headSha: 'def', now: T0 }),
    { release: false, reason: 'cooldown: the last release offline-2026-11-26 is under 3 days old' });
});

test('decideRelease: the cooldown counts as over exactly three days after the last release', () => {
  const latest = { tagName: 'offline-2026-11-23', sha: 'abc', publishedAt: new Date(T0 - 3 * DAY) };
  assert.equal(decideRelease({ latest, headSha: 'def', now: T0 - 1 }).release, false);
  assert.deepEqual(decideRelease({ latest, headSha: 'def', now: T0 }),
    { release: true, reason: 'changes since offline-2026-11-23, and the cooldown is over' });
});
