'use strict';

// Task 8 tests: page renderers + inline data.js.
//
// Fixture strategy (per the controller's recommendation): a hand-built
// minimal WIKI_DATA literal — 6 mods, a handful of items — fast and focused,
// no fake modsDir tree needed. Item-body markdown comes from a layout built
// over a temp directory (what readContentLayout would list), so the "用法
// 正文" branch is covered with a real file read.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderSite, renderNavSearchJs, firstParagraphExcerpt } = require('../tools/build/render.js');
const { addHandwrittenItems, mergeSupplements } = require('../tools/build/supplements.js');

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

test('renderSite: 产物覆盖全部路由(主页、更新日志、检索器 + 每物品/机制/mod 页 + data.js、nav-search.js)', async () => {
  const out = await buildFixture({ layout: null });
  for (const rel of [
    'index.html', 'changelog.html', 'search.html', 'data.js', 'nav-search.js',
    ...MODS.map((m) => `mods/${m.id}.html`),
    ...ITEMS.map((it) => `item/${it.id}.html`),
    ...MECHANICS.map((m) => `mechanics/${m.slug}.html`),
  ]) {
    assert.ok(out.has(rel), `缺少 ${rel}`);
    assert.equal(typeof out.get(rel), 'string');
  }
  assert.ok(!out.has('mods/install-compat.html'), 'install-compat 占位页已删除(final review)');
  assert.equal(out.size, 4 + 6 + 7 + 2 + 1); // 骨架 3 页 + data.js + nav-search.js + mods + items + mechanics
});

// ---------- ① 物品页 ----------

test('item 页:infobox 贴图相对路径、面包屑、内链与表格', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('item/wondrous_milk.html');
  assert.ok(html.includes('src="../assets/items/lewd_meme/item_milk.png"'), '贴图相对路径 ../assets/');
  assert.ok(html.includes('href="../css/theme.css"'));
  assert.ok(html.includes('href="../index.html"'));
  assert.ok(html.includes('href="../mods/lewd_meme.html"'), 'the item page leads to its mod\'s page');
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
  // 相关页面:所属 mod 的导航页(全站的机制索引已经没有了)
  assert.ok(html.includes('<a href="../mods/lewd_meme.html">淫色深空:可能是触手</a>'));
  // infobox 适用版本接线(M1):所属 mod 的版本,非恒"待补充"
  assert.ok(html.includes('1.9.2'));
  assert.ok(html.includes('<div class="clear"></div>'));
});

test('item 页:name=null 时标题与卡片回退显示 id,不输出字面 null(I2)', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('item/tear_merchant.html');
  assert.ok(html.includes('<h1 class="page-title">tear_merchant</h1>'));
  assert.ok(!html.includes('>null<'));
  // 全站任何页面不出现字面 null 卡片
  for (const [rel, page] of out) {
    if (rel === 'data.js' || rel === 'nav-search.js') continue;
    assert.ok(!page.includes('>null<'), `${rel} 出现 >null<`);
    assert.ok(!page.includes('alt="null"'), `${rel} 出现 alt="null"`);
  }
  const modPage = out.get('mods/dui_mian_lan_qiu_ji_tearl.html');
  assert.ok(modPage.includes('<span class="nm">tear_merchant</span>'), '卡片名称回退 id');
});

test('item 页:icon/price null 用占位,严格 null 判断', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('item/tear_merchant.html');
  assert.ok(html.includes('class="no-icon"'));
  assert.ok(!html.includes('src="../assets/items/'), '无物品贴图');
  assert.ok(html.includes('待补充'));
});

