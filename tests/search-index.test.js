'use strict';

// Task 9 tests: 2-gram search index + client search.
//
// 覆盖三块:
// 1. tools/build/search-index.js — tokenize / buildSearchIndex / queryIndex
// 2. render.js 接线 — data.js 的 search 字段从占位 [] 换成真实索引,
//    并用解析后的 WIKI_DATA.search 直接跑查询(与客户端同数据形状)
// 3. assets-src/search.js — 纯静态浏览器脚本,无法 node --test 直接跑,
//    用「轻量 DOM stub」加载(伪造 window/document 元素)做行为断言,
//    辅以少量源码字符串断言(双读 location.search/hash、keyup)。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { tokenize, buildSearchIndex, queryIndex } = require('../tools/build/search-index.js');
const { renderSite } = require('../tools/build/render.js');

// 与 WIKI_DATA.items 同形状的精简字段(id/name/mod/price/shape/categories/
// tags/description/flavor)。hand-built,小而聚焦。
const ITEMS = [
  {
    id: 'wondrous_milk', name: '神奇乳汁', mod: 'lewd_meme', price: 180, shape: [2, 3],
    categories: ['饮料', '食物'], tags: ['奢侈品'],
    description: '苗床产出的核心液体物品。', flavor: '苗床以人类的食物为原料酿出的乳汁。',
  },
  {
    id: 'milk_barrel', name: '神奇乳汁桶', mod: 'lewd_meme_remake', price: 150, shape: [1, 1],
    categories: ['容器'], tags: [],
    description: '桶装容器。', flavor: null,
  },
  {
    id: 'milk_rich', name: '浓郁乳汁', mod: 'lewd_meme_remake', price: 300, shape: [1, 1],
    categories: ['饮料'], tags: [],
    description: '价值最高的乳汁。', flavor: null,
  },
  {
    id: 'milk_shake', name: '奶昔 Milk Shake', mod: 'lewd_meme', price: 60, shape: [1, 1],
    categories: ['饮料'], tags: ['milk'],
    description: '含 milk 的饮品。', flavor: null,
  },
  {
    id: 'milks_jar', name: 'Milks 罐', mod: 'lewd_meme', price: 40, shape: [1, 1],
    categories: [], tags: [],
    description: 'milks 相关的罐装物品。', flavor: null,
  },
  {
    // name/categories/tags/description/flavor 全 null 的容错条目
    id: 'no_name', name: null, mod: 'lewd_meme', price: null, shape: null,
    categories: null, tags: null, description: null, flavor: null,
  },
  {
    // description 超过 80 字符:summary 必须截断
    id: 'long_desc', name: '长描述物品', mod: 'lewd_meme', price: 1, shape: [1, 1],
    categories: [], tags: [],
    description: '这是一段专门用来测试摘要截断行为的超长描述文本。'.repeat(6), flavor: null,
  },
];

const MECHANICS = [
  { slug: 'night-settlement', title: '夜间结算与疲劳' },
  { slug: 'barrel-system', title: '桶装系统' },
];

function fixture() {
  return structuredClone({ items: ITEMS, mechanics: MECHANICS });
}

function idOf(index, id) {
  const idx = index.docs.findIndex((d) => d.id === id);
  assert.ok(idx >= 0, `docs 中缺少 ${id}`);
  return idx;
}

// ---------------------------------------------------------------------------
// ① tokenize:中文 2-gram 滑窗 + ASCII 整词
// ---------------------------------------------------------------------------

test('tokenize: 中文按相邻二字滑窗(神奇乳汁 → 神奇/奇乳/乳汁)', () => {
  assert.deepEqual(tokenize('神奇乳汁'), ['神奇', '奇乳', '乳汁']);
  assert.deepEqual(tokenize('神奇乳汁桶'), ['神奇', '奇乳', '乳汁', '汁桶']);
  assert.deepEqual(tokenize('桶装系统'), ['桶装', '装系', '系统']);
});

test('tokenize: ASCII 整词 + 附加 2-gram(milks → milks+mi/il/lk/ks,I1 前缀命中)', () => {
  assert.deepEqual(tokenize('milk'), ['milk', 'mi', 'il', 'lk']);
  assert.deepEqual(tokenize('milks'), ['milks', 'mi', 'il', 'lk', 'ks']);
  assert.deepEqual(tokenize('mi'), ['mi'], '长度≤2 仅整词(滑窗与整词重复)');
  assert.deepEqual(tokenize('Milk Shake'), ['milk', 'mi', 'il', 'lk', 'shake', 'sh', 'ha', 'ak', 'ke']);
  assert.deepEqual(tokenize('milk_shake'), ['milk', 'mi', 'il', 'lk', 'shake', 'sh', 'ha', 'ak', 'ke'], '下划线是分隔符');
});

