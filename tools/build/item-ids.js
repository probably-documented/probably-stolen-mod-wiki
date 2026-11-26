'use strict';

// 文件名里的物品 id（导入计划 Task 11）。
//
// CMS 保存词条时按「物品 ID」一栏给文件命名；顶层 `slug: { lowercase: false }`
// 生效（0.271.0 实测：改完配置要把页面整个刷新一次），所以保存不会改掉大小写。
// 即便如此，手打的物品 ID 仍可能与真实 id 只差大小写（gear.maidDress 写成
// gear.maiddress）。文件名与真实 id 只差大小写时，构建仍应把它归到那件物品：
// 内容检查、补充层合并、正文读取都走这一个函数，跨平台（Windows 不区分大小写、
// CI 的 Linux 区分）行为一致。
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
