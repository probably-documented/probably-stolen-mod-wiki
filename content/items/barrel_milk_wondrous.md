---
slug: 'barrel_milk_wondrous'
usage:
  - type: 'use'
    text: '点击使用后输入要取出的瓶数,逐瓶放回乳汁:成功放置一瓶才扣一次,空间不足即停止,余量留桶;次数用完后桶消失'
    source: '据 ItemFactory.cs SetupBarrelCallbacks(BarrelDispense.Open)与 UseCountHelper(destroyOnEmpty)'
  - type: 'drag-target'
    text: '把瓶装乳汁拖到桶上补充(原版 [[wondrous_milk]] 与自有 milk_wondrous 都认),一比一换算,每桶上限 1000 次'
    source: '据 ItemFactory.cs SetupLiquidTargeting 与机制页 barrel-system'
sources:
  - source: '自动装桶'
    detail: '每晚结算后扫描本体产出区:已有同类桶先自动补满;原版神奇乳汁与自有神奇乳汁合计满 3 瓶且「自动新建」开启时新建一桶;追加乳汁每份先扣一瓶原版乳汁或扣本桶一次(先扣后产)'
    probability: '合计 3 瓶阈值(据玩法指南桶装表)'
categories:
  - '奢侈品'
related:
  - 'wondrous_milk'
  - 'barrel_milk_rich'
  - 'barrel_milk_diluted'
notes: '原版没有独立的另一种神奇乳汁桶,本桶沿用现有桶 ID;追加乳汁直接入桶时「本夜追加」与「库存装桶」分项记账(据玩法指南)。占格 4×4。'
---