test('tokenize: 混合文本与确定性', () => {
  const q = '神奇乳汁 milk';
  assert.deepEqual(tokenize(q), ['神奇', '奇乳', '乳汁', 'milk', 'mi', 'il', 'lk']);
  // 确定性:多次调用、空白差异,输出一致
  assert.deepEqual(tokenize(q), tokenize(q));
  assert.deepEqual(tokenize(q), tokenize('  神奇乳汁   milk  '));
  assert.deepEqual(tokenize('神奇乳汁(milk)桶装'), ['神奇', '奇乳', '乳汁', 'milk', 'mi', 'il', 'lk', '桶装'],
    '标点分隔中英段');
});

test('tokenize: 边界(空/ null/ 单个 CJK 字)', () => {
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
  assert.deepEqual(tokenize(undefined), []);
  assert.deepEqual(tokenize('乳'), ['乳'], '单字段退化为单字 token');
});

// ---------------------------------------------------------------------------
// ② buildSearchIndex:docs + 倒排 grams
// ---------------------------------------------------------------------------

test('buildSearchIndex: docs 形状与 url(type: item|mechanic)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  assert.equal(index.docs.length, ITEMS.length + MECHANICS.length);
  assert.deepEqual(index.docs[0], {
    id: 'wondrous_milk', type: 'item', title: '神奇乳汁',
    url: 'item/wondrous_milk.html', summary: '苗床产出的核心液体物品。',
  });
  const mech = index.docs.find((d) => d.type === 'mechanic');
  assert.equal(mech.id, 'night-settlement');
  assert.equal(mech.url, 'mechanics/night-settlement.html');
  assert.equal(mech.title, '夜间结算与疲劳');
  // items 在前、mechanics 在后
  assert.equal(index.docs[index.docs.length - 1].id, 'barrel-system');
});

test('buildSearchIndex: name=null 回退 id;summary 截前 80 字符;mechanic 摘要为空', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const noName = index.docs.find((d) => d.id === 'no_name');
  assert.equal(noName.title, 'no_name', 'name null 回退 id');
  assert.equal(noName.summary, '');
  const long = index.docs.find((d) => d.id === 'long_desc');
  assert.ok(long.summary.length <= 81, `summary ≤80 字符 + …(实际 ${long.summary.length})`);
  assert.ok(long.summary.endsWith('…'), '截断补省略号');
  const mech = index.docs.find((d) => d.type === 'mechanic');
  assert.equal(mech.summary, '', 'mechanics 无 description,summary 为空字符串');
});

test('buildSearchIndex: summary 截断不产生孤立代理对(M2)', () => {
  // 75 ASCII + 3 个 emoji(各 2 code units)+ 中文:旧 slice(0,80) 会切在 emoji 代理中间
  const desc = 'a'.repeat(75) + '🎉🎉🎉快乐文本快乐文本快乐文本';
  assert.ok(desc.length > 80, '前置:源串超 80 code units');
  const index = buildSearchIndex([{ id: 'emoji_item', name: '表情', description: desc }], []);
  const summary = index.docs[0].summary;
  const ORPHAN_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  assert.ok(!ORPHAN_SURROGATE.test(summary), '不得含孤立代理(半截 emoji)');
  assert.ok(summary.endsWith('…'), '仍按 80 个码点截断');
});

test('buildSearchIndex: "神奇乳汁" 的 2-gram(神奇/奇乳/乳汁)全部命中同一 doc(brief Step 1)', () => {
  const index = buildSearchIndex(fixture().items, fixture().mechanics);
  const wIdx = idOf(index, 'wondrous_milk');
  for (const gram of ['神奇', '奇乳', '乳汁']) {
    assert.ok(index.grams[gram].includes(wIdx), `grams["${gram}"] 含 wondrous_milk`);
  }
});

