'use strict';

// Task 5b C1 tests: tools/build/mechanics.js — the content/mechanics merge
// step (mergeMechanicsContent, mechanicTitle), moved out of the build entry
// (skeleton-build.js) so that entry is pure orchestration again. The
// behaviour is the one the build entry had inlined since Task 4: slug = file
// name, title = frontmatter title > first ATX h1 > slug, same slug replaces,
// new slugs append.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { mergeMechanicsContent, mechanicTitle } = require('../tools/build/mechanics.js');

const REPO_CONTENT = path.join(__dirname, '..', 'content');

async function tmpDir(t, label) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `mechanics-${label}-`));
  // Windows may answer ENOTEMPTY/EPERM to the final rmdir of a recursive rm
  // while a just-written entry is still pending. That is the cleanup failing,
  // not the test — fs.rm retries such errors.
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  return dir;
}

const BASE = () => [
  { slug: 'night-settlement', title: '夜间结算与疲劳', source: '# 夜间结算与疲劳\n\n正文。' },
  { slug: 'barrel-system', title: '桶装系统', source: '# 桶装系统\n\n正文。' },
];

/** A content dir holding content/mechanics/<name> files as given. */
async function contentWith(t, label, files) {
  const contentDir = await tmpDir(t, label);
  const dir = path.join(contentDir, 'mechanics');
  await fs.mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return contentDir;
}

// ---------- mechanicTitle ----------

test('mechanicTitle: frontmatter title > first ATX h1 > slug', () => {
  assert.equal(mechanicTitle('---\ntitle: 手写标题\n---\n\n# 被 frontmatter 压过的 h1\n\n正文', 'some-slug'), '手写标题');
  assert.equal(mechanicTitle('---\ntitle:   两侧空白  \n---\n\n正文', 'some-slug'), '两侧空白', 'the title is trimmed');
  assert.equal(mechanicTitle('---\n---\n\n# 正文里的首个 h1\n\n正文', 'some-slug'), '正文里的首个 h1', 'no frontmatter title → first ATX h1');
  assert.equal(mechanicTitle('无 frontmatter 的正文。\n\n## h2 不算\n\n# 正文中间的 h1\n', 'some-slug'), '正文中间的 h1',
    'the h1 is the first ATX h1 anywhere in the body (multi-line match), with or without frontmatter');
  assert.equal(mechanicTitle('---\ntitle: ""\n---\n\n正文', 'some-slug'), 'some-slug', 'an empty frontmatter title is no title');
  assert.equal(mechanicTitle('无标题页正文。\n', 'bare'), 'bare', 'neither frontmatter title nor h1 → the slug');
});

// ---------- mergeMechanicsContent ----------

test('mergeMechanicsContent: null contentDir / a missing directory leave the input as is', async (t) => {
  const base = BASE();

  assert.equal(await mergeMechanicsContent(base, null), base, 'contentDir null → the very same array, nothing read');
  const untouched = await mergeMechanicsContent(base, path.join(await tmpDir(t, 'no-dir'), 'no-such-content'));
  assert.deepEqual(untouched, base, 'a missing content dir → the same entries, same order');
});

test('mergeMechanicsContent: slug = file name, source = the file as written; same slug replaces, new slugs append in file-name order', async (t) => {
  const contentDir = await contentWith(t, 'merge', {
    'z-new.md': '---\ntitle: 新页面\n---\n\n新页面正文。\n',
    'barrel-system.md': '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', // replaces BASE[1]
    'a-first.md': '无标题页正文。\n', // no fm, no h1 → title is the slug
    'notes.txt': 'not a page', // not markdown: ignored
    'README.MD': 'case-variant suffix: still a markdown page',
  });
  await fs.mkdir(path.join(contentDir, 'mechanics', 'drafts'));
  await fs.writeFile(path.join(contentDir, 'mechanics', 'drafts', 'nested.md'), 'a directory entry is not a page\n');

  const merged = await mergeMechanicsContent(BASE(), contentDir);

  assert.deepEqual(
    merged.map((m) => [m.slug, m.title]),
    [
      ['night-settlement', '夜间结算与疲劳'],
      ['barrel-system', '手写替换标题'],
      ['README', 'README'], // .MD stripped case-insensitively; no title → slug
      ['a-first', 'a-first'],
      ['z-new', '新页面'],
    ],
    'base order kept, replaced in place, new slugs appended in file-name order',
  );
  const replaced = merged.find((m) => m.slug === 'barrel-system');
  assert.equal(replaced.source, '---\n---\n\n# 手写替换标题\n\n手写替换正文。\n', 'source is the file as written');
  assert.equal(merged.find((m) => m.slug === 'night-settlement').source, BASE()[0].source, 'an untouched base entry keeps its source');
  assert.equal(Object.keys(replaced).sort().join(','), 'slug,source,title', 'an entry carries exactly slug, title, source');
});

test('mergeMechanicsContent: the repo\'s content/mechanics/install-compat.md merges as the page it is', async () => {
  const raw = await fs.readFile(path.join(REPO_CONTENT, 'mechanics', 'install-compat.md'), 'utf8');
  const merged = await mergeMechanicsContent(BASE(), REPO_CONTENT);
  const page = merged.find((m) => m.slug === 'install-compat');
  assert.deepEqual(page, { slug: 'install-compat', title: '安装与兼容性', source: raw });
  assert.equal(merged.length, BASE().length + 1);
});
