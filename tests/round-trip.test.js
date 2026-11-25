'use strict';

// Rich-text round trip (modwiki: docs/superpowers/specs/2026-11-25-online-wiki-rich-text-design.md).
//
// The CMS's rich-text editor rewrites a whole page in standard Markdown the
// moment a contributor changes anything in it. Every pair in the fixture is
// one piece of text — a real page of the wiki, or a fixed sample — as it was
// written and as that editor wrote it back. The two must render exactly the
// same: what a reader sees on the page must not depend on whether the page
// has been through the editor.
//
// The fixture was exported from Sveltia CMS 0.271.0 in a local test setup
// with the editor components this repository enables. Export it again after a
// CMS upgrade — the editor's write-back is the thing under test.

const test = require('node:test');
const assert = require('node:assert/strict');

const { mdToHtml } = require('../tools/build/markdown.js');
const pairs = require('./fixtures/rich-text-round-trip.json');

/**
 * Every item id the fixture mentions is known, so that a link-shaped
 * write-back always takes the restore step (it only does for a known id).
 */
const knownIds = new Set(pairs.flatMap((p) => [...p.written.matchAll(/\[\[([^\[\]]+?)\]\]/g)].map((m) => m[1].trim())));
const lookup = (id) => (knownIds.has(id) ? { id, name: id } : null);
const render = (md) => mdToHtml(md, lookup, (item) => `<span data-item-id="${item.id}">${item.name}</span>`).html;

/**
 * The pairs whose two sides do NOT render the same — because this renderer
 * mis-renders the text AS WRITTEN, and the editor's write-back is the side
 * that comes out right:
 *   - a literal asterisk followed by a space (`need.* / egg.guide.*`) is taken
 *     for the opening of an emphasis; the editor escapes it as `\*`;
 *   - `***x***` comes out with its tags crossed; the editor writes `**_x_**`.
 * Fixing the emphasis rule would change pages that exist today (two item
 * pages show that stray emphasis right now), which this work must not do —
 * so these pairs are held to what the text was meant to render as, and the
 * defect is reported to the site owner. The second test below pins the
 * defect itself.
 */
const WRITTEN_SIDE_MISRENDERED = new Map([
  ['items/brood_egg.md', '<p>据 zh.csv item.brood_egg.desc 与 egg.hint.need.* / egg.guide.* 词条</p>'],
  ['items/ledger.md', '<p>据 zh.csv ledger.* 与 report.page2.* 词条、PatchLedgerDoubleClick.cs</p>'],
  ['sample/36', '<p><strong>粗体</strong> <em>斜体</em> <strong><em>粗斜体</em></strong> <em>下划线斜体</em></p>'],
]);

test('rich-text round trip: what the CMS writes back renders exactly like what was written', () => {
  assert.ok(pairs.length > 100, `sanity: the fixture has ${pairs.length} pairs`);
  const differing = [];
  for (const { name, written, back } of pairs) {
    if (render(back) === render(written)) continue;
    differing.push(name);
    // …and in the few where it does not, the write-back is the correct side:
    // it renders as the text was meant to.
    assert.ok(render(back).includes(WRITTEN_SIDE_MISRENDERED.get(name)), `${name}: what the editor wrote back`);
  }
  // exactly these, no more: a new difference is a rule that is missing
  assert.deepEqual(differing, [...WRITTEN_SIDE_MISRENDERED.keys()]);
});

test('known defect, kept as it is on purpose: a literal asterisk before a space is taken for emphasis', () => {
  // This is how two item pages read today. The rule must not change in the
  // rich-text work (a page that exists must keep its output); when the
  // emphasis rule is fixed on purpose, this is the test to turn around.
  assert.equal(render('据 zh.csv ledger.* 与 report.page2.* 词条'),
    '<p>据 zh.csv ledger.<em> 与 report.page2.</em> 词条</p>');
  assert.equal(render('***粗斜体***'), '<p><strong><em>粗斜体</strong></em></p>');
});
