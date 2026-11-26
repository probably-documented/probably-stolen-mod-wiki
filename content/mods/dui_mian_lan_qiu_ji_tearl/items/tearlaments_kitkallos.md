---
item_id: 'tearlaments_kitkallos'
mod: dui_mian_lan_qiu_ji_tearl
title: ''
icon: 'items/dui_mian_lan_qiu_ji_tearl/tearlaments.png'
usage:
  - type: 'sell'
    text: '到店的特殊顾客:开场白结束后把三位珠泪哀歌族歌姬放上柜台直售表,可以从她那里买下 [[tearlaments_merrli]] / [[tearlaments_havnis]] / [[tearlaments_scheiren]]'
    source: '据 CustomCustomer.cs ConfigureDialogue→PopulateStock(AddDirectSellingItemToTable)'
  - type: 'sell'
    text: '收购两类东西:任何带 MAIDEN_FEMALE 标签的物品,以及纯净水/高质量水(基础水与水粮不收);对话原文「我会收购少女和高于基础品质的水,价格从优。我的三位歌姬打九折。」'
    source: '据 CustomCustomer.cs willAcceptItem 与 TearlamentsConfig.cs Customer.Accept* 水位开关'
  - type: 'sell'
    text: '收购价修正:整体 buyPriceModifier −10%;放上称台的物品挂价格特征——少女类 −25%(顾客折扣),验收水类 +20%(供货加价)'
    source: '据 CustomCustomer.cs ApplyBuyPriceFeature(-25/+20)与 item_feature_client_discount/supplier_markup'
sources:
  - source: '到店顾客'
    detail: '按下层区市民身份生成,预算 150000+随机 50000,接受违禁品(AcceptingContrabandOverride);角色来自游戏王 Tearlaments 卡组的 Kitkallos'
    probability: '顾客到店池随机(据 CustomCustomer.cs CreateClient 与 manifest Description)'
notes: '价格口径说明:manifest Description 写「歌姬 9 折出售、少女与好水 20% 溢价收购」,反编译源码字面为少女收购特征 −25%、水 +20%、整体 −10%,与 manifest 略有出入,数值以源码为准并在此注明(据 CustomCustomer.cs)。'
---