test('buildSearchIndex: 索引域并入 id 与 aliases(final review:infobox 展示的 ID/别名可检索)', () => {
  const items = structuredClone(ITEMS);
  items.find((it) => it.id === 'wondrous_milk').aliases = ['milk_wondrous'];
  const index = buildSearchIndex(items, MECHANICS);
  const wIdx = idOf(index, 'wondrous_milk');
  // id 域:wondrous(milk) 整词入倒排表(title 级)
  assert.ok(index.grams.wondrous.includes(wIdx), 'id 的 ASCII 整词入表');
  // 别名域:milk_wondrous 同样入表
  assert.ok(index.grams.milk.includes(wIdx));

  // 查询 wondrous_milk(物品真实 ID)→ 全 token 命中该物品,排第一
  const byId = queryIndex(index, 'wondrous_milk');
  assert.equal(byId[0].doc.id, 'wondrous_milk');

  // 查询别名 milk_wondrous → 同样命中该物品且排第一(milk+wondrous 双命中)
  const byAlias = queryIndex(index, 'milk_wondrous');
  assert.equal(byAlias[0].doc.id, 'wondrous_milk');
});

test('buildSearchIndex: 索引域覆盖 title/categories/tags/description/flavor', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const barrel = idOf(index, 'milk_barrel');
  const wIdx = idOf(index, 'wondrous_milk');
  assert.ok(index.grams['容器'].includes(barrel), 'categories 域');
  assert.ok(index.grams['奢侈'].includes(wIdx), 'tags 域(奢侈品 → 奢侈/侈品)');
  assert.ok(index.grams['侈品'].includes(wIdx), 'tags 域滑窗第二个 gram');
  assert.ok(index.grams['苗床'].includes(wIdx), 'description/flavor 域');
  assert.ok(index.grams['酿出'].includes(wIdx), 'flavor 域');
  assert.ok(index.grams['milk'].includes(idOf(index, 'milk_shake')), '英文整词(title/tags/description)');
  // postings:升序且无重复
  for (const [gram, list] of Object.entries(index.grams)) {
    const sorted = [...list].sort((a, b) => a - b);
    assert.deepEqual(list, sorted, `grams["${gram}"] 应升序`);
    assert.equal(new Set(list).size, list.length, `grams["${gram}"] 应无重复`);
  }
});

// ---------------------------------------------------------------------------
// ③ queryIndex:交集路径 + 降级并集 + 命中数排序 + title 权重
// ---------------------------------------------------------------------------

test('queryIndex: 交集路径——"神奇乳汁" 全 token 命中的 doc 排最前(hits=3)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, '神奇乳汁');
  assert.ok(results.length >= 2);
  assert.equal(results[0].hits, 3, 'tokens=神奇/奇乳/乳汁,全命中 hits=3');
  const top2 = results.slice(0, 2).map((r) => r.doc.id).sort();
  assert.deepEqual(top2, ['milk_barrel', 'wondrous_milk'], '神奇乳汁/神奇乳汁桶 全命中');
  // 同 hits=3 的 tie:两者 title 都含全部 token → docIdx 稳定序,wondrous_milk(0) 在前
  assert.equal(results[0].doc.id, 'wondrous_milk');
  // 其余(部分命中)排其后
  assert.ok(results.slice(2).every((r) => r.hits < 3));
});

test('queryIndex: "milk" 英文整词命中,且前缀命中含 milks 的 doc(I1)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, 'milk');
  const ids = results.map((r) => r.doc.id);
  assert.ok(ids.includes('milk_shake'), '整词 milk 命中');
  assert.ok(ids.includes('milks_jar'), '前缀 gram(mi/il/lk)命中含 milks 的 doc');
  const shake = results.find((r) => r.doc.id === 'milk_shake');
  const jar = results.find((r) => r.doc.id === 'milks_jar');
  assert.equal(shake.hits, 4, 'milk+mi+il+lk 全命中(交集路径)');
  assert.equal(jar.hits, 3, 'milks_jar 缺整词 milk,命中 3 个前缀 gram');
  assert.ok(results.findIndex((r) => r.doc.id === 'milk_shake')
    < results.findIndex((r) => r.doc.id === 'milks_jar'), '整词命中排前');
});

test('queryIndex: "mi" 前缀命中 milk 与 milks 的 docs(I1)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, 'mi');
  const ids = results.map((r) => r.doc.id);
  assert.ok(ids.includes('milk_shake'));
  assert.ok(ids.includes('milks_jar'));
});

test('queryIndex: 单字中文查询扫描含该字的 2-gram 键("乳" 命中乳汁 docs,I2)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, '乳');
  const ids = results.map((r) => r.doc.id);
  for (const id of ['wondrous_milk', 'milk_barrel', 'milk_rich']) {
    assert.ok(ids.includes(id), `单字"乳"应命中 ${id}`);
  }
  assert.ok(results.every((r) => r.hits === 1), '单字 token 无论扫中几个 2-gram 键都计 1');
});

