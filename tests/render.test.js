'use strict';

// Task 8 tests: page renderers + inline data.js.
//
// Fixture strategy (per the controller's recommendation): a hand-built
// minimal WIKI_DATA literal — 6 mods, a handful of items — fast and focused,
// no fake modsDir tree needed. Item-body markdown comes from a temp
// contentDir so the "用法正文" branch is covered with a real file read.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderSite } = require('../tools/build/render.js');

const MODS = [
  { id: 'lewd_meme', name: '淫色深空:可能是触手', version: '1.9.2', author: 'tentacle', prerequisites: [], description: '家族主模组。苗床与触手本体。\n【1.9.2】修复苗床产出。', itemCount: 2 },
  { id: 'lewd_meme_remake', name: '暗流交易', version: '1.6.4', author: 'remake', prerequisites: ['lewd_meme'], description: '三种自有乳汁与桶装系统。\n【1.6.4】新增疲劳与估值机制。', itemCount: 2 },
  { id: 'claude.lewdMemeBrood', name: '巢穴扩展', version: '0.3.31', author: 'brood', prerequisites: ['lewd_meme'], description: '触手卵孵化与功能触手。', itemCount: 1 },
  { id: 'lewd_meme_brothel', name: '掌上青楼', version: '0.10.4', author: 'brothel', prerequisites: ['lewd_meme'], description: '青楼经营玩法。', itemCount: 1 },
  { id: 'lewd_meme_legacy_content', name: '可能有互动', version: '1.0.6', author: 'legacy', prerequisites: ['lewd_meme'], description: '旧版互动内容合集。', itemCount: 0 },
  { id: 'dui_mian_lan_qiu_ji_tearl', name: 'tearlaments', version: '7', author: 'tear', prerequisites: ['lewd_meme'], description: '深海来客。', itemCount: 1 },
];

function item(id, mod, extra) {
  return {
    id,
    aliases: [],
    name: id,
    mod,
    price: null,
    shape: [1, 1],
    icon: null,
    categories: [],
    tags: [],
    description: null,
    flavor: null,
    usage: [],
    sources: [],
    related: [],
    notes: null,
    provenance: {},
    ...extra,
  };
}

const ITEMS = [
  item('wondrous_milk', 'lewd_meme', {
    aliases: ['milk_wondrous'],
    name: '神奇乳汁',
    price: 180,
    shape: [2, 3],
    icon: 'items/lewd_meme/item_milk.png',
    categories: ['饮料', '食物'],
    tags: ['奢侈品'],
    description: '苗床产出的核心液体物品。',
    flavor: '苗床以人类的食物为原料酿出的乳汁。',
    // plan 契约:usage 是对象数组 [{type, text, source}];字符串条目兼容旧形状。
    usage: [
      { type: 'use', text: '<b>直接饮用</b>:恢复体力 30 点。', source: '本体' },
      '装入 [[milk_barrel]] 增加存量。',
    ],
    // plan 契约:sources 是对象数组 [{source, detail, probability}]。
    sources: [{ source: '苗床产出', detail: '夜间结算时苗床产乳', probability: '每夜 1+ 瓶' }, '商人随机带货'],
    related: ['milk_barrel', 'milk_rich'],
    notes: '启用 [[milk_barrel]] 对应的模组后由 2×3 版本接管注册,历史别名 milk_wondrous 仍可识别。',
    provenance: { price: 'csv:物品定义', description: 'loc:lewd_meme' },
  }),
  item('tentacle_body', 'lewd_meme', { name: '触手本体', price: 90, icon: 'items/lewd_meme/tentacle_body.png', categories: ['工具'], description: '触手本体。' }),
  item('milk_barrel', 'lewd_meme_remake', { name: '神奇乳汁桶', price: 150, icon: 'items/lewd_meme_remake/barrel.png', categories: ['容器'], description: '桶装容器。' }),
  item('milk_rich', 'lewd_meme_remake', { name: '浓郁乳汁', price: 300, icon: 'items/lewd_meme_remake/milk_high.png', categories: ['饮料'], description: '价值最高的乳汁。' }),
  item('brood_egg', 'claude.lewdMemeBrood', { name: '触手卵', price: 120, icon: 'items/claude.lewdMemeBrood/brood_egg.png', categories: ['工具'], description: '可孵化为功能触手。' }),
  item('palm_brothel', 'lewd_meme_brothel', { name: '掌上青楼', price: 200, icon: 'items/lewd_meme_brothel/palm.png', description: '青楼经营终端。' }),
  // 真实数据存在 name=null 的内部条目:卡片与页面标题必须回退显示 id。
  item('tear_merchant', 'dui_mian_lan_qiu_ji_tearl', { name: null, price: null, icon: null, description: '收购少女与高品质的水。' }),
];

