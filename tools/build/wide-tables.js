'use strict';

// Table rows wider than their header (rich text in the CMS).
//
// The CMS's rich-text editor treats an image as an inline thing. Dropped at
// the end of a table row, it is written as one more cell of that row
// (`| 1 | 2 |![](images/x.png)`), and the renderer — like GFM — keeps only the
// cells a row has in common with the header: the image would vanish from the
// page without a word. This module finds such rows; the build entry
// (skeleton-build.js) turns them into a BuildError that names the file and
// the line, before anything on disk is touched.
//
// The rows are found with the renderer itself (the `warnings` of mdToHtml),
// on the very text the page is rendered from — so what is reported here and
// what the page drops can never be two different things.

const fs = require('node:fs/promises');
const path = require('node:path');

const { mdToHtml } = require('./markdown.js');
const { splitFrontmatter } = require('../extract/frontmatter.js');

const toPosix = (p) => p.split(path.sep).join('/');

/**
 * The table rows of one page's text that are wider than their header, with
 * each row's line in that text.
 * @param {string} text
 * @returns {Array<{ line: number, headerCells: number, rowCells: number }>}
 */
function wideRowsOf(text) {
  const { body } = splitFrontmatter(text);
  // The body is the text's own lines, cut and rejoined, so the difference
  // between the two line counts is how many lines before it (the frontmatter
  // block, and whatever follows it up to where the body starts).
  const linesBeforeBody = text.split(/\r?\n/).length - body.split('\n').length;
  return mdToHtml(body, () => null, () => '').warnings.map(({ line, headerCells, rowCells }) => ({
    line: linesBeforeBody + line,
    headerCells,
    rowCells,
  }));
}

const byFileThenLine = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line);

/**
 * Every table row, among the pages a contributor edits, that has more cells
 * than its header: the home page, the section pages, each mod's own page, its
 * mechanic pages and item entries, and the site pages — everything the layout
 * lists (tools/build/content-layout.js). An empty layout has nothing to check.
 * @param {object|null} layout readContentLayout 的结果
 * @param {string|null} contentDir 只用来算出相对路径(报告里显示用)
 * @returns {Promise<Array<{ file: string, line: number, headerCells: number, rowCells: number }>>}
 *   file is relative to contentDir (POSIX separators) and line is the row's
 *   own line in that file, from 1; ordered by file, then by line.
 */
async function findWideTableRows(layout, contentDir) {
  const found = [];
  const pages = [
    ...(layout?.home == null ? [] : [layout.home]),
    ...(layout?.sections ?? []).map((page) => page.file),
    ...(layout?.mods ?? []).flatMap((mod) => [
      ...(mod.indexFile === null ? [] : [mod.indexFile]),
      ...mod.mechanics.map((page) => page.file),
      ...mod.items.map((entry) => entry.file),
    ]),
    ...(layout?.site ?? []).map((page) => page.file),
  ];
  for (const file of pages) {
    const text = await fs.readFile(file, 'utf8');
    for (const row of wideRowsOf(text)) found.push({ file: toPosix(path.relative(contentDir ?? 'content', file)), ...row });
  }
  return found.sort(byFileThenLine);
}

/**
 * The contributor-facing report: a heading with the count, one line per row
 * — the file and the line, with how many cells the header and the row have —
 * and one actionable hint as the last line.
 * @param {Array<{ file: string, line: number, headerCells: number, rowCells: number }>} rows
 * @param {string} contentDir
 * @returns {string}
 */
function formatWideTableRows(rows, contentDir) {
  const lines = [...rows].sort(byFileThenLine).map(({ file, line, headerCells, rowCells }) =>
    `  ${toPosix(path.join(contentDir, file))} 第 ${line} 行(表头 ${headerCells} 格,这一行 ${rowCells} 格)`);
  return [
    `[table] FAIL — ${rows.length} 处表格行比表头多出了单元格:`,
    ...lines,
    '提示:多半是一张图片贴在了表格某一行的行尾。请打开这个文件,把多出来的内容挪到表格的上方或下方,单独占一行。',
  ].join('\n');
}

module.exports = { findWideTableRows, formatWideTableRows };
