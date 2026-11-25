---
slug: 'tearlaments_kitkallos_merge'
price: 500
shape:
  - 4
  - 4
categories:
  - '违禁品'
usage:
  - type: 'process'
    text: '把两件带「珠泪合成」标记的珠泪哀歌族物品(如 [[tearlaments_merrli]]/[[tearlaments_havnis]]/[[tearlaments_scheiren]])放进垃圾桶,立即融合成这位融合体少女;不需要解锁交易也能触发'
    source: '据反编译产物 v15 TearlamentsConfig.cs BinExchange(TriggerTag=TEARLAMENTS_BIN_MERGE/RequiredUnits=2)与 manifest Description'
  - type: 'drag-target'
    text: '走 lewd_meme 少女协议(UseLewdMemeProtocol,深海·研究员·普乳·少女·处女,力/智/魅 4/4/4):可被触手体系当作苗床收购与互动'
    source: '据反编译产物 v15 TearlamentsConfig.cs BinExchange.Result 与 manifest Description'
  - type: 'sell'
    text: '违禁品,4×4,基价 500;卖给 [[tearlaments_kitkallos]] 时按少女类收购价修正结算'
    source: '据反编译产物 v15 TearlamentsConfig.cs(CONTRABAND/UnitValue=500)与 CustomCustomer.cs ApplyBuyPriceFeature'
sources:
  - source: '垃圾桶融合'
    detail: '珠泪哀歌族物品两件一组,丢进垃圾桶即得'
    probability: '必得(据 BinExchange RequiredUnits=2)'
related:
  - 'tearlaments_kitkallos'
  - 'tearlaments_merrli'
  - 'tearlaments_havnis'
  - 'tearlaments_scheiren'
notes: '源码内描述文案仍是占位符「Replace this text when the final item is ready」,页面文案以 zh-Hans.csv 定位文案为准(据反编译产物 v15 与 Localization/zh-Hans.csv)。'
---
