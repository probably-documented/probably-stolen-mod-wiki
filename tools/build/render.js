'use strict';

// Task 8: page renderers + inline data.js — assembles the whole static site
// from Task 5's WIKI_DATA, Task 6's mdToHtml and Task 7's templates.
//
// renderSite(data, { layout = null, nav }) -> Promise<Map<relPath, string>>
//   relPath keys are posix-style ('item/<id>.html'); values are full HTML
//   documents or a data script (data.js, nav-search.js). fs.mkdir/write is
//   left to the Task 10 build entry. layout is the content layout
//   (tools/build/content-layout.js): it supplies the home page's and the
//   section pages' bodies and the optional per-item 详解 body
//   (content/mods/<modId>/items/<物品ID>.md); null skips all of it. nav is
//   the home page's search model (buildNavSearch, tools/build/nav-search.js):
//   which mods there are, in what order, and under which sections.
//
// Missing-value discipline (project rule): strictly-null checks everywhere —
// empty string is a VALID value, price 0 is valid, only null/undefined (and
// for icon, '') render the 待补充 / 无图 placeholders.

const fs = require('node:fs/promises');

const { mdToHtml, restoreItemLinks, liftRelativeUrls } = require('./markdown.js');
const { buildSearchIndex } = require('./search-index.js');
const { sitePagesWithNavLabel } = require('./mechanics.js');
const { resolveItemId } = require('./item-ids.js');
const { splitFrontmatter } = require('../extract/frontmatter.js');
const {
  layout, infobox, itemCard, itemInline, renderWikiTable, aboutNavItem, homeSearchRow, homePinnedBlock, sectionEntries, sectionBlock, modBar, modCard,
} = require('./templates.js');

const MISSING = '<i class="missing">待补充</i>';

// changelog 版本行(与 merge.js splitChangelog 同规则):mod 概述 = manifest
// description 中第一个版本行之前的文本。
const VERSION_LINE_RE = /^[ \t]*(?:【\d+(?:\.\d+){2,}】|\d+(?:\.\d+){2,})[ \t：:]*/;

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text, max) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** manifest description → mod 概述(第一个版本行之前;空则退回首行)。 */
function modOverview(description) {
  const lines = String(description ?? '').split(/\r?\n/);
  const head = [];
  for (const line of lines) {
    if (VERSION_LINE_RE.test(line)) break;
    head.push(line);
  }
  let text = head.join(' ').trim();
  if (text === '') text = (lines[0] ?? '').trim();
  return text;
}

/** 源 md 正文:剥 frontmatter,再剥首个 h1(页面已有 page-title,防重复)。
 * frontmatter 解析来自 tools/extract/frontmatter.js(final review Critical:
 * 与 merge 共用 lenient 方言,无闭合 --- 的物品词条 md 不再把
 * frontmatter 当正文泄漏)。 */
function stripTitleBlock(source) {
  const { fm, body } = splitFrontmatter(source);
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^#\s+/.test(lines[i].trim())) lines.splice(i, 1);
  return { fm, body: lines.join('\n') };
}

/**
 * 机制索引摘要:首个段落去 markdown 记号后截断。
 *
 * It follows the page's own rendering: a page the CMS's rich-text editor has
 * rewritten must yield the excerpt it yielded before. So the item links that
 * editor mis-stores are restored first (the renderer's own function — it needs
 * the item table), and escaped punctuation is parked while the markup is
 * stripped, or `\*` would be eaten by the emphasis rule.
 * @param {string} source
 * @param {(id: string) => object|null} lookup
 * @param {number} [max]
 * @returns {string}
 */