const MECHANICS = [
  {
    slug: 'night-settlement',
    title: '夜间结算与疲劳',
    source: '# 夜间结算与疲劳\n\n介绍 [[wondrous_milk]] 每晚的产出与疲劳运算。\n\n## 结算顺序\n\n原版完成后追加三种自有乳汁。\n\n## 疲劳等级与系数\n\n入夜疲劳达到 90 时暂停活动。',
  },
  { slug: 'barrel-system', title: '桶装系统', source: '# 桶装系统\n\n桶上限 1000 次,支持批量取出。' },
];

const FIXTURE = {
  generatedAt: '2026-11-18T10:00:00.000Z',
  baseline: { date: '2026-11-18', versions: { lewd_meme: '1.9.2', lewd_meme_remake: '1.6.4', 'claude.lewdMemeBrood': '0.3.31', lewd_meme_brothel: '0.10.4', lewd_meme_legacy_content: '1.0.6', dui_mian_lan_qiu_ji_tearl: '7' } },
  mods: MODS,
  items: ITEMS,
  mechanics: MECHANICS,
  news: [
    { date: '11-18', text: '暗流交易 1.6.4:疲劳与估值机制页重写' },
    { date: '11-17', text: '巢穴扩展 0.3.31:六色功能触手条目补全' },
  ],
  changelog: [
    { mod: 'lewd_meme_remake', version: '1.6.4', date: '', text: '新增疲劳与估值机制' },
    { mod: 'lewd_meme', version: '1.9.2', date: '', text: '修复苗床产出' },
  ],
  facets: { categories: ['容器', '饮料', '食物', '工具'] },
};

async function buildFixture(options = {}) {
  return renderSite(structuredClone(FIXTURE), options);
}

// ---------- 路由完整性 ----------

test('renderSite: 产物覆盖全部路由(页面 + 每物品/机制/mod 页 + data.js)', async () => {
  const out = await buildFixture({ contentDir: null });
  for (const rel of [
    'index.html', 'items.html', 'mechanics.html', 'changelog.html', 'search.html', 'data.js',
    ...MODS.map((m) => `mods/${m.id}.html`),
    ...ITEMS.map((it) => `item/${it.id}.html`),
    ...MECHANICS.map((m) => `mechanics/${m.slug}.html`),
  ]) {
    assert.ok(out.has(rel), `缺少 ${rel}`);
    assert.equal(typeof out.get(rel), 'string');
  }
  assert.ok(!out.has('mods/install-compat.html'), 'install-compat 占位页已删除(final review)');
  assert.equal(out.size, 6 + 6 + 7 + 2); // 骨架 5 + data.js + mods + items + mechanics
});

// ---------- ① 物品页 ----------

