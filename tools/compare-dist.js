'use strict';

// 逐字节比较两份构建输出。用法:
//   node tools/compare-dist.js <A> <B> [--ignore <相对路径前缀>]… [--allow <正则>]…
//
// 每处差异打印一行:A 只有的、B 只有的、内容不同的。以 --ignore 开头的路径不参与比较;
// --allow 匹配到的差异照样打印,但不计入退出码。还有没被允许的差异时退出码是 1。
//
// 站点和离线包是同一份 dist:改了构建之后,拿它证明「不该变的页一个字节都没变」。

const fs = require('node:fs/promises');
const path = require('node:path');

/** 每个文件,相对 dir 的 posix 路径,排序。 */
async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = `${prefix}${entry.name}`;
    if (entry.isDirectory()) out.push(...await listFiles(path.join(dir, entry.name), `${rel}/`));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * @param {string} dirA
 * @param {string} dirB
 * @param {{ ignore?: string[] }} [options] 相对路径的前缀;以它们开头的文件不参与比较
 * @returns {Promise<{ onlyInA: string[], onlyInB: string[], differing: string[], same: number }>}
 *   路径相对各自的目录,已排序
 */
async function compareTrees(dirA, dirB, { ignore = [] } = {}) {
  const skipped = (rel) => ignore.some((prefix) => rel.startsWith(prefix));
  const [rootA, rootB] = [path.resolve(dirA), path.resolve(dirB)];
  const [inA, inB] = [
    (await listFiles(rootA)).filter((rel) => !skipped(rel)),
    (await listFiles(rootB)).filter((rel) => !skipped(rel)),
  ];
  const setB = new Set(inB);
  const result = { onlyInA: [], onlyInB: [], differing: [], same: 0 };
  const seen = new Set();
  for (const rel of inA) {
    seen.add(rel);
    if (!setB.has(rel)) {
      result.onlyInA.push(rel);
      continue;
    }
    const [a, b] = await Promise.all([fs.readFile(path.join(rootA, rel)), fs.readFile(path.join(rootB, rel))]);
    if (a.equals(b)) result.same += 1;
    else result.differing.push(rel);
  }
  result.onlyInB = inB.filter((rel) => !seen.has(rel));
  return result;
}

async function main(argv) {
  const dirs = [];
  const ignore = [];
  const allow = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--ignore' || arg === '--allow') {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} 需要一个值`);
      (arg === '--ignore' ? ignore : allow).push(value);
      i += 1;
    } else {
      dirs.push(arg);
    }
  }
  if (dirs.length !== 2) {
    throw new Error('用法: node tools/compare-dist.js <A> <B> [--ignore <前缀>]… [--allow <正则>]…');
  }
  const result = await compareTrees(dirs[0], dirs[1], { ignore });
  const patterns = allow.map((p) => new RegExp(p));
  const allowed = (rel) => patterns.some((re) => re.test(rel));

  for (const rel of result.onlyInA) console.log(`A only   ${rel}${allowed(rel) ? '   (allowed)' : ''}`);
  for (const rel of result.onlyInB) console.log(`B only   ${rel}${allowed(rel) ? '   (allowed)' : ''}`);
  for (const rel of result.differing) console.log(`differs  ${rel}${allowed(rel) ? '   (allowed)' : ''}`);
  const unallowed = [...result.onlyInA, ...result.onlyInB, ...result.differing].filter((rel) => !allowed(rel)).length;
  console.log(`same ${result.same}  A-only ${result.onlyInA.length}  B-only ${result.onlyInB.length}`
    + `  differing ${result.differing.length}  unallowed ${unallowed}`);
  if (unallowed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[compare] ${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { compareTrees };
