'use strict';

// 主页搜索的数据（阶段 3 Task 1）。
//
// 主页把每个 mod 放在它所属的分区下面，可以按名称、ID、简介和 redirects.yaml 里的别名、关键词搜索。
// 这里把三个来源合成一个模型（{ mods, sections }）；构建把它交给 render.js，由它写成一个很小的
// 脚本 nav-search.js。搜索在浏览器里做，不发请求：站点上和离线包里是同一套。
//
//   mods      全局顺序：有导出数据的照数据的顺序，没有数据的排在后面、按标题。
//             名称三级回退：数据里的 name → 导航页文件的 title → 目录名。
//   sections  有 order 的按升序在前，没填的排在后面，都按标题；order 不是数字就当没填。

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');
const { modOverview, firstParagraphExcerpt } = require('./render.js');

const defaultReadFile = (file) => fs.readFile(file, 'utf8');

/** 比较两个标题：中文按拼音，英文按字母。 */
const byTitle = (a, b) => a.localeCompare(b, 'zh-Hans-CN');

/** 一个去掉首尾空白的字符串；不是字符串就是 ''。 */
const textOf = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * redirects.yaml 是纯 YAML：只认顶层的 `aliases:`、`keywords:` 和它们下面缩进的 `- 项`，
 * 或者写在同一行的 `[a, b]`。别的键一律不碰。带引号的项去掉引号。
 * @param {string|null} text
 * @returns {{ aliases: string[], keywords: string[] }}
 */
function parseRedirectsYaml(text) {
  const out = { aliases: [], keywords: [] };
  let current = null;
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const top = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(raw);
    if (top !== null && !/^\s/.test(raw)) {
      current = top[1] === 'aliases' || top[1] === 'keywords' ? top[1] : null;
      if (current !== null && top[2].trim() !== '') out[current].push(...flowList(top[2]));
      continue;
    }
    const item = /^[ \t]+-[ \t]*(.*)$/.exec(raw);
    if (item !== null && current !== null && unquote(item[1]) !== '') out[current].push(unquote(item[1]));
  }
  return out;
}

/** 同一行的 `[a, b]`：方括号可有可无，逗号分隔，引号里的逗号不算。 */
function flowList(text) {
  const inner = text.trim().replace(/^\[|\]$/g, '');
  if (inner.trim() === '') return [];
  return inner.match(/'[^']*'|"[^"]*"|[^,]+/g).map((part) => unquote(part)).filter((part) => part !== '');
}

/** 去掉一层引号：'…'（里面的 '' 是一个 '）或 "…"。 */
function unquote(raw) {
  const text = raw.trim();
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  return text;
}

/**
 * 每个 mod 的重定向，键是 mod 的目录名。没有 redirects.yaml 的 mod 不在结果里；
 * 文件是空的在结果里，两组都是空。
 * @param {object|null} layout readContentLayout 的结果
 * @param {(file: string) => Promise<string>} [readFile]
 * @returns {Promise<Map<string, { aliases: string[], keywords: string[] }>>}
 */
async function readRedirects(layout, readFile = defaultReadFile) {
  const redirects = new Map();
  for (const mod of layout?.mods ?? []) {
    if (mod.redirectsFile === null) continue;
    redirects.set(mod.id, parseRedirectsYaml(await readFile(mod.redirectsFile)));
  }
  return redirects;
}

/**
 * 主页要的模型。
 * @param {object} args
 * @param {object|null} args.data 载入的站点数据（mods 的顺序就是全局 mod 顺序）
 * @param {object|null} args.layout readContentLayout 的结果
 * @param {Map<string, { aliases: string[], keywords: string[] }>|null} args.redirects readRedirects 的结果
 * @param {(file: string) => Promise<string>} [args.readFile]
 * @returns {Promise<{ mods: Array<{ id: string, name: string, summary: string, aliases: string[], keywords: string[], sections: string[] }>,
 *   sections: Array<{ slug: string, title: string, intro: string, order: number|null }> }>}
 */
async function buildNavSearch({ data, layout, redirects, readFile = defaultReadFile }) {
  // 分区：标题、第一段摘要、顺序，以及每个 mod 出现在哪些分区里。
  const sections = [];
  for (const section of layout?.sections ?? []) {
    const source = await readFile(section.file);
    const { fm } = splitFrontmatter(source);
    sections.push({
      slug: section.slug,
      title: textOf(fm.title) || section.slug,
      intro: firstParagraphExcerpt(source, () => null),
      order: typeof fm.order === 'number' && Number.isFinite(fm.order) ? fm.order : null,
      mods: Array.isArray(fm.mods) ? fm.mods.map(String) : [],
    });
  }
  sections.sort((a, b) => {
    if (a.order === null || b.order === null) {
      if (a.order !== b.order) return a.order === null ? 1 : -1;
    } else if (a.order !== b.order) {
      return a.order - b.order;
    }
    return byTitle(a.title, b.title);
  });
  const sectionsOf = new Map(); // mod 的目录名 → 它出现的分区，照分区的顺序
  for (const section of sections) {
    for (const id of section.mods) {
      if (!sectionsOf.has(id)) sectionsOf.set(id, []);
      sectionsOf.get(id).push(section.slug);
    }
  }

  // mod：有导出数据的照数据的顺序；其余的排在后面、按标题。
  // 名称三级回退：数据里的 name → 导航页文件的 title → 目录名。
  const exported = new Map((data?.mods ?? []).map((mod) => [mod.id, mod]));
  const pageTitle = new Map(); // mod 的目录名 → 导航页文件的 title（没有文件或没写就是 ''）
  const handWritten = [];
  for (const mod of layout?.mods ?? []) {
    const title = mod.indexFile === null ? '' : textOf(splitFrontmatter(await readFile(mod.indexFile)).fm.title);
    pageTitle.set(mod.id, title);
    if (!exported.has(mod.id)) handWritten.push({ id: mod.id, name: title || mod.id });
  }
  handWritten.sort((a, b) => byTitle(a.name, b.name));
  const ordered = [
    ...(data?.mods ?? []).map((mod) => ({ id: mod.id, exported: mod })),
    ...handWritten.map((mod) => ({ id: mod.id, exported: null })),
  ];

  const mods = ordered.map(({ id, exported: exportedMod }) => {
    const own = redirects?.get(id);
    return {
      id,
      name: textOf(exportedMod?.name) || pageTitle.get(id) || id,
      summary: exportedMod === null ? '' : modOverview(exportedMod.description),
      aliases: own === undefined ? [] : [...own.aliases],
      keywords: own === undefined ? [] : [...own.keywords],
      sections: sectionsOf.get(id) ?? [],
    };
  });
  return { mods, sections: sections.map(({ mods: _listed, ...section }) => section) };
}

module.exports = { parseRedirectsYaml, readRedirects, buildNavSearch };
