---
slug: 'barrel_milk_diluted'
usage:
  - type: 'use'
    text: '点击使用后输入要取出的瓶数,逐瓶放回 [[milk_diluted]]:成功放置一瓶才扣一次,空间不足即停止,余量留桶;次数用完后桶消失'
    source: '据 ItemFactory.cs SetupBarrelCallbacks(BarrelDispense.Open)与 UseCountHelper(destroyOnEmpty)'
  - type: 'drag-target'
    text: '把瓶装 [[milk_diluted]] 拖到桶上补充,一比一换算,每桶上限 1000 次'
    source: '据 ItemFactory.cs SetupLiquidTargeting 与机制页 barrel-system'
sources:
  - source: '自动装桶'
    detail: '每晚结算后扫描本体产出区:已有同类桶先自动补满,剩余瓶装满 3 瓶且「自动新建」开启时新建一桶(开关默认开启)'
    probability: '3 瓶阈值(据玩法指南桶装表)'
categories:
  - '奢侈品'
related:
  - 'milk_diluted'
  - 'barrel_milk_wondrous'
  - 'barrel_milk_rich'
notes: '占格 4×4;关闭自动新建后已有桶仍自动补充,手动拖拽充填与取出不受影响(据玩法指南)。'
---
