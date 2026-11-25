'use strict';

// Table rows wider than their header (rich text in the CMS).
//
// The CMS's rich-text editor treats an image as an inline thing. Dropped at
// the end of a table row, it is written as one more cell of that row
// (`| 1 | 2 |![](images/x.png)`), and the renderer — like GFM — keeps only
// the cells a row has in common with the header: the image would vanish from
// the page without a word. tools/build/wide-tables.js finds such rows, so
// that the build can tell the contributor which line to fix.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { findWideTableRows, formatWideTableRows } = require('../tools/build/wide-tables.js');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `wide-tables-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry is still pending: the cleanup failing, not the
  // test. fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

const toPosix = (p) => p.split(path.sep).join('/');

test('a body row with more cells than its header is reported by file and line, the frontmatter lines counted', async (t) => {
  const contentDir = await tmpDir(t, 'frontmatter');
  await fs.mkdir(path.join(contentDir, 'mechanics'));
  // line 10 is the wide one: four lines of frontmatter, a blank, a paragraph, a blank, header, delimiter
  await fs.writeFile(path.join(contentDir, 'mechanics', 'wide.md'),
    '---\ntitle: 宽表\nnav_label:\n---\n\n正文\n\n| A | B |\n| --- | --- |\n| 1 | 2 |![](images/x.png)\n');

  assert.deepEqual(await findWideTableRows(contentDir),
    [{ file: 'mechanics/wide.md', line: 10, headerCells: 2, rowCells: 3 }]);
});

test('a file without frontmatter is counted from its own first line', async (t) => {
  const contentDir = await tmpDir(t, 'no-frontmatter');
  await fs.mkdir(path.join(contentDir, 'items'));
  await fs.writeFile(path.join(contentDir, 'items', 'x.md'), '正文\n\n| A |\n| --- |\n| 1 | 2 |\n');

  assert.deepEqual(await findWideTableRows(contentDir),
    [{ file: 'items/x.md', line: 5, headerCells: 1, rowCells: 2 }]);
});

test('a content directory that does not exist has nothing to check', async () => {
  assert.deepEqual(await findWideTableRows(path.join(os.tmpdir(), `no-such-content-dir-${Date.now()}`)), []);
});

test('rows that fit, a page without tables, and a page without frontmatter at all give no findings', async (t) => {
  const contentDir = await tmpDir(t, 'clean');
  await fs.mkdir(path.join(contentDir, 'mechanics'));
  await fs.writeFile(path.join(contentDir, 'mechanics', 'fits.md'), '---\ntitle: 合适\n---\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n');
  await fs.writeFile(path.join(contentDir, 'mechanics', 'plain.md'), '---\ntitle: 无表\n---\n\n只有文字。\n');
  await fs.writeFile(path.join(contentDir, 'mechanics', 'bare.md'), '没有开头块,也没有表格。\n');

  assert.deepEqual(await findWideTableRows(contentDir), []);
});

test('every wide row of a page is reported, in the order they appear', async (t) => {
  const contentDir = await tmpDir(t, 'several');
  await fs.mkdir(path.join(contentDir, 'mechanics'));
  // line 3 in the first table; the second table's header is on line 7, so its wide row is on line 9
  await fs.writeFile(path.join(contentDir, 'mechanics', 'twice.md'),
    '| A |\n| --- |\n| 1 | 2 |\n\n文字\n\n| B |\n| --- |\n| 3 | 4 |\n');

  assert.deepEqual(await findWideTableRows(contentDir), [
    { file: 'mechanics/twice.md', line: 3, headerCells: 1, rowCells: 2 },
    { file: 'mechanics/twice.md', line: 9, headerCells: 1, rowCells: 2 },
  ]);
});

test('the report names each file and line in Chinese, ordered by file name then line, and ends with the hint', () => {
  const report = formatWideTableRows([
    { file: 'mechanics/foo.md', line: 12, headerCells: 2, rowCells: 3 },
    { file: 'items/bar.md', line: 5, headerCells: 3, rowCells: 4 },
  ], path.join('/c', 'content'));

  assert.equal(report, [
    '[table] FAIL — 2 处表格行比表头多出了单元格:',
    `  ${toPosix(path.join('/c', 'content'))}/items/bar.md 第 5 行(表头 3 格,这一行 4 格)`,
    `  ${toPosix(path.join('/c', 'content'))}/mechanics/foo.md 第 12 行(表头 2 格,这一行 3 格)`,
    '提示:多半是一张图片贴在了表格某一行的行尾。请打开这个文件,把多出来的内容挪到表格的上方或下方,单独占一行。',
  ].join('\n'));
});
