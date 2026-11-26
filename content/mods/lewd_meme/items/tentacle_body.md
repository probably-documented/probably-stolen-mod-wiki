---
item_id: 'tentacle_body'
mod: lewd_meme
title: ''
usage:
  - type: 'use'
    text: '点击打开本体窗口,管理五个分区:侵蚀区 3×16(收触手侵蚀类箱子)、苗床区 16×16(收女性角色)、产出区 16×16(收乳汁/精液)、触手区 3×16(收触手类工具)、便签区 2×2(收说明书)'
    source: '据 tentacle_manual desc(物品定义.csv)'
  - type: 'drag-target'
    text: '把 [[maiden_lower]] 拖进苗床区,每夜自动结算调教并产出 [[wondrous_milk]] / [[tentacle_semen]];本体等级越高每晚行为次数越多'
    source: '据 tentacle_manual desc 与机制页 maiden-husbandry'
  - type: 'use'
    text: '本体等级无上限(第 n 级需求 = 100 + (n-1)/3×100);侵蚀区是暗格,盘查时里面的东西不会被搜出'
    source: '据 manifest 1.8.0 / 1.3.8'
sources:
  - source: '开局发放'
    detail: '选择「触手起源」天赋后,与 [[corrupt_tentacle]]、[[tentacle_manual]] 三件一起发到仓库,自己拖进对应区域'
    probability: '唯一途径'
related:
  - 'corrupt_tentacle'
  - 'tentacle_manual'
  - 'tentacle_box'
notes: '顾客系统:75% 女性顾客、4×4 客人格、特殊 NPC 保护(据 manifest 1.2.0)。1.4.4 起开局三件套不再预置进触手区/便签区,手动放入的物品存档正常。'
---