test('item 页:布局里的物品词条正文渲染,[[id]] 展开;没有词条时跳过', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modwiki-render-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const write = (id, text) => {
    const file = path.join(tmp, 'mods', 'lewd_meme_remake', 'items', `${id}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return { id, file };
  };
  // 真实方言(final review Critical):物品词条的 md 无闭合 ---,
  // frontmatter 之后空行隔开正文——不得把 frontmatter 当正文泄漏成 JSON。
  const milk = write('wondrous_milk', '---\nnotes: 覆盖说明\n\n## 详解小节\n\n每晚产出 [[tentacle_body]] 相关结算。\n');
  // 只有 frontmatter、无正文的变体:详解节必须连同标题一起跳过。
  const headOnly = write('tentacle_body', '---\nnotes: 只有头\n');
  // 文件名与真实 id 只差大小写:仍然归到那件物品。
  const rich = write('MILK_RICH', '---\n\n浓郁乳汁的详解。\n');
  const layout = {
    home: null, sections: [], site: [], strayFiles: [], legacyDirs: [], imageFolders: [],
    mods: [{ id: 'lewd_meme_remake', dir: path.join(tmp, 'mods', 'lewd_meme_remake'), indexFile: null, redirectsFile: null, items: [milk, headOnly, rich], mechanics: [], nestedIndexFiles: [] }],
  };
  const out = await renderSite(structuredClone(FIXTURE), { layout });

  const withMd = out.get('item/wondrous_milk.html');
  assert.ok(withMd.includes('详解小节'));
  assert.ok(withMd.includes('href="../item/tentacle_body.html"'), '正文 wikilink 展开为内链卡');
  assert.ok(!withMd.includes('notes: 覆盖说明'), 'frontmatter 不得泄漏进正文');

  const headOnlyPage = out.get('item/tentacle_body.html');
  assert.ok(!headOnlyPage.includes('<h2 class="sec">详解</h2>'), '无正文的 md 连详解标题一起跳过');
  assert.ok(!headOnlyPage.includes('notes: 只有头'), 'frontmatter 不泄漏');

  assert.ok(out.get('item/milk_rich.html').includes('浓郁乳汁的详解。'), 'a file name that differs by case only lands on the real item');
  assert.ok(!out.get('item/MILK_RICH.html'), 'the page is named after the item, never after the file');

  const without = await buildFixture({ layout: null });
  assert.ok(!without.get('item/wondrous_milk.html').includes('详解小节'), 'no layout → no item body is read');
});

test('机制页底部:提取自 content/mods/<mod>/mechanics/<slug>.md;数据里的条目(没有文件)不写路径', async () => {
  const data = structuredClone(FIXTURE);
  const [base, file] = data.mechanics;
  file.mod = 'lewd_meme_remake';

  const out = await renderSite(data, { layout: null });

  // The footer of every page says 数据提取自模组安装文件, so the look is at the page's own `updated` line.
  const updatedLine = (slug) => /<div class="updated">[^<]*<\/div>/.exec(out.get(`mechanics/${slug}.html`))[0];
  assert.equal(updatedLine(file.slug), `<div class="updated">数据基线 ${FIXTURE.baseline.date} · 提取自 content/mods/lewd_meme_remake/mechanics/barrel-system.md</div>`,
    'the line names the file under its mod');
  assert.equal(updatedLine(base.slug), `<div class="updated">数据基线 ${FIXTURE.baseline.date}</div>`, 'an entry that came from the data has no file');
  for (const [rel, html] of out) {
    assert.ok(!html.includes('content/mechanics/'), `${rel}: the old directory is named nowhere`);
    assert.ok(!html.includes('content/items/'), `${rel}: …nor this one`);
  }
});

// ---------- ② 物品图鉴 ----------
//
// (The all-site 物品图鉴 page — items.html, with its chips and the filter script — gave way in
// stage 3, task 5, to each mod's own navigation page: see ⑤ below for the cards, and
// tests/search-index.test.js for the search the 物品检索器 runs.)

// ---------- ③ data.js ----------

test('data.js:可 require 加载、单行、精简字段、search 索引接线(Task 9)', async () => {
  const out = await buildFixture({ layout: null });
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

// ---------- ④ index.html(主页)与分区页 ----------

/** The home page's search model (tools/build/nav-search.js makes the real one). */
const NAV = {
  mods: MODS.map((mod, i) => ({
    id: mod.id, name: mod.name, summary: `${mod.id} 的简介`, aliases: i === 1 ? ['黑市'] : [], keywords: [],
    sections: i === 0 ? ['lewd-meme-series'] : (i === 1 ? ['lewd-meme-series', 'tear'] : []),
  })),
  sections: [
    { slug: 'lewd-meme-series', title: '淫色深空系列', intro: '以《淫色深空》为核心的系列。', order: null },
    { slug: 'tear', title: '珠泪哀歌', intro: '', order: 2 },
  ],
};

/** A content tree with the home page and two section pages, and the layout over it. */
async function homeTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-home-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const put = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  return {
    home: put('home.md', '---\ntitle: 首页\n---\n\n这里是 **Probably Stolen** 的模组百科。\n'),
    sections: [
      { slug: 'lewd-meme-series', file: put('sections/lewd-meme-series.md', '---\ntitle: 淫色深空系列\nmods:\n  - lewd_meme\n---\n\n以《淫色深空》为核心的系列。\n') },
      { slug: 'tear', file: put('sections/tear.md', '---\ntitle: 珠泪哀歌\norder: 2\nmods:\n  - lewd_meme_remake\n---\n') },
    ],
    site: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [],
  };
}

test('主页:正文首行是搜索栏和「限定范围」;每个分区一个可折叠的方框,mod 条只放名字;不属于任何分区的 mod 单独一块', async (t) => {
  const layout = await homeTree(t);
  const html = (await renderSite(structuredClone(FIXTURE), { layout, nav: NAV })).get('index.html');

  // The search bar opens the body; the scope panel lists a box per section and starts closed.
  const body = html.slice(html.indexOf('<div class="content-box">'));
  assert.ok(body.includes('<div class="nav-search-row">\n<form class="nav-search"'), 'the search row is the first thing in the body');
  assert.ok(html.includes('id="nav-q"'));
  assert.ok(html.includes('id="nav-scope-toggle" aria-expanded="false"'));
  assert.ok(html.includes('限定范围'));
  assert.ok(html.includes('<div class="scope-panel" id="nav-scope-panel" hidden>'), 'closed until asked for');
  for (const section of NAV.sections) {
    assert.ok(html.includes(`<input type="checkbox" value="${section.slug}"/>${section.title}</label>`), `${section.slug}: a box in the scope panel`);
  }
  assert.ok(html.includes('id="nav-scope-clear"'), 'a way to clear the boxes');
  assert.ok(html.includes('<div class="nav-status" id="nav-status" hidden></div>'));
  assert.ok(html.includes('<div class="nav-results" id="nav-results" hidden></div>'));

  // One block per section, then one for the mods in no section.
  const blocks = [...html.matchAll(/<section class="sec-block" data-sec="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(blocks, ['lewd-meme-series', 'tear', '__none']);
  const series = html.slice(html.indexOf('data-sec="lewd-meme-series"'), html.indexOf('data-sec="tear"'));
  assert.ok(series.includes('<button type="button" class="sec-toggle" aria-expanded="true" aria-controls="bars-lewd-meme-series">淫色深空系列</button>'),
    'the title folds the block; open to begin with');
  assert.ok(series.includes('<a class="sec-link" href="sections/lewd-meme-series.html">进入分区</a>'));
  assert.ok(series.includes('2 个模组'));
  assert.ok(series.includes('以《淫色深空》为核心的系列。'), 'the intro');
  const bars = [...series.matchAll(/<a class="mod-bar" href="mods\/([^"]+)\.html" data-mod="([^"]+)" title="([^"]*)">([^<]*)<\/a>/g)]
    .map((m) => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(bars, [
    ['lewd_meme', 'lewd_meme', MODS[0].name, MODS[0].name],
    ['lewd_meme_remake', 'lewd_meme_remake', MODS[1].name, MODS[1].name],
  ], 'bars hold the name only, in the order of the home page');
  assert.ok(!/<img|信用点|data-category/.test(series), 'nothing of an item card is in a bar');
  const none = html.slice(html.indexOf('data-sec="__none"'));
  assert.ok(none.includes('不属于任何分区的 mod'));
  assert.ok(!none.includes('sec-link'), 'the block of the unsectioned mods leads nowhere');
  assert.equal((none.match(/class="mod-bar"/g) || []).length, 4, 'the other four mods');

  // A mod in two sections shows up in both.
  assert.equal((html.match(/data-mod="lewd_meme_remake"/g) || []).length, 2);
});

test('主页:底部是 home.md 的正文和三个入口;保留全站通知条;两个脚本,数据在前', async (t) => {
  const layout = await homeTree(t);
  // …with a site page that declares itself 关于本站: the third entry leads there.
  layout.site = (await siteWith(t, 'nav_label: 关于本站')).site;
  const out = await renderSite(structuredClone(FIXTURE), { layout, nav: NAV });
  const html = out.get('index.html');

  const foot = html.slice(html.indexOf('<div class="home-foot">'));
  assert.ok(foot.indexOf('<strong>Probably Stolen</strong> 的模组百科') < foot.indexOf('class="home-links"'), "home.md's body, rendered, comes before the entries");
  assert.ok(foot.includes('href="https://github.com/probably-documented/probably-stolen-mod-wiki/releases"'), '离线包下载');
  assert.ok(foot.includes('<a href="site/about.html">关于本站</a>'), '关于本站: the site page that declares itself');
  assert.ok(foot.includes('href="changelog.html"'), '更新日志');

  assert.ok(html.includes('<div class="crumb">首页</div>'), 'the breadcrumb is 首页 and nothing else');
  assert.ok(html.includes('class="top-news"'), 'the site-wide notice bar stays');
  assert.ok(html.includes('当前数据基线:'));
  for (const gone of ['id="mod-family"', 'class="mod-card"', '热门物品', '站点统计', '最近更新', '快捷入口']) {
    assert.ok(!html.includes(gone), `the old home page's ${gone} is gone`);
  }

  assert.ok(html.includes('<script src="nav-search.js"></script>'));
  assert.ok(html.includes('<script src="assets/js/nav-home.js"></script>'));
  assert.ok(html.indexOf('<script src="nav-search.js">') < html.indexOf('<script src="assets/js/nav-home.js">'), 'the data loads before the script that reads it');
  assert.ok(!html.includes('data.js'), 'the home page does not need the item data');
  assert.equal((html.match(/<script\b/g) || []).length, 2, 'and loads nothing else');
  const code = out.get('nav-search.js');
  assert.ok(code.startsWith('window.NAV_SEARCH = '));
  assert.deepEqual(JSON.parse(code.slice('window.NAV_SEARCH = '.length).replace(/;\s*$/, '')), NAV, 'nav-search.js carries the model as it was given');
  // 无 config/api 内部路径泄漏
  for (const secret of ['modsDir', 'apiPatchesDir', 'decompileBase', 'decompileDir', 'contentDir', 'https://wiki.biligame.com/probablystolen/index.php']) {
    assert.ok(!html.includes(secret), secret);
  }
});

