'use strict';

// Task 3 tests: frontmatter accepts CMS-native YAML subset.
//
// Sveltia CMS 保存条目时会用自己的 YAML 序列化器重写整份 markdown:
// 多行块列表 + 裸标量(布尔/数字)。渲染链路的 frontmatter 解析必须
// 吃得下这个格式;同时 Task 2 迁来的旧方言(行式 kv + 单行 JSON)不能破。
// 子集定义见 task-3-brief:
//   key: scalar            去引号字符串、"true"/"false" 布尔、数字
//   key:                   后随缩进 "- item" 的标量列表(项可带引号)
//   key: [a, b]            flow 列表(兼容)
//   key: {...} / [...]     单行 JSON(旧方言,保留)
// 明确拒绝的超集:列表对象项(- key: value 续行)、多级嵌套——不实现、
// 不抛错,按现有"跳过非 kv 行"的宽容行为处理。

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  splitFrontmatter,
  parseFrontmatter,
  parseFrontmatterScalar,
} = require('../tools/extract/frontmatter.js');

// ---------- 新方言:Sveltia 序列化风格 ----------

test('Sveltia 主样例:多行列表 + 带引号项 + 标量混排(brief 逐字)', () => {
  const { fm, body } = splitFrontmatter(
    '---\ntags:\n  - milk\n  - "brood"\nnote: hi\nsold: true\n---\nbody');
  assert.deepEqual(fm, { tags: ['milk', 'brood'], note: 'hi', sold: true });
  assert.equal(body, 'body');
});

test('YAML 标量:布尔 true/false、数字、带引号字符串、负数与小数', () => {
  const { fm } = splitFrontmatter(
    '---\nsold: true\narchived: false\nprice: 180\noffset: -5\nrate: 2.5\nname: "quoted"\nflavor: \'single\'\n---\nb');
  assert.equal(fm.sold, true, 'sold 是布尔而非字符串');
  assert.equal(fm.archived, false);
  assert.equal(fm.price, 180, 'price 是数字');
  assert.equal(fm.offset, -5);
  assert.equal(fm.rate, 2.5);
  assert.equal(fm.name, 'quoted', '双引号去除');
  assert.equal(fm.flavor, 'single', '单引号去除');
});

test('多行列表:项走标量解析(布尔/数字/引号项)', () => {
  const { fm } = splitFrontmatter(
    '---\nvals:\n  - true\n  - false\n  - 180\n  - \'quoted\'\n  - "dq"\n---\nb');
  assert.deepEqual(fm.vals, [true, false, 180, 'quoted', 'dq']);
});

test('多行列表:遇非列表行即止,后续 kv 行继续正常解析', () => {
  const { fm } = splitFrontmatter(
    '---\ntags:\n  - a\n  - b\nnote: next\n---\nx');
  assert.deepEqual(fm, { tags: ['a', 'b'], note: 'next' });
});

test('多行列表:key: 后没有列表行时保持旧空值行为(空串)', () => {
  const { fm } = splitFrontmatter('---\nempty:\nnote: x\n---\nb');
  assert.deepEqual(fm, { empty: '', note: 'x' });
});

test('多行列表:到 frontmatter 结束(---)即止,body 不吞列表', () => {
  const { fm, body } = splitFrontmatter('---\ntags:\n  - a\n---\nbody');
  assert.deepEqual(fm, { tags: ['a'] });
  assert.equal(body, 'body');
});

test('flow 列表 key: [a, b](非 JSON 裸项)', () => {
  const { fm } = splitFrontmatter('---\ntags: [milk, brood]\nnums: [1, 2]\n---\nb');
  assert.deepEqual(fm.tags, ['milk', 'brood']);
  assert.deepEqual(fm.nums, [1, 2]);
});

test('无闭合方言 + 多行列表:首个空行结束 frontmatter', () => {
  const { fm, body } = splitFrontmatter('---\ntags:\n  - milk\n\n正文');
  assert.deepEqual(fm, { tags: ['milk'] });
  assert.equal(body, '正文');
});

test('Sveltia 风格混排:多行列表与旧单行 JSON 共存于同一份 frontmatter', () => {
  const { fm } = splitFrontmatter(
    '---\ntags:\n  - milk\nrelated: ["tentacle_body"]\nsold: true\n---\nb');
  assert.deepEqual(fm.tags, ['milk'], '新方言多行列表');
  assert.deepEqual(fm.related, ['tentacle_body'], '旧方言单行 JSON 不破');
  assert.equal(fm.sold, true);
});

