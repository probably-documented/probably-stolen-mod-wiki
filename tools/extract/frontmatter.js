'use strict';

// Shared frontmatter parser (final review Critical fix).
//
// 两个消费方曾各自实现、方言分叉:
//   - extract/merge.js parseFrontmatter:宽容(无闭合 --- 时扫到 EOF),
//     但只返回 fm,不切 body;
//   - build/render.js splitFrontmatter:要求闭合 ---\n,否则整个文件当正文
//     → T13 的 59 个 content/items/*.md(无闭合 ---)在物品页「详解」节
//     泄漏原始 frontmatter JSON。
//
// 本模块是唯一实现:两种方言都接受——
//   闭合:  ---\nkey: v\n---\n<body>          (mechanics/*.md、测试 fixture)
//   无闭合: ---\nkey: v\n\n<body>            (content/items/*.md 真实方言:
//          首个空行结束 frontmatter;若到 EOF 都没有空行则 body 为空)
// 放在 tools/extract/ 层:build 已依赖 extract(build.js require merge.js),
// 依赖方向保持 build → extract,不引入倒依赖。

/** Scalar frontmatter value: quoted strings unquoted, JSON arrays/objects parsed. */
function parseFrontmatterScalar(raw) {
  if (raw === '') return '';
  if (
    (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) ||
    (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2)
  ) {
    return raw.slice(1, -1);
  }
  if (raw[0] === '[' || raw[0] === '{') {
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // not valid JSON: keep verbatim
    }
  }
  return raw;
}

const KV_LINE_RE = /^([A-Za-z][\w-]*)\s*:\s?(.*)$/;

/** frontmatter 行 → data(kv 之外的行跳过,空行不可能是 kv)。 */
function parseKvLines(lines) {
  const data = {};
  for (const line of lines) {
    const match = line.match(KV_LINE_RE);
    if (match === null) continue;
    data[match[1]] = parseFrontmatterScalar(match[2].trim());
  }
  return data;
}

/**
 * Split the leading `---` frontmatter block of a markdown file.
 * @param {string} mdText
 * @returns {{ fm: Record<string, unknown>, body: string }}
 *   非 `---` 开头的文件:{ fm: {}, body: 原文 }。
 */
function splitFrontmatter(mdText) {
  const text = String(mdText ?? '');
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { fm: {}, body: text };
  }
  // 优先闭合方言:任何位置出现单独 `---` 都视为块结束(与旧 merge 语义
  // 一致,闭合块内允许空行);否则无闭合方言:首个空行结束 frontmatter。
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { closeIdx = i; break; }
    if (lines[i].trim() === '') break;
  }
  if (closeIdx >= 1) {
    return { fm: parseKvLines(lines.slice(1, closeIdx)), body: lines.slice(closeIdx + 1).join('\n') };
  }
  // 无闭合:收集到首个空行(或 EOF)
  const fmLines = [];
  let end = lines.length; // EOF:没有空行 → 整段是 frontmatter,body 为空
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') { end = i; break; }
    fmLines.push(lines[i]);
  }
  if (end === lines.length) return { fm: parseKvLines(fmLines), body: '' };
  return { fm: parseKvLines(fmLines), body: lines.slice(end + 1).join('\n') };
}

/**
 * Parse the leading `---` frontmatter block of a markdown file (data only).
 * @param {string} mdText
 * @returns {Record<string, string | number | boolean | unknown[] | object>}
 */
function parseFrontmatter(mdText) {
  return splitFrontmatter(mdText).fm;
}

module.exports = { parseFrontmatter, splitFrontmatter, parseFrontmatterScalar };
