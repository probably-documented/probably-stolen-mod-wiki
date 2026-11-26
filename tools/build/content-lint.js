'use strict';

// 新目录结构的检查。每一条都是贡献者通过 CMS 或者直接改文件能触发的,所以每条都说清:
// 哪个文件、哪里不对、怎么改。构建入口在清理旧的 dist 之前跑它(skeleton-build.js)。
//
//   A  机制页开头的 mod: 不是所在的 Mod 目录,或者没写
//   B  物品词条开头的 mod: 不是所在的 Mod 目录,或者没写
//   C  redirects.yaml 开头的 mod: 不是所在的 Mod 目录
//   D  Mod 建在了另一个 Mod 的目录里面
//   E  文件直接放在 mods/ 下,不在任何 Mod 的目录里
//   F  旧的 content/items、content/mechanics 目录还有残留
//   G  文件名只能用英文、数字、短横线、下划线、点和中文,不能以点开头
//   H  两个 Mod 下有同名的机制页(页面地址会撞)
//   I  词条所属的 Mod 不存在
//   J  分区的名单里列了不存在的 Mod
//   K  重定向文件里写的 Mod 不存在
//   L  物品词条的文件名不是任何一件已导出物品的 ID(允许纯手写物品之后不再报)
//   M  物品词条放在了这件物品不属于的 Mod 目录下
//   N  两张图片会发到同一个位置
//   O  两份物品词条指向同一件物品
//   P  物品词条开头的 item_id 不是它自己的文件名(或没写)

const fs = require('node:fs/promises');
const path = require('node:path');

const { splitFrontmatter } = require('../extract/frontmatter.js');
const { resolveItemId } = require('./item-ids.js');

/** 文件名允许的字符,和 CMS 的 pattern 一致。 */
const NAME_RE = /^[A-Za-z0-9._\-\u4e00-\u9fff]+$/;

/** redirects.yaml 是纯 YAML,这里只认顶层那一行 `mod:`。 */
const REDIRECTS_MOD_RE = /^mod:[ \t]*(.*?)[ \t]*$/m;

/** 检查的先后。报告里同一个文件的问题按这个顺序排。 */
const ISSUE_ORDER = Object.freeze([...'ABCDEFGHIJKLMNOP']);

const isMissing = (err) => err != null && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

const toPosix = (p) => p.split(path.sep).join('/');

/** 每个文件,任意深度,排序;目录不存在时是空数组。 */
async function listFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

const defaultReadFile = (file) => fs.readFile(file, 'utf8');

/**
 * 一篇词条开头的 `mod:`:没写、写的不是已有的 Mod、写的是别的 Mod 目录。
 * @returns {Promise<{ code: string, problem: string, fix: string }|null>} 不带 `file`
 */
async function entryModIssues({ file, mod, modIds, what, code, readFile }) {
  const fm = splitFrontmatter(await readFile(file)).fm;
  const said = fm.mod == null ? '' : String(fm.mod).trim();
  const modLine = `\`mod: ${mod.id}\``;
  if (said === '') {
    return {
      code,
      problem: `这一篇${what}写在 ${mod.id} 的目录下,但开头没有写 mod:`,
      fix: `在文件开头加上一行 ${modLine}。在 CMS 里打开这一篇,把「所属 mod」选成 ${mod.id},再保存。`,
    };
  }
  if (!modIds.has(said)) {
    return {
      code: 'I',
      problem: `这一篇${what}所属的 Mod ${said} 不存在`,
      fix: `在 CMS 里打开这一篇,从「所属 mod」的列表里重新选一个。`,
    };
  }
  if (said !== mod.id) {
    return {
      code,
      problem: `这一篇${what}写在 ${mod.id} 的目录下,但开头的 mod: 写的是 ${said}`,
      fix: `把开头那一行改成 ${modLine}。在 CMS 里改了「所属 mod」,文件不会跟着移动;确实要换 Mod,请新建一篇,把内容搬过去。`,
    };
  }
  return null;
}

async function redirectsIssues(mod, modIds, readFile) {
  const file = mod.redirectsFile;
  const text = await readFile(file);
  const said = (REDIRECTS_MOD_RE.exec(text)?.[1] ?? '').trim();
  const modLine = `\`mod: ${mod.id}\``;
  if (said === mod.id) return null;
  if (said === '') {
    return { code: 'C', problem: `${mod.id} 的重定向文件开头没有写 mod:`, fix: `把开头那一行写成 ${modLine}。` };
  }
  if (!modIds.has(said)) {
    return { code: 'K', problem: `重定向文件里写的 Mod ${said} 不存在`, fix: `把开头那一行写成 ${modLine}。` };
  }
  return { code: 'C', problem: `重定向文件写在 ${mod.id} 的目录下,但开头的 mod: 写的是 ${said}`, fix: `把开头那一行写成 ${modLine}。` };
}

