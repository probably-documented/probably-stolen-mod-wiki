'use strict';

// BWIKI-style HTML templates for the offline wiki site (Task 7).
//
// Visual baseline (the ONLY accepted look): the confirmed mockup at
// .superpowers/brainstorm/1764-1794949587/content/bwiki-style-mockups.html
// DOM structure replicates the mockup 1:1; theme.css (assets-src/) carries
// its <style> block. No external asset references anywhere — the footer's
// BWIKI credit text link is the single audited whitelist exception.
//
// Exports:
//   layout({title, relRoot, activeNav, breadcrumb, bodyHtml, noticeHtml, aboutNav}) -> string
//     (noticeHtml optional: renders the mockup's top-news bar between the
//      ps-site banner and the content box; omit for no bar. aboutNav
//      optional: the top-nav about entry a site page declares — aboutNavItem —
//      omit for no 关于本站 entry)
//   infobox(item, relRoot = '../')        -> string  (detail pages are depth 1)
//   itemCard(item, relRoot = '')          -> string
//   itemInline(item, relRoot = '')        -> string
//   renderWikiTable(headers, rows)        -> string  (cells are trusted HTML)
//   cssVars                                — Global Constraints palette
//   NAV_ITEMS                              — the structural entries of the top nav
//   navLinks(relRoot, activeNav, placement, aboutNav) -> string
//   aboutNavItem(label, slug)              — the nav entry a site page declares
//   homeSearchRow, sectionBlock, modBar    — the home page and the section pages
//
// Discipline: strictly-null checks for "missing" fields. Empty string is a
// VALID value (project rule) and must never render as 待补充. price 0 is valid.

const SITE_NAME = 'probably-documented';
const SITE_LOGO_SMALL = 'PROBABLY STOLEN MOD WIKI';
const SITE_SUBNAME = 'Probably Stolen 模组百科';
const SITE_NOTICE = '本站是 Probably Stolen 模组的非官方百科,内容由贡献者在线维护。<br/>数据提取自模组安装文件,与游戏内表现一致;转载请注明来源。';
const BWIKI_CREDIT_URL = 'https://wiki.biligame.com/probablystolen';
const MISSING = '<i class="missing">待补充</i>';

// Global Constraints palette (docs/superpowers/plans/2026-11-18-lewdmeme-wiki.md)
const cssVars = Object.freeze({
  page: 'rgba(33,29,40,.92)',
  bg: '#433943',
  panel: '#625354',
  edge: '#292532',
  line: '#857576',
  text: '#e1e0d0',
  muted: '#c5c9b8',
  faint: '#9d9a8c',
  accent: '#e0a27a',
  accent2: '#f0c39f',
  metal: '#a9afa2',
  rust: '#b97c57',
});

// Top nav (stage 3): 首页, 更新日志 and 物品检索器, structural pages all, in both
// the wiki-header menu-row and the ps-site banner's ps-site__links. hrefs are
// relative to the site root, always rendered with the relRoot prefix.
// The 关于本站 entry is NOT in this list: a site page declares it with its
// front matter `nav_label` (sitePagesWithNavLabel in mechanics.js →
// aboutNavItem → layout's aboutNav), and it is then the last entry of both
// spots. Delete that page and the entry is gone; nothing here changes.
// The four entries of the old bar — 玩法指南, 模组介绍, 物品图鉴, 机制说明 —
// are gone from it: each lives on in the mod's own navigation page.
const NAV_ITEMS = Object.freeze([
  { key: 'home', label: '首页', href: 'index.html' },
  { key: 'changelog', label: '更新日志', href: 'changelog.html' },
  { key: 'searchtools', label: '物品检索器', href: 'search.html' },
].map(Object.freeze));

/** Where the about entry sits in the nav order: last, as in the approved prototype. */
const ABOUT_SLOT = NAV_ITEMS.length;

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// icon is "missing" only for null/undefined/'' — an empty string can never
// resolve to a real file, so it degrades to the placeholder too. Text fields
// elsewhere keep the strict null-only rule.
function iconSrc(item, relRoot) {
  if (item.icon == null || item.icon === '') return null;
  return `${relRoot}assets/${item.icon}`;
}

function itemHref(item, relRoot) {
  return `${relRoot}item/${item.id}.html`;
}

// The top-nav about entry a site page provides through its frontmatter
// `nav_label` (stage 3, task 5): the last entry of both spots, linking at
// that page (content/site/<slug>.md → site/<slug>.html). `label` is page data
// and `slug` a file name — both are escaped where they are rendered (navLinks).
// `key` 默认是 'about'(第一个声明的页面);之后的页面由构建入口传入各自唯一的 key,
// 这样每一项都能单独高亮。
function aboutNavItem(label, slug, key = 'about') {
  return { key, label, href: `site/${slug}.html` };
}

