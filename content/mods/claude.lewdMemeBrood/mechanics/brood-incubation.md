---
title: 触手卵孵化
mod: claude.lewdMemeBrood
---
*适用版本:巢穴扩展(claude.lewdMemeBrood)v0.3.31,前置 lewd_meme(数据基线 2026-11-18)*

触手卵是巢穴扩展的繁殖循环起点:苗床会怀上 [[brood_egg]],卵在孵卵巢里孵化、培养成白触手(食物)或红、绿、黄、蓝、紫五种功能触手(据 lewdMemeBrood manifest Description)。

## 开启条件

本体达到 Lv2 且卖过或对来客用过触手精液后,李北文会在一周内带来 [[brood_core_crystal]];当晚触手渴望发作,长出 [[brood_nest]](据 manifest Description)。

## 孵化流程

1. 把触手卵放进孵卵巢的**孵化区(6×6)**,逐夜累积孵化进度(据 Localization/zh.csv nest.panel.hatch)。
2. 不在孵化区的卵,数夜后会枯萎成 [[brood_nutrient_egg]],只能作为营养材料(据 zh.csv tip.egg.spoil 与 item.brood_egg.desc)。
3. 卵内小生命寻求食物:把**不同类型的液体**放到卵上会影响孵化结果,可以尝试乳汁、精液等各类液体或疑似液体的物品(据 item.brood_egg.desc)。
4. 孵出 [[brood_larva]] 后放进孵卵巢的培养区,喂饱了才会慢慢长大(据 item.brood_larva.desc)。
5. 孵化有概率失败:卵壳变异没有成功时留下 [[brood_failed_seedling]],孵化要从头来过(据 zh.csv egg.guide.fail)。

## 产物去向

- [[brood_white_tentacle]]:巢里长出来的口粮,可以直接吃,也能用刀切成大、中、小三档肉块(据 item.brood_white_tentacle.desc)。大块可再切成 2 块中块、中块切成 2 块小块(据 zh.csv 触手肉块词条);还能直接拖到 [[maiden_lower]] 苗床身上交配,有概率让胸部变大、体态成熟(据 TentacleUse.cs)。
- 红、绿、黄、蓝、紫五种功能触手:喂食升到 Lv10 后部署进共生巢提供加成,详见[共生巢部署](brood-symbiotic-nest.html);平时也能直接拖到 [[maiden_lower]] 苗床身上交配,累计互动次数与调教值(据 TentacleUse.cs)。
- 失败的幼苗还有特殊用途:放到正被吞噬的苗床身上,本体会把它当作替代品松口,让你把人挪出来(据 item.brood_failed_seedling.desc)。

## 相关页面

- [共生巢部署](brood-symbiotic-nest.html) —— 功能触手的去向
- [本体吞噬进化](brood-devour-evolution.html) —— 失败幼苗与吞噬暂停
- [苗床与少女养成](maiden-husbandry.html) —— 苗床的获取与养成