/**
 * 物品词条开头的 `item_id` 必须是它自己的文件名。CMS 保存时按「物品 ID」这一栏给文件
 * 命名:两处不一致,下次保存文件就被改名——悄悄换成别的物品。没写也算不一致。
 * @returns {Promise<{ code: string, problem: string, fix: string }|null>} 不带 `file`
 */
async function itemIdFieldIssue(entry, readFile) {
  const { item_id } = splitFrontmatter(await readFile(entry.file)).fm;
  const said = typeof item_id === 'string' ? item_id.trim() : '';
  if (said === entry.id) return null;
  return {
    code: 'P',
    problem: said === ''
      ? `这一篇的文件名是「${entry.id}」,但开头没有写 item_id`
      : `这一篇的文件名是「${entry.id}」,开头写的 item_id 却是「${said}」,两处不一致`,
    fix: '文件名和开头的 item_id 必须是同一个物品 ID。在 CMS 里打开这一篇,把「物品 ID」一栏改成这一篇实际写的那件物品,再保存:'
      + 'CMS 保存时会按这一栏给文件命名,两处不一致的话,下次保存文件会被悄悄改名,换成别的物品。',
  };
}

/**
 * @param {object} args
 * @param {object} args.layout readContentLayout 的结果
 * @param {object} args.data 载入的站点数据,用到 items(每件的 id 和 mod)
 * @param {boolean} [args.handwrittenItems] 允许对不上数据的物品词条(纯手写物品)时为 true
 * @param {(file: string) => Promise<string>} [args.readFile] 读文件,默认读磁盘
 * @returns {Promise<Array<{ code: string, file: string, problem: string, fix: string }>>}
 *   按文件排序;同一个文件里按 ISSUE_ORDER
 */