function firstParagraphExcerpt(source, lookup, max = 120) {
  const { body } = stripTitleBlock(source);
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') { if (out.length) break; continue; }
    if (/^```/.test(t)) {
      // A fenced block (a code block, an html passthrough block) is not a
      // paragraph: skip it whole, up to the bare ``` that closes it.
      const close = lines.findIndex((line, j) => j > i && line.trim() === '```');
      if (close === -1) break;
      i = close;
      continue;
    }
    if (/^#{1,6}\s/.test(t) || t.startsWith('|') || t.startsWith('>')) continue;
    out.push(t.replace(/^([-*+]|\d+[.)])\s+/, ''));
    if (out.join(' ').length >= max) break;
  }
  let text = restoreItemLinks(out.join(' '), lookup);
  // A link whose text is a bracketed word keeps that word: `[\[x\]](url)` → `[x]`.
  text = text.replace(/\[\\\[([^\[\]\\]+?)\\\]\]\([^)\s]+\)/g, '[$1]');
  const literals = [];
  text = text.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, (_, ch) => {
    literals.push(ch);
    return `\u0000${literals.length - 1}\u0000`;
  });
  text = text
    // `_emphasis_` runs before the item links lose their brackets — as it does
    // in the page — so that `[[id]]_x_` is emphasis and `brood_essence` is not.
    .replace(/(?<![\p{L}\p{N}])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}])/gu, '$1')
    .replace(/\[\[([^\[\]]+?)\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
  return truncate(text.replace(/\u0000(\d+)\u0000/g, (_, i) => literals[Number(i)]), max);
}

/** 单段文本 → 内联 HTML(mdToHtml 单 <p> 剥壳;支持 [[id]]/加粗/链接)。 */
function inlineOnly(text, lookup, relRoot) {
  const { html } = mdToHtml(String(text ?? ''), lookup, (it) => itemInline(it, relRoot));
  return html.replace(/^<p>/, '').replace(/<\/p>$/, '');
}

function multiLine(text) {
  return esc(text).replace(/\n/g, '<br/>');
}

// ---------------------------------------------------------------------------
// Site model helpers
// ---------------------------------------------------------------------------

function buildSiteModel(data, nav = null, about = null) {
  const mods = data.mods ?? [];
  const modsById = new Map(mods.map((m) => [m.id, m]));
  // The name a mod is shown under: the search model's (its page file's title first, then the
  // data, then the directory — nav-search.js), so every page says the same thing.
  const navNames = new Map((nav?.mods ?? []).map((m) => [m.id, m.name]));
  const nameOf = (id) => navNames.get(id) ?? modsById.get(id)?.name ?? null;
  const items = (data.items ?? []).map((it) => ({
    ...it,
    modName: nameOf(it.mod),
    // M1:infobox「适用版本」接线为所属 mod 的版本(item 自身无 version 字段)。
    version: validVersion(modsById.get(it.mod)?.version),
  }));
  // lookup 命中主 id 与全部别名(跨 mod 接管别名仍可 [[引用]])。
  const byId = new Map();
  for (const it of items) {
    byId.set(it.id, it);
    for (const alias of it.aliases ?? []) if (!byId.has(alias)) byId.set(alias, it);
  }
  const lookup = (id) => byId.get(id) ?? null;
  // 顶部导航的「关于本站」由站点页面自己声明:content/site/<文件名>.md 的 frontmatter
  // `nav_label`(mechanics.js 的 sitePagesWithNavLabel 读出来,阶段 3 Task 5)。
  // 没有页面声明 → null → 导航没有这一项;构建入口保证最多一页声明。
  // about 可以是 null、单个页面,或页面数组(每个声明了 nav_label 的站点页面一项)。
  // 第一项的 key 是 'about',其余是 `site-<slug>`;只有一项时 aboutNav 就是那一项本身。
  const aboutPages = about == null ? [] : [].concat(about);
  const aboutNavs = aboutPages.map((p, i) => aboutNavItem(p.navLabel, p.slug, i === 0 ? 'about' : `site-${p.slug}`));
  const aboutNav = aboutNavs.length === 0 ? null : aboutNavs.length === 1 ? aboutNavs[0] : aboutNavs;
  return { mods, modsById, items, lookup, aboutNav, nameOf };
}

/** 首页通知条:数据基线 = 各 mod 版本列表(mods 顺序)。 */
function baselineNotice(data) {
  const parts = (data.mods ?? []).map((m) => `${m.id} ${m.version ?? ''}`.trim());
  return `<span class="news-title">全站通知:</span><span>当前数据基线:${esc(parts.join(' · '))}</span>`;
}

/** 版本有效值(null/undefined/'' 均视为未提供,不渲染尾随分隔符)。 */
function validVersion(version) {
  return version == null || version === '' ? null : String(version);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/** 离线包发布在 GitHub Releases:主页底部「离线包下载」指向那里。 */
const RELEASES_URL = 'https://github.com/probably-documented/probably-stolen-mod-wiki/releases';
/** 「不属于任何分区的 mod」那一块的 data-sec。 */
const NO_SECTION = '__none';

/** 中文排序,同 nav-search.js 的 byTitle:分区物品图鉴里品类标签的先后。 */
const byTitle = (a, b) => a.localeCompare(b, 'zh-Hans-CN');

/** 一个分区在主页顺序下的 mod 条;NO_SECTION 时是不属于任何分区的 mod。 */
function navBars(mods, slug, hrefOf) {
  return mods
    .filter((mod) => (slug === NO_SECTION ? mod.sections.length === 0 : mod.sections.includes(slug)))
    .map((mod) => modBar(mod.name, hrefOf(mod.id), mod.id));
}

/**
 * 主站导航页(index.html):搜索栏和「限定范围」;置顶的安装攻略块;每个分区一个可折叠的方框,
 * 框里是只放名字的 mod 条;不属于任何分区的 mod 单独一块;底部是 home.md 的正文和三个入口
 * (离线包下载、关于本站、更新日志)。全站通知条保留。搜索在浏览器里做(assets-src/js/nav-home.js),
 * 数据是构建写出的 nav-search.js。
 * @param {object|null} content readContentLayout 的结果(home.md 在这里;没有就是没有介绍)
 * @param {object} nav buildNavSearch 的结果({ mods, sections })
 */
async function renderHomePage(data, model, content, nav) {
  const mods = nav.mods ?? [];
  const sections = nav.sections ?? [];
  const homeHref = (id) => `mods/${id}.html`;
  const blocks = [
    ...sections.map((section) => sectionBlock(section, navBars(mods, section.slug, homeHref), { relRoot: '', linked: true })),
  ];
  const loose = navBars(mods, NO_SECTION, homeHref);
  if (loose.length > 0) {
    blocks.push(sectionBlock({ title: '不属于任何分区的 mod', slug: NO_SECTION, intro: '' }, loose, { relRoot: '', linked: false }));
  }

  let homeFm = {};
  let intro = '';
  const raw = content?.home == null ? null : await readOptional(content.home);
  if (raw != null) {
    const parsed = splitFrontmatter(raw);
    homeFm = parsed.fm;
    intro = mdToHtml(parsed.body, model.lookup, (it) => itemCard(it, '')).html;
  }
  const pinnedTitle = typeof homeFm.pinned_section_title === 'string' && homeFm.pinned_section_title !== ''
    ? homeFm.pinned_section_title
    : '安装攻略';
  const pinnedBody = typeof homeFm.pinned_section_body === 'string' ? homeFm.pinned_section_body : '';
  const pinnedHtml = mdToHtml(pinnedBody, model.lookup, (it) => itemCard(it, '')).html;

  const entries = [
    ['离线包下载', RELEASES_URL],
    ...[].concat(model.aboutNav ?? []).map((nav) => [nav.label, nav.href]),
    ['更新日志', 'changelog.html'],
  ].map(([label, href]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('');

  const body = `${homeSearchRow(sections)}
${homePinnedBlock(pinnedTitle, pinnedHtml)}
${blocks.join('\n')}
<div class="home-foot">
${intro === '' ? '' : `<h2 class="sec">关于本站</h2>
${intro}
`}<p class="home-links">${entries}</p>
</div>
<script src="nav-search.js"></script>
<script src="assets/js/nav-home.js"></script>`;

  return layout({
    title: '首页',
    relRoot: '',
    activeNav: 'home',
    breadcrumb: [{ text: '首页' }],
    bodyHtml: body,
    noticeHtml: baselineNotice(data),
    aboutNav: model.aboutNav,
  });
}

/**
 * 一个 mod 的版本和前置:有导出数据的用数据里的,没有(或数据里没写)才用它导航页文件里写的。
 * mod 导航页和分区页的卡片共用这一处,两边的说法不会走样。
 * @param {object|null} exported 数据里的 mod;纯手写的是 null
 * @param {object} fm 它导航页文件的开头(没有文件就是 {})
 * @returns {{ version: string|null, prerequisites: string[] }}
 */
function versionAndPrerequisites(exported, fm) {
  const said = (value) => (typeof value === 'string' ? value.trim() : '');
  const either = (fromData, fromPage) => (fromData == null || fromData === '' ? fromPage : fromData);
  return {
    version: validVersion(either(validVersion(exported?.version), said(fm.version))),
    prerequisites: (exported?.prerequisites ?? []).length > 0
      ? exported.prerequisites.map(String)
      : (Array.isArray(fm.prerequisites) ? fm.prerequisites.map(String) : []),
  };
}

/**
 * 分区页卡片模式下的卡片(阶段 5 Task 2):这个分区的 mod,主页顺序,一个 mod 一张。
 * 卡上的数字和文字同 mod 页——版本和前置有数据用数据,纯手写的用它导航页文件里写的;
 * 物品数是「有数据的加纯手写的」;简介是搜索模型里的那一句,超过 90 字截断,没有就不出。
 * @param {string[]} orderOf buildNavSearch 的 mods(主页顺序)
 * @param {(id: string) => string} hrefOf 一个 mod 的导航页地址
 * @param {object|null} content 内容布局(mod 的导航页文件在这里)
 * @returns {Promise<string[]>}
 */
async function sectionCards(data, model, orderOf, slug, hrefOf, content) {
  const cards = [];
  for (const mod of (orderOf ?? []).filter((m) => m.sections.includes(slug))) {
    const indexFile = (content?.mods ?? []).find((m) => m.id === mod.id)?.indexFile ?? null;
    const raw = indexFile === null ? null : await readOptional(indexFile);
    const { fm } = splitFrontmatter(raw ?? '');
    const { version, prerequisites } = versionAndPrerequisites(data.mods?.find((m) => m.id === mod.id) ?? null, fm);
    cards.push(modCard({
      name: mod.name,
      href: hrefOf(mod.id),
      id: mod.id,
      version,
      summary: truncate(mod.summary, 90),
      itemCount: model.items.filter((it) => it.mod === mod.id).length,
      prerequisites,
    }));
  }
  return cards;
}

/** 分区文件的开头和正文;没有文件、或者读不到,都是空的。分区页和它的两页共用。 */
async function readSection(section) {
  const raw = section?.file == null ? null : await readOptional(section.file);
  const { fm, body } = splitFrontmatter(raw ?? '');
  return { fm, body };
}

/**
 * 分区级两页的「概述」(阶段 5 Task 5):分区文件的 items_intro / mechanics_intro,按 Markdown 渲染,
 * 写了才出这一节。它是按分区页的深度写的,放到深一层的页面上,相对地址提升一级;
 * 物品内嵌卡由构建生成,直接用对的深度。
 * @param {object} section { slug, title, file } — file 是分区文件
 * @param {string} key items_intro 或 mechanics_intro
 * @returns {Promise<string>} 没写就是空串
 */
async function sectionIntro(section, key, relRoot, model) {
  const { fm } = await readSection(section);
  const text = typeof fm[key] === 'string' ? fm[key] : '';
  if (text.trim() === '') return '';
  const { html } = mdToHtml(text, model.lookup, (it) => itemCard(it, relRoot));
  return `<h2 class="sec">概述</h2>\n${liftRelativeUrls(html)}\n`;
}

/**
 * 分区导航页(sections/<slug>.html):标题、入口行(物品图鉴、机制说明,进到这个分区自己的两页)、
 * 本分区的 mod(样式同主页;这一页只有它自己,所以方框不折叠)、最后才是介绍正文
 * (按 Markdown 渲染,物品内嵌卡可用)。分区块里不放简介行:正文就在下面,不再重复。
 * 分区文件写了 cards: true 就是卡片模式(阶段 5 Task 2):每个 mod 一张卡(sectionCards),
 * 别的时候都是条。只有严格的布尔 true 算开。
 * @param {object} section { slug, title, intro, order, file } — file 是分区文件,可以没有
 * @param {object[]} mods buildNavSearch 的 mods(主页顺序)
 * @param {object|null} content readContentLayout 的结果(卡片模式要读 mod 的导航页文件)
 */
async function renderSectionPage(data, model, section, mods, content) {
  const relRoot = '../';
  const { fm, body } = await readSection(section);
  const { html } = mdToHtml(body, model.lookup, (it) => itemCard(it, relRoot));
  const hrefOf = (id) => `${relRoot}mods/${id}.html`;
  const cards = fm.cards === true ? await sectionCards(data, model, mods, section.slug, hrefOf, content) : null;

  return layout({
    title: section.title,
    relRoot,
    activeNav: 'home',
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: section.title },
    ],
    bodyHtml: `<h1 class="page-title">${esc(section.title)}</h1>
${sectionEntries(section.slug, relRoot)}
${sectionBlock({ ...section, intro: '' }, navBars(mods, section.slug, hrefOf), { relRoot, linked: false, collapsible: false, cards })}
${html}`,
    aboutNav: model.aboutNav,
  });
}

/**
 * 分区级物品图鉴页(sections/<slug>/items.html,阶段 5 Task 4):这个分区所有 mod 的物品,按 mod 分节,
 * 能按品类和来源筛选(assets-src/js/item-filter.js,只在 #section-items 里动)。品类是这个分区的物品
 * 有过的品类(数据里的加词条里写的),来源就是物品的 mod——都是自动的,编辑者什么都不用做。
 * 比别的页面深一层,地址前缀都是 ../../。
 * @param {object} section { slug, title, file } — file 是分区文件,概述从那里读
 * @param {object[]} mods buildNavSearch 的 mods(主页顺序)
 */
async function renderSectionItems(data, model, section, mods) {
  const relRoot = '../../';
  const intro = await sectionIntro(section, 'items_intro', relRoot, model);
  const sectionMods = (mods ?? []).filter((mod) => mod.sections.includes(section.slug));
  const itemsOf = (id) => model.items.filter((it) => it.mod === id);
  const total = sectionMods.reduce((n, mod) => n + itemsOf(mod.id).length, 0);
  const categories = [...new Set(sectionMods.flatMap((mod) => itemsOf(mod.id).flatMap((it) => it.categories ?? [])))].sort(byTitle);
  const chip = (dim, value, label, on) => `<button type="button" class="item-inline item-chip${on ? ' is-on' : ''}" data-${dim}="${esc(value)}" aria-pressed="${on ? 'true' : 'false'}">${esc(label)}</button>`;

  const parts = sectionMods.map((mod) => {
    const items = itemsOf(mod.id);
    const version = validVersion(data.mods?.find((m) => m.id === mod.id)?.version);
    return `<section data-mod="${esc(mod.id)}">
<h2 class="sec">${esc(mod.name)}${version == null ? '' : `(${esc(version)})`}</h2>
${mod.summary ? `<p style="${QUIET}">${esc(truncate(mod.summary, 120))}</p>` : ''}
${items.length === 0 ? blank('该模组暂无物品条目。') : `<div class="item-grid">
${items.map((it) => itemCard(it, relRoot)).join('\n')}
</div>`}
</section>`;
  }).join('\n');

  // 一件物品都没有就没有可筛的:不出「筛选」这一节。
  const filter = categories.length === 0 ? '' : `<h2 class="sec">筛选</h2>
<p class="filter-row">品类:${chip('category', '', '全部', true)}${categories.map((c) => chip('category', c, c, false)).join('')}</p>
<p class="filter-row">来源:${chip('mod', '', '全部模组', true)}${sectionMods.map((mod) => chip('mod', mod.id, mod.name, false)).join('')}</p>
<div class="filter-status" id="item-filter-status"></div>`;

  return layout({
    title: `${section.title} · 物品图鉴`,
    relRoot,
    activeNav: 'home',
    // 首页、分区页(上一层)、本页。
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: section.title, href: `../${section.slug}.html` },
      { text: '物品图鉴' },
    ],
    bodyHtml: `<h1 class="page-title">物品图鉴</h1>
<div class="updated">数据基线 ${esc(data.baseline?.date ?? '')} · ${sectionMods.length} 个模组 · 共 ${total} 件物品</div>
${intro}<div id="section-items">
${filter}
${parts}
</div>
<script src="${relRoot}assets/js/item-filter.js"></script>`,
    aboutNav: model.aboutNav,
  });
}

/**
 * 分区级机制说明页(sections/<slug>/mechanics.html,阶段 5 Task 3):这个分区各个 mod 的机制页,
 * 按 mod 分组,卡片同 mod 页。自动生成,编辑者不用建。比别的页面深一层,地址前缀都是 ../../。
 * @param {object} section { slug, title, file } — file 是分区文件,概述从那里读
 * @param {object[]} mods buildNavSearch 的 mods(主页顺序)
 */
async function renderSectionMechanics(data, model, section, mods) {
  const relRoot = '../../';
  const intro = await sectionIntro(section, 'mechanics_intro', relRoot, model);
  const groups = (mods ?? [])
    .filter((mod) => mod.sections.includes(section.slug))
    .map((mod) => ({ mod, pages: (data.mechanics ?? []).filter((m) => m.mod === mod.id) }))
    .filter(({ pages }) => pages.length > 0);
  const total = groups.reduce((n, { pages }) => n + pages.length, 0);

  return layout({
    title: `${section.title} · 机制说明`,
    relRoot,
    activeNav: 'home',
    // 首页、分区页(上一层)、本页。
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: section.title, href: `../${section.slug}.html` },
      { text: '机制说明' },
    ],
    bodyHtml: `<h1 class="page-title">机制说明</h1>
<div class="updated">数据基线 ${esc(data.baseline?.date ?? '')} · ${groups.length} 个 mod 有机制页 · 共 ${total} 篇</div>
${intro}${groups.length === 0 ? blank('这个分区还没有机制页。') : groups.map(({ mod, pages }) => `<h2 class="sec">${esc(mod.name)}</h2>
${mechanicCards(pages, relRoot, model.lookup)}`).join('\n')}`,
    aboutNav: model.aboutNav,
  });
}

