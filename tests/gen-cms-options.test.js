'use strict';

// Import plan review fix: the 74-item dropdown in admin/config.yml must follow
// data/mods/*.json. This generator rewrites that one options block; `--check`
// compares instead of writing (a contributor editing the data can run it, and
// tests/admin-config.test.js fails until it is run).

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderOptions, replaceOptions } = require('../tools/gen-cms-options.js');

test('renderOptions:每个物品两行,label = name ?? id,单引号', () => {
  const text = renderOptions(
    [{ id: 'mod_a' }],
    [{ id: 'wondrous_milk', mod: 'mod_a', name: '神奇乳汁' }, { id: 'dish.cheeseSteak', mod: 'mod_a', name: null }],
  );
  assert.equal(text, [
    "          - label: '神奇乳汁'",
    "            value: 'wondrous_milk'",
    "          - label: 'dish.cheeseSteak'",
    "            value: 'dish.cheeseSteak'",
  ].join('\n'));
});

test('renderOptions:单引号里的单引号写成两个', () => {
  const text = renderOptions([{ id: 'mod_a' }], [{ id: 'x', mod: 'mod_a', name: "it's" }]);
  assert.ok(text.includes("'it''s'"), text);
});

test('replaceOptions:只替换 slug 的 options 块,其余不动', () => {
  const config = [
    'site_url: https://example.test/',
    'collections:',
    '  - name: items',
    '    fields:',
    '      - name: slug',
    '        options:',
    '          - label: 旧',
    '            value: old_id',
    '      - name: body',
    '        widget: markdown',
    '',
  ].join('\n');
  const out = replaceOptions(config, "          - label: '新'\n            value: 'new_id'");
  assert.equal(out, [
    'site_url: https://example.test/',
    'collections:',
    '  - name: items',
    '    fields:',
    '      - name: slug',
    '        options:',
    "          - label: '新'",
    "            value: 'new_id'",
    '      - name: body',
    '        widget: markdown',
    '',
  ].join('\n'));
});

test('replaceOptions:没有 options 块 → 抛出,不猜别的位置', () => {
  assert.throws(() => replaceOptions('collections:\n  - name: items\n', "          - label: 'x'\n            value: 'x'"),
    /options/);
});
