---
slug: 'milk_rich'
usage:
  - type: 'drag-target'
    text: '拖到苗床少女身上喂食:疲劳 −25(下限 40,已低于或等于 40 时不消耗)'
    source: '据 ItemFactory.cs CreateMilkVariant(relief 25)与 MaidenFatigue.cs Feed'
  - type: 'drink'
    text: '点击自己喝掉:立即 +30 信用点,瓶子销毁(「饮下一瓶浓缩乳汁」)'
    source: '据 ItemFactory.cs CreateMilkVariant onActivateSlotItemFunc'
  - type: 'sell'
    text: '单价固定 150,是三种追加乳汁中的高价档;橱窗摆出它可提高收购商到店概率'
    source: '据 ItemFactory.cs unitValue 与玩法指南「收购商」节'
  - type: 'process'
    text: '产出区攒满 3 瓶自动新建/补充 [[barrel_milk_rich]];也可手动拖到同类桶上补充'
    source: '据机制页 barrel-system'
sources:
  - source: '夜间结算追加'
    detail: '贫乳苗床泌乳等级 ≥1(或怀孕)时每夜追加;泌乳等级 2 起每级 +30 个百分点,概率超 100% 后可能多份;每份先扣产出区一瓶原版 [[wondrous_milk]]'
    probability: '基础 30%,随泌乳等级提升(据玩法指南三种追加乳汁表)'
categories:
  - '奢侈品'
  - '饮料'
  - '零食'
  - '食物'
related:
  - 'milk_diluted'
  - 'wondrous_milk'
  - 'barrel_milk_rich'
notes: '完成治安部支线后的归档服务按案值要求本物品(据玩法指南/机制页 security-branch)。'
---