/** dist/nav-search.js:主页搜索的数据,一个赋值语句,和 data.js 一样。 */
function renderNavSearchJs(nav) {
  return `window.NAV_SEARCH = ${JSON.stringify(nav ?? {})};\n`;
}

/**
 * 站点页面(site/<slug>.html,阶段 3 Task 5):不属于任何 mod 的页面,例如「关于本站」。
 * 标题、正文(按 Markdown 渲染,物品内嵌卡可用)。面包屑是「首页、本页」。
 * 声明了 nav_label 的那一页就是顶栏的「关于本站」,它自己高亮这一项;别的站点页面不高亮任何项。
 * @param {{ slug: string, file: string|null }} page
 * @param {{ slug: string, navLabel: string }|null} about 布局里声明了「关于本站」的站点页面
 */
async function renderSitePage(data, model, page, about) {
  const relRoot = '../';
  const raw = page.file == null ? null : await readOptional(page.file);
  const { fm, body } = splitFrontmatter(raw ?? '');
  const title = typeof fm.title === 'string' && fm.title.trim() !== '' ? fm.title.trim() : page.slug;
  const { html } = mdToHtml(body, model.lookup, (it) => itemCard(it, relRoot));
  // 这一页自己声明了顶栏入口 → 高亮它;没声明的站点页面不高亮任何项。
  const ownNav = [].concat(model.aboutNav ?? []).find((nav) => nav.href === `site/${page.slug}.html`);

  return layout({
    title,
    relRoot,
    activeNav: ownNav ? ownNav.key : null,
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: title },
    ],
    bodyHtml: `<h1 class="page-title">${esc(title)}</h1>
${html}`,
    aboutNav: model.aboutNav,
  });
}

