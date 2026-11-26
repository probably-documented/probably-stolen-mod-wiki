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
// 对象块列表(key: 下每项是 - key: value 的对象,Sveltia 的 list-of-objects
// 写法)已支持,续行是同一对象的键;更深的多级嵌套仍不实现、不抛错,
// 按"跳过无法识别的行"的宽容行为处理。

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

// ---------- 对象块列表(list-of-objects)与宽容行为 ----------

test('对象块列表:列表项是 - key: value 时解析成对象,续行是同一对象的键', () => {
  const { fm } = splitFrontmatter(
    '---\nusage:\n  - type: use\n    text: hi\n---\nb');
  assert.deepEqual(fm.usage, [{ type: 'use', text: 'hi' }]);
});

test('含冒号的裸标量项是 YAML plain scalar,保留在列表(fix: KVISH 误判)', () => {
  // 冒号后无空格(http://x、draft:AI)是 plain scalar,属"标量列表"子集,
  // 不得误判为对象项而静默丢弃(丢弃时值退化为 '',构建不红、数据丢失)
  const { fm } = splitFrontmatter(
    '---\nlinks:\n  - http://example.com\n  - draft:AI\n---\nb');
  assert.deepEqual(fm.links, ['http://example.com', 'draft:AI']);
});

test('对象项与标量项可以混排: - key: value 开对象,plain scalar 仍是标量', () => {
  const { fm } = splitFrontmatter(
    '---\nmixed:\n  - type: use\n  - http://x\n  - key:\n---\nb');
  // `- type: use`(冒号后空格)与 `- key:`(冒号后行尾)是对象项;
  // `- http://x` 是 plain scalar → 保留
  assert.deepEqual(fm.mixed, [{ type: 'use' }, 'http://x', { key: '' }]);
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

// ---------- 引号字符串的转义(task 6 Ruling W)----------
//
// Sveltia CMS 保存条目时用 yaml 库写出 frontmatter:需要引号的字符串默认用
// 单引号,内部的 `'` 按 YAML 规定写成两个;双引号字符串则用 `\"` 与 `\\`。
// 修复前解析器只是去掉首尾引号,这些转义原样留在值里(页面标题多出一个
// 单引号,或冒出一个反斜杠)。

test('单引号字符串:内部的两个单引号还原为一个', () => {
  assert.equal(parseFrontmatterScalar(String.raw`'Don''t stop'`), "Don't stop");
  assert.equal(parseFrontmatterScalar(String.raw`''''`), "'", '内容只有一个单引号');
  assert.equal(parseFrontmatterScalar(String.raw`'a''b''c'`), "a'b'c", '多处');
  assert.equal(parseFrontmatterScalar("''"), '', '空串不变');
  assert.equal(parseFrontmatterScalar("'安装与兼容性'"), '安装与兼容性', '没有转义时行为不变');
});

test('双引号字符串:转义的引号和反斜杠还原为本身', () => {
  assert.equal(parseFrontmatterScalar(String.raw`"say \"hi\""`), 'say "hi"');
  assert.equal(parseFrontmatterScalar(String.raw`"C:\\path\\"`), 'C:\\path\\');
  assert.equal(parseFrontmatterScalar(String.raw`"\""`), '"', '内容只有一个双引号');
  assert.equal(parseFrontmatterScalar('""'), '', '空串不变');
  // 一次扫描(D9 把这条换成了良构的输入):`\\\"` 是 `\\` + `\"`,值是 `\` + `"`。
  // 顺序替换里「先 \\ 后 \"」会解错:第一步得到的 \" 会被第二步再解成 "。
  assert.equal(parseFrontmatterScalar(String.raw`"x\\\"y"`), String.raw`x\"y`);
  // 反斜杠后面还是一个转义的开头:`\\n` 是 `\\` + `n`(两个字符),不是换行。
  // 先处理 \n 的顺序替换会把它解成反斜杠加换行。
  assert.equal(parseFrontmatterScalar(String.raw`"x\\ny"`), String.raw`x\ny`);
});

// ---------- task 6b D9:双引号字符串的完整转义集合 ----------
//
// CMS 写出的 YAML 形态要到上线后才能实测。中文内容若被写成 \uXXXX 而解析器
// 不还原,页面会直接显示乱码——所以把 YAML 的转义提前补齐。单字符转义 \n \t
// \r \0 \b \f \\ \" \/、\uXXXX 与 \UXXXXXXXX。

test('D9 — 双引号字符串:单字符转义 \\n \\t \\r \\0 \\b \\f \\\\ \\" \\/', () => {
  assert.equal(parseFrontmatterScalar(String.raw`"a\nb"`), 'a\nb');
  assert.equal(parseFrontmatterScalar(String.raw`"a\tb"`), 'a\tb');
  assert.equal(parseFrontmatterScalar(String.raw`"a\rb"`), 'a\rb');
  assert.equal(parseFrontmatterScalar(String.raw`"a\0b"`), 'a\0b');
  assert.equal(parseFrontmatterScalar(String.raw`"a\bb"`), 'a\bb');
  assert.equal(parseFrontmatterScalar(String.raw`"a\fb"`), 'a\fb');
  assert.equal(parseFrontmatterScalar(String.raw`"a\\b"`), 'a\\b');
  assert.equal(parseFrontmatterScalar(String.raw`"a\"b"`), 'a"b');
  assert.equal(parseFrontmatterScalar(String.raw`"a\/b"`), 'a/b');
  // 相邻的转义互不干扰:一次扫描
  assert.equal(parseFrontmatterScalar(String.raw`"\n\t\r"`), '\n\t\r');
  assert.equal(parseFrontmatterScalar(String.raw`"\\n"`), String.raw`\n`);
  assert.equal(parseFrontmatterScalar(String.raw`"\\"`), '\\', 'the whole value is one backslash');
});

test('D9 — 双引号字符串:\\uXXXX 与 \UXXXXXXXX 还原为字符,中文与 emoji 不再是乱码', () => {
  assert.equal(parseFrontmatterScalar(String.raw`"\u4e2d\u6587"`), '中文');
  assert.equal(parseFrontmatterScalar(String.raw`"\u4E2D"`), '中', '十六进制大小写都认');
  assert.equal(parseFrontmatterScalar(String.raw`"安装\u0020指南"`), '安装 指南', '与字面字符混排');
  assert.equal(parseFrontmatterScalar(String.raw`"\U0001F600"`), '\u{1F600}', '八位的 \U');
  assert.equal(parseFrontmatterScalar(String.raw`"\U00000041"`), 'A');
  assert.equal(parseFrontmatterScalar(String.raw`"\uD83D\uDE00"`), '\u{1F600}', '一对代理项');
});

test('D9 — 不是合法转义的写法原样保留,不抛错:不认识的字母、位数不够、超出 Unicode 范围、末尾孤立的反斜杠', () => {
  assert.equal(parseFrontmatterScalar(String.raw`"a\qb"`), String.raw`a\qb`);
  assert.equal(parseFrontmatterScalar(String.raw`"\u12"`), String.raw`\u12`);
  assert.equal(parseFrontmatterScalar(String.raw`"\uzzzz"`), String.raw`\uzzzz`);
  assert.equal(parseFrontmatterScalar(String.raw`"\U00110000"`), String.raw`\U00110000`, 'beyond U+10FFFF');
  assert.equal(parseFrontmatterScalar(String.raw`"a\"`), 'a\\', 'a lone backslash at the end: the closing quote is not consumed as an escaped quote');
});

test('D9 — 经 splitFrontmatter:被 CMS 写成转义形态的中文标题与列表项,读出来是原来的文字', () => {
  const { fm, body } = splitFrontmatter(String.raw`---
title: "\u5B89\u88C5\u4E0E\u517C\u5BB9\u6027"
nav_label: "\u5173\u4E8E\u672C\u7AD9"
tags:
  - "a\tb"
  - "line1\nline2"
---
正文
`);
  assert.equal(fm.title, '安装与兼容性');
  assert.equal(fm.nav_label, '关于本站');
  assert.deepEqual(fm.tags, ['a\tb', 'line1\nline2']);
  assert.equal(body, '正文\n');
});

test('单引号字符串:反斜杠不是转义符,保持原样(只有 \'\' 是转义)', () => {
  assert.equal(parseFrontmatterScalar(String.raw`'C:\path'`), String.raw`C:\path`);
  assert.equal(parseFrontmatterScalar(String.raw`'a\nb'`), String.raw`a\nb`);
  assert.equal(parseFrontmatterScalar(String.raw`'it\'s'`), String.raw`it\'s`, 'a backslash before the quote does not escape it either');
  assert.equal(parseFrontmatterScalar(String.raw`'C:\path''\x'`), String.raw`C:\path'\x`, '…while \'\' still is one quote');
});

test('引号转义:经 splitFrontmatter 读取 CMS 写出的 frontmatter,键值与列表项都还原', () => {
  const { fm, body } = splitFrontmatter(String.raw`---
title: 'Don''t stop'
path: "C:\\dir\\"
tags:
  - 'it''s'
  - "a\"b"
---
正文 [[tentacle_body]]
`);
  assert.equal(fm.title, "Don't stop");
  assert.equal(fm.path, 'C:\\dir\\');
  assert.deepEqual(fm.tags, ["it's", 'a"b']);
  assert.equal(body, '正文 [[tentacle_body]]\n');
});

// ---------- 对象块列表:与单行 JSON 等价 ----------

test('对象块列表: - key: value 的项解析成对象数组', () => {
  const { fm } = splitFrontmatter([
    '---', 'usage:', '  - type: sell', '    text: 卖掉它', '    source: 据 a.cs',
    '  - type: process', '    text: 加工', '    source: 据 b.cs', '---', '', '正文',
  ].join('\n'));
  assert.deepEqual(fm.usage, [
    { type: 'sell', text: '卖掉它', source: '据 a.cs' },
    { type: 'process', text: '加工', source: '据 b.cs' },
  ]);
});

test('对象块列表: 与单行 JSON 写法解析结果相同', () => {
  const json = splitFrontmatter('---\nusage: [{"type":"sell","text":"卖掉它"}]\n---\n').fm;
  const block = splitFrontmatter('---\nusage:\n  - type: sell\n    text: 卖掉它\n---\n').fm;
  assert.deepEqual(block, json);
});

// ---------- 阶段 5:块标量(Sveltia CMS 把多行的字符串字段写成 | 或 >) ----------
//
// 实测(Sveltia CMS 0.271.0,Test 后端,2026-11-26):一个多行的富文本字段保存后是
// `items_intro: |-` 加缩进两格的内容,空行保留;没填的写成 ''。YAML 库还会把超过
// 80 列、带空格的句子折成 `>-`。在此之前解析器不认这种写法:值被读成一个竖线,
// 后面的行连同 --- 都成了正文。任何一个允许多行的字段(比如 Mod 的简介)都踩得到。

/** 实测保存出来的文件,逐字。 */
const SAVED_BY_THE_CMS = [
  '---',
  'title: 淫色深空系列',
  'order: null',
  'mods:',
  '  - lewd_meme',
  'cards: true',
  'items_intro: |-',
  '  第一行：先看神奇乳汁，再看 wondrous_milk。',
  '',
  '  第二行：另起一段。',
  '',
  '  第三行，紧挨着第二行。第一行：先看神奇乳汁。',
  '',
  '  第二行：再看看别的，还有内嵌卡 wondrous_milk。',
  '',
  '  - 列表项一',
  '  - 列表项二',
  "mechanics_intro: ''",
  '---',
  '',
  '以《淫色深空：可能是触手》为核心的模组系列，含暗流交易、巢穴扩展、掌上青楼、旧版互动和 tearlaments。',
  '',
].join('\n');

test('块字面量 |:内容缩进、空行保留;块后面的键和正文都不受影响;块里看着像键的行是内容', () => {
  const { fm, body } = splitFrontmatter([
    '---', 'title: 甲', 'text: |', '  第一行', '', '  第二行', '  fake: 这不是键', 'next: 2', '---', '', '正文。', '',
  ].join('\n'));
  assert.equal(fm.title, '甲');
  assert.equal(fm.text, '第一行\n\n第二行\nfake: 这不是键\n', 'clip: exactly one final line break');
  assert.equal(fm.next, 2, 'the key after the block is read as a key');
  assert.equal(body, '\n正文。\n', 'and the body is the body');
});

test('块字面量的结尾:| 留一个换行,|- 去掉,|+ 全留;空块是空串', () => {
  const read = (head, tail = '') => parseFrontmatter(`---\ntext: ${head}\n  甲\n  乙\n${tail}next: 1\n---\n`);
  assert.equal(read('|').text, '甲\n乙\n');
  assert.equal(read('|-').text, '甲\n乙\n'.trimEnd());
  assert.equal(read('|', '\n\n').text, '甲\n乙\n', 'clip drops the extra empty lines');
  assert.equal(read('|+', '\n\n').text, '甲\n乙\n\n\n', 'keep keeps them');
  assert.equal(parseFrontmatter('---\ntext: |\nnext: 1\n---\n').text, '', 'no content lines at all: the empty string');
  assert.equal(parseFrontmatter('---\ntext: |-\n\n  甲\nnext: 1\n---\n').text, '甲', 'empty lines before the first line of content are not content');
});

test('折叠块 >:行与行之间是一个空格,空行是换行;>- 和 >+ 的结尾;缩进更深的行保留换行', () => {
  assert.equal(parseFrontmatter("---\nsummary: >-\n  This is a long sentence that the YAML library folded at a space\n  because it was wider than eighty columns.\nnext: 1\n---\n").summary,
    'This is a long sentence that the YAML library folded at a space because it was wider than eighty columns.');
  assert.equal(parseFrontmatter('---\ntext: >\n  甲\n\n  乙\n  丙\nnext: 1\n---\n').text, '甲\n乙 丙\n');
  assert.equal(parseFrontmatter("---\ntext: >+\n  甲\n\n\nnext: 1\n---\n").text, '甲\n\n\n');
  assert.equal(parseFrontmatter("---\ntext: >-\n  甲\n    更深的一行\n  乙\nnext: 1\n---\n").text, '甲\n  更深的一行\n乙', 'a more-indented line keeps its line breaks, and only its extra indent');
});

test('CMS 实测的文件:多行的富文本是 |-,开关是 true,没填的是空串;读回原来的文字,正文照旧', () => {
  const { fm, body } = splitFrontmatter(SAVED_BY_THE_CMS);
  assert.equal(fm.title, '淫色深空系列');
  assert.deepEqual(fm.mods, ['lewd_meme']);
  assert.equal(fm.cards, true);
  assert.equal(fm.mechanics_intro, '');
  assert.equal(fm.items_intro, [
    '第一行：先看神奇乳汁，再看 wondrous_milk。', '', '第二行：另起一段。', '', '第三行，紧挨着第二行。第一行：先看神奇乳汁。', '',
    '第二行：再看看别的，还有内嵌卡 wondrous_milk。', '', '- 列表项一', '- 列表项二',
  ].join('\n'));
  assert.ok(body.includes('以《淫色深空：可能是触手》为核心的模组系列'), 'the body is the body');
  assert.ok(!body.includes('items_intro') && !body.includes('第一行') && !body.includes('mechanics_intro'), 'nothing of the header leaked into it');
});

test('既有的多行字段同样读得回:Mod 的简介在编辑器里按过回车,保存后是折叠块;折叠块里的一个空行读回是一个换行', () => {
  const fm = parseFrontmatter("---\ntitle: 甲\nsummary: >-\n  第一行的简介\n\n  第二行的简介\nauthor: '某人'\n---\n\n正文\n");
  assert.equal(fm.summary, '第一行的简介\n第二行的简介', 'YAML folds one empty line into one line break');
  assert.equal(fm.author, '某人', 'the key after it is still a key');
  assert.equal(parseFrontmatter("---\ntitle: 甲\nsummary: |-\n  第一行的简介\n\n  第二行的简介\nauthor: '某人'\n---\n").summary, '第一行的简介\n\n第二行的简介',
    'a literal block keeps the empty line as it is');
});

test('老文件不受影响:头部里没有块写法的,切分和读法同以前', () => {
  // 无闭合方言:首个空行结束头部(以前就这样)
  const old = splitFrontmatter('---\ntitle: 甲\n\n正文里的 --- 不算闭合\n---\n');
  assert.deepEqual(old.fm, { title: '甲' });
  assert.equal(old.body, '正文里的 --- 不算闭合\n---\n');
  // 闭合方言里夹着空行、没有块写法:仍在首个空行结束(以前的宽容行为,不动)
  const spaced = splitFrontmatter('---\ntitle: 甲\n\nsummary: 乙\n---\n正文');
  assert.deepEqual(spaced.fm, { title: '甲' });
});

test('对象块列表: 值里的引号、转义与数字', () => {
  const { fm } = splitFrontmatter([
    '---', 'items:', "  - name: 'it''s'", '    count: 3', '    note: "a\\"b"', '---',
  ].join('\n'));
  assert.deepEqual(fm.items, [{ name: "it's", count: 3, note: 'a"b' }]);
});
