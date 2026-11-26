'use strict';

// lintContent: the checks on the per-mod content directory. Every one of them can be
// triggered by a contributor through the CMS or by hand, so each says which file, what is
// wrong, and what to do — in Chinese. The files are stubbed: what is pinned is how a given
// layout and given file contents turn into issues.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { lintContent, formatContentIssues, ISSUE_ORDER, NAME_RE } = require('../tools/build/content-lint.js');

const EMPTY = { home: null, sections: [], site: [], mods: [], strayFiles: [], legacyDirs: [], imageFolders: [] };
const layoutOf = (extra) => ({ ...EMPTY, ...extra });
const mod = (id, extra = {}) => ({
  id, dir: `c/mods/${id}`, indexFile: `c/mods/${id}/_index.md`, redirectsFile: null,
  items: [], mechanics: [], nestedIndexFiles: [], ...extra,
});
const mech = (modId, slug) => ({ slug, file: `c/mods/${modId}/mechanics/${slug}.md` });
const item = (modId, id) => ({ id, file: `c/mods/${modId}/items/${id}.md` });
const page = (dir, slug) => ({ slug, file: `c/${dir}/${slug}.md` });
const fm = (lines, body = '正文') => `---\n${lines}\n---\n\n${body}\n`;

/** A stand-in for readFile that answers from a table and refuses anything else. */
const filesOf = (files) => async (file) => {
  if (!(file in files)) throw new Error(`no stub for ${file}`);
  return files[file];
};

const codes = (issues) => issues.map((i) => i.code);

test('ISSUE_ORDER is the eighteen checks, A to R, and NAME_RE is what the CMS accepts for a file name', () => {
  assert.equal(ISSUE_ORDER.length, 18);
  assert.deepEqual([...ISSUE_ORDER].sort(), [...'ABCDEFGHIJKLMNOPQR'].sort());
  for (const ok of ['barrel-system', 'a.b', 'A_B', '中文.别名', 'a..b', 'gear.maidDress', '_index']) assert.match(ok, NAME_RE, ok);
  for (const bad of ['a b', 'a/b', 'a~b', 'a#b', 'a\\b']) assert.doesNotMatch(bad, NAME_RE, bad);
});

test('a clean layout has no issues, whatever the checks look at', async () => {
  const layout = layoutOf({
    home: 'c/home.md',
    sections: [page('sections', 'lewd-meme-series')],
    site: [page('site', 'about')],
    mods: [
      mod('alpha', { redirectsFile: 'c/mods/alpha/redirects.yaml', items: [item('alpha', 'egg')], mechanics: [mech('alpha', 'one')] }),
      mod('beta'),
    ],
  });
  const files = {
    'c/mods/alpha/mechanics/one.md': fm('title: 一\nmod: alpha'),
    'c/mods/alpha/items/egg.md': fm('title: 卵\nitem_id: egg\nmod: alpha'),
    'c/mods/alpha/redirects.yaml': 'mod: alpha\naliases:\n  - 卵\nkeywords: []\n',
    'c/sections/lewd-meme-series.md': fm('title: 系列\nmods:\n  - alpha\n  - beta'),
  };
  assert.deepEqual(await lintContent({ layout, data: { items: [{ id: 'egg', mod: 'alpha' }] }, readFile: filesOf(files) }), []);
});

test('A — a mechanic page whose mod: is another mod, or is not written', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { mechanics: [mech('alpha', 'one'), mech('alpha', 'two')] }), mod('beta')] });
  const files = {
    'c/mods/alpha/mechanics/one.md': fm('title: 一\nmod: beta'),
    'c/mods/alpha/mechanics/two.md': fm('title: 二'),
  };
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf(files) });
  assert.deepEqual(codes(issues), ['A', 'A']);
  assert.match(issues[0].problem, /alpha[\s\S]*beta/, 'names the directory and what the file says');
  assert.match(issues[0].fix, /mod: alpha/);
  assert.match(issues[1].problem, /没有写/);
});

test('B — an item entry whose mod: is another mod', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'egg')] }), mod('beta')] });
  const issues = await lintContent({ layout, data: { items: [{ id: 'egg', mod: 'alpha' }] }, readFile: filesOf({ 'c/mods/alpha/items/egg.md': fm('title: 卵\nitem_id: egg\nmod: beta') }) });
  assert.deepEqual(codes(issues), ['B']);
  assert.match(issues[0].problem, /alpha[\s\S]*beta/);
});