test('主页:没有内容树、没有搜索数据时,搜索栏和三个入口仍在,没有分区块', async () => {
  const html = (await buildFixture({ layout: null })).get('index.html');
  assert.ok(html.includes('id="nav-q"'));
  assert.equal((html.match(/class="sec-block"/g) || []).length, 0, 'no sections, no blocks — not even the one for the unsectioned mods');
  const foot = html.slice(html.indexOf('<div class="home-foot">'));
  assert.ok(!foot.includes('<strong>'), 'no home.md: nothing to introduce');
  assert.ok(foot.includes('离线包下载') && foot.includes('更新日志'));
  assert.ok(!foot.includes('>关于本站<'), 'no page declares the about entry: no such entry here');
});

test('分区页:标题、介绍正文(物品内嵌卡可用)、本分区的 mod 条;面包屑是「首页、分区名」;不搜索', async (t) => {
  const layout = await homeTree(t);
  fs.writeFileSync(layout.sections[0].file, '---\ntitle: 淫色深空系列\nmods:\n  - lewd_meme\n---\n\n以《淫色深空》为核心的系列,先看 [[wondrous_milk]]。\n');
  const out = await renderSite(structuredClone(FIXTURE), { layout, nav: NAV });

  for (const section of NAV.sections) assert.ok(out.has(`sections/${section.slug}.html`), `sections/${section.slug}.html`);
  assert.ok(!out.has('sections/nope.html'));
  const html = out.get('sections/lewd-meme-series.html');
  assert.ok(html.includes('<title>淫色深空系列 · '), 'the section is the page title');
  assert.ok(html.includes('<h1 class="page-title">淫色深空系列</h1>'));
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; 淫色深空系列</div>'));
  assert.ok(html.includes('以《淫色深空》为核心的系列,先看 '), 'the intro is rendered as Markdown');
  assert.ok(html.includes('href="../item/wondrous_milk.html"'), '[[id]] in a section page is an item card');
  assert.deepEqual([...html.matchAll(/<a class="mod-bar" href="\.\.\/mods\/([^"]+)\.html"/g)].map((m) => m[1]), ['lewd_meme', 'lewd_meme_remake'],
    'the bars of this section only, in the order of the home page');
  assert.equal((html.match(/class="sec-block"/g) || []).length, 1, 'one block here: the section itself');
  assert.ok(!html.includes('sec-link'), '…which needs no 「进入分区」');
  assert.ok(!html.includes('sec-toggle'), '…and does not fold');
  assert.ok(html.includes('href="../css/theme.css"'));
  assert.ok(!html.includes('nav-home.js') && !html.includes('nav-search.js'), 'a section page does not search');
  assert.equal((html.match(/<script\b/g) || []).length, 0);
  // 一个分区里一个 mod 都没有:照常渲染,提示是空的
  const tear = out.get('sections/tear.html');
  assert.equal((tear.match(/class="mod-bar"/g) || []).length, 1, '珠泪哀歌 holds one mod: 暗流交易');
});

test('分区页:标题下面是入口行,然后是分区块,最后才是正文;分区块里不再重复简介;轻的分区也有入口;主页不变', async (t) => {
  const layout = await homeTree(t);
  const out = await renderSite(structuredClone(FIXTURE), { layout, nav: NAV });
  const html = out.get('sections/lewd-meme-series.html');
  const at = (needle) => html.indexOf(needle);
  const title = at('<h1 class="page-title">淫色深空系列</h1>');
  const entries = at('<p class="home-links sec-entries">');
  const block = at('<section class="sec-block" data-sec="lewd-meme-series">');
  const body = at('<p>以《淫色深空》为核心的系列。</p>');
  assert.ok(title !== -1 && title < entries, 'the entries come right under the title');
  assert.ok(entries < block, '…and above the block');
  assert.ok(block < body, 'the body follows the block');
  assert.deepEqual([...html.slice(entries, block).matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]), [
    ['../sections/lewd-meme-series/items.html', '物品图鉴'],
    ['../sections/lewd-meme-series/mechanics.html', '机制说明'],
  ], 'two entries, leading into this section');
  assert.equal((html.match(/class="sec-intro"/g) || []).length, 0, 'the block does not repeat the intro: the body is right below it');
  assert.equal((html.match(/<script\b/g) || []).length, 0, 'still a page without a script');

  // 主页上的同一个分区块:简介行照旧,没有入口行
  const home = out.get('index.html');
  const series = home.slice(home.indexOf('data-sec="lewd-meme-series"'), home.indexOf('data-sec="tear"'));
  assert.ok(series.includes('<div class="sec-intro">以《淫色深空》为核心的系列。</div>'), 'the home page keeps its intro line');
  assert.ok(!home.includes('sec-entries'), 'and has no entries row');

  // 轻的分区(没有正文、没开卡片)也有入口
  const tear = out.get('sections/tear.html');
  assert.ok(tear.includes('<a href="../sections/tear/items.html">物品图鉴</a>'));
  assert.ok(tear.includes('<a href="../sections/tear/mechanics.html">机制说明</a>'));
});

// ---------- 阶段 5 Task 2:卡片模式 ----------

test('卡片模式:分区文件写 cards: true 时分区块是一张张卡片(自动的:名字、ID 和版本、简介、物品数、前置);没写、false、或写成别的样子都还是条;主页不变', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  // 一个纯手写的 mod(没有导出数据)也放进这个分区:它的一张卡看得出回退规则
  const nav = { ...NAV, mods: [...NAV.mods, { ...GHOST, sections: ['lewd-meme-series'] }] };
  const pageOf = async (navUsed, cardsLine) => {
    fs.writeFileSync(layout.sections[0].file, `---\ntitle: 淫色深空系列\nmods:\n  - lewd_meme\n${cardsLine}---\n\n以《淫色深空》为核心的系列。\n`);
    return (await renderSite(structuredClone(data), { layout, nav: navUsed })).get('sections/lewd-meme-series.html');
  };

  const on = await pageOf(nav, 'cards: true\n');
  assert.ok(on.includes('<div class="mod-cards" id="bars-lewd-meme-series">'), 'the block holds cards');
  assert.ok(!on.includes('mod-bars') && !on.includes('mod-bar"'), '…and no bars');
  assert.ok(on.includes('<span class="sec-count">3 个模组</span>'), 'counted all the same');
  // 有导出数据的 mod:版本和前置取数据里的;简介是搜索模型里的;物品数同 mod 页
  assert.ok(on.includes(`<h4><a href="../mods/lewd_meme.html">${MODS[0].name}</a><span class="ver">lewd_meme · 1.9.2</span></h4>`));
  assert.ok(on.includes(`<p>${NAV.mods[0].summary}</p>`));
  assert.ok(on.includes('<div class="meta">2 件物品 · 无前置</div>'));
  assert.ok(on.includes(`<h4><a href="../mods/lewd_meme_remake.html">${MODS[1].name}</a><span class="ver">lewd_meme_remake · 1.6.4</span></h4>`));
  assert.ok(on.includes('<div class="meta">2 件物品 · 前置 lewd_meme</div>'));
  // 纯手写的 mod:版本和前置取它导航页文件里写的;物品数算上它自己写的那一件;没有简介就不出这一行
  assert.ok(on.includes('<h4><a href="../mods/ghost_mod.html">幽灵模组</a><span class="ver">ghost_mod · 0.1.0</span></h4>'), 'the version comes from its page file');
  assert.ok(on.includes('幽灵模组</a><span class="ver">ghost_mod · 0.1.0</span></h4>\n<div class="meta">1 件物品 · 前置 lewd_meme</div>'), 'no summary line; the prerequisites from its page file; its own item counts');
  // 顺序是主页的顺序;入口行和正文照旧在
  assert.deepEqual([...on.matchAll(/<a href="\.\.\/mods\/([^"]+)\.html">/g)].map((m) => m[1]), ['lewd_meme', 'lewd_meme_remake', 'ghost_mod']);
  assert.ok(on.includes('<p class="home-links sec-entries">') && on.includes('<p>以《淫色深空》为核心的系列。</p>'));

  // 简介超过 90 字:截断
  const wordy = { ...nav, mods: nav.mods.map((m, i) => (i === 0 ? { ...m, summary: '长'.repeat(120) } : m)) };
  assert.ok((await pageOf(wordy, 'cards: true\n')).includes(`<p>${'长'.repeat(90)}…</p>`));

  // 没写、false、带引号的字符串:都还是条
  for (const [what, line] of [['not written', ''], ['false', 'cards: false\n'], ['a quoted string', "cards: 'yes'\n"]]) {
    const off = await pageOf(nav, line);
    assert.ok(off.includes('<div class="mod-bars" id="bars-lewd-meme-series">'), `${what}: still bars`);
    assert.ok(!off.includes('mod-card"'), `${what}: no cards`);
  }

  // 主页不受影响:分区开着卡片,主页上的这个分区块仍是条
  await pageOf(nav, 'cards: true\n'); // 这一步把分区文件写成 cards: true
  const home = (await renderSite(structuredClone(data), { layout, nav })).get('index.html');
  assert.ok(home.includes('<div class="mod-bars" id="bars-lewd-meme-series">'));
  assert.ok(!home.includes('class="mod-card"'), 'the home page has no cards');
});

