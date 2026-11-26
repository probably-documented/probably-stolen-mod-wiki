'use strict';

// Task 7 tests: BWIKI-style templates + theme.css port.
// Visual baseline: .superpowers/brainstorm/1764-1794949587/content/bwiki-style-mockups.html

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  layout, infobox, itemCard, itemInline, renderWikiTable, cssVars,
  NAV_ITEMS, navLinks, aboutNavItem, homeSearchRow, sectionEntries, sectionBlock, modBar, modCard,
} = require('../tools/build/templates.js');

const THEME_CSS_PATH = path.join(__dirname, '..', 'assets-src', 'theme.css');

const ITEM = {
  id: 'wondrous_milk',
  aliases: ['milk_wondrous'],
  name: '神奇乳汁',
  mod: 'lewd_meme',
  modName: '淫色深空:可能是触手',
  price: 180,
  shape: [2, 3],
  icon: 'items/lewd_meme/item_milk.png',
  categories: ['饮料', '食物'],
  tags: ['奢侈品'],
  description: '苗床产出的核心液体物品。',
  flavor: '苗床以人类的食物为原料酿出的乳汁。只要喂得好,产量就很可观。',
  version: '1.9.2',
};

// ---------- layout ----------

test('layout: 骨架关键类、页脚署名、标题', () => {
  const html = layout({
    title: '更新日志',
    relRoot: '',
    activeNav: 'changelog',
    breadcrumb: [{ text: '首页', href: 'index.html' }, { text: '更新日志' }],
    bodyHtml: '<h1 class="page-title">更新日志</h1>',
  });
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('class="wiki-header"'));
  assert.ok(html.includes('class="ps-site"'));
  assert.ok(html.includes('class="content-box"'));
  assert.ok(html.includes('class="wiki-footer"'));
  assert.ok(html.includes('CC BY-NC-SA'));
  assert.ok(html.includes('<title>更新日志 · probably-documented</title>'), 'the site name is probably-documented (stage 3)');
  // 根页资源路径无前缀
  assert.ok(html.includes('href="css/theme.css"'));
  assert.ok(html.includes('src="assets/bwiki/emblem.jpg"'));
});

test('layout: relRoot="../" 时全部资源路径带前缀', () => {
  const html = layout({
    title: '神奇乳汁',
    relRoot: '../',
    activeNav: 'changelog',
    breadcrumb: [{ text: '首页', href: '../index.html' }, { text: '神奇乳汁' }],
    bodyHtml: 'x',
  });
  assert.ok(html.includes('href="../css/theme.css"'));
  assert.ok(html.includes('href="../index.html"'));
  assert.ok(html.includes('href="../changelog.html"'));
  assert.ok(html.includes('src="../assets/bwiki/emblem.jpg"'));
  assert.ok(html.includes('action="../search.html"'));
});

