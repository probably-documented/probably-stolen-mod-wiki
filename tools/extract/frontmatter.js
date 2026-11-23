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
// Task 3 起另接受 CMS 原生 YAML 子集(Sveltia 序列化风格):
//   key: 后随缩进 `- item` 的多行标量列表、裸 true/false/数字标量、
//   flow 列表 [a, b];旧单行 JSON 方言不变。零 npm 依赖,手写行式解析。
// 放在 tools/extract/ 层:build 已依赖 extract(build.js require merge.js),
// 依赖方向保持 build → extract,不引入倒依赖。

/**
 * YAML 双引号字符串(已去首尾引号)里的 `\"` 与 `\\`。必须一次扫描:
 * `\\"` 是「反斜杠 + 引号」,先替换 `\"` 再替换 `\\` 会把它解错。
 * 其它转义序列(`\n`、`\t`、`\uXXXX` …)不在本解析器的子集里,原样保留。
 */
function unescapeDoubleQuoted(inner) {
  let out = '';
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    const next = inner[i + 1];
    if (ch === '\\' && (next === '"' || next === '\\')) {
      out += next;
      i += 1;
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Scalar frontmatter value.
 *
 * 旧方言(Task 2 迁移):去引号字符串、单行 JSON 数组/对象。
 * 新方言(Task 3,CMS 原生 YAML 子集):裸 true/false 布尔、数字、
 * flow 列表 `[a, b]`(JSON.parse 失败后的宽容解析)。
 * 引号字符串的转义(task 6 Ruling W):单引号内的 `''` 还原为 `'`;
 * 双引号内的 `\"` 还原为 `"`、`\\` 还原为 `\`——Sveltia CMS 保存条目时
 * 用 yaml 库写出的就是这两种形态。
 * 明确不实现(超集,遇到保持原样/跳过,不抛错):
 * 列表对象项、多级嵌套。
 */
function parseFrontmatterScalar(raw) {
  if (raw === '') return '';
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return unescapeDoubleQuoted(raw.slice(1, -1));
  }
  if (raw[0] === '[' || raw[0] === '{') {
    try {
      return JSON.parse(raw);
    } catch {
      // not valid JSON: [...] 落入 flow 列表(项为裸标量),{...} 原样保留
      return raw[0] === '[' ? parseFlowList(raw) : raw;
    }
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (YAML_NUMBER_RE.test(raw)) return Number(raw);
  return raw;
}

// YAML 数字子集:整数/小数/负数;前导零(如 "007")按 YAML 1.2 视为字符串
const YAML_NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** flow 列表 `[a, b]`:逗号切分,每项按标量解析(子集,不支持嵌套 flow)。 */
function parseFlowList(raw) {
  const inner = raw.slice(1, -1).trim();
  if (inner === '') return [];
  return inner.split(',').map((part) => parseFrontmatterScalar(part.trim()));
}

const KV_LINE_RE = /^([A-Za-z][\w-]*)\s*:\s?(.*)$/;
const LIST_ITEM_RE = /^\s+-\s*(.*)$/;
// 真对象项形态:`key:` 后须空格或行尾(YAML mapping)。冒号后紧跟非空
// (如 http://x、draft:AI)是 plain scalar,不得误判为对象项而静默丢弃。
const KVISH_RE = /^[A-Za-z][\w-]*\s*:(\s|$)/;

/**
 * frontmatter 行 → data(kv 之外的行跳过,空行不可能是 kv)。
 * `key:`(值空)后随缩进 `- item` 行时累积为标量列表(CMS 原生
 * YAML 多行列表);遇非列表行即止。对象项行(`- key: value`)按
 * 现有"跳过非 kv 行"的宽容行为处理,不抛错。
 */
function parseKvLines(lines) {
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const match = lines[i].match(KV_LINE_RE);
    if (match === null) { i += 1; continue; }
    if (match[2].trim() === '') {
      // key: 值空 → 尝试收集后续列表行
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const item = lines[j].match(LIST_ITEM_RE);
        if (item === null) break; // 非列表行:frontmatter 结束或下一个 kv
        if (!KVISH_RE.test(item[1].trim())) {
          items.push(parseFrontmatterScalar(item[1].trim()));
        } // 对象项(- key: value):超集不实现,跳过该行
        j += 1;
      }
      if (items.length > 0) {
        data[match[1]] = items;
        i = j;
        continue;
      }
      data[match[1]] = ''; // 旧空值行为:key: 无值
    } else {
      data[match[1]] = parseFrontmatterScalar(match[2].trim());
    }
    i += 1;
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