// ---------- 阶段 5 Task 5:两个概述 ----------

test('概述:分区的 items_intro 显示在物品图鉴页、mechanics_intro 显示在机制说明页;空的不出这一节;分区页上不显示', async (t) => {
  const layout = await homeTree(t);
  fs.writeFileSync(layout.sections[0].file, [
    '---', 'title: 淫色深空系列', 'mods:', '  - lewd_meme', "items_intro: '先看 [[wondrous_milk]]。'", "mechanics_intro: '从夜间结算读起。'",
    '---', '', '以《淫色深空》为核心的系列。', '',
  ].join('\n'));
  const out = await renderSite(structuredClone(FIXTURE), { layout, nav: NAV });

  const items = out.get('sections/lewd-meme-series/items.html');
  assert.ok(items.includes('<h2 class="sec">概述</h2>\n<p>先看 '), 'the items page shows the items introduction');
  assert.ok(items.includes('href="../../item/wondrous_milk.html"'), 'an inline card in it is two levels up');
  assert.ok(items.indexOf('<div class="updated">') < items.indexOf('<h2 class="sec">概述</h2>') && items.indexOf('<h2 class="sec">概述</h2>') < items.indexOf('<div id="section-items">'),
    '小字,概述,然后才是筛选和物品');
  const mechanics = out.get('sections/lewd-meme-series/mechanics.html');
  assert.ok(mechanics.includes('<h2 class="sec">概述</h2>\n<p>从夜间结算读起。</p>'), 'the mechanics page shows the other one');
  assert.ok(!mechanics.includes('先看 ') && !items.includes('从夜间结算读起'), 'each page shows its own only');
  // 分区页上不显示
  const page = out.get('sections/lewd-meme-series.html');
  assert.ok(!page.includes('先看 ') && !page.includes('从夜间结算读起') && !page.includes('概述'), 'the section page shows neither');

  // 没写的(珠泪哀歌):不出这一节
  assert.ok(!out.get('sections/tear/items.html').includes('概述') && !out.get('sections/tear/mechanics.html').includes('概述'));
  // CMS 写出的空值也不出:'' 和 |-(空块)
  fs.writeFileSync(layout.sections[1].file, "---\ntitle: 珠泪哀歌\nmods:\n  - lewd_meme_remake\nitems_intro: ''\nmechanics_intro: |-\n  \n---\n");
  const blank = await renderSite(structuredClone(FIXTURE), { layout, nav: NAV });
  assert.ok(!blank.get('sections/tear/items.html').includes('概述') && !blank.get('sections/tear/mechanics.html').includes('概述'));
});

// ---------- ⑤ mod 导航页、物品页和机制页(阶段 3 Task 3) ----------

/** A hand-written mod in the search model, in the 珠泪哀歌 section. */
const GHOST = { id: 'ghost_mod', name: '幽灵模组', summary: '', aliases: [], keywords: [], sections: ['tear'] };
const NAV_WITH_GHOST = { ...NAV, mods: [...NAV.mods, GHOST] };

/** homeTree plus two mod folders: a page file for an exported mod, and a hand-written mod with an item entry of its own. */
async function modTree(t) {
  const layout = await homeTree(t);
  const root = path.dirname(layout.home);
  const put = (rel, text) => {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  const folder = (id, indexFile, items) => ({ id, dir: path.join(root, 'mods', id), indexFile, redirectsFile: null, items, mechanics: [], nestedIndexFiles: [] });
  layout.mods = [
    folder('lewd_meme_remake', put('mods/lewd_meme_remake/_index.md', "---\ntitle: 暗流交易\nsummary: ''\nauthor: ''\nversion: ''\nprerequisites: []\n---\n\n**暗流交易**的介绍正文。\n"), []),
    folder('ghost_mod', put('mods/ghost_mod/_index.md', "---\ntitle: 幽灵模组\nauthor: 某人\nversion: 0.1.0\nprerequisites:\n  - lewd_meme\n---\n\n幽灵模组的介绍。它有一件 [[thing]]。\n"), [
      { id: 'thing', file: put('mods/ghost_mod/items/thing.md', '---\nitem_id: thing\nmod: ghost_mod\ntitle: 东西\ndescription: 一把没人导出过的东西。\n---\n') },
    ]),
  ];
  return layout;
}

/** What the build entry does to the data before rendering: the hand-written items, then the entries. */
async function prepared(layout) {
  const data = structuredClone(FIXTURE);
  await addHandwrittenItems(data, layout);
  await mergeSupplements(data, layout, () => {});
  return data;
}

const WINDOW = (name) => (code) => JSON.parse(code.slice(`window.${name} = `.length).replace(/;\s*$/, ''));

/** A page's address prefix: one `../` per directory of its path (a section's galleries sit two deep). */
const relPrefix = (rel) => '../'.repeat(rel.split('/').length - 1);

// ---------- 阶段 5 Task 3:分区级机制说明页(自动生成) ----------

test('分区级机制说明页 sections/<slug>/mechanics.html:每个分区一页;按 mod 分组的卡片,同 mod 页;地址都上两级', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  data.mechanics = [
    { slug: 'night-settlement', title: '夜间结算与疲劳', mod: 'lewd_meme', source: '# 夜间结算与疲劳\n\n介绍每晚的产出。\n\n## 结算顺序\n\n正文。' },
    { slug: 'barrel-system', title: '桶装系统', mod: 'lewd_meme', source: '# 桶装系统\n\n桶上限 1000 次。' },
    { slug: 'orphan', title: '不属于任何 mod 的页', mod: null, source: '# 不属于任何 mod 的页\n\n正文。' },
  ];
  const out = await renderSite(data, { layout, nav: NAV });
  for (const section of NAV.sections) assert.ok(out.has(`sections/${section.slug}/mechanics.html`), `sections/${section.slug}/mechanics.html`);
  assert.ok(!out.has('sections/nope/mechanics.html'));

  const html = out.get('sections/lewd-meme-series/mechanics.html');
  assert.ok(html.includes('<title>淫色深空系列 · 机制说明 · '), 'the section is named in the title, the kind of page after it');
  assert.ok(html.includes('<h1 class="page-title">机制说明</h1>'));
  assert.ok(html.includes('<div class="crumb"><a href="../../index.html">首页</a> &gt; <a href="../lewd-meme-series.html">淫色深空系列</a> &gt; 机制说明</div>'),
    'the way back: home, then the section page one level up');
  // 两级:整页没有一个「上一层」的地址
  assert.ok(html.includes('href="../../css/theme.css"'));
  for (const must of ['<a href="../../index.html">首页</a>', '<a href="../../changelog.html">更新日志</a>', '<a href="../../search.html">物品检索器</a>']) {
    assert.ok(html.includes(must), must);
  }
  assert.ok(!/href="\.\.\/(?:index|changelog|search)\.html"/.test(html));
  assert.equal((html.match(/<a [^>]*class="active">首页<\/a>/g) || []).length, 2, 'the home entry is the highlighted one, in both nav spots');
  // 小字,然后按 mod 分组:每个有机制页的 mod 一个小标题,下面是它的卡片
  assert.ok(html.includes('<div class="updated">数据基线 2026-11-18 · 1 个 mod 有机制页 · 共 2 篇</div>'));
  assert.deepEqual(
    [...html.matchAll(/<h2 class="sec">([^<]*)<\/h2>|<h4><a href="([^"]+)">([^<]*)<\/a><\/h4>|<p>(介绍每晚的产出。|桶上限 1000 次。)<\/p>/g)]
      .map((m) => m[1] ?? (m[2] !== undefined ? `${m[3]} → ${m[2]}` : `摘要:${m[4]}`)),
    [MODS[0].name, `夜间结算与疲劳 → ../../mechanics/night-settlement.html`, '摘要:介绍每晚的产出。', `桶装系统 → ../../mechanics/barrel-system.html`, '摘要:桶上限 1000 次。'],
  );
  assert.ok(!html.includes('mechanics/orphan.html'), 'a page that belongs to no mod is in no section');
  assert.equal((html.match(/<script\b/g) || []).length, 0);

  // 分区里的 mod 一篇机制页都没有:照常出一页
  const tear = out.get('sections/tear/mechanics.html');
  assert.ok(tear.includes('这个分区还没有机制页。'), '珠泪哀歌 holds 暗流交易 only, which has no mechanic page here');
  assert.ok(!tear.includes('mechanics/night-settlement.html'));
});