test('C — redirects.yaml whose mod: line is another mod', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { redirectsFile: 'c/mods/alpha/redirects.yaml' }), mod('beta')] });
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf({ 'c/mods/alpha/redirects.yaml': 'mod: beta\naliases: []\n' }) });
  assert.deepEqual(codes(issues), ['C']);
  assert.match(issues[0].fix, /mod: alpha/);
});

test('D — a mod nested inside another mod', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { nestedIndexFiles: ['c/mods/alpha/sub/_index.md'] })] });
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf({}) });
  assert.deepEqual(codes(issues), ['D']);
  assert.equal(issues[0].file, 'c/mods/alpha/sub/_index.md');
  assert.match(issues[0].problem, /不能建在另一个 Mod 下面/);
  assert.match(issues[0].fix, /移到 content\/mods\//);
});

test('E and F — a stray file under mods/, and the old directories', async () => {
  const layout = layoutOf({ strayFiles: ['c/mods/loose.md'], legacyDirs: ['c/items'] });
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf({}) });
  const by = Object.fromEntries(issues.map((i) => [i.code, i]));
  assert.deepEqual(codes(issues).sort(), ['E', 'F']);
  assert.match(by.E.fix, /mods\/<[^>]+>\/items\/|mechanics\//);
  assert.match(by.F.fix, /删掉这个目录/);
});

test('G — file names: a space, a slash, a leading dot (the slash one is no exported item either and says no item_id, so L and P follow)', async () => {
  const layout = layoutOf({
    sections: [page('sections', 'a b')],
    site: [page('site', '.hidden')],
    mods: [mod('alpha', { items: [item('alpha', 'x/y')], mechanics: [mech('alpha', 'good-name')] })],
  });
  const files = {
    'c/mods/alpha/items/x/y.md': fm('mod: alpha'),
    'c/mods/alpha/mechanics/good-name.md': fm('mod: alpha'),
    'c/sections/a b.md': fm('mods:\n  - alpha'),
  };
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf(files) });
  assert.deepEqual(codes(issues), ['G', 'L', 'P', 'G', 'G'], 'by file: the item entry, the section, the site page');
  assert.deepEqual(issues.slice(0, 3).map((i) => i.file), ['c/mods/alpha/items/x/y.md', 'c/mods/alpha/items/x/y.md', 'c/mods/alpha/items/x/y.md'],
    'all three findings of the item entry come together, before the next file');
  assert.match(issues[0].problem, /只能用英文、数字、短横线、下划线、点和中文/);
});

test('H — two mods with a mechanic page of the same name: both files are listed', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { mechanics: [mech('alpha', 'same')] }), mod('beta', { mechanics: [mech('beta', 'same')] })] });
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf({
    'c/mods/alpha/mechanics/same.md': fm('mod: alpha'), 'c/mods/beta/mechanics/same.md': fm('mod: beta'),
  }) });
  assert.deepEqual(codes(issues), ['H', 'H']);
  assert.deepEqual(issues.map((i) => i.file), ['c/mods/alpha/mechanics/same.md', 'c/mods/beta/mechanics/same.md']);
  assert.match(issues[0].problem, /mechanics\/same\.html/);
});

test('I, J, K — a mod named in a file that does not exist as a directory', async () => {
  const layout = layoutOf({
    sections: [page('sections', 'series')],
    mods: [mod('alpha', { mechanics: [mech('alpha', 'one')], redirectsFile: 'c/mods/alpha/redirects.yaml' })],
  });
  const files = {
    'c/mods/alpha/mechanics/one.md': fm('mod: ghost'),
    'c/mods/alpha/redirects.yaml': 'mod: ghost\naliases: []\n',
    'c/sections/series.md': fm('mods:\n  - alpha\n  - ghost'),
  };
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf(files) });
  assert.deepEqual(codes(issues), ['I', 'K', 'J'], 'by file: the mechanic page, redirects.yaml, the section; a missing mod is the more specific check');
  for (const issue of issues) assert.match(issue.problem, /ghost/);
});

