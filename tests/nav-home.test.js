'use strict';

// The home page search that runs in the browser (stage 3, task 2):
// assets-src/js/nav-home.js. It is a plain script that reads window.NAV_SEARCH
// (written by the build from tools/build/nav-search.js) and needs no fetch, so
// it works on the site and from file:// alike.
//
// What is pinned in Node is the part that is not DOM work — splitQuery,
// matchMod and search — loaded into a bare `window` with vm. The behaviour on
// the page (highlighting, the scope panel, folding) is exercised in a browser.

const test = require('node:test');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'assets-src', 'js', 'nav-home.js');

/** The script loaded into nothing but a window: it must define its functions and touch no DOM while loading. */
function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: 'nav-home.js' });
  return sandbox.window.__navHome;
}

// Values made in the script's realm have another prototype: copy them into this one before comparing.
const plain = (value) => JSON.parse(JSON.stringify(value));

const MODS = [
  { id: 'lewd_meme', name: '淫色深空：可能是触手', summary: '说到空间站，就想起异形。', aliases: [], keywords: [], sections: ['series'] },
  { id: 'lewd_meme_remake', name: '暗流交易', summary: '非官方扩展。', aliases: ['黑市', '暗流交易'], keywords: ['走私'], sections: ['series', 'tear'] },
  { id: 'claude.lewdMemeBrood', name: '巢穴扩展', summary: '触手卵孵化。', aliases: ['孵卵'], keywords: ['触手卵', '孵化'], sections: ['series'] },
  { id: 'lewd_meme_brothel', name: '掌上青楼', summary: '青楼经营。', aliases: [], keywords: [], sections: [] },
];
const MODEL = {
  mods: MODS,
  sections: [
    { slug: 'series', title: '淫色深空系列', intro: '五个 mod。', order: null },
    { slug: 'tear', title: '珠泪哀歌', intro: '', order: 2 },
  ],
};

test('the script loads into a bare window and exposes exactly the four functions', () => {
  const nav = load();
  assert.deepEqual(Object.keys(nav).sort(), ['init', 'matchMod', 'search', 'splitQuery']);
  for (const name of Object.keys(nav)) assert.equal(typeof nav[name], 'function', name);
});

test('splitQuery: case-folded, split on any run of white space — the full-width and the non-breaking one too — and never empty', () => {
  const { splitQuery } = load();
  assert.deepEqual(plain(splitQuery('')), []);
  assert.deepEqual(plain(splitQuery('   ')), []);
  assert.deepEqual(plain(splitQuery('黑市')), ['黑市']);
  assert.deepEqual(plain(splitQuery('  触手   卵 ')), ['触手', '卵']);
  assert.deepEqual(plain(splitQuery('触手\u3000卵')), ['触手', '卵'], 'U+3000, the full-width space a Chinese IME types');
  assert.deepEqual(plain(splitQuery('A\u00a0B')), ['a', 'b'], 'U+00A0, the non-breaking space');
  assert.deepEqual(plain(splitQuery('  Brood\tNEST\n')), ['brood', 'nest'], 'lower-cased: the match ignores case');
  assert.deepEqual(plain(splitQuery(null)), []);
});

test('matchMod: every word has to be in the name, the id, the summary, an alias or a keyword, each scoring its own way; a word that is nowhere is no match', () => {
  const { matchMod } = load();
  assert.deepEqual(plain(matchMod(MODS[0], ['异形'])), { score: 1, why: [] }, 'the summary: 1');
  assert.deepEqual(plain(matchMod(MODS[0], ['可能是触手'])), { score: 10, why: [] }, 'the name: 10');
  assert.deepEqual(plain(matchMod(MODS[2], ['brood'])), { score: 5, why: [] }, 'the id, in any case: 5');
  assert.deepEqual(plain(matchMod(MODS[1], ['黑市'])), { score: 100, why: ['黑市'] }, 'an alias: 100, and it is remembered for the label');
  assert.deepEqual(plain(matchMod(MODS[2], ['孵化'])), { score: 100, why: ['孵化'] }, 'a keyword scores like an alias');
  // An alias beats the name for the same word: 交易 is in both.
  assert.deepEqual(plain(matchMod(MODS[1], ['交易'])), { score: 100, why: ['暗流交易'] });
  // Every word counts on its own; the scores add up.
  assert.deepEqual(plain(matchMod(MODS[2], ['触手卵', 'brood'])), { score: 105, why: ['触手卵'] });
  assert.deepEqual(plain(matchMod(MODS[2], ['孵卵', '孵化'])), { score: 200, why: ['孵卵', '孵化'] }, 'each hit is listed once');
  assert.equal(matchMod(MODS[3], ['触手']), null, 'nowhere in this mod');
  assert.equal(matchMod(MODS[2], ['brood', '青楼']), null, 'one word that is not there is enough to miss');
  assert.deepEqual(plain(matchMod(MODS[3], [])), { score: 0, why: [] }, 'no words: a match that scores nothing');
});