test('item 页:infobox 贴图相对路径、面包屑、内链与表格', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('item/wondrous_milk.html');
  assert.ok(html.includes('src="../assets/items/lewd_meme/item_milk.png"'), '贴图相对路径 ../assets/');
  assert.ok(html.includes('href="../css/theme.css"'));
  assert.ok(html.includes('href="../index.html"'));
  assert.ok(html.includes('href="../items.html"'));
  assert.ok(html.includes('神奇乳汁</a>') === false || html.includes('class="crumb"'));
  // 概述
  assert.ok(html.includes('苗床产出的核心液体物品'));
  // 接管说明(notes → notice-box,内链展开)
  assert.ok(html.includes('class="notice-box"'));
  assert.ok(html.includes('接管注册'));
  assert.ok(html.includes('href="../item/milk_barrel.html"'), 'notes 内链展开');
  // 用途:对象形状取 text(plan 契约),字符串形状兼容;[[milk_barrel]] 内链卡
  assert.ok(html.includes('恢复体力 30 点'), 'usage 对象形状的 text 渲染');
  assert.ok(html.includes('装入'), 'usage 字符串形状兼容');
  assert.ok(html.includes('href="../item/milk_barrel.html"'));
  assert.ok(!html.includes('[object Object]'));
  assert.ok(!html.includes('undefined'));
  // 获取途径:三列表格(plan 主字段 detail 出现在说明列、probability 在概率列)
  assert.ok(html.includes('<th>来源</th>'));
  assert.ok(html.includes('<th>说明</th>'));
  assert.ok(html.includes('<th>概率/数量</th>'));
  assert.ok(html.includes('夜间结算时苗床产乳'), 'sources.detail 渲染于说明列');
  assert.ok(html.includes('每夜 1+ 瓶'), 'sources.probability 渲染于概率列');
  // 相关物品卡片(横排网格 + data 属性)
  assert.ok(html.includes('href="../item/milk_rich.html"'));
  // 相关页面:机制索引链接
  assert.ok(html.includes('href="../mechanics.html"'));
  // infobox 适用版本接线(M1):所属 mod 的版本,非恒"待补充"
  assert.ok(html.includes('1.9.2'));
  assert.ok(html.includes('<div class="clear"></div>'));
});

test('item 页:name=null 时标题与卡片回退显示 id,不输出字面 null(I2)', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('item/tear_merchant.html');
  assert.ok(html.includes('<h1 class="page-title">tear_merchant</h1>'));
  assert.ok(!html.includes('>null<'));
  // 全站任何页面不出现字面 null 卡片
  for (const [rel, page] of out) {
    if (rel === 'data.js') continue;
    assert.ok(!page.includes('>null<'), `${rel} 出现 >null<`);
    assert.ok(!page.includes('alt="null"'), `${rel} 出现 alt="null"`);
  }
  const itemsHtml = out.get('items.html');
  assert.ok(itemsHtml.includes('<span class="nm">tear_merchant</span>'), '卡片名称回退 id');
});

test('item 页:icon/price null 用占位,严格 null 判断', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('item/tear_merchant.html');
  assert.ok(html.includes('class="no-icon"'));
  assert.ok(!html.includes('src="../assets/items/'), '无物品贴图');
  assert.ok(html.includes('待补充'));
});