const PROV_FIELD_NAMES = {
  id: '物品ID', name: '名称', price: '基础价值', shape: '占格', icon: '贴图',
  categories: '品类', tags: '标签', description: '描述', flavor: '风味文本',
  usage: '用途', sources: '获取途径', related: '相关物品', notes: '备注',
};

function renderItemPage(data, model, item, mdBody) {
  const relRoot = '../';
  const { lookup } = model;
  const card = (it) => itemInline(it, relRoot);

  // 概述:description 段 + notes(接管说明,notice-box)+ 数据来源(provenance)。
  const desc = item.description == null
    ? `<p>${MISSING}</p>`
    : `<p>${inlineOnly(item.description, lookup, relRoot)}</p>`;
  const noteBox = item.notes == null ? '' : `<div class="notice-box">${mdToHtml(item.notes, lookup, card).html}</div>`;
  const provRows = Object.entries(item.provenance ?? {})
    .map(([field, label]) => [esc(PROV_FIELD_NAMES[field] ?? field), esc(label)]);
  const provTable = provRows.length === 0 ? '' : `<h3 class="sub">数据来源</h3>\n${renderWikiTable(['字段', '来源'], provRows)}`;

  // 用途:plan 契约为对象数组 [{type, text, source}],取 text 渲染;
  // 字符串条目(旧形状/手写内容)原样兼容;[[id]] → itemInline。
  const usageLines = (item.usage ?? []).map((u) => {
    const text = typeof u === 'string' ? u : (u?.text ?? u?.description ?? '');
    return `- ${text}`;
  });
  const usageHtml = usageLines.length === 0
    ? `<p>${MISSING}</p>`
    : mdToHtml(usageLines.join('\n'), lookup, card).html;

  // 获取途径:来源/说明/概率;plan 主字段为 {source, detail, probability},
  // 字符串元素(旧形状)进来源列;note/description、chance 作为别名兜底。
  const sourceRows = (item.sources ?? []).map((s) => {
    const obj = typeof s === 'string' ? { source: s } : (s ?? {});
    return [
      inlineOnly(obj.source ?? obj.name ?? obj.id ?? '', lookup, relRoot) || `<i class="missing">待补充</i>`,
      inlineOnly(obj.detail ?? obj.note ?? obj.description ?? '', lookup, relRoot),
      esc(obj.probability ?? obj.chance ?? ''),
    ];
  });
  const sourcesHtml = sourceRows.length === 0
    ? `<p>${MISSING}</p>`
    : renderWikiTable(['来源', '说明', '概率/数量'], sourceRows);

  // 详解:布局里这件物品的词条(content/mods/<modId>/items/<物品ID>.md)正文(存在且非空白时;
  // 只有 frontmatter 的 md 连标题一起跳过——final review Critical 件套之二)。
  const detailHtml = mdBody == null || mdBody.trim() === ''
    ? ''
    : `<h2 class="sec">详解</h2>\n${mdToHtml(mdBody, lookup, card).html}`;

  // 相关物品:related ids → 卡片横排;lookup 未命中的 id 跳过。
  const relatedCards = (item.related ?? [])
    .map((rid) => lookup(rid))
    .filter((it) => it != null)
    .map((it) => itemCard(it, relRoot))
    .join('\n');
  const relatedHtml = relatedCards === '' ? `<p>${MISSING}</p>` : `<div class="item-grid">\n${relatedCards}\n</div>`;

  // 相关页面(阶段 3 Task 3):所属 mod 的导航页,和这个 mod 自己的机制页 — 不再是全站的机制索引。
  const mod = model.modsById.get(item.mod);
  const modName = item.modName ?? item.mod;
  // A hand-written item was taken from no game file: there is no data baseline to cite, so no 「适用于…」 line.
  const fromData = !item.handwritten;
  const updated = fromData
    ? `<div class="updated">适用于 ${esc(modName ?? '')} ${mod?.version == null ? '' : esc(mod.version)}(数据基线 ${esc(data.baseline?.date ?? '')})</div>\n`
    : '';
  const pageLinks = [
    ...(item.mod == null ? [] : [`<li><a href="${relRoot}mods/${esc(item.mod)}.html">${esc(modName)}</a> —— 这个 mod 的导航页</li>`]),
    ...(data.mechanics ?? [])
      .filter((m) => m.mod === item.mod)
      .map((m) => `<li><a href="${relRoot}mechanics/${esc(m.slug)}.html">${esc(m.title ?? m.slug)}</a></li>`),
  ].join('\n');

  const body = `<h1 class="page-title">${item.name == null ? esc(item.id) : esc(item.name)}</h1>
${updated}${infobox(item, relRoot)}
<h2 class="sec">概述</h2>
${desc}
${noteBox}
${provTable}
<h2 class="sec">用途</h2>
${usageHtml}
<h2 class="sec">获取途径</h2>
${sourcesHtml}
${detailHtml}
<h2 class="sec">相关物品</h2>
${relatedHtml}
<h2 class="sec">相关页面</h2>
${pageLinks === '' ? `<p>${MISSING}</p>` : `<ul style="font-size:13.5px">
${pageLinks}
</ul>`}
<div class="clear"></div>`;

  return layout({
    title: item.name == null ? item.id : item.name,
    relRoot,
    activeNav: null, // no top-bar entry is the item pages' own: they are reached through their mod's page
    // 首页、所属 mod、本页。
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      ...(item.mod == null ? [] : [{ text: modName, href: `${relRoot}mods/${esc(item.mod)}.html` }]),
      { text: item.name == null ? item.id : item.name },
    ],
    bodyHtml: body,
    aboutNav: model.aboutNav,
  });
}

