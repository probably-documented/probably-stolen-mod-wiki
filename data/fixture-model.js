'use strict';

// Task 4: FIXTURE_DATA — the CI mini WIKI_DATA literal, moved verbatim from
// modwiki tools/build/build.js L56-95 (fixture mode of the full builder).
// Frozen on purpose: callers structuredClone() before rendering (source
// discipline), so the shared literal can never be mutated by a build.

const FIXTURE_DATA = Object.freeze({
  generatedAt: '2026-11-18T10:00:00.000Z',
  baseline: {
    date: '2026-11-18',
    versions: {
      lewd_meme: '1.9.2', lewd_meme_remake: '1.6.4', 'claude.lewdMemeBrood': '0.3.31',
      lewd_meme_brothel: '0.10.4', lewd_meme_legacy_content: '1.0.6', dui_mian_lan_qiu_ji_tearl: '7',
    },
  },
  mods: [
    { id: 'lewd_meme', name: '淫色深空:可能是触手', version: '1.9.2', author: 'tentacle', prerequisites: [], description: '家族主模组。苗床与触手本体。\n【1.9.2】修复苗床产出。', itemCount: 2 },
    { id: 'lewd_meme_remake', name: '暗流交易', version: '1.6.4', author: 'remake', prerequisites: ['lewd_meme'], description: '三种自有乳汁与桶装系统。\n【1.6.4】新增疲劳与估值机制。', itemCount: 2 },
    { id: 'claude.lewdMemeBrood', name: '巢穴扩展', version: '0.3.31', author: 'brood', prerequisites: ['lewd_meme'], description: '触手卵孵化与功能触手。', itemCount: 1 },
    { id: 'lewd_meme_brothel', name: '掌上青楼', version: '0.10.4', author: 'brothel', prerequisites: ['lewd_meme'], description: '青楼经营玩法。', itemCount: 1 },
    { id: 'lewd_meme_legacy_content', name: '可能有互动', version: '1.0.6', author: 'legacy', prerequisites: ['lewd_meme'], description: '旧版互动内容合集。', itemCount: 0 },
    { id: 'dui_mian_lan_qiu_ji_tearl', name: 'tearlaments', version: '7', author: 'tear', prerequisites: ['lewd_meme'], description: '深海来客。', itemCount: 1 },
  ],
  items: [
    { id: 'wondrous_milk', aliases: ['milk_wondrous'], name: '神奇乳汁', mod: 'lewd_meme', price: 180, shape: [2, 3], icon: 'items/lewd_meme/item_milk.png', categories: ['饮料', '食物'], tags: ['奢侈品'], description: '苗床产出的核心液体物品。', flavor: '苗床以人类的食物为原料酿出的乳汁。', usage: [{ type: 'use', text: '<b>直接饮用</b>:恢复体力 30 点。', source: '本体' }, '装入 [[milk_barrel]] 增加存量。'], sources: [{ source: '苗床产出', detail: '夜间结算时苗床产乳', probability: '每夜 1+ 瓶' }, '商人随机带货'], related: ['milk_barrel', 'milk_rich'], notes: '启用 [[milk_barrel]] 对应的模组后由 2×3 版本接管注册,历史别名 milk_wondrous 仍可识别。', provenance: { price: 'csv:物品定义', description: 'loc:lewd_meme' } },
    { id: 'tentacle_body', aliases: [], name: '触手本体', mod: 'lewd_meme', price: 90, shape: [1, 1], icon: 'items/lewd_meme/tentacle_body.png', categories: ['工具'], tags: [], description: '触手本体。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
    { id: 'milk_barrel', aliases: [], name: '神奇乳汁桶', mod: 'lewd_meme_remake', price: 150, shape: [1, 1], icon: 'items/lewd_meme_remake/barrel.png', categories: ['容器'], tags: [], description: '桶装容器。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
    { id: 'milk_rich', aliases: [], name: '浓郁乳汁', mod: 'lewd_meme_remake', price: 300, shape: [1, 1], icon: 'items/lewd_meme_remake/milk_high.png', categories: ['饮料'], tags: [], description: '价值最高的乳汁。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
    { id: 'brood_egg', aliases: [], name: '触手卵', mod: 'claude.lewdMemeBrood', price: 120, shape: [1, 1], icon: 'items/claude.lewdMemeBrood/brood_egg.png', categories: ['工具'], tags: [], description: '可孵化为功能触手。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
    { id: 'palm_brothel', aliases: [], name: '掌上青楼', mod: 'lewd_meme_brothel', price: 200, shape: [1, 1], icon: 'items/lewd_meme_brothel/palm.png', categories: [], tags: [], description: '青楼经营终端。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
    { id: 'tear_merchant', aliases: [], name: null, mod: 'dui_mian_lan_qiu_ji_tearl', price: null, shape: [1, 1], icon: null, categories: [], tags: [], description: '收购少女与高品质的水。', flavor: null, usage: [], sources: [], related: [], notes: null, provenance: {} },
  ],
  mechanics: [
    { slug: 'night-settlement', title: '夜间结算与疲劳', source: '# 夜间结算与疲劳\n\n介绍 [[wondrous_milk]] 每晚的产出与疲劳运算。\n\n## 结算顺序\n\n原版完成后追加三种自有乳汁。\n\n## 疲劳等级与系数\n\n入夜疲劳达到 90 时暂停活动。' },
    { slug: 'barrel-system', title: '桶装系统', source: '# 桶装系统\n\n桶上限 1000 次,支持批量取出。' },
  ],
  news: [
    { date: '11-18', text: '暗流交易 1.6.4:疲劳与估值机制页重写' },
    { date: '11-17', text: '巢穴扩展 0.3.31:六色功能触手条目补全' },
  ],
  changelog: [
    { mod: 'lewd_meme_remake', version: '1.6.4', date: '', text: '新增疲劳与估值机制' },
    { mod: 'lewd_meme', version: '1.9.2', date: '', text: '修复苗床产出' },
  ],
  facets: { categories: ['容器', '饮料', '食物', '工具'] },
});

module.exports = { FIXTURE_DATA };
