'use strict';

// The CMS's custom field controls. These scripts run in a browser against the real CMS, so
// what can be pinned in Node is the part that is not DOM work: both files parse, the shared
// library's item search behaves, exactly three field types are registered, the Esc gate goes
// in before the CMS starts, and the pre-save hook drops the two helper keys and nothing else.
// The controls themselves are exercised in a browser when the new config is switched on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const CMS_DIR = path.join(__dirname, '..', 'tools', 'cms');
const LIB = path.join(CMS_DIR, 'lib.js');
const ADMIN = path.join(CMS_DIR, 'admin.js');

/**
 * Enough of a browser for the two scripts to load: a CMS that is only a shell (no DOM),
 * a `window`, and the globals the library reads while it loads.
 */
function fakeBrowser() {
  const calls = [];
  const noop = () => {};
  const CMS = {
    React: {
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, noop],
      useEffect: noop,
      useRef: () => ({ current: null }),
      useMemo: (make) => make(),
    },
    registerFieldType: (...args) => calls.push(['registerFieldType', ...args]),
    registerEventListener: (listener) => calls.push(['registerEventListener', listener]),
    init: () => calls.push(['init']),
  };
  const sandbox = {
    CMS,
    window: {},
    html: (strings, ...values) => ({ strings, values }),
    navigator: { platform: '', userAgent: '' },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: noop } },
    console,
    setTimeout,
    clearTimeout,
  };
  return { sandbox, calls };
}

function run(file, sandbox) {
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: path.basename(file) });
}

/**
 * The library alone: nothing registered, no CMS started. `ui` is a function so that each
 * assertion can read the library through it.
 */
function loadLib() {
  const browser = fakeBrowser();
  run(LIB, browser.sandbox);
  return { ...browser, ui: browser.sandbox.window.CmsUi };
}

// The scripts run in their own realm, so an array made there has another prototype than one
// made here, and a strict comparison calls them different. Copy a list into this realm first.
const ids = (list) => Array.from(list, (item) => item.id);

const CATALOG = {
  mods: [
    { id: 'alpha', name: '甲', items: [{ id: 'brood_egg', name: '触手卵', taken: true }, { id: 'zzz_last', name: 'Z 后', taken: false }] },
    { id: 'beta', name: '乙', items: [{ id: 'tentacle_body', name: 'Tentacle Brood 触手本体', taken: false }] },
  ],
};

test('both scripts parse', () => {
  for (const file of [LIB, ADMIN]) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(checked.status, 0, `${path.basename(file)}: ${checked.stderr}`);
  }
});

test('the library loads on its own under the name window.CmsUi, and registers nothing', () => {
  const { ui, calls } = loadLib();
  assert.equal(typeof ui, 'object');
  assert.equal(typeof ui.pickModItems, 'function');
  assert.equal(calls.length, 0, 'no field type, no listener, no init: those are admin.js\'s job');
});

test('pickModItems: one mod\'s items, sorted by name; an unknown or unselected mod is empty', () => {
  const { ui } = loadLib();
  assert.deepEqual(ids(ui.pickModItems(CATALOG, 'alpha')), ['brood_egg', 'zzz_last'], 'sorted by name, not by id');
  assert.deepEqual(ids(ui.pickModItems(CATALOG, 'beta')), ['tentacle_body']);
  assert.deepEqual(ids(ui.pickModItems(CATALOG, 'ghost')), []);
  assert.deepEqual(ids(ui.pickModItems(CATALOG, null)), []);
  assert.deepEqual(ids(ui.pickModItems(null, 'alpha')), []);
});

test('searchItems: name or id, case-insensitive, every word of the query; the order is kept', () => {
  const { ui } = loadLib();
  const items = Array.from(ui.pickModItems(CATALOG, 'beta')).concat(Array.from(ui.pickModItems(CATALOG, 'alpha')));
  assert.deepEqual(ids(ui.searchItems(items, '')), ['tentacle_body', 'brood_egg', 'zzz_last']);
  assert.deepEqual(ids(ui.searchItems(items, 'TENTACLE')), ['tentacle_body']);
  assert.deepEqual(ids(ui.searchItems(items, 'brood')), ['tentacle_body', 'brood_egg'], 'the id and the name both count');
  assert.deepEqual(ids(ui.searchItems(items, '触手 卵')), ['brood_egg'], 'both words have to be there');
  assert.deepEqual(ids(ui.searchItems(items, 'nothing-here')), []);
});

/** Load the library, then admin.js on top of it with the library's DOM and network work taken out. */
function loadAdmin() {
  const browser = fakeBrowser();
  run(LIB, browser.sandbox);
  Object.assign(browser.sandbox.window.CmsUi, {
    ensureStyle: () => {},
    loadCatalog: () => Promise.resolve({ templates: {}, categories: {} }),
    installEscGate: () => browser.calls.push(['installEscGate']),
  });
  run(ADMIN, browser.sandbox);
  return browser;
}