/** toc: {id, level, title}[];title 未转义,Ruling 7 要求渲染时转义。 */
function tocHtml(toc) {
  if (!toc || toc.length === 0) return '';
  const items = toc.map((t) => `<li><a href="#${esc(t.id)}">${esc(t.title)}</a></li>`).join('\n');
  return `<div class="toc">
<div class="toc-title">目录</div>
<ol>
${items}
</ol>
</div>`;
}

function renderMechanicPage(data, model, mech, modName = null) {
  const relRoot = '../';
  const { fm, body } = stripTitleBlock(mech.source);
  const title = fm.title ?? mech.title ?? mech.slug;
  const { html, toc } = mdToHtml(body, model.lookup, (it) => itemInline(it, relRoot));

  // 这一页来自哪个文件:布局里的机制页带 mod(mergeMechanicsContent);数据里的条目没有文件。
  const extractedFrom = mech.mod == null
    ? ''
    : ` · 提取自 content/mods/${esc(mech.mod)}/mechanics/${esc(mech.slug)}.md`;

  const page = layout({
    title,
    relRoot,
    activeNav: null, // as the item pages: reached through their mod's page
    // 首页、所属 mod、本页。
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      ...(mech.mod == null ? [] : [{ text: modName ?? mech.mod, href: `${relRoot}mods/${esc(mech.mod)}.html` }]),
      { text: title },
    ],
    bodyHtml: `<h1 class="page-title">${esc(title)}</h1>
<div class="updated">数据基线 ${esc(data.baseline?.date ?? '')}${extractedFrom}</div>
${tocHtml(toc)}
${html}`,
    aboutNav: model.aboutNav,
  });
  return page;
}

