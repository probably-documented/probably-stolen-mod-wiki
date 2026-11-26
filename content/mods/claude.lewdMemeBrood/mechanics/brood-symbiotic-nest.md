---
title: 共生巢部署
mod: claude.lewdMemeBrood
---
*适用版本:巢穴扩展(claude.lewdMemeBrood)v0.3.31,前置 lewd_meme(数据基线 2026-11-18)*

[[brood_sym_nest]] 是留给成年触手栖息的腔室:把长成的功能触手放进部署区(6×6),它们会与你重新连成一体,各显其能(据 Localization/zh.csv item.brood_sym_nest.desc 与 nest.panel.deploy)。功能触手靠喂食升级,等级上限 = 对应支基因等级 + 1(封顶 Lv10,基因等级靠本体吞噬触手积累,详见[本体吞噬进化](brood-devour-evolution.html);据 Genes.cs TentacleCap 与 manifest Description)。

## 五色触手加成

各色触手的部署加成(据 zh.csv ab.str、ab.vit、ab.gld、ab.aqu、ab.nrv 词条与各触手描述):

| 触手 | 部署加成 |
| --- | --- |
| [[brood_tentacle_red]] 红 | 拾荒次数 +(不同条取最高)· 捕获概率 +(可叠加);鞭打力道足以破开石壁,可疑造型或许会迎来盘查 |
| [[brood_tentacle_green]] 绿 | 拾荒次数 +(不同条取最高)· 受伤 −(可叠加);外出拾荒更顺、受的伤更少 |
| [[brood_tentacle_yellow]] 黄 | 每个苗床额外产出 +(取最高)· 分泌物价值 +(可叠加),把乳汁推向更高档位 |
| [[brood_tentacle_aqua]] 蓝 | 每天集水与去杂质,存水悄悄补进孵卵巢;对苗床温和得多 |
| [[brood_tentacle_purple]] 紫 | 触手卵受孕概率 +(可叠加)· 部署 3 条开启 [[fragrance]] |

黄触手的分泌加成会直接推动乳汁档位:底子 + 分泌推档决定最终产出(据 zh.csv tip.milk.base 与 tip.milk.next)。母巢芬芳开启后,店里弥漫若有似无的甜香,让顾客变得好说话(据 item.brood_tentacle_purple.desc)。

## 直接用在苗床身上

不部署也能用:把成体触手直接拖到 [[maiden_lower]] 苗床身上即可交配,同一只触手每天限用一次,效果与触手等级无关(据 TentacleItems.cs 成体拖拽注册、TentacleUse.cs Use 与 zh.csv tip.adult.ready/used 词条)。各色效果:

| 触手 | 对苗床的效果 |
| --- | --- |
| [[brood_tentacle_red]] 红 | 性交 +3~5,首次转换处女标记;调教值 +3~5 |
| [[brood_tentacle_green]] 绿 | 肛交 +3~5,首次转换后庭标记;调教值 +3~5 |
| [[brood_tentacle_yellow]] 黄 | 口交 +3~5,不动任何贞操标记;调教值 +3~5 |
| [[brood_tentacle_aqua]] 蓝 | 口交/性交/肛交各 +1~2,首次同时转换处女与后庭标记;调教值 +3~6 |
| [[brood_tentacle_purple]] 紫 | 口交/性交/肛交各 +1~2,首次同时转换处女与后庭标记;调教值额外 +5(合计 +8~11) |
| [[brood_white_tentacle]] 白 | 口交/性交/肛交各 +1~2,调教值 +3~6;默认 12% 概率胸部变大一档(贫乳→普乳→巨乳)、10% 概率体态成熟一档(萝莉→少女→御姐→少妇→熟女),两档均封顶 |

数值区间与标记转换据 TentacleUse.cs Use/Apply 分支与 Rng.Range(含两端);白的两项概率为设置默认值,可在模组设置中调整(据 Settings.cs WhiteGrow/WhiteBody)。互动结果以「{触手} 和 {苗床} 互动了一番。(调教值 +N)」提示(据 zh.csv use.result 词条),累计的互动次数与调教值参与收购商估值(处女加价同理,见 [[maiden_lower]])。

## 其它用法

部署不是唯一去向(据 manifest Description 与各触手描述):

- 功能触手可以**直接用在苗床身上**互动,详见上一节。
- 也可以让本体吞下获得基因,详见[本体吞噬进化](brood-devour-evolution.html)。
- 不需要时同样可以切了获取肉块。

## 相关页面

- [触手卵孵化](brood-incubation.html) —— 触手的来源与培养
- [本体吞噬进化](brood-devour-evolution.html) —— 吞噬触手获取基因
- [夜间结算与疲劳](nightly-settlement.html) —— 苗床产出结算