// ---------- 明确拒绝的超集:不实现、不抛错 ----------

test('超集:列表对象项(- key: value 续行)不解析成对象,不抛错', () => {
  const { fm } = splitFrontmatter(
    '---\nusage:\n  - type: use\n    text: hi\n---\nb');
  // 契约:绝不产出对象解析(数组项全为非 object,或整体不是数组)
  const ok = !Array.isArray(fm.usage) || fm.usage.every((v) => v === null || typeof v !== 'object');
  assert.ok(ok, '对象列表项不得被解析成对象');
});

test('含冒号的裸标量项是 YAML plain scalar,保留在列表(fix: KVISH 误判)', () => {
  // 冒号后无空格(http://x、draft:AI)是 plain scalar,属"标量列表"子集,
  // 不得误判为对象项而静默丢弃(丢弃时值退化为 '',构建不红、数据丢失)
  const { fm } = splitFrontmatter(
    '---\nlinks:\n  - http://example.com\n  - draft:AI\n---\nb');
  assert.deepEqual(fm.links, ['http://example.com', 'draft:AI']);
});

test('真对象项仍跳过:KVISH 收紧为冒号后须空格或行尾', () => {
  const { fm } = splitFrontmatter(
    '---\nmixed:\n  - type: use\n  - http://x\n  - key:\n---\nb');
  // `- type: use`(冒号后空格)与 `- key:`(冒号后行尾)是真对象项形态 → 跳过;
  // `- http://x` 是 plain scalar → 保留
  assert.deepEqual(fm.mixed, ['http://x']);
});

test('超集:多级嵌套行按现有跳过行为处理,不抛错', () => {
  const { fm } = splitFrontmatter(
    '---\nouter:\n  - a\n    nested: v\n---\nb');
  assert.deepEqual(fm.outer, ['a'], '顶层标量项照常收集');
  assert.ok(!('nested' in fm), '嵌套 kv 行不进入数据');
});

// ---------- 旧方言回归(Task 2 迁移样例抄录)----------

test('旧方言回归:无闭合 ---、空行分隔正文(render.test.js 既有样例)', () => {
  const { fm, body } = splitFrontmatter(
    '---\nnotes: 覆盖说明\n\n## 详解小节\n\n每晚产出 [[tentacle_body]] 相关结算。\n');
  assert.deepEqual(fm, { notes: '覆盖说明' });
  assert.ok(body.includes('详解小节'), 'frontmatter 不泄漏进正文');
});

test('旧方言回归:单行 JSON 数组/对象(fixture wondrous_milk.md 既有样例)', () => {
  const { fm } = splitFrontmatter(
    '---\nrelated: ["tentacle_body"]\n'
    + 'usage: [{"type": "drink", "text": "饮用后恢复少量体力。", "source": "draft:AI"}]\n'
    + '---\n正文');
  assert.deepEqual(fm.related, ['tentacle_body']);
  assert.deepEqual(fm.usage,
    [{ type: 'drink', text: '饮用后恢复少量体力。', source: 'draft:AI' }]);
});

test('旧方言回归:闭合/无闭合/EOF 三形态 body 切分不变(merge.test.js 样例)', () => {
  assert.deepEqual(splitFrontmatter('---\ntitle: A\n---\n# H1\n\n正文'),
    { fm: { title: 'A' }, body: '# H1\n\n正文' });
  assert.deepEqual(splitFrontmatter('---\ntitle: A\n\n# H1\n\n正文'),
    { fm: { title: 'A' }, body: '# H1\n\n正文' });
  assert.deepEqual(splitFrontmatter('---\nnotes: 只有头\n'),
    { fm: { notes: '只有头' }, body: '' });
  assert.deepEqual(splitFrontmatter('# 直接正文'),
    { fm: {}, body: '# 直接正文' });
});

// ---------- parseFrontmatter / parseFrontmatterScalar 出口 ----------

test('parseFrontmatter 只取数据;parseFrontmatterScalar 标量语义', () => {
  assert.deepEqual(parseFrontmatter('---\ntags:\n  - a\n---\nbody'),
    { tags: ['a'] });
  assert.equal(parseFrontmatterScalar('"x"'), 'x');
  assert.equal(parseFrontmatterScalar('true'), true);
  assert.equal(parseFrontmatterScalar('180'), 180);
  assert.equal(parseFrontmatterScalar('plain'), 'plain');
  assert.deepEqual(parseFrontmatterScalar('["a"]'), ['a'], 'JSON 优先保留');
});