// ---------- 阶段 5 Task 4:分区级物品图鉴页(自动生成,可筛选) ----------

/** A page's chips for one dimension, as [value, pressed, label]. The pressed one carries the class too: the page looks right before any script runs. */
const chipsOf = (html, dim) => [...html.matchAll(new RegExp(`<button type="button" class="item-inline item-chip( is-on)?" data-${dim}="([^"]*)" aria-pressed="([^"]*)">([^<]*)</button>`, 'g'))]
  .map((m) => [m[2], m[3], m[4]]);

test('分区级物品图鉴页 sections/<slug>/items.html:按 mod 分节的卡片,品类和来源两组筛选标签,唯一的脚本是筛选;卡片不带隐藏样式', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  const out = await renderSite(data, { layout, nav: NAV });
  for (const section of NAV.sections) assert.ok(out.has(`sections/${section.slug}/items.html`), `sections/${section.slug}/items.html`);
  assert.ok(!out.has('sections/nope/items.html'));

  const html = out.get('sections/lewd-meme-series/items.html');
  assert.ok(html.includes('<title>淫色深空系列 · 物品图鉴 · '), 'the section is named in the title, the kind of page after it');
  assert.ok(html.includes('<h1 class="page-title">物品图鉴</h1>'));
  assert.ok(html.includes('<div class="crumb"><a href="../../index.html">首页</a> &gt; <a href="../lewd-meme-series.html">淫色深空系列</a> &gt; 物品图鉴</div>'));
  assert.ok(html.includes('<div class="updated">数据基线 2026-11-18 · 2 个模组 · 共 4 件物品</div>'));
  assert.ok(html.includes('href="../../css/theme.css"'));
  assert.ok(!/href="\.\.\/(?:index|changelog|search)\.html"/.test(html), 'the whole page is two levels deep');
  assert.equal((html.match(/<a [^>]*class="active">首页<\/a>/g) || []).length, 2, 'the home entry is the highlighted one, in both nav spots');

  // 筛选:品类是「全部」加这个分区的物品有过的品类(中文排序);来源是「全部模组」加分区的每个 mod。「全部」一开始就是按下态
  assert.deepEqual(chipsOf(html, 'category'), [['', 'true', '全部'], ['工具', 'false', '工具'], ['容器', 'false', '容器'], ['食物', 'false', '食物'], ['饮料', 'false', '饮料']]);
  assert.deepEqual(chipsOf(html, 'mod'), [['', 'true', '全部模组'], ['lewd_meme', 'false', MODS[0].name], ['lewd_meme_remake', 'false', MODS[1].name]]);
  assert.ok(html.includes('<div class="filter-status" id="item-filter-status"></div>'), 'where the script says how many are left');
  assert.ok(html.includes('<div id="section-items">'), 'the script only touches what is inside this');

  // 每个 mod 一节:小标题带版本,一行简介,然后是卡片,地址上两级
  assert.deepEqual([...html.matchAll(/<section data-mod="([^"]+)">\n<h2 class="sec">([^<]*)<\/h2>/g)].map((m) => [m[1], m[2]]), [
    ['lewd_meme', `${MODS[0].name}(1.9.2)`], ['lewd_meme_remake', `${MODS[1].name}(1.6.4)`],
  ], 'the mods of this section, in the order of the home page');
  assert.ok(html.includes(`<p style="font-size:13px;color:var(--dk-muted)">${NAV.mods[0].summary}</p>`), 'a line with the mod\'s summary');
  assert.ok(html.includes('<a class="item-card" data-mod="lewd_meme" data-category="饮料 食物" href="../../item/wondrous_milk.html">'), 'a card carries what the filter reads');
  assert.ok(html.includes('src="../../assets/items/lewd_meme/item_milk.png"'));

  // 唯一的脚本是筛选;不跑脚本也看得全:没有卡片带隐藏样式
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['../../assets/js/item-filter.js']);
  assert.ok(!/<a class="item-card"[^>]*style=/.test(html));
  assert.ok(!/<a class="item-card"[^>]*\shidden/.test(html));
});