test('item 页:content/items/<id>.md 正文渲染,[[id]] 展开;md 缺失时跳过', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modwiki-render-'));
  fs.mkdirSync(path.join(tmp, 'items'), { recursive: true });
  // 真实方言(final review Critical):content/items 的 md 无闭合 ---,
  // frontmatter 之后空行隔开正文——不得把 frontmatter 当正文泄漏成 JSON。
  fs.writeFileSync(path.join(tmp, 'items', 'wondrous_milk.md'),
    '---\nnotes: 覆盖说明\n\n## 详解小节\n\n每晚产出 [[tentacle_body]] 相关结算。\n');
  // 只有 frontmatter、无正文的变体:详解节必须连同标题一起跳过。
  fs.writeFileSync(path.join(tmp, 'items', 'tentacle_body.md'), '---\nnotes: 只有头\n');
  const out = await renderSite(structuredClone(FIXTURE), { contentDir: tmp });

  const withMd = out.get('item/wondrous_milk.html');
  assert.ok(withMd.includes('详解小节'));
  assert.ok(withMd.includes('href="../item/tentacle_body.html"'), '正文 wikilink 展开为内链卡');
  assert.ok(!withMd.includes('notes: 覆盖说明'), 'frontmatter 不得泄漏进正文');

  const headOnly = out.get('item/tentacle_body.html');
  assert.ok(!headOnly.includes('<h2 class="sec">详解</h2>'), '无正文的 md 连详解标题一起跳过');
  assert.ok(!headOnly.includes('notes: 只有头'), 'frontmatter 不泄漏');

  const withoutMd = await buildFixture({ contentDir: null });
  assert.ok(!withoutMd.get('item/wondrous_milk.html').includes('详解小节'));
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- ② items.html ----------

test('items.html:概述文案、品类/来源 chips、按 mod 分区、卡片 data 属性', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('items.html');
  assert.ok(html.includes('<h1 class="page-title">物品图鉴</h1>'));
  // 概述段(mockup 文案)
  assert.ok(html.includes('物品是模组内容的基本载体'));
  assert.ok(html.includes('决定顾客是否收购'));
  // 品类 chips:全部 + facets.categories 逐个
  assert.ok(html.includes('data-category=""'));
  for (const cat of FIXTURE.facets.categories) {
    assert.ok(html.includes(`data-category="${cat}"`), cat);
  }
  // 来源 chips:全部模组 + 每个 mod
  assert.ok(html.includes('data-mod=""'));
  for (const mod of MODS) {
    assert.ok(html.includes(`data-mod="${mod.id}"`), mod.id);
  }
  // 按 mod 分区标题 = 显示名 + 版本
  assert.ok(html.includes('淫色深空:可能是触手'));
  assert.ok(html.includes('1.9.2'));
  assert.ok(html.includes('暗流交易'));
  // 卡片 data 属性(品类空格分隔多值)
  assert.ok(html.includes('data-mod="lewd_meme" data-category="饮料 食物"')
    || html.includes('data-mod="lewd_meme" data-category="饮料 食物"'));
  assert.ok(html.includes('href="item/wondrous_milk.html"'));
  // chips 过滤交互(Ruling 8):脚本标记 + 状态位 + 两维 chip 挂载
  assert.ok(html.includes('/* item-filter:'), 'filter script marker');
  assert.ok(html.includes('id="item-filter-status"'));
  assert.ok(html.includes("querySelectorAll('span.item-inline[data-' + dim + ']')"));
  assert.ok(html.includes("querySelectorAll('section[data-mod]')"));
  // Minor 9:取消筛选(再点同一 chip)后,「全部」chip 恢复高亮
  assert.ok(html.includes('span.item-inline[data-\' + dim + \'=""]'),
    '取消筛选时「全部」chip 重新高亮');
});

// ---------- ③ data.js ----------