const QUIET = 'font-size:13px;color:var(--dk-muted)';

/** A line in the quiet small print: what a block says when there is nothing to list. */
const blank = (text) => `<p style="${QUIET}">${text}</p>`;

/**
 * 机制页的卡片:标题链到机制页,首段做摘要。mod 导航页和分区的机制说明页共用这一段。
 * @param {object[]} pages data.mechanics 里的条目
 * @param {string} relRoot 页面的地址前缀
 * @param {(id: string) => object|null} lookup 物品内嵌卡用
 */
function mechanicCards(pages, relRoot, lookup) {
  return `<div class="mod-cards">
${pages.map((m) => `<div class="mod-card">
<h4><a href="${relRoot}mechanics/${esc(m.slug)}.html">${esc(m.title ?? m.slug)}</a></h4>
<p>${esc(firstParagraphExcerpt(m.source ?? '', lookup))}</p>
</div>`).join('\n')}
</div>`;
}

/**
 * mod 导航页(mods/<id>.html),阶段 3 Task 3。地址不变,内容是这个 mod 自己的:
 * 模组介绍(名字、一行小字、导航页文件的正文)、所属分区、物品图鉴(有数据的加纯手写的)、
 * 机制说明和玩法指南(这个 mod 的机制页,标题加摘要)、更新日志(这个 mod 自己的)。
 * 有导出数据的 mod:版本、作者、前置以数据为准;没有的(纯手写):用导航页文件里写的。
 * @param {{ id: string, exported: object|null }} entry exported 是数据里的 mod,纯手写的是 null
 * @param {{ content: object|null, nav: object }} where content 是内容布局,nav 是主页搜索模型
 */
