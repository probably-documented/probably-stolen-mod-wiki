---
item_id: 'barrel_semen'
mod: lewd_meme_remake
title: ''
usage:
  - type: 'use'
    text: '点击使用后输入要取出的瓶数,逐瓶放回 [[tentacle_semen]]:成功放置一瓶才扣一次,空间不足即停止,余量留桶;次数用完后桶消失'
    source: '据 ItemFactory.cs SetupBarrelCallbacks(BarrelDispense.Open)与 UseCountHelper(destroyOnEmpty)'
  - type: 'drag-target'
    text: '把瓶装 [[tentacle_semen]] 拖到桶上补充,一比一换算,每桶上限 1000 次'
    source: '据 ItemFactory.cs SetupLiquidTargeting 与机制页 barrel-system'
sources:
  - source: '自动装桶'
    detail: '每晚结算后扫描本体产出区:已有同类桶先自动补满,剩余瓶装满 8 瓶且「自动新建」开启时新建一桶(开关默认开启)'
    probability: '8 瓶阈值(据玩法指南桶装表)'
categories:
  - '违禁品'
  - '奢侈品'
related:
  - 'tentacle_semen'
  - 'barrel_milk_wondrous'
notes: '占格 4×4,II 级管制品(完成治安部支线「30 份精液交货」后列入);管制品不记对应违禁案值;桶装不作为剧情要求的瓶装材料,交任务前先取出(据 ItemFactory.cs contrabandLevel 2、机制页 security-branch / barrel-system)。'
---
