'use strict';

// The filter of a section's item gallery (stage 5, task 4):
// assets-src/js/item-filter.js. A plain script that reads what the build
// wrote on the cards (data-category, data-mod) and needs no fetch, so it
// works on the site and from file:// alike.
//
// Pinned in Node: the part that is not DOM work — matches — loaded into a
// bare `window` with vm, the way tests/nav-home.test.js does it. The
// behaviour on the page (clicking a chip, the status line, hiding a mod's
// section) is exercised in a browser.

const test = require('node:test');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'assets-src', 'js', 'item-filter.js');

/** The script loaded into nothing but a window: it must define its functions and touch no DOM while loading. */
function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(SCRIPT, 'utf8'), sandbox, { filename: 'item-filter.js' });
  return sandbox.window.__itemFilter;
}

test('the script loads into a bare window, touches no DOM while loading, and exposes exactly two functions', () => {
  const filter = load();
  assert.deepEqual(Object.keys(filter).sort(), ['init', 'matches']);
  for (const name of Object.keys(filter)) assert.equal(typeof filter[name], 'function', name);
});

test('matches: 品类和来源两维同时生效;哪一维没选(空串)就是全部,放行;品类可以是数组,也可以是空格分隔的字符串', () => {
  const { matches } = load();
  const card = { categories: '饮料 食物', mod: 'lewd_meme' };
  assert.equal(matches(card, { category: '', mod: '' }), true, 'nothing picked: everything shows');
  assert.equal(matches(card, { category: '饮料', mod: 'lewd_meme' }), true);
  assert.equal(matches(card, { category: '饮料', mod: 'lewd_meme_remake' }), false, 'the source counts too');
  assert.equal(matches(card, { category: '工具', mod: '' }), false);
  assert.equal(matches(card, { category: '', mod: 'lewd_meme_remake' }), false);
  assert.equal(matches({ categories: ['容器'], mod: 'x' }, { category: '容器', mod: '' }), true, 'an array');
  assert.equal(matches({ categories: '', mod: 'x' }, { category: '饮料', mod: '' }), false, 'no category of its own: hidden once one is picked');
  assert.equal(matches({ categories: '', mod: 'x' }, { category: '', mod: '' }), true, '…and shown when none is');
  assert.equal(matches({ categories: null, mod: 'x' }, { category: '', mod: '' }), true);
});