test('data.js:可 require 加载、单行、精简字段、search 索引接线(Task 9)', async () => {
  const out = await buildFixture({ contentDir: null });
  const src = out.get('data.js');
  assert.ok(src.startsWith('window.WIKI_DATA = '));
  assert.equal(src.trim().split('\n').length, 1, '单行');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modwiki-datajs-'));
  const file = path.join(tmp, 'data.js');
  fs.writeFileSync(file, src);
  global.window = {};
  require(file);
  const data = global.window.WIKI_DATA;
  assert.equal(data.items.length, ITEMS.length);
  assert.equal(data.mods.length, MODS.length);
  assert.equal(data.mechanics.length, MECHANICS.length);
  assert.deepEqual(data.mechanics[0], { slug: 'night-settlement', title: '夜间结算与疲劳' });
  // Task 9:占位 [] 已替换为真实 2-gram 索引(细粒度断言在 search-index.test.js)
  assert.equal(data.search.docs.length, ITEMS.length + MECHANICS.length);
  assert.ok(Object.keys(data.search.grams).length > 0);
  assert.equal(data.baseline.date, '2026-11-18');
  // 精简:不含 provenance / notes 内部字段
  for (const it of data.items) {
    assert.ok(!('provenance' in it), it.id);
    assert.ok(!('notes' in it), it.id);
  }
  for (const mod of data.mods) {
    assert.ok(!('provenance' in mod), mod.id);
  }
  // items 精简版仍带检索所需字段
  const milk = data.items.find((it) => it.id === 'wondrous_milk');
  assert.deepEqual(milk.categories, ['饮料', '食物']);
  assert.equal(milk.price, 180);
  assert.equal(milk.icon, 'items/lewd_meme/item_milk.png');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------- ④ index.html ----------

test('index.html:六张模组卡、锚点、热门物品、统计、基线通知、无内部路径', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('index.html');
  assert.ok(html.includes('id="mod-family"'), '模组家族锚点容器');
  assert.equal((html.match(/class="mod-card"/g) || []).length, 6, '六张模组卡');
  assert.ok(html.includes('href="mods/lewd_meme.html"'));
  assert.ok(html.includes('lewd_meme · 1.9.2'));
  assert.ok(html.includes('无前置'));
  assert.ok(html.includes('前置 lewd_meme'));
  // 热门物品:price 降序、id 升序决胜,前 10(price null 除外)
  assert.ok(html.indexOf('浓郁乳汁') < html.indexOf('神奇乳汁'), '300 排在 180 前');
  assert.ok(!html.includes('href="item/tear_merchant.html"'), 'price null 不进热门墙');
  // 站点统计
  assert.ok(html.includes('站点统计'));
  assert.ok(html.includes(`${ITEMS.length}`));
  assert.ok(html.includes('2026-11-18'));
  // 最近更新(news)
  assert.ok(html.includes('疲劳与估值机制页重写'));
  // 通知条:数据基线 + 各 mod 版本
  assert.ok(html.includes('class="top-news"'));
  assert.ok(html.includes('当前数据基线:'));
  assert.ok(html.includes('lewd_meme 1.9.2'));
  assert.ok(html.includes('dui_mian_lan_qiu_ji_tearl 7'));
  // 无 config/api 内部路径泄漏
  for (const secret of ['modsDir', 'apiPatchesDir', 'decompileBase', 'decompileDir', 'contentDir', 'http://', 'https://wiki.biligame.com/probablystolen/index.php']) {
    assert.ok(!html.includes(secret), secret);
  }
});

test('index.html: news 为空时最近更新显示数据基线日期', async () => {
  const data = structuredClone(FIXTURE);
  data.news = [];
  const out = await renderSite(data, { contentDir: null });
  const html = out.get('index.html');
  assert.ok(html.includes('最近更新'));
  assert.ok(html.includes('数据基线 2026-11-18'));
});

// ---------- ⑤ 机制页 ----------

test('mechanics/<slug>.html:TOC(title 转义)、[[id]] 内链卡、frontmatter title', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('mechanics/night-settlement.html');
  assert.ok(html.includes('<h1 class="page-title">夜间结算与疲劳</h1>'));
  // TOC:mdToHtml 的 toc title 渲染时转义(Ruling 7)
  assert.ok(html.includes('class="toc"'));
  assert.ok(html.includes('href="#结算顺序"'));
  assert.ok(html.includes('结算顺序</a>'));
  // 正文 wikilink → 内链卡
  assert.ok(html.includes('href="../item/wondrous_milk.html"'));
  assert.ok(html.includes('class="item-inline"'));
  // 面包屑:首页 > 机制说明 > 标题
  assert.ok(html.includes('机制说明'));
  assert.ok(html.includes('href="../mechanics.html"') || html.includes('mechanics.html'));
  // 无 h1 重复(源 md 的 h1 已剥,page-title 之外无裸 h1)
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

test('mechanics.html 索引页(Ruling 6):全部机制卡 + 摘要', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('mechanics.html');
  assert.ok(html.includes('href="mechanics/night-settlement.html"'));
  assert.ok(html.includes('href="mechanics/barrel-system.html"'));
  assert.ok(html.includes('桶上限 1000 次'), '首段摘要');
});

// ---------- ⑥ 通用:面包屑 + 返回路径 ----------

test('每页均有面包屑与返回首页链接;导航目标已接线(Ruling 6)', async () => {
  const out = await buildFixture({ contentDir: null });
  for (const [rel, html] of out) {
    if (rel === 'data.js') continue;
    assert.ok(html.includes('class="crumb"'), `${rel} 缺面包屑`);
    assert.ok(/<a href="[^"]*index\.html"/.test(html), `${rel} 缺返回首页链接`);
    assert.ok(html.includes('href="' + (rel.includes('/') ? '../' : '') + 'css/theme.css'), rel);
  }
  // NAV 占位全部接线:不再有 href="#"
  const index = out.get('index.html');
  assert.ok(!index.includes('href="#"'), '导航占位必须清除');
  assert.ok(index.includes('href="mechanics.html"'));
  assert.ok(index.includes('href="search.html"'));
  assert.ok(index.includes('href="index.html#mod-family"'));
  // Task 5b A2:顶部导航的「关于本站」不再硬编码——没有页面用 navLabel 声明它,
  // 导航就没有这一项(见下面的 A 组测试)
  assert.ok(!index.includes('href="mechanics/install-compat.html"'), '导航不再硬编码指向 install-compat');
});

// ---------- mods 页 / changelog / search / install-compat ----------

test('mods/<modId>.html:信息表、物品清单、changelog 节选', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('mods/lewd_meme_remake.html');
  assert.ok(html.includes('<h1 class="page-title">暗流交易</h1>'));
  assert.ok(html.includes('<th>项目</th>'));
  assert.ok(html.includes('<code>lewd_meme_remake</code>'));
  assert.ok(html.includes('1.6.4'));
  assert.ok(html.includes('前置'));
  // 物品清单(该 mod 全部卡片,relRoot ../)
  assert.ok(html.includes('href="../item/milk_barrel.html"'));
  assert.ok(html.includes('href="../item/milk_rich.html"'));
  assert.ok(!html.includes('href="../item/wondrous_milk.html"'), '不混入其他 mod 物品');
  // changelog 节选
  assert.ok(html.includes('新增疲劳与估值机制'));
});

