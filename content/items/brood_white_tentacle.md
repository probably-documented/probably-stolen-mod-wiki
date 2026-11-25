---
slug: 'brood_white_tentacle'
usage:
  - type: 'eat'
    text: '巢里长出来的口粮:可以直接吃,是稳定的食物来源'
    source: '据 zh.csv item.brood_white_tentacle.desc'
  - type: 'drag-target'
    text: '直接拖到 [[maiden_lower]] 苗床身上交配:口交/性交/肛交次数各 +1~2、调教值 +3~6,首次使用会同时转换处女与后庭标记;并有默认 12% 概率胸部变大一档(贫乳→普乳→巨乳)、10% 概率体态成熟一档(萝莉→少女→御姐→少妇→熟女),两档封顶、概率可在模组设置中调整。同一只触手每天限用一次'
    source: '据 TentacleUse.cs Use 默认分支、TryGrow/TryShiftBody、Settings.cs WhiteGrow/WhiteBody 默认值与 zh.csv tip.white.use 词条'
  - type: 'process'
    text: '用刀(拖刀上去)切成 [[brood_tentacle_meat_large]] / [[brood_tentacle_meat]] / [[brood_tentacle_meat_small]] 三档肉块,大块可再切 2 中块、中块切 2 小块'
    source: '据 item.brood_white_tentacle.desc 与 Meat.cs IsKnife 分支'
  - type: 'sell'
    text: '整条或切块出售变现'
    source: '据 Meat.cs 肉块价值阶梯'
sources:
  - source: '卵孵化'
    detail: '[[brood_egg]] 孵化产出的基础形态;[[brood_larva]] 长成后的默认去向之一'
    probability: '孵化循环产出(据 manifest Description)'
categories:
  - '食物'
related:
  - 'brood_egg'
  - 'brood_larva'
  - 'brood_tentacle_meat_large'
  - 'maiden_lower'
notes: '「泛着粉光的白触手,肥嫩得轻轻一按就会陷下去。」(据 zh.csv item.brood_white_tentacle.desc)它不走五色的喂养/升级循环:不能被喂食升级、不能部署共生,本体吞下也没有基因经验(据 TentacleItems.cs CanFeed 的 IsFunctional 判定、NestItems.cs CanDeploy 与 BodyActions.cs Absorb 的 White 排除);它的「营养」(1600+200×等级)是卵期孵化喂食决定的另一条线(据 BranchInfo.cs WhiteKcal 与 BROOD_WHITE_BONUS 链),详见[本体吞噬进化](../mechanics/brood-devour-evolution.html)的区分说明。'
---