test('L — an item entry whose file name is no exported item, until hand-written items are allowed (then it is Q that asks for a title)', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'made_up')] })] });
  const files = { 'c/mods/alpha/items/made_up.md': fm('item_id: made_up\nmod: alpha') };
  const data = { items: [{ id: 'egg', mod: 'alpha' }] };
  const issues = await lintContent({ layout, data, readFile: filesOf(files) });
  assert.deepEqual(codes(issues), ['L']);
  assert.match(issues[0].fix, /真实物品的 ID/);
  // Once hand-written items are allowed the file name is fine, but the entry names no item in the data: it has to name itself.
  const allowed = await lintContent({ layout, data, handwrittenItems: true, readFile: filesOf(files) });
  assert.deepEqual(codes(allowed), ['Q'], 'not L any more: Q');
});

test('Q — a hand-written item entry (no exported item behind it) has to give the item a title; one that does is clean', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'made_up'), item('alpha', 'named'), item('alpha', 'egg')] })] });
  const files = {
    'c/mods/alpha/items/made_up.md': fm('item_id: made_up\nmod: alpha'), // no title at all
    'c/mods/alpha/items/named.md': fm("item_id: named\nmod: alpha\ntitle: '自己起的名字'"),
    'c/mods/alpha/items/egg.md': fm("item_id: egg\nmod: alpha"), // an exported item: its title is optional
  };
  const data = { items: [{ id: 'egg', mod: 'alpha' }] };

  const issues = await lintContent({ layout, data, handwrittenItems: true, readFile: filesOf(files) });

  assert.deepEqual(issues.map((i) => [i.file, i.code]), [['c/mods/alpha/items/made_up.md', 'Q']]);
  assert.match(issues[0].problem, /「made_up」[\s\S]*标题/, 'names the entry and the missing title');
  assert.match(issues[0].fix, /标题/, 'says which box to fill');
  // An exported item whose entry says no title is not asked for one, and before hand-written items are allowed Q keeps quiet.
  assert.deepEqual(codes(await lintContent({ layout, data, readFile: filesOf(files) })).filter((c) => c === 'Q'), []);
});

test('M — an item entry filed under a mod the item does not belong to', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'egg')] }), mod('beta')] });
  const issues = await lintContent({ layout, data: { items: [{ id: 'egg', mod: 'beta' }] }, readFile: filesOf({ 'c/mods/alpha/items/egg.md': fm('item_id: egg\nmod: alpha') }) });
  assert.deepEqual(codes(issues), ['M']);
  assert.match(issues[0].fix, /mods\/beta\/items\//, 'says where to move it');
});

test('R — an entry whose icon was uploaded needs the picture to be in its mod\'s images/ folder; an icon written any other way is not asked for', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'has'), item('alpha', 'lost'), item('alpha', 'old')] })] });
  const files = {
    'c/mods/alpha/items/has.md': fm('item_id: has\nmod: alpha\ntitle: 有图\nicon: ../images/a.png'),
    'c/mods/alpha/items/lost.md': fm('item_id: lost\nmod: alpha\ntitle: 丢了图\nicon: ../images/gone.png'),
    'c/mods/alpha/items/old.md': fm('item_id: old\nmod: alpha\ntitle: 游戏贴图\nicon: items/alpha/old.png'), // a game texture's own path
  };
  const there = async (file) => file === path.join('c/mods/alpha', 'images', 'a.png');

  const issues = await lintContent({ layout, data: { items: [] }, handwrittenItems: true, readFile: filesOf(files), fileExists: there });

  assert.deepEqual(issues.map((i) => [i.file, i.code]), [['c/mods/alpha/items/lost.md', 'R']]);
  assert.match(issues[0].problem, /alpha[\s\S]*gone\.png/, 'names the folder and the picture');
  assert.match(issues[0].fix, /重新上传/, 'says what to do in the CMS');
  assert.deepEqual(await lintContent({ layout, data: { items: [] }, handwrittenItems: true, readFile: filesOf(files), fileExists: async () => true }), []);
});