test('admin.js registers exactly three field types, gates Esc before anything else, and starts the CMS once, last', () => {
  const { calls } = loadAdmin();
  const order = calls.map((call) => call[0]);
  const registered = calls.filter((call) => call[0] === 'registerFieldType');
  assert.deepEqual(registered.map((call) => call[1]), ['template-starter', 'filename-hint', 'item-id']);
  for (const call of registered) assert.equal(typeof call[2], 'function', `${call[1]} is given a component`);
  assert.ok(order.indexOf('installEscGate') >= 0, 'the Esc gate is installed');
  assert.ok(order.indexOf('installEscGate') < order.indexOf('registerFieldType'),
    'the gate goes in first: CMS key handlers run in registration order, and it has to be ahead of theirs');
  assert.equal(order.filter((step) => step === 'init').length, 1, 'CMS.init() is called once, by admin.js');
  assert.equal(order.at(-1), 'init');
});

test('the pre-save hook drops the two helper keys and touches nothing else', () => {
  const { calls } = loadAdmin();
  const listener = calls.find((call) => call[0] === 'registerEventListener')?.[1];
  assert.equal(listener?.name, 'preSave');

  // The smallest stand-in for an Immutable Map that the hook could use: has(key), delete(key).
  const dataOf = (object) => ({
    has: (key) => Object.prototype.hasOwnProperty.call(object, key),
    delete: (key) => { const next = { ...object }; delete next[key]; return dataOf(next); },
  });
  const keysOf = (data) => ['title', 'template_starter', 'filename_hint', 'item_id', 'mod', 'body'].filter((key) => data.has(key));

  const kept = listener.handler({ entry: { get: () => dataOf({ title: '一', template_starter: null, filename_hint: null, item_id: 'egg', mod: 'alpha', body: 'x' }) } });
  assert.deepEqual(keysOf(kept), ['title', 'item_id', 'mod', 'body']);

  const untouched = dataOf({ title: '一', body: '' });
  assert.equal(listener.handler({ entry: { get: () => untouched } }), undefined, 'nothing to drop: the hook returns undefined and the entry is left as it is');
});

// ---------------------------------------------------------------------------
// The 物品 ID control, found in the browser smoke test of stage 2b
//
// It was opened on an entry that was already saved — gear.maidDress's own —
// and said 「这件物品已经有词条了：再建一篇会和它重名」. To the page being edited
// that is untrue: it IS that entry. And its input box had no accessible name.
// ---------------------------------------------------------------------------

/** An object made in the scripts' realm has another prototype: copy it into this one before comparing. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('itemStatus: a saved entry is told its item is exported — never that it clashes with itself; a new entry is warned', () => {
  const { ui } = loadLib();
  const taken = { id: 'brood_egg', name: '触手卵', taken: true };
  const free = { id: 'tentacle_body', name: '触手本体', taken: false };

  assert.equal(ui.itemStatus(null, { saved: true }), null, 'nothing typed or picked yet: nothing to say');
  assert.deepEqual(plain(ui.itemStatus(taken, { saved: true })), { warn: false, text: '已导出的物品：触手卵' },
    'the entry is this item\'s own entry: the catalog\'s 「已有词条」 is itself');
  assert.deepEqual(plain(ui.itemStatus(taken, { saved: false })), { warn: true, text: '这件物品已经有词条了：再建一篇会和它重名。' });
  assert.deepEqual(plain(ui.itemStatus(free, { saved: false })), { warn: false, text: '已导出的物品：触手本体' });
  assert.deepEqual(plain(ui.itemStatus(free, { saved: true })), { warn: false, text: '已导出的物品：触手本体' });
  assert.deepEqual(plain(ui.itemStatus({ id: 'ending', name: null, taken: false }, { saved: false })),
    { warn: false, text: '已导出的物品：ending' }, 'an item the data gives no name is named by its id');
});

/** What a control's html`` template comes to, with its dynamic parts in place. */
function flatten(template) {
  const show = (v) => (typeof v === 'string' || typeof v === 'number' ? String(v) : Array.isArray(v) ? v.map(show).join('') : v && typeof v === 'object' && 'strings' in v ? flatten(v) : `[${typeof v}]`);
  return template.strings.reduce((text, part, i) => text + part + (i < template.values.length ? show(template.values[i]) : ''), '');
}

test('the 物品 ID control gives its input box the field\'s label as its accessible name', () => {
  const { calls } = loadAdmin();
  const ItemId = calls.find((call) => call[0] === 'registerFieldType' && call[1] === 'item-id')[2];
  const out = ItemId({
    forID: 'c47',
    value: 'gear.maidDress',
    onChange: () => {},
    entry: { getIn: () => 'lewd_meme_brothel', get: () => 'lewd_meme_brothel/items/gear.maidDress.md' },
    field: { get: (key) => (key === 'label' ? '物品 ID' : undefined) },
  });
  // A tagged template: the attribute's name ends a static part, its value is the part that follows.
  const at = out.strings.findIndex((part) => part.endsWith('aria-label='));
  assert.ok(at > 0, `the input box carries an aria-label:\n${flatten(out).slice(0, 300)}`);
  assert.ok(out.strings.slice(0, at).join('').includes('<input'), '…on the input box, not somewhere else');
  assert.equal(out.values[at], '物品 ID', 'named after the field: the CMS labels its own fields the same way');
  assert.ok(flatten(out).includes('<input id=c47 '), '…and the box keeps the id the CMS handed it');
});
