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
//      optional: the top-nav about entry a page declares — aboutNavItem —
//      omit for no 关于本站 entry, task 5b A)
//   infobox(item, relRoot = '../')        -> string  (detail pages are depth 1)
//   itemCard(item, relRoot = '')          -> string
//   itemInline(item, relRoot = '')        -> string
//   renderWikiTable(headers, rows)        -> string  (cells are trusted HTML)
//   cssVars                                — Global Constraints palette
//   NAV_ITEMS                              — shared nav (relRoot-prefixed at render)
//   navLinks(relRoot, activeNav, placement, aboutNav) -> string
//   aboutNavItem(label, slug)              — the nav entry a page declares
//
// Discipline: strictly-null checks for "missing" fields. Empty string is a
// VALID value (project rule) and must never render as 待补充. price 0 is valid.

const SITE_NAME = '淫色深空 Wiki';
const SITE_LOGO_SMALL = 'LEWD MEME FAMILY';
const SITE_SUBNAME = 'LEWD MEME MOD FAMILY · 离线版';
const SITE_NOTICE = '本 wiki 为 lewd_meme 系模组的非官方离线资料站,随模组版本更新重新打包生成。<br/>内容基于模组源码与数据文件整理,转载请注明来源。';
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

// Top nav. Items appear in both the wiki-header menu-row and the ps-site
// banner's ps-site__links unless onlyIn restricts them (mirrors the mockup:
// menu-row ends with 关于本站, ps-site__links ends with 物品检索器). hrefs
// are relative to the site root, always rendered with the relRoot prefix.
// Every entry here is an auto-generated structural page. The 关于本站 entry
// is NOT in this list: it points at a content page, so the page itself
// declares it (frontmatter `nav_label` → aboutNavItem → layout's aboutNav,
// task 5b A). Delete that page and the entry is gone; nothing here changes.
// Placeholders wired by Task 8 (controller Ruling 6): 玩法指南 rides the
// mechanics index, and the search tools entry points at the client-side
// search page.
const NAV_ITEMS = Object.freeze([
  { key: 'home', label: '首页', href: 'index.html' },
  { key: 'items', label: '物品图鉴', href: 'items.html' },
  { key: 'mechanics', label: '机制说明', href: 'mechanics.html' },
  { key: 'guides', label: '玩法指南', href: 'mechanics.html' },
  { key: 'mods', label: '模组介绍', href: 'index.html#mod-family' },
  { key: 'changelog', label: '更新日志', href: 'changelog.html' },
  { key: 'searchtools', label: '物品检索器', href: 'search.html', onlyIn: 'site-links' },
].map(Object.freeze));

/** Where the about entry sits in the nav order: right after 更新日志. */
const ABOUT_SLOT = NAV_ITEMS.findIndex((it) => it.key === 'changelog') + 1;

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

// The top-nav about entry a mechanic page provides through its frontmatter
// `nav_label` (task 5b A1): shown in the wiki-header menu-row only, right
// after 更新日志, linking at that page. `label` is page data and `slug` a
// file name — both are escaped where they are rendered (navLinks).
function aboutNavItem(label, slug) {
  return { key: 'about', label, href: `mechanics/${slug}.html`, onlyIn: 'menu-row' };
}

/** The nav in order, with the declared about entry (if any) in its slot. */
function navItems(aboutNav) {
  if (aboutNav == null) return NAV_ITEMS;
  return [...NAV_ITEMS.slice(0, ABOUT_SLOT), aboutNav, ...NAV_ITEMS.slice(ABOUT_SLOT)];
}

// placement: 'menu-row' | 'site-links'; items flagged onlyIn render in one
// spot only, everything else shows in both. aboutNav (task 5b A): the entry
// declared by a page (aboutNavItem), or null/omitted when no page declares one.
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

// aboutNav (task 5b A): the top-nav about entry declared by a page
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
${searchForm(relRoot, 'header-search', '搜索物品、机制…')}
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
${searchForm(relRoot, 'ps-site__search', '搜索本 Wiki')}
</div>
</div>
${notice}
${breadcrumbHtml(breadcrumb)}
<div class="content-box">
${bodyHtml}
</div>
<div class="wiki-footer">
离线便携版 · 数据提取自模组安装文件 · 风格与素材复用自 <a href="${BWIKI_CREDIT_URL}" target="_blank" rel="noopener noreferrer">深空当铺 BWIKI</a>(CC BY-NC-SA 4.0)· 仅限个人学习交流
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

/** A mod's bar on the home page: the name, and where it leads. */
function modBar(name, href, id) {
  return `<a class="mod-bar" href="${esc(href)}" data-mod="${esc(id)}" title="${esc(name)}">${esc(name)}</a>`;
}

/**
 * A section as a box: its title (which folds the box), 「进入分区」, how many
 * mods it holds, its intro, and the bars.
 * @param {{ title: string, slug: string, intro?: string }} section
 * @param {string[]} bars as modBar makes them
 * @param {{ relRoot?: string, linked?: boolean, collapsible?: boolean }} [options]
 *   linked false: no 「进入分区」 (the block of the mods in no section, and a
 *   section page, which is that section); collapsible false: the title is
 *   plain text, the box cannot fold (a section page: nothing there folds it)
 */
function sectionBlock({ title, slug, intro = '' }, bars, { relRoot = '', linked = true, collapsible = true } = {}) {
  const heading = collapsible
    ? `<button type="button" class="sec-toggle" aria-expanded="true" aria-controls="bars-${esc(slug)}">${esc(title)}</button>`
    : `<span class="sec-title">${esc(title)}</span>`;
  const link = linked ? `<a class="sec-link" href="${esc(relRoot)}sections/${esc(slug)}.html">进入分区</a>` : '';
  return `<section class="sec-block" data-sec="${esc(slug)}">
<div class="sec-head">
${heading}
${link}
<span class="sec-count">${bars.length} 个模组</span>
</div>
${intro === '' ? '' : `<div class="sec-intro">${esc(intro)}</div>`}
<div class="mod-bars" id="bars-${esc(slug)}">
${bars.join('\n')}
</div>
</section>`;
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
  sectionBlock,
  modBar,
};