test('分区级物品图鉴页:没有物品的 mod 留一节提示;同一个 mod 属于两个分区时两页都有它;一件物品都没有的分区照常出一页,没有筛选', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  // 掌上青楼有物品,旧版互动一件都没有:把两个都放进淫色深空系列
  const inSeries = (id) => ({ ...NAV.mods.find((m) => m.id === id), sections: ['lewd-meme-series'] });
  const series = [
    ...NAV.mods.filter((m) => m.sections.includes('lewd-meme-series')),
    inSeries('lewd_meme_brothel'),
    inSeries('lewd_meme_legacy_content'),
  ];
  const out = await renderSite(data, { layout, nav: { ...NAV, mods: series } });

  const html = out.get('sections/lewd-meme-series/items.html');
  assert.ok(html.includes('<div class="updated">数据基线 2026-11-18 · 4 个模组 · 共 5 件物品</div>'));
  assert.ok(html.includes('<section data-mod="lewd_meme_legacy_content">') && html.includes('该模组暂无物品条目。'),
    'a mod with no item keeps its section, with a line saying so');
  assert.ok(html.includes('<a class="item-card" data-mod="lewd_meme_brothel" href="../../item/palm_brothel.html">'), 'a card with no category of its own');
  assert.deepEqual(chipsOf(html, 'mod').map(([value]) => value), ['', 'lewd_meme', 'lewd_meme_remake', 'lewd_meme_brothel', 'lewd_meme_legacy_content'], 'every mod of the section is a source, with items or not');

  // 暗流交易同属淫色深空系列和珠泪哀歌:两页都列出它,卡片地址都对
  const tear = out.get('sections/tear/items.html');
  assert.ok(tear.includes('<section data-mod="lewd_meme_remake">') && tear.includes('href="../../item/milk_barrel.html"'));
  assert.ok(html.includes('<section data-mod="lewd_meme_remake">') && html.includes('href="../../item/milk_barrel.html"'));
  assert.ok(!tear.includes('item/wondrous_milk.html'), '…and 珠泪哀歌 lists nothing of the main mod');

  // 珠泪哀歌只留旧版互动:一件物品都没有
  const emptyNav = { ...NAV, mods: NAV.mods.map((m) => (m.id === 'lewd_meme_legacy_content' ? { ...m, sections: ['tear'] } : { ...m, sections: m.sections.filter((s) => s !== 'tear') })) };
  const empty = (await renderSite(data, { layout, nav: emptyNav })).get('sections/tear/items.html');
  assert.ok(empty.includes('<h1 class="page-title">物品图鉴</h1>'), 'the page is there all the same');
  assert.ok(empty.includes('共 0 件物品'));
  assert.ok(!empty.includes('筛选') && !chipsOf(empty, 'category').length, 'nothing to filter: no filter');
  assert.ok(empty.includes('该模组暂无物品条目。'));
});