test('layout: 无外链资源引用(白名单仅页脚 biligame 文字链)', () => {
  const html = layout({ title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '' });
  assert.ok(!html.includes('<link href="http'));
  assert.ok(!/src="http/.test(html));
  const externalHrefs = html.match(/href="https?:\/\/[^"]*"/g) || [];
  assert.ok(externalHrefs.length > 0, '页脚应保留 BWIKI 署名文字链');
  for (const href of externalHrefs) {
    assert.ok(href.includes('wiki.biligame.com'), `非白名单外链: ${href}`);
  }
});

test('layout: 顶栏三项 + activeNav 高亮当前项', () => {
  const html = layout({ title: 'x', relRoot: '', activeNav: 'changelog', breadcrumb: [], bodyHtml: '' });
  for (const label of ['首页', '更新日志', '物品检索器']) {
    assert.ok(html.includes(`>${label}</a>`), label);
  }
  assert.ok(html.includes('href="changelog.html" class="active"'));
  assert.ok(!html.includes('href="index.html" class="active"'));
});

test('文案(阶段 3): 站名、副标题、公告、页脚、两个搜索框的占位;旧站名和「离线」字样都不再出现', () => {
  const html = layout({ title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '' });
  assert.ok(html.includes('<div class="wiki-logo-text">probably-documented<small>PROBABLY STOLEN MOD WIKI</small></div>'));
  assert.ok(html.includes('<span class="ps-site__name">probably-documented</span>'));
  assert.ok(html.includes('<span class="ps-site__subname">Probably Stolen 模组百科</span>'));
  assert.ok(html.includes('<div class="ps-site__notice">本站是 Probably Stolen 模组的非官方百科,内容由贡献者在线维护。<br/>数据提取自模组安装文件,与游戏内表现一致;转载请注明来源。</div>'));
  assert.deepEqual((html.match(/placeholder="([^"]*)"/g) || []).map((m) => m.slice('placeholder="'.length, -1)), ['搜索物品、词条…', '搜索物品、词条…'],
    'both search boxes carry the new placeholder');
  const footer = html.split('class="wiki-footer"')[1].split('</div>')[0];
  assert.ok(footer.includes('数据提取自模组安装文件') && footer.includes('内容由贡献者在线维护'), footer);
  assert.ok(footer.includes('href="https://wiki.biligame.com/probablystolen"'), 'the BWIKI credit stays (CC BY-NC-SA 4.0)');
  assert.ok(footer.includes('CC BY-NC-SA 4.0'));
  for (const gone of ['淫色深空 Wiki', 'LEWD MEME', '离线版', '离线便携版', 'lewd_meme 系模组家族', '搜索本 Wiki', '搜索物品、机制…']) {
    assert.ok(!html.includes(gone), `${gone} is gone`);
  }
});

test('layout: 面包屑中间项带链接、最后一项纯文本', () => {
  const html = layout({
    title: 'x',
    relRoot: '',
    activeNav: null,
    breadcrumb: [
      { text: '首页', href: 'index.html' },
      { text: '物品图鉴', href: 'items.html' },
      { text: '神奇乳汁' },
    ],
    bodyHtml: '',
  });
  const crumb = html.split('class="crumb"')[1].split('</div>')[0];
  assert.ok(crumb.includes('<a href="index.html">首页</a>'));
  assert.ok(crumb.includes('<a href="items.html">物品图鉴</a>'));
  assert.ok(crumb.includes('神奇乳汁'));
  assert.ok(!crumb.includes('>神奇乳汁</a>'));
  assert.ok(crumb.includes('&gt;'));
});

// ---------- infobox ----------

test('infobox: caption、贴图、code ID 与属性行', () => {
  const html = infobox(ITEM);
  assert.ok(html.includes('<table class="ps-infobox">'));
  assert.ok(html.includes('<caption>神奇乳汁</caption>'));
  assert.ok(html.includes('src="../assets/items/lewd_meme/item_milk.png"'));
  assert.ok(html.includes('class="info-flavor"'));
  assert.ok(html.includes('苗床以人类的食物为原料酿出的乳汁'));
  assert.ok(html.includes('所属模组'));
  assert.ok(html.includes('href="../mods/lewd_meme.html"'));
  assert.ok(html.includes('淫色深空:可能是触手'));
  assert.ok(html.includes('标签'));
  assert.ok(html.includes('奢侈品'));
  assert.ok(html.includes('180 信用点'));
  assert.ok(html.includes('2 × 3'));
  assert.ok(html.includes('<code>wondrous_milk</code>'));
  assert.ok(html.includes('<code>milk_wondrous</code>'));
  assert.ok(html.includes('1.9.2'));
  assert.ok(!html.includes('待补充'));
});

test('infobox: 严格 null 判断——price 0 与空串是有效值,不算缺失', () => {
  const html = infobox({
    id: 'x', aliases: [], name: 'X', mod: 'lewd_meme', price: 0, shape: [1, 1],
    icon: 'items/lewd_meme/x.png', categories: ['工具'], tags: [], flavor: '', version: '',
  });
  assert.ok(html.includes('0 信用点'));
  assert.ok(!html.includes('待补充'));
});

test('infobox: null 字段渲染“待补充”斜体,icon null 用占位', () => {
  const html = infobox({
    id: 'ghost', aliases: [], name: '幽灵', mod: null, price: null, shape: null,
    icon: null, categories: null, tags: null, flavor: null, version: null,
  });
  assert.ok(html.includes('<i class="missing">待补充</i>'));
  assert.ok((html.match(/待补充/g) || []).length >= 4);
  assert.ok(html.includes('class="no-icon"'));
  assert.ok(!html.includes('<img'));
});

// ---------- itemCard / itemInline ----------

test('itemCard: 链接、img 贴图、名称与价格', () => {
  const html = itemCard(ITEM);
  assert.ok(html.includes('class="item-card"'));
  assert.ok(html.includes('href="item/wondrous_milk.html"'));
  assert.ok(html.includes('src="assets/items/lewd_meme/item_milk.png"'));
  assert.ok(html.includes('<span class="nm">神奇乳汁</span>'));
  assert.ok(html.includes('180 信用点'));
});

test('itemCard: relRoot 前缀;icon null 用“无图”占位,price null 待补充', () => {
  const html = itemCard({ ...ITEM, icon: null, price: null }, '../');
  assert.ok(html.includes('href="../item/wondrous_milk.html"'));
  assert.ok(html.includes('class="no-icon"'));
  assert.ok(html.includes('无图'));
  assert.ok(html.includes('待补充'));
  assert.ok(!html.includes('<img'));
});

test('itemInline: 结构与 relRoot;icon null 占位', () => {
  const html = itemInline(ITEM, '../');
  assert.ok(html.includes('class="item-inline"'));
  assert.ok(html.includes('href="../item/wondrous_milk.html"'));
  assert.ok(html.includes('src="../assets/items/lewd_meme/item_milk.png"'));
  assert.ok(html.includes('神奇乳汁</a>'));

  const noIcon = itemInline({ ...ITEM, icon: null });
  assert.ok(noIcon.includes('class="no-icon"'));
  assert.ok(!noIcon.includes('<img'));
});

test('itemCard/itemInline: name null 回退 id,不输出字面 null(I2)', () => {
  const card = itemCard({ ...ITEM, name: null }, '../');
  assert.ok(card.includes('<span class="nm">wondrous_milk</span>'));
  assert.ok(card.includes('alt="wondrous_milk"'));
  assert.ok(!card.includes('>null<'));
  assert.ok(!card.includes('alt="null"'));
  const inline = itemInline({ ...ITEM, name: null }, '../');
  assert.ok(inline.includes('href="../item/wondrous_milk.html"'));
  assert.ok(inline.includes('wondrous_milk</a>'));
  assert.ok(!inline.includes('>null<'));
  assert.ok(!inline.includes('alt="null"'));
});

// ---------- renderWikiTable ----------

test('renderWikiTable: wiki-table 结构,单元格 HTML 直通', () => {
  const html = renderWikiTable(['来源', '说明'], [['<b>苗床产出</b>', '夜间结算时苗床产乳']]);
  assert.ok(html.includes('<table class="wiki-table">'));
  assert.ok(html.includes('<thead>'));
  assert.ok(html.includes('<tbody>'));
  assert.ok(html.includes('<th>来源</th>'));
  assert.ok(html.includes('<td><b>苗床产出</b></td>'));
  assert.ok(html.includes('<td>夜间结算时苗床产乳</td>'));
  assert.ok(html.includes('</tbody>'));
  assert.ok(html.endsWith('</table>'));
});

// ---------- cssVars ----------

test('cssVars: Global Constraints 精确色值', () => {
  assert.strictEqual(cssVars.page, 'rgba(33,29,40,.92)');
  assert.strictEqual(cssVars.bg, '#433943');
  assert.strictEqual(cssVars.panel, '#625354');
  assert.strictEqual(cssVars.edge, '#292532');
  assert.strictEqual(cssVars.line, '#857576');
  assert.strictEqual(cssVars.text, '#e1e0d0');
  assert.strictEqual(cssVars.muted, '#c5c9b8');
  assert.strictEqual(cssVars.accent, '#e0a27a');
  assert.strictEqual(cssVars.rust, '#b97c57');
  assert.strictEqual(cssVars.metal, '#a9afa2');
  // mockup 补充色
  assert.strictEqual(cssVars.accent2, '#f0c39f');
  assert.strictEqual(cssVars.faint, '#9d9a8c');
});

test('layout: noticeHtml 渲染于 ps-site 与 content-box 之间', () => {
  const notice = '<span class="news-title">全站通知:</span><span>当前数据基线:lewd_meme 1.9.2</span>';
  const html = layout({
    title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '', noticeHtml: notice,
  });
  assert.ok(html.includes('class="top-news"'));
  assert.ok(html.includes('当前数据基线:lewd_meme 1.9.2'));
  assert.ok(html.indexOf('class="ps-site"') < html.indexOf('class="top-news"'));
  assert.ok(html.indexOf('class="top-news"') < html.indexOf('class="content-box"'));
});

test('layout: 不传 noticeHtml 则无 top-news', () => {
  const html = layout({ title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '' });
  assert.ok(!html.includes('class="top-news"'));
});

/** The two nav spots of a layout() document, as arrays of `<a …>…</a>` strings. */
function navOf(html, spot) {
  return html.split(`class="${spot}"`)[1].split('</div>')[0].match(/<a [^>]*>.*?<\/a>/g) ?? [];
}

test('layout: 无 aboutNav 时两处导航都是三项,没有“关于本站”;从顶栏去掉的四项不在', () => {
  const html = layout({ title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '' });
  const menuRow = navOf(html, 'menu-row');
  const siteLinks = navOf(html, 'ps-site__links');
  const texts = (links) => links.map((a) => a.replace(/<a [^>]*>|<\/a>/g, ''));
  assert.deepEqual(texts(menuRow), ['首页', '更新日志', '物品检索器'], 'menu-row: three entries');
  assert.deepEqual(texts(siteLinks), ['首页', '更新日志', '物品检索器'], 'ps-site__links: the same three');
  // The about entry is DECLARED by a page (nav_label on a site page); with no page declaring it the top nav has none.
  assert.ok(!html.includes('关于本站'));
  assert.ok(!html.includes('mechanics/install-compat.html'));
  // The four entries the new navigation took off the top bar: each lives on in the mod's own page.
  for (const gone of ['玩法指南', '模组介绍', '物品图鉴', '机制说明']) {
    assert.ok(!html.includes(`>${gone}</a>`), `${gone} is no longer on the top bar`);
  }
  for (const href of ['items.html', 'mechanics.html', 'index.html#mod-family']) {
    assert.ok(!html.includes(`href="${href}"`), `${href}: the two all-site pages are gone`);
  }
  assert.ok(siteLinks.some((a) => a.includes('href="search.html"')));
  assert.ok(!html.includes('href="#"'));
});

test('layout: aboutNav → 两处导航的末尾都是“关于本站”,指向站点页面;relRoot 前缀', () => {
  const about = aboutNavItem('关于本站', 'about');
  const html = layout({ title: 'x', relRoot: '', activeNav: null, breadcrumb: [], bodyHtml: '', aboutNav: about });
  const texts = (links) => links.map((a) => a.replace(/<a [^>]*>|<\/a>/g, ''));
  assert.deepEqual(texts(navOf(html, 'menu-row')), ['首页', '更新日志', '物品检索器', '关于本站'], 'menu-row: 关于本站 is the last item');
  assert.deepEqual(texts(navOf(html, 'ps-site__links')), ['首页', '更新日志', '物品检索器', '关于本站'], 'ps-site__links: the same, as in the approved prototype');
  assert.ok(navOf(html, 'menu-row').at(-1).includes('href="site/about.html"'), 'the about href: a site page');

  const deep = layout({ title: 'x', relRoot: '../', activeNav: null, breadcrumb: [], bodyHtml: '', aboutNav: about });
  assert.ok(navOf(deep, 'menu-row').at(-1).includes('href="../site/about.html"'), 'sub pages: the relRoot prefix');
  assert.ok(navOf(deep, 'ps-site__links').at(-1).includes('href="../site/about.html"'));
});

// ---------- the about entry is declared by a site page (stage 3, task 5) ----------

test('NAV_ITEMS: three structural entries — 首页, 更新日志, 物品检索器 — and none points at a content page or at a page that is no more', () => {
  assert.deepEqual(NAV_ITEMS.map((it) => it.key), ['home', 'changelog', 'searchtools']);
  for (const it of NAV_ITEMS) {
    assert.ok(!/^(mechanics|site)\/[^/]+\.html$/.test(it.href), `${it.key}: ${it.href} points at a content page`);
    assert.ok(it.onlyIn === undefined, `${it.key}: every entry shows in both spots`);
    assert.ok(!['items.html', 'mechanics.html'].includes(it.href), `${it.key}: ${it.href}`);
  }
});

test('aboutNavItem: { key: about, label, href: site/<slug>.html } — in both spots, like the structural entries', () => {
  assert.deepEqual(aboutNavItem('关于本站', 'about'), {
    key: 'about', label: '关于本站', href: 'site/about.html',
  });
});

test('navLinks / aboutNavItem: label 与 href 来自页面数据,一律转义', () => {
  const about = aboutNavItem('<b>关于 & 本站"', 'a&b');
  assert.equal(about.label, '<b>关于 & 本站"', 'the label is kept as data; escaping happens at render');
  const html = navLinks('', null, 'menu-row', about);
  assert.ok(html.includes('<a href="site/a&amp;b.html">&lt;b&gt;关于 &amp; 本站&quot;</a>'), html);
  // …and the hard-coded entries still render exactly as before
  assert.ok(html.includes('<a href="index.html">首页</a>'));
  assert.ok(html.includes('<a href="changelog.html">更新日志</a>'));
  assert.ok(html.includes('<a href="search.html">物品检索器</a>'));
});

test('navLinks: activeNav 只高亮 key 相同的那一项(about 项的 key 是 about)', () => {
  const about = aboutNavItem('关于本站', 'about');
  const html = navLinks('', 'about', 'menu-row', about);
  assert.ok(html.includes('<a href="site/about.html" class="active">关于本站</a>'));
  assert.equal((html.match(/class="active"/g) || []).length, 1);
  // without an about entry nothing can be highlighted under that key
  assert.ok(!navLinks('', 'about', 'menu-row').includes('class="active"'));
});

// ---------- theme.css 源文件 ----------

test('theme.css: 本地字体与背景图,无 @import、无外链', () => {
  const css = fs.readFileSync(THEME_CSS_PATH, 'utf8');
  assert.ok(!css.includes('@import'), '禁止 @import 外链字体');
  assert.ok(!css.includes('http://'), 'CSS 内禁止 http 外链');
  assert.ok(!css.includes('https://'), 'CSS 内禁止 https 外链');
  // 三个本地 @font-face(文件名约定,Task 10 落盘到 dist/assets/fonts/)
  assert.ok(css.includes('PSNotoSansSC.woff2'));
  assert.ok(css.includes('PSLubrifontSC.woff2'));
  assert.ok(css.includes('PSTektur.woff2'));
  // 字体栈保持 mockup
  assert.ok(css.includes('"PSNotoSansSC","Lubrifont_SC","Microsoft YaHei","PingFang SC",sans-serif'));
  // 背景图本地化:CSS 部署于 <root>/css/,实体在 <root>/assets/ 下 → ../assets/
  assert.ok(css.includes('url(../assets/bwiki/bg.png)'));
  assert.ok(css.includes('url(../assets/fonts/'));
  // 防回归:不得指向与 dist 布局矛盾的路径
  assert.ok(!css.includes('url(../fonts/'));
  assert.ok(!css.includes('url(../bwiki/'));
  // 新增样式
  assert.ok(css.includes('.wikilink-missing'));
  assert.ok(css.includes('@media print'));
});

test('theme.css: wiki-table 斑马纹锚定 tbody odd(thead 下数据首行着色)', () => {
  const css = fs.readFileSync(THEME_CSS_PATH, 'utf8');
  assert.ok(css.includes('table.wiki-table tbody tr:nth-child(odd) td'));
  // 防回归:无 thead 假设的旧选择器(nth-child 在 thead 下会错位一行)
  assert.ok(!css.includes('table.wiki-table tr:nth-child(even) td'));
  // 正文裸 markdown 表格(mdToHtml 输出同样带 thead/tbody)遵循同一约定
  assert.ok(css.includes('tbody tr:nth-child(odd) td'));
});

test('theme.css: 色板与 mockup 关键类逐字保留', () => {
  const css = fs.readFileSync(THEME_CSS_PATH, 'utf8');
  for (const v of [
    'rgba(33,29,40,.92)', '#433943', '#625354', '#292532', '#857576',
    '#e1e0d0', '#c5c9b8', '#e0a27a', '#b97c57', '#a9afa2',
  ]) {
    assert.ok(css.includes(v), v);
  }
  for (const selector of [
    '.wiki-header', '.menu-row', '.header-search', '.ps-site', '.ps-site__mast',
    '.ps-site__emblem', '.ps-site__name', '.ps-site__nav', '.ps-site__links',
    '.ps-site__search', '.top-news', '.crumb', '.content-box', 'h1.page-title',
    'h2.sec', 'h3.sub', '.toc', '.ps-infobox', '.info-image', '.info-flavor',
    '.item-grid', '.item-card', '.item-inline', 'table.wiki-table', '.formula',
    '.notice-box', '.mod-cards', '.mod-card', '.wiki-footer', '.updated',
    // the home page and the section pages since stage 3
    '.nav-search-row', '.nav-search', '.nav-scope', '.nav-results', '.sec-block', '.mod-bars', '.mod-bar', '.home-foot', '.home-links',
  ]) {
    assert.ok(css.includes(selector), selector);
  }
  // …while the old home page's layout (two columns, a stat table, a news list) left with the page itself (stage 3)
  for (const dead of ['.home-cols', '.home-main', '.home-side', '.stat-table', '.news-list']) {
    assert.ok(!css.includes(dead), `${dead}: nothing renders it any more`);
  }
});

// ---------- 阶段 3 Task 2:主页和分区页的三个模板 ----------

test('homeSearchRow: 搜索栏、默认收起的「限定范围」和它的下拉面板(每个分区一个复选框、「清空」)、状态行和结果容器', () => {
  const html = homeSearchRow([{ slug: 'a', title: '甲 <一>' }, { slug: 'b', title: '乙' }], { relRoot: '' });
  assert.ok(html.includes('<div class="nav-search-row">'));
  assert.ok(html.includes('<input type="search" id="nav-q"'), 'the search box');
  assert.ok(html.includes('id="nav-scope-toggle" aria-expanded="false" aria-controls="nav-scope-panel">限定范围'), 'closed until asked for');
  assert.ok(html.includes('<div class="scope-panel" id="nav-scope-panel" hidden>'));
  assert.ok(html.includes('<input type="checkbox" value="a"/>甲 &lt;一&gt;</label>'), 'a box per section; names are escaped');
  assert.ok(html.includes('<input type="checkbox" value="b"/>乙</label>'));
  assert.ok(html.includes('id="nav-scope-clear">清空</button>'));
  assert.ok(html.includes('<div class="nav-status" id="nav-status" hidden></div>'));
  assert.ok(html.includes('<div class="nav-results" id="nav-results" hidden></div>'));
  // 没有分区:面板里没有复选框,搜索照常
  const bare = homeSearchRow([], { relRoot: '' });
  assert.ok(bare.includes('id="nav-q"') && !bare.includes('type="checkbox"'));
});

test('sectionEntries: 分区页标题下的入口行——物品图鉴、机制说明,地址在 sections/<slug>/ 下,带前缀,slug 转义', () => {
  const html = sectionEntries('a <一>', '../');
  assert.ok(html.startsWith('<p class="home-links sec-entries">') && html.endsWith('</p>'), "one row, in the style of the home page's entries");
  assert.deepEqual([...html.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map((m) => [m[1], m[2]]), [
    ['../sections/a &lt;一&gt;/items.html', '物品图鉴'],
    ['../sections/a &lt;一&gt;/mechanics.html', '机制说明'],
  ]);
  assert.ok(sectionEntries('a').includes('href="sections/a/items.html"'), 'at the root there is no prefix');
  assert.equal((sectionEntries('a').match(/<script|<button/g) || []).length, 0, 'plain links: a section page has no script');
});

test('modCard: 名字链到 mod 页,ID 和版本一行小字;简介没有就不出;物品数和前置;都转义', () => {
  const full = modCard({ name: '甲 <一>', href: '../mods/a.html', id: 'a', version: '1.2.0', summary: '一句话。', itemCount: 3, prerequisites: ['b', 'c'] });
  assert.ok(full.startsWith('<div class="mod-card">\n<h4>'));
  assert.ok(full.includes('<h4><a href="../mods/a.html">甲 &lt;一&gt;</a><span class="ver">a · 1.2.0</span></h4>'));
  assert.ok(full.includes('<p>一句话。</p>'));
  assert.ok(full.includes('<div class="meta">3 件物品 · 前置 b、c</div>'));
  const bare = modCard({ name: '乙', href: '../mods/b.html', id: 'b', summary: '' });
  assert.ok(bare.includes('<span class="ver">b</span>'), 'no version: the id alone');
  assert.ok(!bare.includes('<p>'), 'no summary: no line for it');
  assert.ok(bare.includes('<div class="meta">0 件物品 · 无前置</div>'));
});

test('sectionBlock: 标题(可折叠)、「进入分区」、计数、简介和 mod 条;linked 为假时没有「进入分区」', () => {
  const bars = [modBar('甲 <一>', 'mods/a.html', 'a'), modBar('乙', 'mods/b.html', 'b')];
  const html = sectionBlock({ title: '分区 <一>', slug: 'a', intro: '一句话简介。' }, bars, { relRoot: '', linked: true });
  assert.ok(html.startsWith('<section class="sec-block" data-sec="a">'));
  assert.ok(html.includes('<button type="button" class="sec-toggle" aria-expanded="true" aria-controls="bars-a">分区 &lt;一&gt;</button>'),
    'the title folds the block; open to begin with');
  assert.ok(html.includes('<a class="sec-link" href="sections/a.html">进入分区</a>'));
  assert.ok(html.includes('<span class="sec-count">2 个模组</span>'), 'as many as there are bars');
  assert.ok(html.includes('<div class="sec-intro">一句话简介。</div>'));
  assert.ok(html.includes('<div class="mod-bars" id="bars-a">'));
  assert.ok(html.includes('<a class="mod-bar" href="mods/a.html" data-mod="a" title="甲 &lt;一&gt;">甲 &lt;一&gt;</a>'), 'a bar holds the name, escaped, and nothing else');

  const unlinked = sectionBlock({ title: '不属于任何分区的 mod', slug: '__none', intro: '' }, bars, { relRoot: '', linked: false });
  assert.ok(unlinked.includes('data-sec="__none"'));
  assert.ok(!unlinked.includes('sec-link'));
  assert.ok(!unlinked.includes('sec-intro'), 'no intro: no line for it');

  // 分区页:条指向上一级的 mods/,方框不折叠(那一页只有它,没有脚本)
  const page = sectionBlock({ title: '甲', slug: 'a', intro: '' }, [modBar('甲', '../mods/a.html', 'a')], { relRoot: '../', linked: false, collapsible: false });
  assert.ok(page.includes('<span class="sec-title">甲</span>'), 'the title is plain text when the block cannot fold');
  assert.ok(!page.includes('sec-toggle') && !page.includes('<button'));
  assert.equal((page.match(/<span class="sec-count">/g) || []).length, 1, 'the count is there all the same');

  // 卡片模式(阶段 5 Task 2):给了 cards 就是一张张卡片,没有条;计数照数;折叠时藏的还是那一个容器
  const cards = sectionBlock({ title: '分区', slug: 'a', intro: '' }, [], {
    relRoot: '../', linked: false, collapsible: false, cards: ['<div class="mod-card">一</div>', '<div class="mod-card">二</div>'],
  });
  assert.ok(cards.includes('<div class="mod-cards" id="bars-a">'), 'the cards sit where the bars would, under the same id');
  assert.ok(!cards.includes('mod-bars'));
  assert.deepEqual([...cards.matchAll(/<div class="mod-card">[^<]*<\/div>/g)].map((m) => m[0]), ['<div class="mod-card">一</div>', '<div class="mod-card">二</div>']);
  assert.ok(cards.includes('<span class="sec-count">2 个模组</span>'), 'as many as there are cards');
  const emptyCards = sectionBlock({ title: '分区', slug: 'a', intro: '' }, [], { cards: [] });
  assert.ok(emptyCards.includes('<div class="mod-cards" id="bars-a">\n\n</div>') && emptyCards.includes('0 个模组'), 'no card: the empty grid, and the count says so');
});

test('modBar: 链接、data-mod 和转义过的名字', () => {
  assert.equal(modBar('a & b', 'mods/x.html', 'x'), '<a class="mod-bar" href="mods/x.html" data-mod="x" title="a &amp; b">a &amp; b</a>');
});

test('navLinks: aboutNav 可以是数组 → 多个站点页面各有一项,按顺序排在固定入口之后,各自独立高亮', () => {
  const navs = [aboutNavItem('关于本站', 'about'), aboutNavItem('安装攻略', 'install-guide', 'site-install-guide')];
  const html = navLinks('', 'site-install-guide', 'menu-row', navs);
  const labels = [...html.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(labels, [...NAV_ITEMS.map((it) => it.label), '关于本站', '安装攻略']);
  assert.match(html, /<a href="site\/install-guide\.html" class="active">安装攻略<\/a>/);
  assert.doesNotMatch(html, /about\.html" class="active"/);
});