async function renderModPage(data, model, { id, exported }, { content, nav }) {
  const relRoot = '../';
  const navMod = (nav.mods ?? []).find((m) => m.id === id) ?? { name: id, sections: [] };
  const name = navMod.name || id;

  // 导航页文件的文件头和正文。
  const indexFile = (content?.mods ?? []).find((m) => m.id === id)?.indexFile ?? null;
  const raw = indexFile === null ? null : await readOptional(indexFile);
  const { fm, body } = splitFrontmatter(raw ?? '');
  const said = (value) => (typeof value === 'string' ? value.trim() : '');
  // 数据里有就用数据的,没有才用页面文件里写的。
  const either = (fromData, fromPage) => (fromData == null || fromData === '' ? fromPage : fromData);
  const author = either(exported?.author, said(fm.author));
  const { version, prerequisites } = versionAndPrerequisites(exported, fm);

  const sections = (nav.sections ?? []).filter((section) => navMod.sections.includes(section.slug));
  const modItems = model.items.filter((it) => it.mod === id);
  const modMechanics = (data.mechanics ?? []).filter((m) => m.mod === id);
  const entries = (data.changelog ?? []).filter((c) => c.mod === id);

  const facts = [
    `<code>${esc(id)}</code>`,
    version == null ? null : `版本 ${esc(version)}`,
    author === '' ? null : `作者 ${esc(author)}`,
    prerequisites.length === 0 ? null : `前置 ${prerequisites.map(esc).join('、')}`,
  ].filter(Boolean).join(' · ');

  const bodyHtml = `<h1 class="page-title">${esc(name)}</h1>
<div class="updated">${facts}</div>
${mdToHtml(body, model.lookup, (it) => itemCard(it, relRoot)).html}
<h2 class="sec">所属分区</h2>
${sections.length === 0 ? blank('不属于任何分区。') : `<ul style="font-size:13.5px">
${sections.map((section) => `<li><a href="${relRoot}sections/${esc(section.slug)}.html">${esc(section.title)}</a></li>`).join('\n')}
</ul>`}
<h2 class="sec">物品图鉴(${esc(modItems.length)} 件)</h2>
${modItems.length === 0 ? blank('还没有物品。') : `<div class="item-grid">
${modItems.map((it) => itemCard(it, relRoot)).join('\n')}
</div>`}
<h2 class="sec">机制说明和玩法指南</h2>
${modMechanics.length === 0 ? blank('还没有机制页。') : mechanicCards(modMechanics, relRoot, model.lookup)}
<h2 class="sec">更新日志</h2>
${entries.length === 0 ? blank('还没有更新记录。') : entries.map((c) => `<h3 class="sub">v${esc(c.version)}</h3>
<p style="${QUIET}">${multiLine(c.text ?? '')}</p>`).join('\n')}
<div class="clear"></div>`;

  return layout({
    title: name,
    relRoot,
    activeNav: 'home', // the mod pages are where the home page's navigation leads
    // 首页、mod 名:一个 mod 可以属于几个分区,面包屑里不放分区。
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: name },
    ],
    bodyHtml,
    aboutNav: model.aboutNav,
  });
}

function renderChangelog(data, model) {
  const groups = model.mods
    .map((mod) => ({
      mod,
      entries: (data.changelog ?? []).filter((c) => c.mod === mod.id),
    }))
    .filter((g) => g.entries.length > 0);

  const sections = groups.map(({ mod, entries }) => `<h2 class="sec"><a href="mods/${esc(mod.id)}.html">${esc(model.nameOf(mod.id) ?? mod.id)}</a></h2>
${entries.map((c) => `<h3 class="sub">v${esc(c.version)}</h3>\n<p style="font-size:13px">${multiLine(c.text ?? '')}</p>`).join('\n')}`).join('\n');

  return layout({
    title: '更新日志',
    relRoot: '',
    activeNav: 'changelog',
    breadcrumb: [{ text: '首页', href: 'index.html' }, { text: '更新日志' }],
    bodyHtml: `<h1 class="page-title">更新日志</h1>
<div class="updated">按模组分组的版本记录 · 数据基线 ${esc(data.baseline?.date ?? '')}</div>
${sections === '' ? '<p style="font-size:13px;color:var(--dk-muted)">暂无版本记录。</p>' : sections}`,
    aboutNav: model.aboutNav,
  });
}

function renderSearch(data, model) {
  return layout({
    title: '物品检索器',
    relRoot: '',
    activeNav: 'searchtools',
    breadcrumb: [{ text: '首页', href: 'index.html' }, { text: '物品检索器' }],
    aboutNav: model.aboutNav,
    bodyHtml: `<h1 class="page-title">物品检索器</h1>
<div class="updated">输入关键词即时筛选 · 数据基线 ${esc(data.baseline?.date ?? '')}</div>
<p>支持按物品名称、物品 ID、别名、标签与品类检索,结果卡片可直接跳转物品详情页。筛选逻辑由 <code>assets/js/search.js</code> 提供(基于内联 <code>data.js</code> 数据)。</p>
<input type="search" id="search-input" placeholder="输入物品名称、ID、标签或品类…" style="width:100%;padding:8px 10px;margin:10px 0"/>
<div id="search-results" class="item-grid"></div>
<script src="data.js"></script>
<script src="assets/js/search.js"></script>`,
  });
}

