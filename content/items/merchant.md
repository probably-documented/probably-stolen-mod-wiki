---
slug: 'merchant'
icon: 'items/lewd_meme_brothel/mei_meng.png'
description: '有着岛国血脉,却没能跟上星际时代,只能在深空里自己讨生活的服饰商人(据 zh.csv ledger.merchantProfile)'
usage:
  - type: 'sell'
    text: '固定服饰商人:解锁青楼职业的次日开始不定期来访,把当批服饰放上柜台直售表卖给你;首次来访固定带 [[gear.maidDress]]、[[gear.catEars]]、[[gear.catTailPlug]] 三件,之后每次随机上架 3~6 件'
    source: '据 MerchantService.cs AddStock / GearCatalog.cs RollStock 与 FirstVisitItemIds'
  - type: 'sell'
    text: '成交台词与砍价对话:「多买两件嘛,姐姐也要吃饭的。」;每次成交计入 [[ledger]] 的来访/成交统计'
    source: '据 zh.csv merchant.accept / visit 系列与 MerchantService.cs onItemSold'
sources:
  - source: '到店顾客'
    detail: '设定:有着岛国血脉、在深空里自己讨生活的服饰商人;解锁青楼职业当天 +1 日首次来访,之后每隔 4~10 天再来'
    probability: '首访必来,复访间隔 4~10 天(据 MerchantSchedule.cs)'
related:
  - 'palm'
  - 'ledger'
  - 'gear.maidDress'
notes: '账本里存着她的台词「可别把姐姐忘了呀~」(据 zh.csv merchant.done / ledger.merchantProfile)。'
---