/** The nav in order, with the declared about entry (if any) last. */
// aboutNav 可以是 null、单个入口,或入口数组(多个站点页面各自声明了 nav_label)。
function navItems(aboutNav) {
  const declared = aboutNav == null ? [] : [].concat(aboutNav);
  if (declared.length === 0) return NAV_ITEMS;
  return [...NAV_ITEMS.slice(0, ABOUT_SLOT), ...declared, ...NAV_ITEMS.slice(ABOUT_SLOT)];
}

// placement: 'menu-row' | 'site-links'; items flagged onlyIn render in one
// spot only, everything else shows in both. aboutNav: the entry declared by
// a site page (aboutNavItem), or null/omitted when no page declares one.
function navLinks(relRoot, activeNav, placement, aboutNav = null) {
  return navItems(aboutNav)
    .filter((it) => !it.onlyIn || it.onlyIn === placement)
    .map(({ key, label, href }) => {
      const cls = key === activeNav ? ' class="active"' : '';
      return `<a href="${esc(relRoot + href)}"${cls}>${esc(label)}</a>`;
    })
    .join('');
}

// breadcrumb: [{text, href?}] — every entry except the last is a link; the
// last one is plain text. hrefs are used as given (caller applies relRoot).
function breadcrumbHtml(breadcrumb) {
  if (!breadcrumb || breadcrumb.length === 0) return '';
  const parts = breadcrumb.map((entry, idx) => {
    const isLast = idx === breadcrumb.length - 1;
    if (entry.href && !isLast) return `<a href="${esc(entry.href)}">${esc(entry.text)}</a>`;
    return esc(entry.text);
  });
  return `<div class="crumb">${parts.join(' &gt; ')}</div>`;
}

function searchForm(relRoot, cls, placeholder) {
  return `<form class="${cls}" action="${esc(relRoot)}search.html" method="get">`
    + `<input type="search" name="q" placeholder="${esc(placeholder)}"/>`
    + '<button type="submit">搜索</button>'
    + '</form>';
}

// aboutNav: the top-nav about entry declared by a site page
// (templates.aboutNavItem), or null/omitted when no page declares one.
function layout({ title, relRoot = '', activeNav = null, breadcrumb = null, bodyHtml = '', noticeHtml = null, aboutNav = null }) {
  // top-news 全站通知条(数据基线等),仅首页等显式传入时渲染
  const notice = noticeHtml == null ? '' : `<div class="top-news">${noticeHtml}</div>`;
  return `<!DOCTYPE html>
<html lang="zh-Hans-CN">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title)} · ${SITE_NAME}</title>
<link rel="stylesheet" href="${esc(relRoot)}css/theme.css"/>
</head>
<body>
<div class="page-wrap">
<div class="wiki-header">
<div class="wiki-logo-text">${SITE_NAME}<small>${SITE_LOGO_SMALL}</small></div>
<div class="menu-row">${navLinks(relRoot, activeNav, 'menu-row', aboutNav)}</div>
${searchForm(relRoot, 'header-search', '搜索物品、词条…')}
</div>
<div class="ps-site">
<div class="ps-site__mast">
<div class="ps-site__brand">
<div class="ps-site__emblem"><img src="${esc(relRoot)}assets/bwiki/emblem.jpg" style="width:100%" alt="站点头图"/></div>
<div class="ps-site__sitename">
<span class="ps-site__name">${SITE_NAME}</span>
<span class="ps-site__subname">${SITE_SUBNAME}</span>
</div>
</div>
<div class="ps-site__notice">${SITE_NOTICE}</div>
</div>
<div class="ps-site__nav">
<div class="ps-site__links">${navLinks(relRoot, activeNav, 'site-links', aboutNav)}</div>
${searchForm(relRoot, 'ps-site__search', '搜索物品、词条…')}
</div>
</div>
${notice}
${breadcrumbHtml(breadcrumb)}
<div class="content-box">
${bodyHtml}
</div>
<div class="wiki-footer">
数据提取自模组安装文件 · 内容由贡献者在线维护 · 风格与素材复用自 <a href="${BWIKI_CREDIT_URL}" target="_blank" rel="noopener noreferrer">深空当铺 BWIKI</a>(CC BY-NC-SA 4.0)· 仅限个人学习交流
</div>
</div>
</body>
</html>`;
}

// name 缺失(null/undefined)时全部展示层回退到物品 ID —— 真实数据中存在
// name=null 的内部条目,卡片/alt/caption 绝不能输出字面 "null"。
function displayName(item) {
  return item.name == null ? item.id : item.name;
}

