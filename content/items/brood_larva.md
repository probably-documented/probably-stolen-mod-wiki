---
slug: 'brood_larva'
usage:
  - type: 'drag-target'
    text: '放进孵卵巢的培养区,喂饱了才会慢慢长大;长成后成为 [[brood_white_tentacle]](口粮)或红/绿/黄/蓝/紫功能触手。功能触手成体从 Lv0 起步,之后靠把食物拖到触手身上喂养升级(上限 = 对应基因等级 + 1),养成循环见[本体吞噬进化](../mechanics/brood-devour-evolution.html)'
    source: '据 zh.csv item.brood_larva.desc、NestCycle.cs Mature/NewAdult(成体 Lv0 出场)与 manifest Description'
  - type: 'process'
    text: '幼体每夜从水巢汲取水分、从基础巢吃存粮,营养不良会停止成长'
    source: '据 zh.csv item.brood_water_nest.desc / item.brood_base_nest.desc'
sources:
  - source: '卵孵化'
    detail: '[[brood_egg]] 在孵化区孵出幼体(带名字后缀「触手幼体({0})」)'
    probability: '孵化成功即得(据 manifest 与 item.brood_larva.named)'
related:
  - 'brood_egg'
  - 'brood_nest'
  - 'brood_sym_nest'
  - 'brood_white_tentacle'
notes: '吞噬反哺:本体每主动吞噬一定数量个体,卵与幼体培养速度提升(据 zh.csv tip.nest.feedback)。'
---
