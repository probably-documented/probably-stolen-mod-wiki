---
item_id: 'brood_tentacle_meat'
mod: claude.lewdMemeBrood
title: ''
price: 23
shape:
  - 2
  - 1
usage:
  - type: 'process'
    text: '用刀再切:中块可以切成 2 块 [[brood_tentacle_meat_small]]'
    source: '据 zh.csv item.brood_tentacle_meat.desc 与 Meat.cs Grades(next 链)'
  - type: 'sell'
    text: '食物类商品(热量 400,基础价 23),可直接出售或做菜'
    source: '据 Meat.cs Grades(kcal 400/value 23)'
sources:
  - source: '切块'
    detail: '把刀拖到 [[brood_white_tentacle]] / 功能触手上,或把大块再切获得'
    probability: '切肉必得(据 Meat.cs)'
categories:
  - '食物'
related:
  - 'brood_tentacle_meat_large'
  - 'brood_tentacle_meat_small'
notes: '「切好的触手肉。用刀可以再切成 2 块小块。」(据 zh.csv item.brood_tentacle_meat.desc)'
---
