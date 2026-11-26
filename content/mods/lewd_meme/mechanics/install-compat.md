---
title: 安装与兼容性
mod: lewd_meme
---
*适用版本:触手家族各模组,以各自 manifest 为准(数据基线 2026-11-23)*

触手家族模组众多,而且**安装目录名不等于 mod ID**(例如暗流交易安装在 LewdMemeShadowTrade 目录,mod ID 却是 lewd_meme_remake)。排障、写前置或查管制品时,一律以 manifest 里的 ID 为准。

## mod ID 与安装目录对照

| 安装目录(Mods/ 下) | mod ID | 名称 | 版本 | 必需前置 | 游戏版本 |
| --- | --- | --- | --- | --- | --- |
| lewd_meme | lewd_meme | 淫色深空:可能是触手 | 2.5.5 | 无 | 0.46 |
| LewdMemeShadowTrade | lewd_meme_remake | 淫色深空:暗流交易 | 1.6.4 | lewd_meme | 0.46 |
| lewdMemeBrood | claude.lewdMemeBrood | 淫色深空:巢穴扩展 | 0.3.31 | lewd_meme | 0.46 |
| lewd_meme_brothel | lewd_meme_brothel | 淫色深空:掌上青楼 | 0.10.4 | lewd_meme | 0.46D |
| lewd_meme_legacy_content | lewd_meme_legacy_content | 淫色深空:可能更有互动 | 1.0.6 | lewd_meme | 0.46D |
| tearlaments | dui_mian_lan_qiu_ji_tearl | tearlaments | 15 | lewd_meme(2.0.2+/TentacleApi 1.2.0+) | 未声明 |
| ItemPortraitHD | item_portrait_hd | 苗床高清立绘管理器 | 1.3.0 | 仅 lewd_meme 必需 | 0.46 / 0.46D |
| lewd_meme_crisp_portraits | lewd_meme_crisp_portraits | 触手bug修复 | 1.0.0 | lewd_meme | 0.46D |

上表逐项取自各模组 manifest 的 ID、ModVersion、Prerequisites 与 GameVersions 节点。

## 前置关系图

以 lewd_meme 为中心(箭头指向前置):

- 内容扩展:lewd_meme_remake → lewd_meme;claude.lewdMemeBrood → lewd_meme;lewd_meme_brothel → lewd_meme;lewd_meme_legacy_content → lewd_meme;dui_mian_lan_qiu_ji_tearl → lewd_meme
- 外围视觉:item_portrait_hd → lewd_meme;lewd_meme_crisp_portraits → lewd_meme
- 特例(2.5.5 更新:tearlaments v15 起):dui_mian_lan_qiu_ji_tearl 清单前置已显式声明 lewd_meme,且需要 lewd_meme 2.0.2+(TentacleApi 1.2.0+);版本过旧时人鱼双击苗床面板停用并写日志(v7 时代的"清单前置为空、运行时降级"已不再成立,据 v15 manifest 与反编译产物 TearlamentsMod.cs)

外围视觉模组说明:

- **item_portrait_hd**:为角色物品提供 128/256 纹理、自选立绘与完整 4×4 占格,默认 F7 打开管理器。清单里列出的 8 个立绘包仅表示兼容与来源追踪范围,**只有 lewd_meme 是运行必需**,立绘包无需全部安装(据其 manifest Description 安装说明)。
- **lewd_meme_crisp_portraits**:可选视觉与交互修复,保留主模组人物原图分辨率并以点采样显示,修复占格、拖动命中与透明像素点不到的问题;不修改物品 ID、数值或存档结构(据其 manifest Description)。

## 安装要点

- 把模组目录放在游戏 Mods 下,同时启用前置与子模组;更新后重启游戏(据暗流交易 README)。
- LewdMemeShadowTrade 目录只保留一份 ShadowTrade.dll,**不要与旧 MidnightPawnRemake.dll 并存**(据暗流交易 README)。
- 模组 ID、命名空间、物品 ID 与旧存档键在各版本间保留:已有角色、乳汁、桶装、名册和剧情进度继续使用(据暗流交易 README)。

## 快速上手

新开局选择"触手起源"天赋后,[[tentacle_body]]、[[corrupt_tentacle]]、[[tentacle_manual]]、[[tentacle_archive]] 与 [[customer_archive]] 五件会一起发到仓库,自己拖进本体对应区域(据 lewd_meme manifest 1.4.4/1.10.1/2.5.0 段;2.5.5 更新:开局发放清单以 Perks.cs 为准)。之后的成长路线见[触手侵蚀](tentacle-corruption.html)与[苗床与少女养成](maiden-husbandry.html)。

## 相关页面

- [触手侵蚀](tentacle-corruption.html) —— 本体与侵蚀性触手的入门
- [苗床与少女养成](maiden-husbandry.html) —— 苗床获取
- [旧版互动](legacy-interactions.html) —— 内容层补充模组