test('changelog.html:按 mod 分组、版本号+文本、无日期字段', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('changelog.html');
  assert.ok(html.includes('暗流交易'));
  assert.ok(html.includes('1.6.4'));
  assert.ok(html.includes('新增疲劳与估值机制'));
  assert.ok(html.includes('修复苗床产出'));
  assert.ok(html.includes('href="mods/lewd_meme.html"'));
});

test('search.html:输入框 + results 容器 + 引用 data.js 与 assets/js/search.js', async () => {
  const out = await buildFixture({ contentDir: null });
  const html = out.get('search.html');
  assert.ok(html.includes('type="search"'));
  assert.ok(html.includes('id="search-results"'));
  // data.js 必须先于 search.js 加载:autoInit 读 window.WIKI_DATA.search
  assert.ok(html.includes('<script src="data.js"></script>\n<script src="assets/js/search.js"></script>'));
});

test('关于本站:占位页已删,全站无占位文案', async () => {
  const out = await buildFixture({ contentDir: null });
  assert.ok(!out.has('mods/install-compat.html'), '占位页必须删除');
  for (const [rel, html] of out) {
    if (rel === 'data.js') continue;
    assert.ok(!html.includes('本页为占位骨架'), `${rel} 残留占位文案`);
  }
});

// ---------- Task 5b A — 顶部导航的 about 项由页面自己声明(nav_label) ----------
//
// 机制页的 frontmatter `nav_label`(mergeMechanicsContent 读成 navLabel)使该页
// 成为顶部导航的 about 项。没有页面声明 → 导航没有这一项;删掉这页,导航里的
// 「关于本站」随之消失——这就是贡献者可以在 CMS 里安全删除一个机制页的原因。

/** A copy of FIXTURE whose mechanic `slug` carries `navLabel` (undefined = none). */
function fixtureWithNavLabel(slug, navLabel) {
  const data = structuredClone(FIXTURE);
  const mech = data.mechanics.find((m) => m.slug === slug);
  if (navLabel === undefined) delete mech.navLabel;
  else mech.navLabel = navLabel;
  return data;
}

/** The nav anchors of one spot ('menu-row' | 'ps-site__links') of a page, as [text, html] pairs. */
function navAnchors(html, spot) {
  const inner = html.split(`class="${spot}"`)[1].split('</div>')[0];
  return (inner.match(/<a [^>]*>.*?<\/a>/g) ?? []).map((a) => [a.replace(/<a [^>]*>|<\/a>/g, ''), a]);
}