test('queryIndex: 单字中文多 token 计分("乳 桶" → 桶装条目 hits=2 排前,I2)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, '乳 桶');
  const barrel = results.find((r) => r.doc.id === 'milk_barrel');
  assert.equal(barrel.hits, 2, '乳+桶 双命中');
  assert.equal(results[0].doc.id, 'milk_barrel');
});

test('queryIndex: "乳汁桶" 命中桶装条目且按命中数排前(桶装 hits=2 > 普通乳汁 hits=1)', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const results = queryIndex(index, '乳汁桶');
  const ids = results.map((r) => r.doc.id);
  assert.ok(ids.includes('milk_barrel'), '桶装条目命中(神奇乳汁桶 → 乳汁+汁桶)');
  assert.ok(ids.includes('wondrous_milk'), '普通乳汁部分命中(仅 乳汁),并集路径保留');
  const barrel = results.find((r) => r.doc.id === 'milk_barrel');
  const milk = results.find((r) => r.doc.id === 'wondrous_milk');
  assert.equal(barrel.hits, 2);
  assert.equal(milk.hits, 1);
  assert.ok(results.findIndex((r) => r.doc.id === 'milk_barrel')
    < results.findIndex((r) => r.doc.id === 'wondrous_milk'), '命中数多的在前');
});

test('queryIndex: 降级并集路径——无 doc 全命中时按命中数降序', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  // 夜间/结算 只在 mechanic title,神奇 只在物品——交集为空
  const results = queryIndex(index, '夜间 结算 神奇');
  assert.ok(results.length >= 2, '并集路径:部分命中也返回');
  assert.ok(results.every((r) => r.hits < 3), '无全命中 doc(交集为空)');
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].hits >= results[i].hits, 'hits 降序');
  }
  const mech = results.find((r) => r.doc.id === 'night-settlement');
  const milk = results.find((r) => r.doc.id === 'wondrous_milk');
  assert.equal(mech.hits, 2, '夜间+结算 双命中');
  assert.equal(milk.hits, 1);
  assert.ok(results.findIndex((r) => r.doc.id === 'night-settlement')
    < results.findIndex((r) => r.doc.id === 'wondrous_milk'));
});

test('queryIndex: title 命中权重——同 hits 时 title 命中者在前', () => {
  const duo = [
    { id: 'a_potion', name: '红色药水', categories: [], tags: [], description: '乳汁制品。', flavor: null },
    { id: 'b_potion', name: '乳汁药水', categories: [], tags: [], description: '红色制品。', flavor: null },
  ];
  const index = buildSearchIndex(duo, []);
  const results = queryIndex(index, '乳汁');
  assert.deepEqual(results.map((r) => r.doc.id), ['b_potion', 'a_potion'],
    '两者 hits 均 1,但 b_potion 的 title 命中 → 前');
});

test('queryIndex: 空 query 与空索引容错', () => {
  const index = buildSearchIndex(ITEMS, MECHANICS);
  assert.deepEqual(queryIndex(index, ''), []);
  assert.deepEqual(queryIndex(index, '   '), []);
  assert.deepEqual(queryIndex(index, '!!!'), [], '全标点 → 无 token');
  assert.deepEqual(queryIndex(null, '乳汁'), []);
  assert.deepEqual(queryIndex({}, '乳汁'), []);
});

// ---------------------------------------------------------------------------
// ④ render.js 接线:data.js 的 search 字段
// ---------------------------------------------------------------------------

const RENDER_FIXTURE = {
  generatedAt: '2026-11-18T10:00:00.000Z',
  baseline: { date: '2026-11-18', versions: { lewd_meme: '1.9.2' } },
  mods: [{ id: 'lewd_meme', name: '淫色深空', version: '1.9.2', author: 'x', prerequisites: [], description: '主模组。', itemCount: ITEMS.length }],
  items: ITEMS,
  mechanics: MECHANICS,
  news: [],
  changelog: [],
  facets: { categories: ['饮料', '容器'] },
};

