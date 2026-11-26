---
item_id: 'fragrance'
mod: claude.lewdMemeBrood
title: ''
usage:
  - type: 'use'
    text: '紫触手部署满 3 条开启的常驻效果:店里弥漫若有似无的甜香,让顾客变得好说话——你出售的物品挂 +价格特征(至多 +25%),要收购的物品挂 −价格特征(至多 −15%),强度随部署加成变化'
    source: '据 Fragrance.cs Apply(0.25/0.15 × strength)与 Tune.cs FragranceSellMax/FragranceBuyMax、zh.csv ab.nrv / fragrance.name'
sources:
  - source: '共生巢部署'
    detail: '[[brood_sym_nest]] 部署 3 条紫触手后自动生效,无需使用任何物品'
    probability: '3 条紫触手(据 zh.csv ab.nrv)'
related:
  - 'brood_tentacle_purple'
  - 'brood_sym_nest'
notes: '它不是背包物品,而是挂在交易物品上的「母巢芬芳」价格特征;物品目录里注册了同名条目,故 wiki 保留此页(据 Fragrance.cs RemoveItemFeatureByID("broodFragrance") 与 manifest)。'
---
