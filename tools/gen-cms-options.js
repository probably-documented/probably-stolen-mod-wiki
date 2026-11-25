'use strict';

// 重新生成 admin/config.yml 里「物品」下拉的 74 项（导入计划 review fix）。
//
// 数据里新增或改名物品后：`node tools/gen-cms-options.js` 写回 config.yml，
// 或 `node tools/gen-cms-options.js --check` 只检查（不一致退出码 1）。
// label 用数据里的 name，没有名字的用 id；顺序 = 数据的 mod 顺序 + 每个
// mod 内物品的顺序（与 loadWikiData 的 modOrder 一致）。

const fs = require('node:fs');
const path = require('node:path');

const { loadWikiData } = require('./build/wiki-data.js');

const CONFIG = path.join(__dirname, '..', 'admin', 'config.yml');
const OPTIONS_INDENT = ' '.repeat(10);
const VALUE_INDENT = ' '.repeat(12);
const OPTIONS_LINE = '        options:';

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

/**
 * The options block lines for the items dropdown, in data order.
 * @param {Array<{ id: string }>} mods
 * @param {Array<{ id: string, mod: string, name: string|null }>} items
 * @returns {string}
 */
function renderOptions(mods, items) {
  const lines = [];
  for (const mod of mods) {
    for (const item of items.filter((it) => it.mod === mod.id)) {
      const label = typeof item.name === 'string' && item.name !== '' ? item.name : item.id;
      lines.push(`${OPTIONS_INDENT}- label: ${quote(label)}`);
      lines.push(`${VALUE_INDENT}value: ${quote(item.id)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Replace the options block of the slug field; the block ends at the first
 * line that is not indented deeper than `options:` itself.
 * @param {string} configText
 * @param {string} optionsText
 * @returns {string}
 */
function replaceOptions(configText, optionsText) {
  const lines = configText.split('\n');
  const start = lines.indexOf(OPTIONS_LINE);
  if (start === -1) throw new Error(`admin/config.yml 里找不到「${OPTIONS_LINE.trim()}」这一行(物品下拉的选项块)`);
  const baseIndent = OPTIONS_LINE.match(/^\s*/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.trim() === '') break;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= baseIndent) break;
    end += 1;
  }
  return [...lines.slice(0, start + 1), optionsText, ...lines.slice(end)].join('\n');
}

async function main() {
  const check = process.argv.includes('--check');
  const data = await loadWikiData('data');
  const text = fs.readFileSync(CONFIG, 'utf8');
  const next = replaceOptions(text, renderOptions(data.mods, data.items));
  if (check) {
    if (next !== text) {
      console.error('[cms-options] FAIL — admin/config.yml 的物品下拉与 data/mods/*.json 不一致');
      console.error('提示:运行 node tools/gen-cms-options.js 重新生成,然后提交 admin/config.yml。');
      process.exitCode = 1;
      return;
    }
    console.log('[cms-options] OK — the dropdown matches the data');
    return;
  }
  fs.writeFileSync(CONFIG, next);
  console.log(`[cms-options] wrote ${data.items.length} options → ${CONFIG}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[cms-options] fatal:', err);
    process.exitCode = 1;
  });
}

module.exports = { renderOptions, replaceOptions };
