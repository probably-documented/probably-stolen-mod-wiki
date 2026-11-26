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

const { mdToHtml, restoreItemLinks } = require('./markdown.js');
const { buildSearchIndex } = require('./search-index.js');
const { mechanicsWithNavLabel } = require('./mechanics.js');
const { resolveItemId } = require('./item-ids.js');
const { splitFrontmatter } = require('../extract/frontmatter.js');
const {
  layout, infobox, itemCard, itemInline, renderWikiTable, aboutNavItem, homeSearchRow, sectionBlock, modBar,
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

function buildSiteModel(data, nav = null) {
  const mods = data.mods ?? [];
  const modsById = new Map(mods.map((m) => [m.id, m]));
  // A hand-written mod's name lives in its page file; the search model (nav) carries it.
  const navNames = new Map((nav?.mods ?? []).map((m) => [m.id, m.name]));
  const items = (data.items ?? []).map((it) => ({
    ...it,
    modName: modsById.get(it.mod)?.name ?? navNames.get(it.mod) ?? null,
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
  // 顶部导航的「关于本站」由页面自己声明:机制页的 navLabel(mergeMechanicsContent
  // 读自 content/mods/<modId>/mechanics/<slug>.md 的 frontmatter `nav_label`,task 5b A)。
  // 「navLabel 是否已设置」只问 mechanics.js 一处(mechanicsWithNavLabel,
  // task 6b D1):这里不再自己判定。没有页面声明 → null → 导航没有这一项;
  // 构建入口保证最多一页带它。
  const [aboutPage] = mechanicsWithNavLabel(data.mechanics ?? []);
  const aboutNav = aboutPage == null ? null : aboutNavItem(aboutPage.navLabel.trim(), aboutPage.slug);
  return { mods, modsById, items, lookup, aboutNav };
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

/** 一个分区在主页顺序下的 mod 条;NO_SECTION 时是不属于任何分区的 mod。 */
function navBars(mods, slug, hrefOf) {
  return mods
    .filter((mod) => (slug === NO_SECTION ? mod.sections.length === 0 : mod.sections.includes(slug)))
    .map((mod) => modBar(mod.name, hrefOf(mod.id), mod.id));
}

/**
 * 主站导航页(index.html),阶段 3。从上到下:搜索栏和「限定范围」;每个分区一个可折叠的方框,
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

  let intro = '';
  const raw = content?.home == null ? null : await readOptional(content.home);
  if (raw != null) intro = mdToHtml(splitFrontmatter(raw).body, model.lookup, (it) => itemCard(it, '')).html;

  const entries = [
    ['离线包下载', RELEASES_URL],
    ...(model.aboutNav == null ? [] : [[model.aboutNav.label, model.aboutNav.href]]),
    ['更新日志', 'changelog.html'],
  ].map(([label, href]) => `<a href="${esc(href)}">${esc(label)}</a>`).join('');

  const body = `${homeSearchRow(sections)}
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
 * 分区导航页(sections/<slug>.html):标题、介绍正文(按 Markdown 渲染,物品内嵌卡可用)、
 * 本分区的 mod 条,样式同主页。这一页只有它自己,所以方框不折叠,也不搜索。
 * @param {object} section { slug, title, intro, order, file } — file 是分区文件,可以没有
 * @param {object[]} mods buildNavSearch 的 mods(主页顺序)
 */
async function renderSectionPage(data, model, section, mods) {
  const relRoot = '../';
  const raw = section.file == null ? null : await readOptional(section.file);
  const { body } = splitFrontmatter(raw ?? '');
  const { html } = mdToHtml(body, model.lookup, (it) => itemCard(it, relRoot));

  return layout({
    title: section.title,
    relRoot,
    activeNav: 'home',
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: section.title },
    ],
    bodyHtml: `<h1 class="page-title">${esc(section.title)}</h1>
${html}
${sectionBlock(section, navBars(mods, section.slug, (id) => `${relRoot}mods/${id}.html`), { relRoot, linked: false, collapsible: false })}`,
    aboutNav: model.aboutNav,
  });
}

/** dist/nav-search.js:主页搜索的数据,一个赋值语句,和 data.js 一样。 */
function renderNavSearchJs(nav) {
  return `window.NAV_SEARCH = ${JSON.stringify(nav ?? {})};\n`;
}

function renderItems(data, model) {
  const { mods, items } = model;

  const catChips = ['<span class="item-inline" style="border-color:var(--dk-accent);color:var(--dk-accent)" data-category="">全部</span>']
    .concat((data.facets?.categories ?? []).map((c) => `<span class="item-inline" data-category="${esc(c)}">${esc(c)}</span>`))
    .join('');
  const modChips = ['<span class="item-inline" style="border-color:var(--dk-accent);color:var(--dk-accent)" data-mod="">全部模组</span>']
    .concat(mods.map((m) => `<span class="item-inline" data-mod="${esc(m.id)}">${m.name == null ? esc(m.id) : esc(m.name)}</span>`))
    .join('');

  const sections = mods.map((mod) => {
    const modItems = items.filter((it) => it.mod === mod.id);
    const name = mod.name == null ? esc(mod.id) : esc(mod.name);
    const version = validVersion(mod.version);
    const overview = mod.description == null ? '' : `<p style="font-size:13px;color:var(--dk-muted)"><b>${esc(truncate(modOverview(mod.description), 120))}</b></p>`;
    const grid = modItems.length === 0
      ? '<p style="font-size:13px;color:var(--dk-muted)">该模组暂无物品条目。</p>'
      : `<div class="item-grid">\n${modItems.map((it) => itemCard(it, '')).join('\n')}\n</div>`;
    return `<section data-mod="${esc(mod.id)}">
<h2 class="sec">${name}${version == null ? '' : `(${esc(version)})`}</h2>
${overview}
${grid}
</section>`;
  }).join('\n');

  const body = `<h1 class="page-title">物品图鉴</h1>
<div class="updated">本页数据基线:${esc(data.baseline?.date ?? '')} · 覆盖 ${esc(mods.length)} 个模组 · 共 ${esc(items.length)} 件物品</div>
<h2 class="sec">概述</h2>
<p>物品是模组内容的基本载体。每件物品具有数个基本属性:<b>名称、所属模组、品类、基础价值、占格尺寸(宽×高)、标签、描述</b> 等。</p>
<ul style="font-size:13px">
<li><b>品类</b>:决定顾客是否收购——顾客有偏好与拒收品类清单。</li>
<li><b>基础价值</b>:交易基准价,实际成交价受声望、管制、疲劳估值等修正。</li>
<li><b>标签</b>:价格修正项与机制触发条件,如「触手侵蚀」标记可被侵蚀性触手转化的物品。</li>
<li><b>占格尺寸</b>:背包与货架内的占用格数(宽×高)。</li>
</ul>
<h2 class="sec">筛选</h2>
<p style="font-size:13px">品类:${catChips}</p>
<p style="font-size:13px">来源:${modChips}</p>
<div id="item-filter-status" style="font-size:12px;color:var(--dk-muted)"></div>
${sections}
<script src="assets/js/item-filter.js"></script>`;

  return layout({
    title: '物品图鉴',
    relRoot: '',
    activeNav: 'items',
    breadcrumb: [{ text: '首页', href: 'index.html' }, { text: '物品图鉴' }],
    bodyHtml: body,
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
    activeNav: 'items',
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
    activeNav: 'mechanics',
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

function renderMechanicsIndex(data, model) {
  const cards = (data.mechanics ?? []).map((m) => `<div class="mod-card">
<h4><a href="mechanics/${esc(m.slug)}.html">${esc(m.title ?? m.slug)}</a></h4>
<p>${esc(firstParagraphExcerpt(m.source ?? '', model.lookup))}</p>
</div>`).join('\n');
  const cardsHtml = cards === ''
    ? '<p style="font-size:13px;color:var(--dk-muted)">机制条目待补充。</p>'
    : `<div class="mod-cards">
${cards}
</div>`;

  return layout({
    title: '机制说明',
    relRoot: '',
    activeNav: 'mechanics',
    breadcrumb: [{ text: '首页', href: 'index.html' }, { text: '机制说明' }],
    bodyHtml: `<h1 class="page-title">机制说明</h1>
<div class="updated">全部机制与玩法指南索引 · 数据基线 ${esc(data.baseline?.date ?? '')}</div>
${cardsHtml}`,
    aboutNav: model.aboutNav,
  });
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
  const quiet = 'font-size:13px;color:var(--dk-muted)';
  const blank = (text) => `<p style="${quiet}">${text}</p>`;
  const navMod = (nav.mods ?? []).find((m) => m.id === id) ?? { name: id, sections: [] };
  const name = navMod.name || id;

  // 导航页文件的文件头和正文。
  const indexFile = (content?.mods ?? []).find((m) => m.id === id)?.indexFile ?? null;
  const raw = indexFile === null ? null : await readOptional(indexFile);
  const { fm, body } = splitFrontmatter(raw ?? '');
  const said = (value) => (typeof value === 'string' ? value.trim() : '');
  // 数据里有就用数据的,没有才用页面文件里写的。
  const either = (fromData, fromPage) => (fromData == null || fromData === '' ? fromPage : fromData);
  const version = validVersion(either(validVersion(exported?.version), said(fm.version)));
  const author = either(exported?.author, said(fm.author));
  const prerequisites = (exported?.prerequisites ?? []).length > 0
    ? exported.prerequisites.map(String)
    : (Array.isArray(fm.prerequisites) ? fm.prerequisites.map(String) : []);

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
${modMechanics.length === 0 ? blank('还没有机制页。') : `<div class="mod-cards">
${modMechanics.map((m) => `<div class="mod-card">
<h4><a href="${relRoot}mechanics/${esc(m.slug)}.html">${esc(m.title ?? m.slug)}</a></h4>
<p>${esc(firstParagraphExcerpt(m.source ?? '', model.lookup))}</p>
</div>`).join('\n')}
</div>`}
<h2 class="sec">更新日志</h2>
${entries.length === 0 ? blank('还没有更新记录。') : entries.map((c) => `<h3 class="sub">v${esc(c.version)}</h3>
<p style="${quiet}">${multiLine(c.text ?? '')}</p>`).join('\n')}
<div class="clear"></div>`;

  return layout({
    title: name,
    relRoot,
    activeNav: 'mods',
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

  const sections = groups.map(({ mod, entries }) => `<h2 class="sec"><a href="mods/${esc(mod.id)}.html">${mod.name == null ? esc(mod.id) : esc(mod.name)}</a></h2>
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
// mods/install-compat.html 占位骨架。「关于本站」导航项由机制页自己声明
// (frontmatter `nav_label` → navLabel → model.aboutNav,task 5b A),
// 目前是 content/mods/lewd_meme/mechanics/install-compat.md。

/** 精简客户端数据包:不含 provenance / notes 等内部字段;search 由 Task 9 填充。 */
function renderDataJs(data, model) {
  const payload = {
    generatedAt: data.generatedAt ?? null,
    baseline: data.baseline ?? { date: null, versions: {} },
    mods: (data.mods ?? []).map((m) => ({
      id: m.id, name: m.name, version: m.version, author: m.author,
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
  const model = buildSiteModel(data, nav);
  // A mod's name for a page that belongs to it: the data's, or — for a hand-written mod — the search model's.
  const modNameOf = (id) => model.modsById.get(id)?.name ?? (nav.mods ?? []).find((m) => m.id === id)?.name ?? null;
  const out = new Map();

  out.set('index.html', await renderHomePage(data, model, layout, nav));
  out.set('items.html', renderItems(data, model));
  out.set('mechanics.html', renderMechanicsIndex(data, model));
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
    out.set(`sections/${section.slug}.html`, await renderSectionPage(data, model, { ...section, file }, nav.mods ?? []));
  }
  out.set('nav-search.js', renderNavSearchJs(nav));

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