async function lintContent({ layout, data, handwrittenItems = false, readFile = defaultReadFile }) {
  const issues = [];
  const add = (file, issue) => {
    if (issue !== null) issues.push({ code: issue.code, file, problem: issue.problem, fix: issue.fix });
  };
  const modIds = new Set(layout.mods.map((mod) => mod.id));

  for (const mod of layout.mods) {
    for (const page of mod.mechanics) {
      add(page.file, await entryModIssues({ file: page.file, mod, modIds, what: '机制页', code: 'A', readFile }));
    }
    for (const entry of mod.items) {
      add(entry.file, await entryModIssues({ file: entry.file, mod, modIds, what: '物品词条', code: 'B', readFile }));
    }
    if (mod.redirectsFile !== null) add(mod.redirectsFile, await redirectsIssues(mod, modIds, readFile));
    for (const file of mod.nestedIndexFiles) {
      add(file, {
        code: 'D',
        problem: `Mod 不能建在另一个 Mod 下面:这个文件在 ${mod.id} 的目录里面,不会被当作一个 Mod`,
        fix: '把它移到 content/mods/ 下,自己占一个目录(content/mods/<目录名>/_index.md)。在 CMS 里,Mod 只能从左侧「Mod」→「新建」里建。',
      });
    }
  }

  for (const file of layout.strayFiles) {
    add(file, {
      code: 'E',
      problem: '这个文件直接放在 mods/ 下,不在任何 Mod 的目录里,不会被读取',
      fix: '把它移到 content/mods/<mod 的目录名>/items/ 或 mechanics/ 下;不需要的话就删掉。',
    });
  }
  for (const dir of layout.legacyDirs) {
    add(dir, {
      code: 'F',
      problem: '这是旧目录,构建已经不再读取它',
      fix: '把里面的文件搬到对应 Mod 的目录下(content/mods/<mod 的目录名>/items/ 或 mechanics/),然后删掉这个目录。',
    });
  }

  const checkName = (file, name) => {
    if (NAME_RE.test(name) && !name.startsWith('.')) return;
    add(file, {
      code: 'G',
      problem: `文件名「${name}」不合规:只能用英文、数字、短横线、下划线、点和中文,不能以点开头`,
      fix: '给文件换一个名字,建议用小写英文加短横线。在 CMS 里点「设置文件名」可以改。',
    });
  };
  const pagesNamed = [
    ...layout.sections.map((page) => [page.file, page.slug]),
    ...layout.site.map((page) => [page.file, page.slug]),
    ...layout.mods.flatMap((mod) => [
      ...mod.mechanics.map((page) => [page.file, page.slug]),
      ...mod.items.map((entry) => [entry.file, entry.id]),
    ]),
  ];
  for (const [file, name] of pagesNamed) checkName(file, name);

  const mechanicFilesBySlug = new Map();
  for (const mod of layout.mods) {
    for (const page of mod.mechanics) {
      if (!mechanicFilesBySlug.has(page.slug)) mechanicFilesBySlug.set(page.slug, []);
      mechanicFilesBySlug.get(page.slug).push(page.file);
    }
  }
  for (const [slug, files] of mechanicFilesBySlug) {
    if (files.length < 2) continue;
    for (const file of files) {
      add(file, {
        code: 'H',
        problem: `${files.length} 个 Mod 下有同名的机制页「${slug}」:${files.join('、')}。机制页的地址是 mechanics/${slug}.html,重名会互相覆盖`,
        fix: '给其中几篇换一个文件名。在 CMS 里点「设置文件名」可以改。',
      });
    }
  }

  for (const section of layout.sections) {
    const listed = splitFrontmatter(await readFile(section.file)).fm.mods;
    for (const value of Array.isArray(listed) ? listed : []) {
      if (modIds.has(String(value))) continue;
      add(section.file, {
        code: 'J',
        problem: `分区里列了一个不存在的 Mod:${String(value)}`,
        fix: `在 CMS 里打开这个分区,从「包含的 mod」里去掉它;或者先把 Mod ${String(value)} 建出来。`,
      });
    }
  }

  const items = data?.items ?? [];
  const itemIds = items.map((it) => it.id);
  const modOfItem = new Map(items.map((it) => [it.id, it.mod]));
  const entriesOfItem = new Map(); // 真实物品 ID → 指向它的词条(跨 mod)
  for (const mod of layout.mods) {
    for (const entry of mod.items) {
      add(entry.file, await itemIdFieldIssue(entry, readFile));
      // A file name that differs from the id by case only still names its item (resolveItemId).
      const realId = resolveItemId(entry.id, itemIds);
      if (realId === null) {
        if (!handwrittenItems) {
          add(entry.file, {
            code: 'L',
            problem: `这一篇的文件名「${entry.id}」不是任何一件已导出物品的 ID`,
            fix: '把文件名改成真实物品的 ID(物品详情页的「物品ID」一栏可以查到)。在 CMS 里用「物品 ID」一栏,从本 mod 已导出的物品里选。',
          });
        }
        continue;
      }
      if (!entriesOfItem.has(realId)) entriesOfItem.set(realId, []);
      entriesOfItem.get(realId).push(entry.file);
      const owner = modOfItem.get(realId);
      if (owner != null && owner !== mod.id) {
        add(entry.file, {
          code: 'M',
          problem: `物品「${realId}」属于 ${owner},这一篇却写在 ${mod.id} 的目录下`,
          fix: `把这一篇移到 content/mods/${owner}/items/ 下。`,
        });
      }
    }
  }
  for (const [realId, files] of entriesOfItem) {
    if (files.length < 2) continue;
    for (const file of files) {
      add(file, {
        code: 'O',
        problem: `物品「${realId}」有 ${files.length} 份词条:${files.map((f) => path.basename(f)).join('、')}。同一个物品只能有一份词条,多出来的会互相覆盖`,
        fix: '只保留一份:在 CMS 里打开不需要的那几篇,把它们删掉。',
      });
    }
  }

  // 每张图片发到它所在文件夹的每一处 dests;同一个位置出现两个来源就会互相覆盖。
  const published = new Map(); // `<dest>/<相对路径>` → 来源文件
  for (const folder of layout.imageFolders) {
    for (const file of await listFiles(folder.imagesDir)) {
      const rel = toPosix(path.relative(folder.imagesDir, file));
      for (const dest of folder.dests) {
        const key = `${dest}/${rel}`;
        if (!published.has(key)) published.set(key, []);
        published.get(key).push(file);
      }
    }
  }
  for (const [key, sources] of published) {
    if (sources.length < 2) continue;
    for (const file of sources) {
      add(file, {
        code: 'N',
        problem: `这张图片会和另外 ${sources.length - 1} 张图片发到同一个位置,互相覆盖:${key}`,
        fix: '给其中一张改名,让它和别的图片不重名。',
      });
    }
  }

  const rank = (code) => ISSUE_ORDER.indexOf(code);
  return issues.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || rank(a.code) - rank(b.code));
}

/**
 * 贡献者可读的报告:标题带数量,每处问题三行,最后一句提示。
 * @param {Array<{ file: string, problem: string, fix: string }>} issues
 * @returns {string}
 */
function formatContentIssues(issues) {
  const entries = issues.map((issue, i) =>
    `  ${i + 1}. 文件:${toPosix(issue.file)}\n     问题:${issue.problem}\n     怎么改:${issue.fix}`);
  return [
    `[content] FAIL — 发现 ${issues.length} 处问题:`,
    ...entries,
    '提示:在文件里找不到上面说的内容时,请联系维护者。改好之前,网站不会更新。',
  ].join('\n');
}

module.exports = { lintContent, formatContentIssues, ISSUE_ORDER, NAME_RE };
