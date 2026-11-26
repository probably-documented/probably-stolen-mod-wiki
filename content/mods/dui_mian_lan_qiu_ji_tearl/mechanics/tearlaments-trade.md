---
title: 深海来客交易
mod: dui_mian_lan_qiu_ji_tearl
---
*适用版本:tearlaments(dui_mian_lan_qiu_ji_tearl)v15(数据基线 2026-11-23)*

[[tearlaments_kitkallos]] 珠泪哀歌族商人来自游戏王卡组 Tearlaments 的角色模组。她的开场白就是收购规则(据 Localization/zh-Hans.csv 对话原文):

*我会收购少女和高于基础品质的水,价格从优。我的三位歌姬打九折。*

## 交易规则

对照 manifest Description(英文,10% 折扣 / 20% 加价):

- **收购加价**:任何带少女标签的物品,以及高于基础品质的水(如 [[tearlaments_aquashard]]),按 20% 溢价收购。
- **出售折扣**:三位珠泪哀歌族人鱼按 9 折出售。
- 物品文本与顾客名跟随游戏语言,由 Localization 目录下的 csv 提供(据 manifest Description)。

## 三位歌姬

| 人物 | 设定(据 zh-Hans.csv 描述) |
| --- | --- |
| [[tearlaments_merrli]] | 梅洛人鱼:在暴政下逃亡,手持捕鱼网求生,歌声从未沉默 |
| [[tearlaments_havnis]] | 哈弗妮丝:承载王国隐秘悲伤,她的痛苦揭开表面之下的真实秩序 |
| [[tearlaments_scheiren]] | 塞壬人鱼:宫廷囚禁的幸存者,锁链既是枷锁,也是斩断枷锁的决心 |

## 垃圾桶融合(v15 新增)

三件人鱼物品自带「珠泪合成」标记:把两件带标记的珠泪物品扔进垃圾桶,立即融合成少女占位物品 [[tearlaments_kitkallos_merge]](4×4 违禁品,基价 500,走少女协议),不需要解锁交易也能触发(据 manifest Description 与反编译产物 v15 TearlamentsConfig.cs BinExchange:TriggerTag=TEARLAMENTS_BIN_MERGE、RequiredUnits=2)。

## 巢穴区夜产(v15 新增)

放进巢穴扩展(claude.lewdMemeBrood)巢穴区的人鱼,每夜产出一颗 [[tearlaments_aquashard]],且夜产不产生任何乳汁(据 manifest Description;反编译产物 v15 中 BroodTribute.Chance=1 为必产,manifest 写 20% 已过期,以源码为准)。

## 与触手体系的联动

v15 起为硬前置(2.5.5 更新:清单 Prerequisites 已显式声明 lewd_meme):

- 需要 lewd_meme 2.0.2+(TentacleApi 1.2.0+):三位人鱼携带少女协议标签,可被触手体系当作苗床收购与互动,并支持双击苗床面板。
- lewd_meme 缺席或版本过旧时,启动日志写明原因,双击苗床面板保持停用(据反编译产物 v15 TearlamentsMod.cs)。
- 全部设置集中在 TearlamentsConfig.cs(据 manifest Description)。

## 相关页面

- [苗床与少女养成](maiden-husbandry.html) —— 少女标签的用途
- [治安部管制与支线](security-branch.html) —— 管制品交易对比
- [安装与兼容性](install-compat.html) —— 软依赖关系说明
