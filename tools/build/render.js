'use strict';

// Task 8: page renderers + inline data.js — assembles the whole static site
// from Task 5's WIKI_DATA, Task 6's mdToHtml and Task 7's templates.
//
// renderSite(data, { layout = null }) -> Promise<Map<relPath, string>>
//   relPath keys are posix-style ('item/<id>.html'); values are full HTML
//   documents (or the data.js script). fs.mkdir/write is left to the Task 10
//   build entry. layout is the content layout (tools/build/content-layout.js)
//   and supplies the optional per-item 详解 body
//   (content/mods/<modId>/items/<物品ID>.md); null skips the section entirely.
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
  layout, infobox, itemCard, itemInline, renderWikiTable, aboutNavItem,
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

function buildSiteModel(data) {
  const mods = data.mods ?? [];
  const modsById = new Map(mods.map((m) => [m.id, m]));
  const items = (data.items ?? []).map((it) => ({
    ...it,
    modName: modsById.get(it.mod)?.name ?? null,
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

/** 热门物品(确定性规则):price 非 null 的物品按 price 降序、同价 id 升序,取前 10。 */
function popularItems(items, limit = 10) {
  return items
    .filter((it) => it.price != null)
    .sort((a, b) => (b.price - a.price) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
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

function renderIndex(data, model) {
  const { mods, items } = model;
  const modCards = mods.map((mod) => {
    const prereq = (mod.prerequisites ?? []).length === 0
      ? '无前置'
      : `前置 ${esc(mod.prerequisites.join('、'))}`;
    const version = validVersion(mod.version);
    return `<div class="mod-card">
<h4><a href="mods/${esc(mod.id)}.html">${mod.name == null ? MISSING : esc(mod.name)}</a><span class="ver">${esc(mod.id)}${version == null ? '' : ` · ${esc(version)}`}</span></h4>
<p>${mod.description == null ? '' : esc(truncate(modOverview(mod.description), 90))}</p>
<div class="meta">${esc(mod.itemCount ?? 0)} 件物品 · ${prereq}</div>
</div>`;
  }).join('\n');

  const hotWall = popularItems(items).map((it) => itemCard(it, '')).join('\n');

  const newsItems = (data.news ?? []).length > 0
    ? (data.news ?? []).map((n) => {
      const obj = typeof n === 'string' ? { date: '', text: n } : n;
      const d = obj.date ?? obj.d ?? '';
      const text = obj.text ?? obj.title ?? obj.content ?? '';
      return `<li>${d === '' ? '' : `<span class="d">${esc(d)}</span>`}${esc(text)}</li>`;
    }).join('\n')
    : `<li>数据基线 ${esc(data.baseline?.date ?? '')}</li>`;

  const quickLinks = (data.mechanics ?? []).slice(0, 3).map((m) =>
    `<a class="item-card" href="mechanics/${esc(m.slug)}.html" style="width:88px"><span class="nm">${esc(m.title)}</span></a>`).join('\n');

  const stats = `<table class="stat-table">
<tr><td>物品条目</td><td>${esc(items.length)}</td></tr>
<tr><td>机制/玩法页面</td><td>${esc((data.mechanics ?? []).length)}</td></tr>
<tr><td>模组条目</td><td>${esc(mods.length)}</td></tr>
<tr><td>数据基线日期</td><td>${esc(data.baseline?.date ?? '')}</td></tr>
</table>`;

  const body = `<div class="home-cols">
<div class="home-main">
<h1 class="page-title">欢迎来到淫色深空 Wiki</h1>
<p>本站收录 <b>lewd_meme 系模组家族</b> 的全部物品图鉴、机制原理与玩法指南。数据直接提取自模组安装文件(物品定义、本地化文本、贴图),与游戏内表现一致。</p>
<h2 class="sec">模组家族</h2>
<div class="mod-cards" id="mod-family">
${modCards}
</div>
<h2 class="sec">热门物品</h2>
<div class="item-grid">
${hotWall}
</div>
<p style="font-size:12px"><a href="items.html">→ 查看全部物品图鉴</a> · 或使用<a href="search.html">物品检索器</a>按分类、来源、价格筛选</p>
</div>
<div class="home-side">
<h2 class="sec" style="margin-top:4px">站点统计</h2>
${stats}
<h2 class="sec">最近更新</h2>
<ul class="news-list">
${newsItems}
</ul>${quickLinks === '' ? '' : `
<h2 class="sec">快捷入口</h2>
<div class="item-grid" style="gap:8px">
${quickLinks}
</div>`}
</div>
</div>`;

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

  const mechLinks = (data.mechanics ?? [])
    .map((m) => `<li><a href="${relRoot}mechanics/${esc(m.slug)}.html">${esc(m.title)}</a></li>`)
    .join('\n');

  const mod = model.modsById.get(item.mod);
  const updated = `适用于 ${mod?.name == null ? esc(item.mod ?? '') : esc(mod.name)} ${mod?.version == null ? '' : esc(mod.version)}(数据基线 ${esc(data.baseline?.date ?? '')})`;

  const body = `<h1 class="page-title">${item.name == null ? esc(item.id) : esc(item.name)}</h1>
<div class="updated">${updated}</div>
${infobox(item, relRoot)}
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
<ul style="font-size:13.5px">
<li><a href="${relRoot}mechanics.html">全部机制索引</a> —— 机制说明与玩法指南</li>
${mechLinks}
</ul>
<div class="clear"></div>`;

  return layout({
    title: item.name == null ? item.id : item.name,
    relRoot,
    activeNav: 'items',
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: '物品图鉴', href: `${relRoot}items.html` },
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

function renderMechanicPage(data, model, mech) {
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
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: '机制说明', href: `${relRoot}mechanics.html` },
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

function renderModPage(data, model, mod) {
  const relRoot = '../';
  const { lookup } = model;
  const modItems = model.items.filter((it) => it.mod === mod.id);
  const prereq = (mod.prerequisites ?? []).length === 0 ? '无前置' : mod.prerequisites.join('、');

  const version = validVersion(mod.version);

  const infoRows = [
    ['名称', mod.name == null ? MISSING : esc(mod.name)],
    ['模组 ID', `<code>${esc(mod.id)}</code>`],
    ['版本', mod.version == null ? MISSING : esc(mod.version)],
    ['作者', mod.author == null || mod.author === '' ? MISSING : esc(mod.author)],
    ['前置', esc(prereq)],
    ['概述', mod.description == null ? MISSING : multiLine(modOverview(mod.description))],
  ];

  const grid = modItems.length === 0
    ? '<p style="font-size:13px;color:var(--dk-muted)">该模组暂无物品条目。</p>'
    : `<div class="item-grid">\n${modItems.map((it) => itemCard(it, relRoot)).join('\n')}\n</div>`;

  const entries = (data.changelog ?? []).filter((c) => c.mod === mod.id);
  const changelogHtml = entries.length === 0 ? '' : `<h2 class="sec">更新日志节选</h2>
${entries.map((c) => `<h3 class="sub">v${esc(c.version)}</h3>\n<p style="font-size:13px">${multiLine(c.text ?? '')}</p>`).join('\n')}`;

  return layout({
    title: mod.name == null ? mod.id : mod.name,
    relRoot,
    activeNav: 'mods',
    breadcrumb: [
      { text: '首页', href: `${relRoot}index.html` },
      { text: '模组介绍', href: `${relRoot}index.html#mod-family` },
      { text: mod.name == null ? mod.id : mod.name },
    ],
    bodyHtml: `<h1 class="page-title">${mod.name == null ? esc(mod.id) : esc(mod.name)}</h1>
<div class="updated">${version == null ? '' : `版本 ${esc(version)} · `}数据基线 ${esc(data.baseline?.date ?? '')}</div>
<h2 class="sec">模组信息</h2>
${renderWikiTable(['项目', '内容'], infoRows)}
<h2 class="sec">物品清单(${esc(modItems.length)} 件)</h2>
${grid}
${changelogHtml}`,
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
  const layout = options.layout ?? null;
  const model = buildSiteModel(data);
  const out = new Map();

  out.set('index.html', renderIndex(data, model));
  out.set('items.html', renderItems(data, model));
  out.set('mechanics.html', renderMechanicsIndex(data, model));
  out.set('changelog.html', renderChangelog(data, model));
  out.set('search.html', renderSearch(data, model));
  out.set('data.js', renderDataJs(data, model));

  for (const mod of model.mods) {
    out.set(`mods/${mod.id}.html`, renderModPage(data, model, mod));
  }

  for (const mech of data.mechanics ?? []) {
    out.set(`mechanics/${mech.slug}.html`, renderMechanicPage(data, model, mech));
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

module.exports = { renderSite, firstParagraphExcerpt };