// Detail-page info box, replicating the mockup's <table class="ps-infobox">.
// Detail pages live at item/<id>.html, hence the '../' default relRoot.
function infobox(item, relRoot = '../') {
  const src = iconSrc(item, relRoot);
  const imageCell = src
    ? `<img src="${esc(src)}" alt="${esc(displayName(item))}"/>`
    : '<div class="no-icon">无图</div>';
  const flavor = item.flavor == null ? MISSING : esc(item.flavor);
  const modCell = item.mod == null
    ? MISSING
    : `<a href="${esc(relRoot)}mods/${esc(item.mod)}.html">${esc(item.modName || item.mod)}</a>`;
  const tagList = [...(item.tags || []), ...(item.categories || [])];
  const tagCell = tagList.length ? tagList.map(esc).join('、') : MISSING;
  const priceCell = item.price == null ? MISSING : `${esc(item.price)} 信用点`;
  const shapeCell = Array.isArray(item.shape) && item.shape.length === 2 && item.shape[0] != null && item.shape[1] != null
    ? `${esc(item.shape[0])} × ${esc(item.shape[1])}`
    : MISSING;
  const ids = [item.id, ...(item.aliases || [])].filter((x) => x != null && x !== '');
  const idCell = ids.length ? ids.map((x) => `<code>${esc(x)}</code>`).join(' / ') : MISSING;
  const versionCell = item.version == null ? MISSING : esc(item.version);

  return `<table class="ps-infobox">
<caption>${esc(displayName(item))}</caption>
<tr><td colspan="2" class="info-image">${imageCell}</td></tr>
<tr><td colspan="2" class="info-flavor">${flavor}</td></tr>
<tr><th>所属模组</th><td>${modCell}</td></tr>
<tr><th>标签</th><td>${tagCell}</td></tr>
<tr><th>基础价值</th><td>${priceCell}</td></tr>
<tr><th>占格</th><td>${shapeCell}</td></tr>
<tr><th>物品ID</th><td>${idCell}</td></tr>
<tr><th>适用版本</th><td>${versionCell}</td></tr>
</table>`;
}

// Grid card (mockup .item-card). Anchored so the whole card navigates; the
// CSS keeps the mockup's colors by resetting the global link color.
// data-mod / data-category carry the Task 9/10 front-end filter hooks:
// data-category is a space-separated word list so CSS [data-category~=X]
// matches any of the item's categories.
function itemCard(item, relRoot = '') {
  const src = iconSrc(item, relRoot);
  const name = displayName(item);
  const image = src
    ? `<img src="${esc(src)}" alt="${esc(name)}"/>`
    : '<div class="no-icon">无图</div>';
  const price = item.price == null ? MISSING : `${esc(item.price)} 信用点`;
  const dataMod = item.mod == null ? '' : ` data-mod="${esc(item.mod)}"`;
  const dataCat = Array.isArray(item.categories) && item.categories.length > 0
    ? ` data-category="${esc(item.categories.join(' '))}"` : '';
  return `<a class="item-card"${dataMod}${dataCat} href="${esc(itemHref(item, relRoot))}">${image}<span class="nm">${esc(name)}</span><span class="pr">${price}</span></a>`;
}

// Inline chip (mockup .item-inline) — also the renderInline callback shape
// consumed by Task 6's mdToHtml for [[item id]] wikilinks.
function itemInline(item, relRoot = '') {
  const src = iconSrc(item, relRoot);
  const image = src ? `<img src="${esc(src)}" alt=""/>` : '<span class="no-icon">无图</span>';
  return `<a class="item-inline" href="${esc(itemHref(item, relRoot))}">${image}${esc(displayName(item))}</a>`;
}