test('mod 导航页:模组介绍、所属分区、物品图鉴、机制说明和玩法指南、更新日志;面包屑是「首页、mod 名」', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  data.mechanics[1].mod = 'lewd_meme_remake'; // 桶装系统 is this mod's page
  const html = (await renderSite(data, { layout, nav: NAV_WITH_GHOST })).get('mods/lewd_meme_remake.html');

  assert.ok(html.includes('<h1 class="page-title">暗流交易</h1>'));
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; 暗流交易</div>'), 'no section in the breadcrumb: a mod may be in several');
  // 模组介绍:名字,一行小字,然后是导航页文件的正文
  const intro = html.slice(html.indexOf('<h1 class="page-title">'), html.indexOf('<h2 class="sec">'));
  assert.ok(intro.includes('<code>lewd_meme_remake</code>') && intro.includes('1.6.4') && intro.includes('remake') && intro.includes('lewd_meme'),
    'the small print — id, version, author, prerequisites — from the data for an exported mod');
  assert.ok(intro.includes('<strong>暗流交易</strong>的介绍正文。'), 'the body of the mod page file, as Markdown');
  // …then the four titled blocks, in this order
  const heads = [...html.matchAll(/<h2 class="sec">([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(heads, ['所属分区', '物品图鉴(2 件)', '机制说明和玩法指南', '更新日志']);
  // 所属分区:由反查得到
  const sections = html.slice(html.indexOf('<h2 class="sec">所属分区</h2>'), html.indexOf('<h2 class="sec">物品图鉴'));
  assert.ok(sections.includes('<a href="../sections/lewd-meme-series.html">淫色深空系列</a>'));
  assert.ok(sections.includes('<a href="../sections/tear.html">珠泪哀歌</a>'));
  // 物品图鉴:这个 mod 的全部物品,别人的不在
  const items = html.slice(html.indexOf('<h2 class="sec">物品图鉴'), html.indexOf('<h2 class="sec">机制说明'));
  assert.ok(items.includes('href="../item/milk_barrel.html"') && items.includes('href="../item/milk_rich.html"'));
  assert.ok(!items.includes('href="../item/wondrous_milk.html"'));
  // 机制说明和玩法指南:这个 mod 的机制页,标题加摘要
  const mechanics = html.slice(html.indexOf('<h2 class="sec">机制说明'), html.indexOf('<h2 class="sec">更新日志'));
  assert.ok(mechanics.includes('<a href="../mechanics/barrel-system.html">桶装系统</a>'));
  assert.ok(mechanics.includes('桶上限 1000 次'), 'the first paragraph, as the excerpt');
  assert.ok(!mechanics.includes('night-settlement.html'), 'not a page of another mod');
  // 更新日志:这个 mod 自己的
  const changelog = html.slice(html.indexOf('<h2 class="sec">更新日志'));
  assert.ok(changelog.includes('v1.6.4') && changelog.includes('新增疲劳与估值机制'));
  assert.ok(!changelog.includes('修复苗床产出'), "another mod's entry is not here");
});

test('纯手写 mod(没有导出数据)的导航页照常渲染:名字、作者、版本、前置来自导航页文件;它的物品在物品图鉴里,能被 [[物品ID]] 引用', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  const html = (await renderSite(data, { layout, nav: NAV_WITH_GHOST })).get('mods/ghost_mod.html');

  assert.ok(html.includes('<h1 class="page-title">幽灵模组</h1>'));
  const intro = html.slice(html.indexOf('<h1 class="page-title">'), html.indexOf('<h2 class="sec">'));
  assert.ok(intro.includes('某人') && intro.includes('0.1.0') && intro.includes('lewd_meme'), 'author, version and prerequisites as the page file gives them');
  assert.ok(intro.includes('幽灵模组的介绍。它有一件 '), 'the body');
  assert.ok(intro.includes('href="../item/thing.html"'), '[[thing]] in the body is a link to the hand-written item');
  assert.ok(html.includes('<h2 class="sec">物品图鉴(1 件)</h2>'));
  assert.ok(html.includes('<a href="../sections/tear.html">珠泪哀歌</a>'), 'the section it was found in');
  // 没有机制页、没有更新日志:两块照常在,写着还没有
  const quiet = 'font-size:13px;color:var(--dk-muted)';
  assert.ok(html.includes(`<h2 class="sec">机制说明和玩法指南</h2>\n<p style="${quiet}">还没有机制页。</p>`));
  assert.ok(html.includes(`<h2 class="sec">更新日志</h2>\n<p style="${quiet}">还没有更新记录。</p>`));
});

test('纯手写物品的页面是完整的:名字来自词条的标题,词条里写的字段都在;没有「数据来源」表,也没有「适用于…」那一行;data.js 里也有它', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  const out = await renderSite(data, { layout, nav: NAV_WITH_GHOST });
  const html = out.get('item/thing.html');

  assert.ok(html.includes('<h1 class="page-title">东西</h1>'));
  assert.ok(html.includes('一把没人导出过的东西。'));
  assert.ok(html.includes('<a href="../mods/ghost_mod.html">幽灵模组</a>'), 'the infobox names its mod — by the mod page\'s title — and links the page');
  assert.ok(!html.includes('数据来源'), 'nothing was taken from the game files: no such table');
  assert.ok(!html.includes('适用于 '), 'and no line about the data baseline');
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; <a href="../mods/ghost_mod.html">幽灵模组</a> &gt; 东西</div>'));
  assert.deepEqual(WINDOW('WIKI_DATA')(out.get('data.js')).items.map((it) => it.id), [...ITEMS.map((it) => it.id), 'thing'], 'in data.js too, after the exported ones');
});

test('物品页和机制页:面包屑是「首页、mod 名、本页」;物品页底部的「相关页面」是所属 mod 的导航页和它的机制页', async (t) => {
  const layout = await modTree(t);
  const data = await prepared(layout);
  data.mechanics[1].mod = 'lewd_meme_remake';
  const out = await renderSite(data, { layout, nav: NAV_WITH_GHOST });

  const milk = out.get('item/milk_rich.html');
  assert.ok(milk.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; <a href="../mods/lewd_meme_remake.html">暗流交易</a> &gt; 浓郁乳汁</div>'));
  const related = milk.slice(milk.indexOf('<h2 class="sec">相关页面</h2>'), milk.indexOf('class="clear"'));
  assert.ok(related.includes('<a href="../mods/lewd_meme_remake.html">暗流交易</a>'), "the mod's own page, by name");
  assert.ok(related.includes('<a href="../mechanics/barrel-system.html">桶装系统</a>'), "and this mod's mechanic pages");
  assert.ok(!related.includes('night-settlement.html'), "not another mod's");
  assert.ok(!related.includes('mechanics.html'), 'the all-site index is gone from here');

  const mech = out.get('mechanics/barrel-system.html');
  assert.ok(mech.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; <a href="../mods/lewd_meme_remake.html">暗流交易</a> &gt; 桶装系统</div>'));
});

// ---------- ⑤ 机制页 ----------

test('mechanics/<slug>.html:TOC(title 转义)、[[id]] 内链卡、frontmatter title', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('mechanics/night-settlement.html');
  assert.ok(html.includes('<h1 class="page-title">夜间结算与疲劳</h1>'));
  // TOC:mdToHtml 的 toc title 渲染时转义(Ruling 7)
  assert.ok(html.includes('class="toc"'));
  assert.ok(html.includes('href="#结算顺序"'));
  assert.ok(html.includes('结算顺序</a>'));
  // 正文 wikilink → 内链卡
  assert.ok(html.includes('href="../item/wondrous_milk.html"'));
  assert.ok(html.includes('class="item-inline"'));
  // 面包屑:首页 > 标题(夹具里的这一页不属于任何 mod;属于某个 mod 的见下面「物品页和机制页」)
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; 夜间结算与疲劳</div>'));
  // 无 h1 重复(源 md 的 h1 已剥,page-title 之外无裸 h1)
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

test('the two all-site pages are no more (stage 3, task 5): items.html and mechanics.html are not rendered, and nothing points at them', async () => {
  const out = await buildFixture({ layout: null });
  assert.ok(!out.has('items.html'), '物品图鉴 lives on in each mod\'s own page');
  assert.ok(!out.has('mechanics.html'), 'so does 机制说明');
  for (const [rel, html] of out) {
    assert.ok(!/"(?:\.\.\/)?items\.html"/.test(html), `${rel}: a link to items.html`);
    assert.ok(!/"(?:\.\.\/)?mechanics\.html"/.test(html), `${rel}: a link to mechanics.html`);
  }
  // …while every mechanic page and every item page is still there, and the search still finds them
  for (const m of MECHANICS) assert.ok(out.has(`mechanics/${m.slug}.html`), `mechanics/${m.slug}.html`);
  for (const it of ITEMS) assert.ok(out.has(`item/${it.id}.html`), `item/${it.id}.html`);
  assert.equal(WINDOW('WIKI_DATA')(out.get('data.js')).search.docs.length, ITEMS.length + MECHANICS.length,
    'the search index still covers the mechanic pages: the 物品检索器 is where they are found now');
});

// ---------- ⑥ 通用:面包屑 + 返回路径 ----------

test('每页均有面包屑与返回首页链接;导航目标已接线', async () => {
  const out = await buildFixture({ layout: null });
  for (const [rel, html] of out) {
    if (rel === 'data.js' || rel === 'nav-search.js') continue;
    assert.ok(html.includes('class="crumb"'), `${rel} 缺面包屑`);
    assert.ok(/<a href="[^"]*index\.html"/.test(html), `${rel} 缺返回首页链接`);
    assert.ok(html.includes('href="' + relPrefix(rel) + 'css/theme.css'), rel);
  }
  // NAV 占位全部接线:不再有 href="#"
  const index = out.get('index.html');
  assert.ok(!index.includes('href="#"'), '导航占位必须清除');
  assert.ok(index.includes('href="changelog.html"'));
  assert.ok(index.includes('href="search.html"'));
  assert.ok(!index.includes('href="index.html#mod-family"'), 'the old 模组介绍 entry pointed at an anchor of the old home page');
  // 「关于本站」不硬编码:没有站点页面用 nav_label 声明它,导航就没有这一项(见下面的 A 组测试)
  assert.ok(!index.includes('>关于本站</a>'), 'no page declares the about entry');
});

// ---------- mods 页 / changelog / search / install-compat ----------

// (The mod page of the old home — 信息表, 物品清单, changelog 节选 — gave way in stage 3, task 3, to the
// mod's own navigation page: see ⑤ below. Until that task the build was checked here; its cases live on there.)

test('changelog.html:按 mod 分组、版本号+文本、无日期字段', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('changelog.html');
  assert.ok(html.includes('暗流交易'));
  assert.ok(html.includes('1.6.4'));
  assert.ok(html.includes('新增疲劳与估值机制'));
  assert.ok(html.includes('修复苗床产出'));
  assert.ok(html.includes('href="mods/lewd_meme.html"'));
});

test('search.html:输入框 + results 容器 + 引用 data.js 与 assets/js/search.js', async () => {
  const out = await buildFixture({ layout: null });
  const html = out.get('search.html');
  assert.ok(html.includes('type="search"'));
  assert.ok(html.includes('id="search-results"'));
  // data.js 必须先于 search.js 加载:autoInit 读 window.WIKI_DATA.search
  assert.ok(html.includes('<script src="data.js"></script>\n<script src="assets/js/search.js"></script>'));
});

test('关于本站:占位页已删,全站无占位文案', async () => {
  const out = await buildFixture({ layout: null });
  assert.ok(!out.has('mods/install-compat.html'), '占位页必须删除');
  for (const [rel, html] of out) {
    if (rel === 'data.js' || rel === 'nav-search.js') continue;
    assert.ok(!html.includes('本页为占位骨架'), `${rel} 残留占位文案`);
  }
});

// ---------- 阶段 3 Task 5 — 顶部导航的「关于本站」由站点页面声明 ----------
//
// content/site/<文件名>.md 的 frontmatter `nav_label`(sitePagesWithNavLabel 读出来)使这一页
// 成为顶部导航的「关于本站」。没有页面声明 → 导航没有这一项;在 CMS 里删掉这一页,
// 导航里的入口随之消失。机制页不再能声明它。

/** A layout with one site page: title 关于本站, the given extra front matter lines (undefined = none), and a body. */
async function siteWith(t, fmLines, body = '这里是关于本站的正文。\n', slug = 'about') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const file = path.join(root, 'site', `${slug}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\ntitle: 关于本站\n${fmLines === undefined ? '' : `${fmLines}\n`}---\n\n${body}`);
  return { home: null, sections: [], site: [{ slug, file }], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [] };
}

/** The nav anchors of one spot ('menu-row' | 'ps-site__links') of a page, as [text, html] pairs. */
function navAnchors(html, spot) {
  const inner = html.split(`class="${spot}"`)[1].split('</div>')[0];
  return (inner.match(/<a [^>]*>.*?<\/a>/g) ?? []).map((a) => [a.replace(/<a [^>]*>|<\/a>/g, ''), a]);
}

const texts = (anchors) => anchors.map(([text]) => text);

test('站点页面 site/<slug>.html:标题、正文(按 Markdown 渲染,物品内嵌卡可用);面包屑是「首页、本页」', async (t) => {
  const out = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t, undefined, '这是 **关于本站** 的正文,先看 [[wondrous_milk]]。') });
  const html = out.get('site/about.html');
  assert.ok(html.includes('<title>关于本站 · probably-documented</title>'));
  assert.ok(html.includes('<h1 class="page-title">关于本站</h1>'));
  assert.ok(html.includes('<strong>关于本站</strong> 的正文,先看 '), 'rendered as Markdown');
  assert.ok(html.includes('href="../item/wondrous_milk.html"'), '[[id]] is an item card');
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; 关于本站</div>'));
  assert.ok(html.includes('href="../css/theme.css"'));
  assert.equal((html.match(/<script\b/g) || []).length, 0);
});

