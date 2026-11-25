---
slug: 'tearlaments_aquashard'
icon: 'items/dui_mian_lan_qiu_ji_tearl/tearlaments.png'
price: 800
shape:
  - 4
  - 4
usage:
  - type: 'sell'
    text: '高价奢侈品(基础价 800):受尽折磨的人鱼之泪凝成的珍珠结晶,可直接出售变现;[[tearlaments_kitkallos]] 到店时会收购少女与纯净水/高质量水'
    source: '据 CustomItem.cs CreateAquashard(unitValue 800, LUXURY_ITEM+AQUASHARD)与 CustomCustomer.cs willAcceptItem'
sources:
  - source: '巢穴区夜产'
    detail: '放进触手巢穴扩展(brood)巢穴区的珠泪哀歌族少女,每夜产出一颗水碎片水晶(v15 源码为必产:BroodTribute.Chance=1;manifest Description 写 20% 已过期,以源码为准);她们夜产不产生任何乳汁'
    probability: '每位人鱼每夜 1 颗(据反编译产物 v15 BroodTribute.cs/TearlamentsConfig.cs)'
  - source: '商店购买'
    detail: '具体进货渠道以游戏内货架为准;设定上由古代海洋文明珍视的深海凝结物'
    probability: '待补充'
categories:
  - '奢侈品'
related:
  - 'tearlaments_kitkallos'
notes: '机制页 tearlaments-trade 将其作为「高于基础品质的水」的例子;反编译源码中 kitkallos 的验收名单按水的品质特征(纯净水/高质量水)判定,未直接按 AQUASHARD 标签放行,能否被她收购取决于 WaterHelper 对其特征的识别,待实测(据 CustomCustomer.cs)。'
---
