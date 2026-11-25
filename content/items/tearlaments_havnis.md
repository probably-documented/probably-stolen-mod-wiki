---
slug: 'tearlaments_havnis'
price: 300
shape:
  - 4
  - 4
usage:
  - type: 'buy'
    text: '从 [[tearlaments_kitkallos]] 的柜台直售表买下(对话结束后三位歌姬一起上架)'
    source: '据 CustomCustomer.cs PopulateStock'
  - type: 'drag-target'
    text: 'lewd_meme 运行时携带完整苗床协议(MAIDEN_FEMALE/巨乳/处女等标签,深海·酒保·巨乳·御姐,力 3 智 3 魅 4):可被触手体系当作苗床收购与互动;lewd_meme 缺席时作为普通违禁品流通'
    source: '据 MaidenProtocol.cs Apply 与 TearlamentsConfig.cs Maidens[1]'
  - type: 'sell'
    text: '作为违禁品转售;卖给 kitkallos 时按少女类收购价修正结算'
    source: '据 TearlamentsConfig.cs(CONTRABAND)与 CustomCustomer.cs ApplyBuyPriceFeature'
sources:
  - source: '[[tearlaments_kitkallos]] 出售'
    detail: '珠泪哀歌族商人到店开场的柜台直售;「我的三位歌姬打九折」'
    probability: '她到店必上架(据 CustomCustomer.cs PopulateStock)'
categories:
  - '违禁品'
related:
  - 'tearlaments_kitkallos'
  - 'tearlaments_merrli'
  - 'tearlaments_scheiren'
notes: '设定(据 zh-Hans.csv):承载王国隐秘悲伤的人鱼少女,她的痛苦揭开佩尔雷诺表面之下的真实秩序。'
---
