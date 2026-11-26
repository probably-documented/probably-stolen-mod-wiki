---
item_id: 'palm'
mod: lewd_meme_brothel
title: ''
icon: 'items/lewd_meme_brothel/palm_brothel.png'
price: 0
usage:
  - type: 'use'
    text: '点击打开可翻页的掌上终端:每一页是今天预约的一位客人,上方是借用的路人立绘,悬停看想要的特征与预算;「少女」格只能放一位少女,「推销」格 4×4 不限件数'
    source: '据 manifest Description 与 zh.csv palm.description / palm.itemTooltip'
  - type: 'use'
    text: '点「接客」只是锁住这一页,过夜费与推销结果第二天揭晓;每命中一个想要的特征标签,客人预算 +10%;总价超预算时命中 ≥5 个标签才有一半机会被负债买下,预算内必定卖出'
    source: '据 manifest Description 与 zh.csv palm.tooltip / palm.hint 系列'
  - type: 'use'
    text: '过夜费在少女右键菜单里设(0~9999),超过客人预算的少女不能放进这一页;每天预约人数 = 基础 2 + 客源扩建(每次 +2)×展示柜每多一位少女 +1'
    source: '据 manifest Description 与 zh.csv network.profession.description / maiden.rightClickHint'
sources:
  - source: '网络解锁'
    detail: '在「Wild 的人脉」网络花 800 信用解锁「青楼职业」后发放,同时赠送一件 [[gear.maidDress]];物品丢失会重新补发一份'
    probability: '必得(据 NetworkUpgrades.cs AddNetworkUpgrade 800 与 PalmBrothelService 发放逻辑)'
categories:
  - '工具'
related:
  - 'gear.maidDress'
  - 'ledger'
  - 'merchant'
notes: '带【重要物品】【不可转售】标签的容器物品;找不到掌上青楼时游戏会提示重新解锁青楼职业(据 BrothelItemCatalog.cs CreatePalmBrothel 与 zh.csv error.palmMissing)。'
---
