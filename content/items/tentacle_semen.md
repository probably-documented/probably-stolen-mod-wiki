---
slug: 'tentacle_semen'
usage:
  - type: 'drag-target'
    text: '拖到 [[corrupt_tentacle]] 身上吸收淫力,每瓶 +10,可多瓶一起拖,溢出不会浪费瓶子'
    source: '据 manifest 1.9.2 / 1.3.10'
  - type: 'drag-target'
    text: '把 [[empty_syringe]] 拖到精液上,消耗一瓶精液,空针管变成 [[ovulation_shot]]'
    source: '据 manifest 1.7.0'
  - type: 'use'
    text: '对女性是「只对女性生效的费洛蒙香水」:为女性顾客提供声望加成,同一顾客只乘一次、重复使用不消耗精液'
    source: '据 manifest 1.0.0 / 1.3.1'
sources:
  - source: '夜间结算产出'
    detail: '苗床每夜结算按产出率掷瓶,落在产出区;产出率 = 40% + 调教值×1%(60 点必定产出)'
    probability: '40%~100%(据 NightlyPatch.cs 复刻公式 / tentacle_manual desc)'
  - source: '[[tentacle_alarm]] 产出'
    detail: '每夜固定产出一瓶'
    probability: '每夜 1 瓶(据 manifest 1.4.0)'
  - source: '[[tentacle_trap]] 产出'
    detail: '苗床区里每有一个少女,各自判定产出一瓶'
    probability: '每名苗床 50%(据 manifest 1.6.1)'
related:
  - 'corrupt_tentacle'
  - 'empty_syringe'
  - 'ovulation_shot'
  - 'wondrous_milk'
notes: '蕴藏淫力 10 点,物品详情里会显示(据 manifest 1.9.2);对女性充满吸引力,男性闻起来作呕(据物品定义.csv desc)。'
---
