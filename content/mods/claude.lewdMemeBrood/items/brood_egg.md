---
item_id: 'brood_egg'
mod: claude.lewdMemeBrood
title: ''
usage:
  - type: 'drag-target'
    text: '放进孵卵巢的孵化区(6×6),逐夜累积孵化进度;把不同类型的液体(乳汁、精液等或疑似液体的物品)放到卵壳上,会影响孵出什么——卵壳会自己开口要某种成分(血肉/药腐/甜烈/清水/香麻)'
    source: '据 zh.csv item.brood_egg.desc 与 egg.hint.need.* / egg.guide.* 词条'
  - type: 'process'
    text: '不在孵化区里的卵,数夜后枯萎成 [[brood_nutrient_egg]],只能当营养材料'
    source: '据机制页 brood-incubation 与 zh.csv tip.egg.spoil'
sources:
  - source: '苗床产卵'
    detail: '苗床夜间受孕后怀上并产下;部署紫触手可提高触手卵受孕概率'
    probability: '夜间受孕判定(据 manifest Description 与 ab.nrv 词条)'
categories:
  - '食物'
related:
  - 'brood_nest'
  - 'brood_larva'
  - 'brood_nutrient_egg'
  - 'brood_tentacle_purple'
notes: '孵化有概率失败:卵壳变异没成功时留下 [[brood_failed_seedling]],要从头来过(据 zh.csv egg.guide.fail)。'
---
