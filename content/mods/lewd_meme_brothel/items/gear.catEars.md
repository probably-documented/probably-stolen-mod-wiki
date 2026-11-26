---
item_id: 'gear.catEars'
mod: lewd_meme_brothel
title: ''
price: 180
usage:
  - type: 'drag-target'
    text: '拖到少女身上直接更换:占据「头饰」部位,带【猫耳】特征标签'
    source: '据 GearCatalog.cs(catEars=Head/BROTHEL_TRAIT_CAT_EARS)与 zh.csv gear.tooltip'
  - type: 'process'
    text: '与 [[gear.catTailPlug]] 成套搭配;在青楼经营中命中想要猫耳的客人,预算 +10%'
    source: '据 zh.csv gear.catTailPlug.description「适合搭配猫耳」与 palm.tooltip'
sources:
  - source: '[[merchant]] 出售'
    detail: '寐空 梦首次来访固定上架的三件之一,基础价 180 信用;后续来访从全部六件服饰中随机上 3~6 件'
    probability: '首访必刷;后续随机(据 GearCatalog.cs RollStock 与 ItemValue)'
categories:
  - '服饰'
related:
  - 'gear.catTailPlug'
  - 'merchant'
  - 'palm'
notes: '「耳朵会随着情绪轻轻抖动。」(据 zh.csv gear.catEars.flavor)'
---
