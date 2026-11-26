---
item_id: 'wondrous_milk'
mod: lewd_meme
title: ''
icon: 'items/lewd_meme/item_milk.png'
usage:
  - type: 'sell'
    text: '苗床产出的主要商品,卖给顾客变现;单价随产出苗床的泌乳等级上涨(价值 = 100 + 泌乳等级×40)'
    source: '据 NightlyPatch.cs 复刻公式(MilkValueBase 100 + lv×40)与 tentacle_manual desc'
  - type: 'process'
    text: '启用暗流交易后,与原版乳汁合并计入 [[barrel_milk_wondrous]] 的自动建桶阈值(3 瓶),也可拖到同类桶上补充'
    source: '据机制页 barrel-system'
sources:
  - source: '夜间结算产出'
    detail: '苗床泌乳等级 ≥1 时每夜产出,落在 [[tentacle_body]] 产出区(或闹钟/陷阱的产出区)'
    probability: '泌乳参与结算必出(据 tentacle_manual desc / NightlyPatch.cs)'
related:
  - 'tentacle_body'
  - 'milk_rich'
  - 'milk_diluted'
  - 'barrel_milk_wondrous'
notes: 'flavor 提到上层区太太们愿多付三成(据物品定义.csv flavor);拾荒不再掉落排卵诱发剂后,乳汁/精液是苗床两条稳定产出线(据 manifest 1.3.13)。'
---