// renderInstallCompat 已删除(final review Important 4):不再有
// mods/install-compat.html 占位骨架。「关于本站」导航项由站点页面自己声明
// (content/site/<文件名>.md 的 frontmatter `nav_label` → sitePagesWithNavLabel
// → aboutNavItem → model.aboutNav,阶段 3 Task 5),
// 目前是 content/site/about.md。

/** 精简客户端数据包:不含 provenance / notes 等内部字段;search 由 Task 9 填充。 */
function renderDataJs(data, model) {
  const payload = {
    generatedAt: data.generatedAt ?? null,
    baseline: data.baseline ?? { date: null, versions: {} },
    mods: (data.mods ?? []).map((m) => ({
      id: m.id, name: model.nameOf(m.id) ?? m.name, version: m.version, author: m.author,
      prerequisites: m.prerequisites ?? [], itemCount: m.itemCount ?? 0,
    })),
    items: model.items.map((it) => ({
      id: it.id,
      aliases: it.aliases ?? [],
      name: it.name,
      mod: it.mod,
      modName: it.modName,
      price: it.price,
      shape: it.shape ?? null,
      icon: it.icon,
      categories: it.categories ?? [],
      tags: it.tags ?? [],
      description: it.description,
      flavor: it.flavor,
      usage: it.usage ?? [],
      sources: it.sources ?? [],
      related: it.related ?? [],
    })),
    mechanics: (data.mechanics ?? []).map((m) => ({ slug: m.slug, title: m.title })),
    news: data.news ?? [],
    changelog: data.changelog ?? [],
    facets: data.facets ?? { categories: [] },
    // Task 9:2-gram 倒排索引(docs + grams;数百 KB 级,远低于体积预算)
    search: buildSearchIndex(model.items, data.mechanics ?? []),
  };
  return `window.WIKI_DATA = ${JSON.stringify(payload)};\n`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function readOptional(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (err) {
    if (err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return null;
    throw err;
  }
}

async function renderSite(data, options = {}) {
  // nav is the home page's search model (tools/build/nav-search.js): without one the home page
  // is still a home page, with nothing to list or to search.
  const layout = options.layout ?? null;
  const nav = options.nav ?? { mods: [], sections: [] };
  // The site page that declares the top nav's about entry: the first in file-name order. The
  // build entry refuses more than one long before it gets here.
  const about = await sitePagesWithNavLabel(layout);
  const model = buildSiteModel(data, nav, about);
  // A mod's name for a page that belongs to it: the one the search model shows (see buildSiteModel).
  const modNameOf = (id) => model.nameOf(id);
  const out = new Map();

  out.set('index.html', await renderHomePage(data, model, layout, nav));
  out.set('changelog.html', renderChangelog(data, model));
  out.set('search.html', renderSearch(data, model));
  out.set('data.js', renderDataJs(data, model));

  // Every mod with a page: the exported ones, then the hand-written ones — a folder and a page
  // file of their own, no data yet.
  for (const mod of model.mods) {
    out.set(`mods/${mod.id}.html`, await renderModPage(data, model, { id: mod.id, exported: mod }, { content: layout, nav }));
  }
  for (const mod of nav.mods ?? []) {
    if (model.modsById.has(mod.id)) continue;
    out.set(`mods/${mod.id}.html`, await renderModPage(data, model, { id: mod.id, exported: null }, { content: layout, nav }));
  }

  for (const mech of data.mechanics ?? []) {
    out.set(`mechanics/${mech.slug}.html`, renderMechanicPage(data, model, mech, modNameOf(mech.mod)));
  }

  // One page per section, in the home page's order; its file is where the layout says it is.
  for (const section of nav.sections ?? []) {
    const file = (layout?.sections ?? []).find((page) => page.slug === section.slug)?.file ?? null;
    const ofTree = { ...section, file }; // 分区文件在这棵内容树里;可以没有
    out.set(`sections/${section.slug}.html`, await renderSectionPage(data, model, ofTree, nav.mods ?? [], layout));
    // 阶段 5:每个分区自己的物品图鉴页和机制说明页,比分区页深一层。
    out.set(`sections/${section.slug}/items.html`, await renderSectionItems(data, model, ofTree, nav.mods ?? []));
    out.set(`sections/${section.slug}/mechanics.html`, await renderSectionMechanics(data, model, ofTree, nav.mods ?? []));
  }
  out.set('nav-search.js', renderNavSearchJs(nav));

  // One page per site page — 关于本站 among them.
  for (const page of layout?.site ?? []) {
    out.set(`site/${page.slug}.html`, await renderSitePage(data, model, page, about));
  }

  // Every item entry of every mod, by the item it names. A file name that
  // differs from the id by case only names its item too (resolveItemId) —
  // the same rule the content lint and the supplement merge go by. Two
  // entries for one item are refused by the lint; the first one is read.
  const entryOf = new Map();
  const itemIds = model.items.map((it) => it.id);
  for (const mod of layout?.mods ?? []) {
    for (const entry of mod.items) {
      const realId = resolveItemId(entry.id, itemIds);
      if (realId !== null && !entryOf.has(realId)) entryOf.set(realId, entry.file);
    }
  }

  for (const item of model.items) {
    let mdBody = null;
    const file = entryOf.get(item.id);
    if (file !== undefined) {
      const raw = await readOptional(file);
      if (raw != null) mdBody = splitFrontmatter(raw).body;
    }
    out.set(`item/${item.id}.html`, renderItemPage(data, model, item, mdBody));
  }

  return out;
}

module.exports = { renderSite, renderNavSearchJs, firstParagraphExcerpt, modOverview };
