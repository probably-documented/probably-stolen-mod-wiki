'use strict';

// 文件名里的物品 id（导入计划 Task 11）。
//
// Sveltia CMS 0.271.0 保存条目时把文件名小写化——即使配置了顶层
// `slug: { lowercase: false }`（实测：gear.maidDress 存成 gear.maiddress.md，
// gear.catEars 存成 gear.catears.md）。文件名与真实 id 只差大小写时，构建仍
// 应把它归到那件物品：id lint、slug lint、补充层合并、正文读取都走这一个
// 函数，跨平台（Windows 不区分大小写、CI 的 Linux 区分）行为一致。
//
// 只接受"大小写不敏感的唯一匹配"：精确命中优先；没有精确命中而简称命中了
// 多个 id（真实数据里没有这种情况）按有歧义处理，返回 null。

/**
 * @param {string} fileId 文件名里的 id（不含 .md）
 * @param {Iterable<string>} ids 数据里的真实物品 id
 * @returns {string|null} 命中的真实 id；没有命中或有歧义时为 null
 */
function resolveItemId(fileId, ids) {
  const all = [...ids];
  if (all.includes(fileId)) return fileId;
  const lower = fileId.toLowerCase();
  const matches = all.filter((id) => id.toLowerCase() === lower);
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { resolveItemId };
