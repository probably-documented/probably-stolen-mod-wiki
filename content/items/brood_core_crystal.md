---
slug: 'brood_core_crystal'
usage:
  - type: 'use'
    text: '持有它且本体达到 Lv2 即触发觉醒:当晚触手渴望发作,长出 [[brood_nest]] 孵卵巢;「靠近它时,体内的什么东西会跟着发烫。」'
    source: '据 manifest Description 与 BroodVersionMerge.cs(bodyLevel>=2 && Has(brood_core_crystal) → awakeReady)'
sources:
  - source: '李北文送货'
    detail: '本体 Lv2 且卖过或对来客用过触手精液后,李北文会在一周内带来源晶(放进你的库存)'
    probability: '满足条件必来(据 manifest Description 与 LiVisit.cs Spawn)'
related:
  - 'brood_nest'
  - 'tentacle_body'
  - 'tentacle_semen'
notes: '是巢穴扩展整条孵化/吞噬线的起点道具;旧存档迁移时会按「已持有源晶」补齐觉醒状态(据 BroodVersionMerge.cs)。'
---