test('O — two item entries of one mod that name one item (a hand-typed id that differs by case only): both files are listed, and the fix says to keep one', async () => {
  const layout = layoutOf({
    mods: [mod('alpha', { items: [item('alpha', 'gear.maidDress'), item('alpha', 'egg'), item('alpha', 'gear.maiddress')] })],
  });
  const files = {
    'c/mods/alpha/items/gear.maidDress.md': fm('item_id: gear.maidDress\nmod: alpha'),
    'c/mods/alpha/items/gear.maiddress.md': fm('item_id: gear.maiddress\nmod: alpha'),
    'c/mods/alpha/items/egg.md': fm('item_id: egg\nmod: alpha'),
  };
  const data = { items: [{ id: 'gear.maidDress', mod: 'alpha' }, { id: 'egg', mod: 'alpha' }] };

  const issues = await lintContent({ layout, data, readFile: filesOf(files) });

  assert.deepEqual(issues.map((i) => [i.file, i.code]), [
    ['c/mods/alpha/items/gear.maidDress.md', 'O'],
    ['c/mods/alpha/items/gear.maiddress.md', 'O'],
  ], 'both files, and nothing else: the entry that names egg is left alone');
  for (const issue of issues) {
    assert.match(issue.problem, /物品「gear\.maidDress」/, 'names the item');
    assert.ok(issue.problem.includes('gear.maidDress.md') && issue.problem.includes('gear.maiddress.md'),
      `lists every file, on each of them: ${issue.problem}`);
    assert.match(issue.fix, /只保留一份/, issue.fix);
    assert.match(issue.fix, /删掉/, issue.fix);
  }
});

test('O — the two entries may sit in different mods: they are found across mods', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'egg')] }), mod('beta', { items: [item('beta', 'EGG')] })] });
  const files = {
    'c/mods/alpha/items/egg.md': fm('item_id: egg\nmod: alpha'),
    'c/mods/beta/items/EGG.md': fm('item_id: EGG\nmod: beta'),
  };
  const data = { items: [{ id: 'egg', mod: 'alpha' }] };

  const issues = await lintContent({ layout, data, readFile: filesOf(files) });

  assert.deepEqual(issues.map((i) => [i.file, i.code]), [
    ['c/mods/alpha/items/egg.md', 'O'],
    ['c/mods/beta/items/EGG.md', 'M'], // the entry in the wrong mod is M as well …
    ['c/mods/beta/items/EGG.md', 'O'], // … and O, after it
  ]);
});

test('P — an item entry whose item_id is not its own file name: not written, another item, or the same item in another case', async () => {
  const ids = ['egg', 'ham', 'bare', 'Egg', 'padded'];
  const layout = layoutOf({ mods: [mod('alpha', { items: ids.map((id) => item('alpha', id)) })] });
  const files = {
    'c/mods/alpha/items/egg.md': fm('item_id: egg\nmod: alpha'), // agrees with the file name: nothing to report
    'c/mods/alpha/items/ham.md': fm('item_id: egg\nmod: alpha'), // names another item
    'c/mods/alpha/items/bare.md': fm('title: 没写 item_id\nmod: alpha'), // not written at all
    'c/mods/alpha/items/Egg.md': fm('item_id: egg\nmod: alpha'), // the same item, another case
    'c/mods/alpha/items/padded.md': fm("item_id: ' padded '\nmod: alpha"), // blank around the value does not count
  };
  const data = { items: ids.map((id) => ({ id, mod: 'alpha' })) };

  const issues = await lintContent({ layout, data, readFile: filesOf(files) });

  assert.deepEqual(issues.map((i) => [i.file, i.code]), [
    ['c/mods/alpha/items/Egg.md', 'P'],
    ['c/mods/alpha/items/bare.md', 'P'],
    ['c/mods/alpha/items/ham.md', 'P'],
  ]);
  assert.match(issues[0].problem, /文件名是「Egg」[\s\S]*item_id[\s\S]*「egg」/, 'names the file name and what the file says');
  assert.match(issues[1].problem, /文件名是「bare」[\s\S]*没有写 item_id/, '…and says so when nothing is written');
  assert.match(issues[2].problem, /文件名是「ham」[\s\S]*「egg」/);
  for (const issue of issues) {
    assert.match(issue.fix, /「物品 ID」/, issue.fix);
    assert.match(issue.fix, /保存/, issue.fix);
    assert.match(issue.fix, /改名/, `${issue.file}: says that the CMS renames the file by this field`);
  }
});