test('renderSite: data.js 的 search 字段为完整索引(替换占位 [])', async () => {
  const out = await renderSite(structuredClone(RENDER_FIXTURE), { layout: null });
  const src = out.get('data.js');
  assert.ok(src.startsWith('window.WIKI_DATA = '));
  assert.ok(src.includes('"search"'), 'search 字段存在');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modwiki-search-'));
  const file = path.join(tmp, 'data.js');
  fs.writeFileSync(file, src);
  global.window = {};
  require(file);
  const search = global.window.WIKI_DATA.search;
  assert.equal(search.docs.length, ITEMS.length + MECHANICS.length);
  const wIdx = search.docs.findIndex((d) => d.id === 'wondrous_milk');
  assert.ok(search.grams['乳汁'].includes(wIdx), '倒排表已序列化进 data.js');
  // 摘要截断在 data.js 内生效(精简原则)
  assert.ok(search.docs.every((d) => d.summary.length <= 81));
  // 用客户端同形状数据直接查询(端到端)
  const results = queryIndex(search, '乳汁桶');
  assert.equal(results[0].doc.id, 'milk_barrel');
  delete global.window;
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ⑤ assets-src/search.js:轻量 DOM stub 行为测试 + 源码断言
// ---------------------------------------------------------------------------

const SEARCH_SRC = fs.readFileSync(path.join(__dirname, '..', 'assets-src', 'search.js'), 'utf8');

function loadSearchClient() {
  const sandboxWindow = {};
  global.window = sandboxWindow;
  delete require.cache[require.resolve('../assets-src/search.js')];
  require('../assets-src/search.js'); // autoInit 在无 document 时直接返回
  const api = sandboxWindow.__wikiSearch;
  delete global.window;
  assert.ok(api, 'search.js 应向 window 挂载 __wikiSearch(测试钩子)');
  return api;
}

function fakeEl() {
  const listeners = {};
  return {
    value: '',
    innerHTML: '',
    addEventListener(type, fn) { (listeners[type] = listeners[type] ?? []).push(fn); },
    fire(type) { (listeners[type] ?? []).forEach((fn) => fn()); },
  };
}

test('search.js: 内联 tokenize 与索引端输出一致(同步性)', () => {
  const api = loadSearchClient();
  for (const q of ['神奇乳汁 milk', 'Milk Shake', '神奇乳汁(milk)桶装', '乳', 'milk', 'mi', '']) {
    assert.deepEqual(api.tokenize(q), tokenize(q), JSON.stringify(q));
  }
});

test('search.js: searchDocs 与 queryIndex 同序(交集 + 并集降级 + 单字中文)', () => {
  const api = loadSearchClient();
  const index = buildSearchIndex(ITEMS, MECHANICS);
  for (const q of ['神奇乳汁', '乳汁桶', '夜间 结算 神奇', 'milk', 'mi', '乳', '乳 桶']) {
    assert.deepEqual(
      api.searchDocs(index, q).map((h) => h.doc.id),
      queryIndex(index, q).map((r) => r.doc.id),
      q,
    );
  }
});

test('search.js: readInitialQuery 双读 location.search 与 location.hash(#q=)', () => {
  const api = loadSearchClient();
  assert.equal(api.readInitialQuery({ search: '?q=乳汁', hash: '' }), '乳汁', 'GET ?q=');
  assert.equal(api.readInitialQuery({ search: '', hash: '#q=%E4%B9%B3%E6%B1%81' }), '乳汁', 'hash 编码');
  assert.equal(api.readInitialQuery({ search: '?x=1', hash: '#q=乳汁' }), '乳汁', 'search 丢参时回退 hash');
  assert.equal(api.readInitialQuery({ search: '?q=乳汁', hash: '#q=其他' }), '乳汁', 'search 优先');
  assert.equal(api.readInitialQuery({ search: '', hash: '' }), '');
  assert.equal(api.readInitialQuery({ search: '?q=', hash: '' }), '');
  assert.equal(api.readInitialQuery(null), '');
});

test('search.js: init——keyup 实时查询、空 query 提示、结果渲染到容器', () => {
  const api = loadSearchClient();
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const input = fakeEl();
  const resultsEl = fakeEl();
  api.init({ data: { search: index }, input, resultsEl, location: { search: '', hash: '' } });

  assert.ok(resultsEl.innerHTML.includes('search-hint'), '空 query 显示提示');

  input.value = '乳汁桶';
  input.fire('keyup');
  assert.ok(resultsEl.innerHTML.includes('item/milk_barrel.html'), '结果含桶装条目链接');
  assert.ok(resultsEl.innerHTML.includes('神奇乳汁桶'), '结果含标题');
  assert.ok(resultsEl.innerHTML.includes('search-hit-item'), '类型徽章(item)');
  assert.ok(resultsEl.innerHTML.includes('物品'), '中文类型徽章');
  assert.ok(resultsEl.innerHTML.includes('桶装容器。'), '摘要');

  input.value = '夜间';
  input.fire('keyup');
  assert.ok(resultsEl.innerHTML.includes('mechanics/night-settlement.html'), '机制结果');
  assert.ok(resultsEl.innerHTML.includes('机制'), '机制徽章');

  input.value = 'zzzz不存在的词';
  input.fire('keyup');
  assert.ok(resultsEl.innerHTML.includes('search-empty'), '无结果提示');
});

test('search.js: init——初始 query 自动执行(?q= 与 #q= 两种进入方式)', () => {
  const api = loadSearchClient();
  const index = buildSearchIndex(ITEMS, MECHANICS);

  const input1 = fakeEl();
  const results1 = fakeEl();
  api.init({ data: { search: index }, input: input1, resultsEl: results1, location: { search: '?q=神奇乳汁', hash: '' } });
  assert.equal(input1.value, '神奇乳汁');
  assert.ok(results1.innerHTML.includes('item/wondrous_milk.html'), '?q= 自动查询');

  const input2 = fakeEl();
  const results2 = fakeEl();
  api.init({ data: { search: index }, input: input2, resultsEl: results2, location: { search: '', hash: '#q=%E4%B9%B3%E6%B1%81%E6%A1%B6' } });
  assert.equal(input2.value, '乳汁桶');
  assert.ok(results2.innerHTML.includes('item/milk_barrel.html'), '#q= 自动查询');
});

test('search.js: init——WIKI_DATA.search 缺失时容错提示不抛错', () => {
  const api = loadSearchClient();
  for (const data of [null, undefined, {}, { search: null }, { search: {} }]) {
    const input = fakeEl();
    const resultsEl = fakeEl();
    assert.doesNotThrow(() => api.init({ data, input, resultsEl, location: { search: '', hash: '' } }));
    input.value = '乳汁';
    input.fire('keyup');
    assert.ok(resultsEl.innerHTML.includes('搜索索引未生成'), `容错提示(data=${JSON.stringify(data)})`);
  }
});

test('search.js: autoInit——hashchange 触发重查(M1),初始 #q= 自动执行', () => {
  const api = loadSearchClient(); // 先普通加载一次(无 document 路径)
  const index = buildSearchIndex(ITEMS, MECHANICS);
  const listeners = {};
  const input = fakeEl();
  const resultsEl = fakeEl();
  const sandboxWindow = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] ?? []).push(fn); },
    location: { search: '', hash: '#q=%E4%B9%B3%E6%B1%81' },
    WIKI_DATA: { search: index },
  };
  global.window = sandboxWindow;
  global.document = {
    getElementById(id) {
      if (id === 'search-input') return input;
      if (id === 'results' || id === 'search-results') return resultsEl;
      return null;
    },
  };
  delete require.cache[require.resolve('../assets-src/search.js')];
  require('../assets-src/search.js');
  assert.equal(input.value, '乳汁', '初始 hash 自动查询');
  assert.ok(resultsEl.innerHTML.includes('item/wondrous_milk.html'));

  // 页内 hash 变化(不重载页面)→ 自动重查
  sandboxWindow.location.hash = '#q=milk';
  assert.ok(Array.isArray(listeners['hashchange']), '已注册 hashchange 监听');
  listeners['hashchange'].forEach((fn) => fn());
  assert.equal(input.value, 'milk');
  assert.ok(resultsEl.innerHTML.includes('item/milk_shake.html'));

  delete global.document;
  delete global.window;
});

test('search.js: 源码要点(双读/keyup/hashchange/#results 回退/同步注释)', () => {
  assert.ok(SEARCH_SRC.includes('location.search 与 location.hash'), 'file:// 丢参双读说明');
  assert.ok(SEARCH_SRC.includes("'keyup'"), 'keyup 实时查询');
  assert.ok(SEARCH_SRC.includes("'hashchange'"), 'hashchange 重查(M1)');
  assert.ok(SEARCH_SRC.includes("getElementById('results')"), 'brief 目标容器 #results');
  assert.ok(SEARCH_SRC.includes("getElementById('search-results')"), '现有 search.html 容器回退');
  assert.ok(SEARCH_SRC.includes('保持同步'), '与 search-index.js 的同步注释');
  assert.ok(SEARCH_SRC.includes('window.WIKI_DATA'), '数据源');
});
