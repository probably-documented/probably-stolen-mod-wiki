---
slug: 'brood_tentacle_meat_large'
price: 52
shape:
  - 2
  - 2
usage:
  - type: 'process'
    text: '用刀再切:一大块可以切成 2 块 [[brood_tentacle_meat]]'
    source: '据 zh.csv item.brood_tentacle_meat_large.desc 与 Meat.cs Grades(next 链)'
  - type: 'sell'
    text: '食物类商品(热量 800,基础价 52),可直接出售或做菜;小窝后厨联动可用触手肉做章鱼烧等菜式'
    source: '据 Meat.cs Grades(kcal 800/value 52)与 manifest「联动小窝后厨经营(章鱼烧)」'
sources:
  - source: '切块'
    detail: '把刀拖到 [[brood_white_tentacle]] 或功能触手上切成大块'
    probability: '切肉必得(据 Meat.cs IsKnife 分支)'
categories:
  - '食物'
related:
  - 'brood_tentacle_meat'
  - 'brood_white_tentacle'
notes: '三档肉块价值成阶梯:大块比同热量的中块贵、中块比小块贵(据 Meat.cs 自检断言)。'
---
