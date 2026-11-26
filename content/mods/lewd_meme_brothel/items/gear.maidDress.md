---
item_id: 'gear.maidDress'
mod: lewd_meme_brothel
title: ''
price: 260
usage:
  - type: 'drag-target'
    text: '拖到少女身上直接更换:占据「身体」部位,带【女仆】特征标签,能命中想要女仆的客人预算 +10%'
    source: '据 GearCatalog.cs(maidDress=Body/BROTHEL_TRAIT_MAID)与 zh.csv gear.tooltip'
  - type: 'process'
    text: '在青楼经营中给侍奉少女穿戴,提升客人标签命中数;也可以通过少女右键菜单脱下收回'
    source: '据 zh.csv gear.tooltip 与 maiden.menu.noGear / context.strip'
sources:
  - source: '职业解锁赠送'
    detail: '解锁青楼职业时随 [[palm]] 一并发放一件(解锁礼,发放失败会重试)'
    probability: '必得一件(据 MerchantService.cs EnsureStarterGear)'
  - source: '[[merchant]] 出售'
    detail: '首次来访固定上架的三件之一,基础价 260 信用'
    probability: '首访必刷(据 GearCatalog.cs FirstVisitItemIds 与 BrothelItemCatalog.cs ItemValue)'
categories:
  - '服饰'
related:
  - 'palm'
  - 'gear.laceDress'
  - 'merchant'
notes: '服饰均占格 2×2(据 BrothelItemCatalog.cs CreateGear 形状校正)。'
---
