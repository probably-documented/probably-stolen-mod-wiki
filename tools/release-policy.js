'use strict';

// 离线包的发布规则,纯函数,不做任何读写。发布工作流经 tools/should-release.js 调用它;
// 推送、定时、手动三种触发走的是这同一条规则。
//
// 两个包之间至少隔 3 天,有更新才发:自上一个 Release 以来 main 有新提交,
// 并且距上一个 Release 已满 3 天。

const DAY = 24 * 60 * 60 * 1000;

/** 两个包之间的最短间隔。 */
const COOLDOWN_MS = 3 * DAY;

/** `2026-12-01T23:59:59Z` → `2026-12-01`:标签和包名用的是 UTC 的日历日(CI 上也是 UTC)。 */
const utcDate = (date) => date.toISOString().slice(0, 10);

/** Release 的标签:`offline-<YYYY-MM-DD>`。 */
function releaseTagName(date) {
  return `offline-${utcDate(date)}`;
}

/** 离线包的文件名:`offline-wiki-<YYYY-MM-DD>.zip`。 */
function zipNameFor(date) {
  return `offline-wiki-${utcDate(date)}.zip`;
}

/**
 * 这一次要不要发布。
 *
 * @param {object} args
 * @param {null | { tagName: string, sha: string, publishedAt: Date }} args.latest
 *   上一个 Release:标签、它指向的提交、发布时间。还没有 Release 就是 null
 * @param {string} args.headSha 这次要发布的提交
 * @param {number} args.now 现在的毫秒时间戳
 * @returns {{ release: boolean, reason: string }} 发不发,以及原因
 */
function decideRelease({ latest, headSha, now }) {
  if (latest == null) return { release: true, reason: 'first release: there is no release yet' };
  if (latest.sha === headSha) return { release: false, reason: `nothing changed since ${latest.tagName}` };
  // 恰好满 3 天算冷却已过,所以只有「小于」才拦
  if (now - latest.publishedAt.getTime() < COOLDOWN_MS) {
    return { release: false, reason: `cooldown: the last release ${latest.tagName} is under 3 days old` };
  }
  return { release: true, reason: `changes since ${latest.tagName}, and the cooldown is over` };
}

module.exports = { COOLDOWN_MS, releaseTagName, zipNameFor, decideRelease };