test('站点页面没有写 title → 标题、面包屑都用页面的文件名;列在布局里却读不到的文件也照常出一页', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'render-site-bare-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const file = path.join(root, 'site', 'colophon.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '---\n---\n\n版权说明正文。\n');
  const layout = {
    home: null, sections: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [],
    site: [{ slug: 'colophon', file }, { slug: 'gone', file: path.join(root, 'site', 'gone.md') }],
  };

  const out = await renderSite(structuredClone(FIXTURE), { layout });

  const html = out.get('site/colophon.html');
  assert.ok(html.includes('<title>colophon · probably-documented</title>'), 'titled by the file name, as a section page is');
  assert.ok(html.includes('<h1 class="page-title">colophon</h1>'));
  assert.ok(html.includes('<div class="crumb"><a href="../index.html">首页</a> &gt; colophon</div>'));
  assert.ok(html.includes('版权说明正文。'));
  // neither declares the about entry: the nav has none, and nothing is highlighted
  assert.deepEqual(texts(navAnchors(html, 'menu-row')), ['首页', '更新日志', '物品检索器']);
  assert.equal((html.match(/class="active"/g) || []).length, 0);
  // a page the layout listed whose file cannot be read when it is rendered: no crash — an empty page under its name
  const gone = out.get('site/gone.html');
  assert.ok(gone.includes('<h1 class="page-title">gone</h1>'));
});

test('A1 — a site page that declares nav_label becomes the top nav\'s about entry: label = nav_label, href = site/<slug>.html, last in both spots, on every page; only its own page highlights it', async (t) => {
  const out = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t, 'nav_label: 桶装指南', undefined, 'help') });
  for (const [rel, html] of out) {
    if (rel === 'data.js' || rel === 'nav-search.js') continue;
    const prefix = relPrefix(rel);
    for (const spot of ['menu-row', 'ps-site__links']) {
      const anchors = navAnchors(html, spot);
      assert.deepEqual(texts(anchors), ['首页', '更新日志', '物品检索器', '桶装指南'], `${rel} ${spot}: the about entry is the last one`);
      assert.deepEqual(anchors.at(-1)[1].replace(' class="active"', ''), `<a href="${prefix}site/help.html">桶装指南</a>`, `${rel} ${spot}: the about entry`);
      // Highlighted on the page it leads to (A6), and nowhere else
      assert.equal(anchors.at(-1)[1].includes('class="active"'), rel === 'site/help.html', `${rel} ${spot}: active only on its own page`);
    }
  }
});

test('A2 — 没有任何站点页面带 nav_label → 顶部导航没有 about 项;其余页面照常渲染', async (t) => {
  for (const [what, layout] of [['no site pages at all', null], ['a site page that says no nav_label', await siteWith(t)]]) {
    const out = await renderSite(structuredClone(FIXTURE), { layout });
    for (const [rel, html] of out) {
      if (rel === 'data.js' || rel === 'nav-search.js') continue;
      for (const spot of ['menu-row', 'ps-site__links']) {
        assert.deepEqual(texts(navAnchors(html, spot)), ['首页', '更新日志', '物品检索器'], `${what} — ${rel} ${spot}`);
      }
    }
  }
});

test('A4 — nav_label 为空串或仅空白 → 视为未设置(无 about 项),这一页照常渲染', async (t) => {
  for (const bad of ['""', '"   "', '']) {
    const out = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t, `nav_label: ${bad}`) });
    assert.deepEqual(texts(navAnchors(out.get('index.html'), 'menu-row')), ['首页', '更新日志', '物品检索器'], `navLabel ${JSON.stringify(bad)}: no about entry`);
    assert.ok(out.has('site/about.html'), '…while the page itself is still a page');
  }
  // …while surrounding whitespace of a real label is not part of it
  const padded = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t, 'nav_label:   关于本站   ') });
  assert.deepEqual(texts(navAnchors(padded.get('index.html'), 'menu-row')), ['首页', '更新日志', '物品检索器', '关于本站']);
});

test('A6 — the page that declares the about entry highlights it; a site page that declares nothing highlights no entry', async (t) => {
  const out = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t, 'nav_label: 关于本站') });
  const page = out.get('site/about.html');
  for (const spot of ['menu-row', 'ps-site__links']) {
    assert.deepEqual(texts(navAnchors(page, spot).filter(([, a]) => a.includes('class="active"'))), ['关于本站'], `${spot}: 关于本站 is the highlighted entry`);
  }
  assert.equal((page.match(/class="active"/g) || []).length, 2, 'exactly the two nav spots, one highlighted entry each');
  const quiet = await renderSite(structuredClone(FIXTURE), { layout: await siteWith(t) });
  assert.equal((quiet.get('site/about.html').match(/class="active"/g) || []).length, 0, 'nothing to highlight');
});

test('firstParagraphExcerpt: strips what the rich-text editor writes back, exactly like the text that was written', () => {
  const lookup = (id) => (id === 'wondrous_milk' ? { id } : null);
  const ex = (source) => firstParagraphExcerpt(source, lookup);
  assert.equal(ex('_斜体_ 与 ~~删除线~~ 与 Lv6\\~10'), '斜体 与 删除线 与 Lv6~10');
  assert.equal(ex('扣除一瓶 [[wondrous_milk]](按堆叠数量)'), '扣除一瓶 wondrous_milk(按堆叠数量)');
  assert.equal(ex('扣除一瓶 [\\[wondrous_milk\\]](按堆叠数量)'), '扣除一瓶 wondrous_milk(按堆叠数量)');
  assert.equal(ex('凝结出 [[wondrous_milk]](据 x)'), '凝结出 wondrous_milk(据 x)');
  assert.equal(ex('凝结出 [[wondrous_milk]\\](据 x)'), '凝结出 wondrous_milk(据 x)');
  // a link a contributor really made keeps its link text, known item or not in the brackets
  assert.equal(ex('见 [\\[说明\\]](install-compat.html)'), '见 [说明]');
  assert.equal(ex('见 [\\[拼错的id\\]](install-compat.html)'), '见 [拼错的id]');
  // an escaped asterisk stays a literal asterisk: the editor escapes the ones it does not want as emphasis
  assert.equal(ex('据 zh.csv ledger.\\* 与 report.page2.\\* 词条'), '据 zh.csv ledger.* 与 report.page2.* 词条');
});