// headers: string[]; rows: string[][]. Cells are trusted HTML (the caller
// composes them from esc()'d data or other templates); no escaping here.
function renderWikiTable(headers, rows) {
  const head = (headers || []).map((h) => `<th>${h}</th>`).join('');
  const body = (rows || [])
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table class="wiki-table">
<thead><tr>${head}</tr></thead>
<tbody>
${body}
</tbody>
</table>`;
}

// ---------------------------------------------------------------------------
// The home page and the section pages (stage 3). Ported from the approved
// prototype (.superpowers/spike-nav-2026-11-26/proto-home/build.js in modwiki);
// theme.css carries their styles.
// ---------------------------------------------------------------------------

/**
 * The first row of the home page's body: the search bar on the left, the
 * 「限定范围」 button beside it — closed until asked for — and its panel with
 * one box per section and a 「清空」; then the line that says what was found
 * and the box that lists it. assets-src/js/nav-home.js drives all of it by
 * these ids.
 * @param {Array<{ slug: string, title: string }>} sections
 */
function homeSearchRow(sections) {
  const boxes = sections.map((s) => `<label><input type="checkbox" value="${esc(s.slug)}"/>${esc(s.title)}</label>`).join('\n');
  return `<div class="nav-search-row">
<form class="nav-search" id="nav-search" role="search">
<input type="search" id="nav-q" placeholder="搜索模组:名称、ID、简介,或别名和关键词" autocomplete="off"/>
<button type="submit">搜索</button>
</form>
<div class="nav-scope" id="nav-scope">
<button type="button" class="scope-toggle" id="nav-scope-toggle" aria-expanded="false" aria-controls="nav-scope-panel">限定范围<span class="scope-badge" id="nav-scope-badge" hidden></span></button>
<div class="scope-panel" id="nav-scope-panel" hidden>
<div class="scope-panel-head"><span class="scope-hint">(都不勾选就是全部)</span><button type="button" class="scope-clear" id="nav-scope-clear">清空</button></div>
<div class="scope-list">
${boxes}
</div>
</div>
</div>
</div>
<div class="nav-status" id="nav-status" hidden></div>
<div class="nav-results" id="nav-results" hidden></div>`;
}

/**
 * 分区页标题下的入口行(阶段 5 Task 1):「物品图鉴」「机制说明」,进到这个分区自己的两个
 * 自动页面(sections/<slug>/items.html、mechanics.html)。样式同主页底部的三个入口。
 * 普通链接:分区页没有脚本。slug 是文件名,转义后再进地址。
 */
function sectionEntries(slug, relRoot = '') {
  return `<p class="home-links sec-entries"><a href="${esc(relRoot)}sections/${esc(slug)}/items.html">物品图鉴</a><a href="${esc(relRoot)}sections/${esc(slug)}/mechanics.html">机制说明</a></p>`;
}

/** A mod's bar on the home page: the name, and where it leads. */
function modBar(name, href, id) {
  return `<a class="mod-bar" href="${esc(href)}" data-mod="${esc(id)}" title="${esc(name)}">${esc(name)}</a>`;
}

/**
 * A section as a box: its title (which folds the box), 「进入分区」, how many
 * mods it holds, its intro, and the bars — or, in the card mode of a section
 * page (stage 5, task 2), one card per mod (`cards`).
 * @param {{ title: string, slug: string, intro?: string }} section
 * @param {string[]} bars as modBar makes them
 * @param {{ relRoot?: string, linked?: boolean, collapsible?: boolean, cards?: string[] | null }} [options]
 *   linked false: no 「进入分区」 (the block of the mods in no section, and a
 *   section page, which is that section); collapsible false: the title is
 *   plain text, the box cannot fold (a section page: nothing there folds it);
 *   cards: the cards to show instead of the bars (modCard makes them), null for bars
 */
function sectionBlock({ title, slug, intro = '' }, bars, { relRoot = '', linked = true, collapsible = true, cards = null } = {}) {
  const heading = collapsible
    ? `<button type="button" class="sec-toggle" aria-expanded="true" aria-controls="bars-${esc(slug)}">${esc(title)}</button>`
    : `<span class="sec-title">${esc(title)}</span>`;
  const link = linked ? `<a class="sec-link" href="${esc(relRoot)}sections/${esc(slug)}.html">进入分区</a>` : '';
  // The cards sit where the bars would, under the same id: what folds the box hides either.
  const content = cards === null ? { class: 'mod-bars', items: bars } : { class: 'mod-cards', items: cards };
  return `<section class="sec-block" data-sec="${esc(slug)}">
<div class="sec-head">
${heading}
${link}
<span class="sec-count">${content.items.length} 个模组</span>
</div>
${intro === '' ? '' : `<div class="sec-intro">${esc(intro)}</div>`}
<div class="${content.class}" id="bars-${esc(slug)}">
${content.items.join('\n')}
</div>
</section>`;
}

/**
 * 分区页卡片模式下的一张卡(阶段 5 Task 2):一个 mod 一张,旧首页「模组家族」的那种。
 * 名字链到 mod 页,ID 和版本一行小字,简介(没有就不出),物品数和前置。都是转义过的。
 * @param {{ name: string, href: string, id: string, version?: string|null, summary?: string, itemCount?: number, prerequisites?: string[] }} card
 */
function modCard({ name, href, id, version = null, summary = '', itemCount = 0, prerequisites = [] }) {
  const prerequisite = prerequisites.length === 0 ? '无前置' : `前置 ${prerequisites.map(esc).join('、')}`;
  return `<div class="mod-card">
<h4><a href="${esc(href)}">${esc(name)}</a><span class="ver">${esc(id)}${version == null ? '' : ` · ${esc(version)}`}</span></h4>
${summary === '' ? '' : `<p>${esc(summary)}</p>\n`}<div class="meta">${esc(itemCount)} 件物品 · ${prerequisite}</div>
</div>`;
}

module.exports = {
  layout,
  infobox,
  itemCard,
  itemInline,
  renderWikiTable,
  cssVars,
  NAV_ITEMS,
  navLinks,
  aboutNavItem,
  homeSearchRow,
  sectionEntries,
  sectionBlock,
  modBar,
  modCard,
};