test('A1 — 机制页的 navLabel 成为顶部导航的 about 项:label = navLabel、href = mechanics/<slug>.html、只在 menu-row、位于更新日志之后、全站每页都有', async () => {
  const out = await renderSite(fixtureWithNavLabel('barrel-system', '桶装指南'), { contentDir: null });
  for (const [rel, html] of out) {
    if (rel === 'data.js') continue;
    const prefix = rel.includes('/') ? '../' : '';
    const menuRow = navAnchors(html, 'menu-row');
    assert.deepEqual(menuRow.map(([text]) => text), ['首页', '物品图鉴', '机制说明', '玩法指南', '模组介绍', '更新日志', '桶装指南'],
      `${rel}: menu-row ends with the about entry, right after 更新日志`);
    assert.equal(menuRow.at(-1)[1], `<a href="${prefix}mechanics/barrel-system.html">桶装指南</a>`, `${rel}: the about entry`);
    assert.ok(!navAnchors(html, 'ps-site__links').some(([text]) => text === '桶装指南'), `${rel}: not in ps-site__links`);
  }
  // navLabel is build-time data: the client payload still carries slug + title only
  assert.ok(!out.get('data.js').includes('navLabel'), 'data.js does not serialize navLabel');
});

test('A2 — 没有任何页面带 navLabel → 顶部导航没有 about 项;其余页面照常渲染', async () => {
  const out = await renderSite(fixtureWithNavLabel('barrel-system'), { contentDir: null });
  assert.equal(out.size, 6 + 6 + 7 + 2, 'every route is still rendered');
  for (const [rel, html] of out) {
    if (rel === 'data.js') continue;
    const labels = ['首页', '物品图鉴', '机制说明', '玩法指南', '模组介绍', '更新日志'];
    assert.deepEqual(navAnchors(html, 'menu-row').map(([text]) => text), labels, `${rel}: menu-row`);
    assert.deepEqual(navAnchors(html, 'ps-site__links').map(([text]) => text), [...labels, '物品检索器'], `${rel}: ps-site__links`);
  }
});

test('A4 — navLabel 为空串或仅空白 → 视为未设置(无 about 项)', async () => {
  for (const bad of ['', '   ', '\t\n']) {
    const out = await renderSite(fixtureWithNavLabel('barrel-system', bad), { contentDir: null });
    const menuRow = navAnchors(out.get('index.html'), 'menu-row');
    assert.equal(menuRow.at(-1)[0], '更新日志', `navLabel ${JSON.stringify(bad)}: menu-row ends with 更新日志, i.e. no about entry`);
  }
  // …while surrounding whitespace of a real label is not part of it
  const padded = await renderSite(fixtureWithNavLabel('barrel-system', '  桶装指南 \n'), { contentDir: null });
  assert.equal(navAnchors(padded.get('index.html'), 'menu-row').at(-1)[0], '桶装指南');
});

test('A6 — about 页的高亮与改动前一致:active 的是「机制说明」,about 项本身不高亮', async () => {
  const out = await renderSite(fixtureWithNavLabel('barrel-system', '桶装指南'), { contentDir: null });
  const page = out.get('mechanics/barrel-system.html');
  for (const spot of ['menu-row', 'ps-site__links']) {
    assert.deepEqual(
      navAnchors(page, spot).filter(([, a]) => a.includes('class="active"')).map(([text, a]) => [text, a]),
      [['机制说明', '<a href="../mechanics.html" class="active">机制说明</a>']],
      `${spot}: 机制说明 is the highlighted entry`,
    );
  }
  assert.equal((page.match(/class="active"/g) || []).length, 2, 'exactly the two nav spots, one highlighted entry each');
  assert.ok(page.includes('<a href="../mechanics/barrel-system.html">桶装指南</a>'), 'the about entry is on its own page and is NOT highlighted');
  assert.match(page, /<h1 class="page-title">桶装系统<\/h1>/, 'it is still the mechanic page it always was');
  assert.ok(page.includes('<a href="../mechanics.html">机制说明</a> &gt; 桶装系统'), 'breadcrumb: 首页 &gt; 机制说明 &gt; 标题');
});