test('P — a hand-written item (no exported item behind it) is held to the same rule', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'made_up'), item('alpha', 'other')] })] });
  const files = {
    'c/mods/alpha/items/made_up.md': fm('item_id: made_up\nmod: alpha'),
    'c/mods/alpha/items/other.md': fm('item_id: something_else\nmod: alpha'),
  };

  const issues = await lintContent({ layout, data: { items: [] }, handwrittenItems: true, readFile: filesOf(files) });

  // P first by file order (made_up.md < other.md); made_up says no title, so Q follows it.
  assert.deepEqual(issues.map((i) => [i.file, i.code]), [
    ['c/mods/alpha/items/made_up.md', 'Q'],
    ['c/mods/alpha/items/other.md', 'P'],
    ['c/mods/alpha/items/other.md', 'Q'],
  ]);
});

test('N — two images that would be published to the same place: every source file is listed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'content-lint-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }));
  const put = async (rel) => {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), '');
    return path.join(root, rel);
  };
  const home = await put('images/x.png');
  const alpha = await put('mods/alpha/images/x.png');
  const beta = await put('mods/beta/images/x.png');
  await put('mods/beta/images/sub/y.png');
  const section = await put('sections/images/x.png'); // another destination: no clash
  const layout = layoutOf({
    mods: [mod('alpha'), mod('beta')],
    imageFolders: [
      { imagesDir: path.join(root, 'images'), dests: ['images'] },
      { imagesDir: path.join(root, 'mods/alpha/images'), dests: ['images', 'mods/images'] },
      { imagesDir: path.join(root, 'mods/beta/images'), dests: ['images', 'mods/images'] },
      { imagesDir: path.join(root, 'sections/images'), dests: ['sections/images'] },
    ],
  });

  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf({}) });

  assert.ok(issues.length > 0 && codes(issues).every((c) => c === 'N'));
  assert.deepEqual([...new Set(issues.map((i) => i.file))].sort(), [home, alpha, beta].sort());
  assert.ok(!issues.some((i) => i.file === section));
  assert.match(issues[0].fix, /改名/);
});

test('the issues come out by file, and inside a file in the order of the checks', async () => {
  const layout = layoutOf({ mods: [mod('alpha', { items: [item('alpha', 'made up')], nestedIndexFiles: ['c/mods/alpha/sub/_index.md'] })] });
  const files = { 'c/mods/alpha/items/made up.md': fm('mod: ghost') };
  const issues = await lintContent({ layout, data: { items: [] }, readFile: filesOf(files) });
  assert.deepEqual(issues.map((i) => [i.file, i.code]).slice(0, 3), [
    ['c/mods/alpha/items/made up.md', 'G'],
    ['c/mods/alpha/items/made up.md', 'I'],
    ['c/mods/alpha/items/made up.md', 'L'],
  ]);
  // The file says no item_id either: that is the last finding of this file, after L.
  assert.deepEqual(issues[3], {
    code: 'P', file: 'c/mods/alpha/items/made up.md',
    problem: '这一篇的文件名是「made up」,但开头没有写 item_id',
    fix: '文件名和开头的 item_id 必须是同一个物品 ID。在 CMS 里打开这一篇,把「物品 ID」一栏改成这一篇实际写的那件物品,再保存:'
      + 'CMS 保存时会按这一栏给文件命名,两处不一致的话,下次保存文件会被悄悄改名,换成别的物品。',
  });
});

test('formatContentIssues: a heading with the count, three lines per issue, and the hint last', () => {
  const text = formatContentIssues([
    { file: 'content/mods/a/mechanics/one.md', problem: '问题一', fix: '改法一' },
    { file: 'content/mods/b/mechanics/two.md', problem: '问题二', fix: '改法二' },
  ]);
  const lines = text.split('\n');
  assert.equal(lines[0], '[content] FAIL — 发现 2 处问题:');
  assert.deepEqual(lines.slice(1, 4), ['  1. 文件:content/mods/a/mechanics/one.md', '     问题:问题一', '     怎么改:改法一']);
  assert.deepEqual(lines.slice(4, 7), ['  2. 文件:content/mods/b/mechanics/two.md', '     问题:问题二', '     怎么改:改法二']);
  assert.equal(lines.length, 8);
  assert.match(lines[7], /^提示:/);
  assert.ok(lines[7].endsWith('改好之前,网站不会更新。'));
});