test('search: alias and keyword hits come first, then the name, the id, the summary; within a grade the home page order is kept', () => {
  const { search } = load();
  const { results, aliasHit } = search(MODEL, { query: '黑市' });
  assert.deepEqual(plain(results.map((r) => r.mod.id)), ['lewd_meme_remake']);
  assert.deepEqual(plain(aliasHit), { lewd_meme_remake: true });

  // 暗流 is in an alias of lewd_meme_remake and in the id of every lewd_meme_* mod: the alias wins, the ids follow in page order.
  const mixed = search(MODEL, { query: 'lewd' });
  assert.deepEqual(plain(mixed.results.map((r) => [r.mod.id, r.score])), [
    ['lewd_meme', 5], ['lewd_meme_remake', 5], ['claude.lewdMemeBrood', 5], ['lewd_meme_brothel', 5],
  ], 'same grade: the order of the home page (the id is matched in any case)');
  assert.deepEqual(plain(mixed.aliasHit), {
    lewd_meme: false, lewd_meme_remake: false, 'claude.lewdMemeBrood': false, lewd_meme_brothel: false,
  });

  // Several words: every one has to be in the mod.
  assert.deepEqual(plain(search(MODEL, { query: '触手 卵' }).results.map((r) => r.mod.id)), ['claude.lewdMemeBrood']);
});

test('search: two mods that claim the same alias both come first, in the home page order, both labelled', () => {
  const { search } = load();
  const twin = {
    mods: [
      { id: 'a-first', name: '甲', summary: '', aliases: ['触手'], keywords: [], sections: [] },
      { id: 'b-second', name: '乙', summary: '', aliases: ['触手'], keywords: [], sections: [] },
      { id: 'c-named', name: '触手类', summary: '', aliases: [], keywords: [], sections: [] },
    ],
    sections: [],
  };
  const { results, aliasHit } = search(twin, { query: '触手' });
  assert.deepEqual(plain(results.map((r) => r.mod.id)), ['a-first', 'b-second', 'c-named'], 'the two alias hits first, in page order; the name hit after them');
  assert.deepEqual(plain(aliasHit), { 'a-first': true, 'b-second': true, 'c-named': false });
  assert.deepEqual(plain(results[0].why), ['触手']);
  assert.deepEqual(plain(results[1].why), ['触手']);
});

test('search: a scope limits the search to the mods of the checked sections; no query is no results', () => {
  const { search } = load();
  // 青楼 is only in lewd_meme_brothel, which is in no section.
  assert.deepEqual(plain(search(MODEL, { query: '青楼' }).results.map((r) => r.mod.id)), ['lewd_meme_brothel']);
  assert.deepEqual(plain(search(MODEL, { query: '青楼', scope: ['series'] }).results), [], 'outside the checked sections');
  assert.deepEqual(plain(search(MODEL, { query: '青楼', scope: [] }).results.map((r) => r.mod.id)), ['lewd_meme_brothel'], 'nothing checked is everything');
  // 暗流交易 is in both sections: one of them checked is enough.
  assert.deepEqual(plain(search(MODEL, { query: '黑市', scope: ['tear'] }).results.map((r) => r.mod.id)), ['lewd_meme_remake']);
  assert.deepEqual(plain(search(MODEL, { query: '   ' })), { results: [], aliasHit: {} });
  assert.deepEqual(plain(search(MODEL, { query: '没有这个词' })), { results: [], aliasHit: {} });
  assert.deepEqual(plain(search({ mods: [], sections: [] }, { query: '触手' })), { results: [], aliasHit: {} }, 'an empty model is no error');
});
