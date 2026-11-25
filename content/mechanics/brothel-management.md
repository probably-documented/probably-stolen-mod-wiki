---
title: 青楼经营
---
*适用版本:掌上青楼(lewd_meme_brothel)v0.10.4,必需前置 lewd_meme(数据基线 2026-11-18)*

## 开通

在游戏的"Wild 的人脉"网络中解锁 [[network.profession]] 青楼职业后,得到实体物品 [[palm]] 与一件 [[gear.maidDress]](据 lewd_meme_brothel manifest Description 与 Localization/zh.csv)。

## 每日预约人数

- 基础每天 **2 位**预约客人(据 zh.csv network.profession.description)。
- [[network.capacity]] 客源扩建:每次 +2,且让每位客人**多要一个特征标签**;已买过的扩建保留(据 zh.csv network.capacity.description)。
- 展示柜里每多一位少女 +1 位(据 manifest Description)。

## 接客与结算

掌上青楼是一部可翻页的容器终端,每一页是今天预约的一位客人:上方是借用的路人 NPC 立绘,悬停可看想要的特征与预算;"少女"格只能放一位少女,"推销"格 4×4 不限件数(据 manifest Description)。

- 点"接客"只是锁住这一页,过夜费与推销是否成功**要到第二天才揭晓**(据 zh.csv palm.description)。
- 过夜费在少女右键菜单里设(0~9999);超过客人预算的少女不能放进这一页(据 manifest Description)。
- 每命中一个客人想要的特征标签,客人预算 +10%;推销总价超过预算时,只有命中 5 个以上标签才有一半机会被负债买下;预算内则必定卖出(据 manifest Description 与 zh.csv palm.hint 系列)。
- 揭示语如"推销成功 · 服务收入 + 商品收入"见 zh.csv palm.result 系列词条。

## 账本与服饰

- [[ledger]] 营业账本为两页:第一页来客明细,第二页是昨夜一位少女的侍奉汇报、客人满意度与随机的枕边吐槽(据 manifest Description)。
- 服饰拖到少女身上即可直接更换,带部位与标签(女仆、猫耳、情趣、兔耳、腿环等),如 [[gear.catEars]]、[[gear.laceDress]] 等(据 zh.csv gear 系列)。

## 兼容性

必须同时启用 lewd_meme;lewd_meme_legacy_content 只提供额外标签,不启用也能运行(据 manifest Description),详见[安装与兼容性](install-compat.html)。

## 相关页面

- [苗床与少女养成](maiden-husbandry.html) —— 少女的获取与属性
- [旧版互动](legacy-interactions.html) —— 青楼可用的额外标签来源
- [安装与兼容性](install-compat.html) —— 前置关系总览
