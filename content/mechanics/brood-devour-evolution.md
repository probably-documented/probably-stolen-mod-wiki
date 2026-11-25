---
title: 本体吞噬进化
---
*适用版本:巢穴扩展(claude.lewdMemeBrood)v0.3.31,前置 lewd_meme(数据基线 2026-11-18)*

巢穴觉醒后,触手本体获得吞噬能力:把 [[tentacle_body]] 覆盖在苗床身上,可以将她纳入体内、彻底融为一体(据 Localization/zh.csv tip.body.lore.devour)。吞噬过程中苗床价值按进度衰减,完全吞噬后累计吞噬数 +1(据 zh.csv tip.maiden.devouring 与 rep.devoured)。

## 吞噬节奏

- 吞噬分三个阶段推进:**侵蚀、变异、融化**(据 zh.csv devour.tier.0/1/2 词条)。
- 每日吞噬有数量上限,超限时提示"本体还在消化,明天再说"(据 zh.csv devour.limit)。
- 把 [[brood_failed_seedling]] 放到正被吞噬的苗床身上,本体会转而缠住幼苗、松开苗床:吞噬暂停,可以把她挪出来(据 zh.csv devour.paused 与 tip.maiden.devourEta)。

## 触巢精华与突破

吞噬母体时偶尔会凝结出 [[brood_essence]](据 manifest Description 与 zh.csv rep.essence)。本体对精华有所反应,吸收规则(据 zh.csv essence 系列词条):

- 本体 Lv5 起才能承受精华,更早使用会被拒绝。
- 每颗精华推进一段突破进度;吸收成功显示"突破进度 当前/所需"。
- 本体到顶后不再吸收。
- 突破后本体等级上限升至 Lv10,并给可用适应点(据 zh.csv essence.levelup:"本体突破到 Lv,可用适应点,在孵卵巢的本体适应里分配")。

## 适应点分配

适应点在孵卵巢的**本体适应**面板分配,三项每点效果(据 zh.csv adapt 系列词条;单项点数上限 3、总点数等于突破次数(本体 Lv6~10 共 5 点),据 BodyActions/Tune/BodyLevel 反编译源码):

| 项目 | 每点效果 |
| --- | --- |
| 代谢适应 | 食物与水的消耗 −3%(与吞噬减免合计最多 −60%) |
| 基因同化 | 基因经验 +10% |
| 孵育稳定 | 孵化进度 +5% |

## 吞噬子触(吸收)

五色成体功能触手(红/绿/黄/蓝/紫)也能被本体吞下:把成体触手拖到本体上即可"吸收它的基因"(据 zh.csv tip.body.hint 与 tip.adult.absorb 词条)。幼体与 [[brood_white_tentacle]] 不能被吸收(据 BodyActions.cs MayTarget/CanTarget 的 IsFunctional 判定与 Absorb 的 White 排除);巢穴觉醒前此功能锁定(据 body.locked 词条)。

吸收获得该支基因经验,**经验随触手等级提高**(据 Genes.cs GainFor 与 Tune.cs 常量):

| 触手等级 | Lv1 | Lv2 | Lv3 | Lv4 | Lv5 | Lv6 | Lv7 | Lv8 | Lv9 | Lv10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 基因经验 | 28 | 36 | 44 | 52 | 60 | 68 | 76 | 84 | 92 | 100 |

公式:`(20 + 8 × 触手等级) × (1 + 0.1 × 基因同化点数)`——同化 3 点时最多 +30%(Lv10 触手给 130)。吞噬台词"本体吞下了它。{0}支基因 Lv{1}。/ …升到 Lv{1}!"(据 zh.csv gene.gain / gene.levelup)。

## 基因等级

每支基因(力/韧/腺/水/神)独立累积经验、独立显示在本体 tooltip("基因:{0}",据 zh.csv tip.body.genes;白无基因)。每级所需经验(据 Tune.cs LevelNeed):

| 基因等级 | Lv0→1 | Lv1→2 | Lv2→3 | Lv3→4 | Lv4→5 | Lv5→6 | Lv6→7 | Lv7→8 | Lv8→9 | Lv9→10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 所需经验 | 100 | 120 | 140 | 160 | 180 | 200 | 220 | 240 | 260 | 280 |

Lv0→10 累计 **1900 经验**、基因封顶 Lv10(据 Genes.cs LevelOf/AddExp 截断与自测断言)。基因等级有两个作用:

- **抬高该色触手的等级上限**(见下节,据 Genes.cs TentacleCap 与 zh.csv tip.adult.capped)。
- **提高该色孵化权重**:每级 +5%(据 Genes.cs Pool 与 Tune.GenePoolPerLevel;零基因时白 72%、紫 3%)。

## 触手喂养与升级

- **对象**:仅五色功能触手;白触手是口粮不是功能体,不能被喂(据 TentacleItems.cs CanFeed 的 IsFunctional 判定)。
- **操作**:把任意带卡路里的食物拖到触手身上即可,tooltip 会显示「Lv{0}/{1} · 经验 {2}/{3}(喂食物升级)」(据 zh.csv tip.adult.level)。堆叠食物按 卡路里×数量 结算;**触手不能喂触手**(含白触手),给蓝触手倒液体走容器互倒、不算喂食(据 CanFeed 的 IsTentacle/LiquidPair 排除)。
- **换算**:**每 10 卡路里 = 1 经验**(向下取整,据 TentacleItems.cs Feed 与 Tune.cs KcalPerExp=10)。例:一块 [[brood_tentacle_meat_large]](800 卡)= 80 经验。
- **每级所需经验**:`50 × 当前等级`(Lv0、Lv1 均按 1 计,据 TentacleItems.cs ExpToNext 与 Tune.cs ExpPerLevelStep):

| 触手等级 | Lv0→1 | Lv1→2 | Lv2→3 | Lv3→4 | Lv4→5 | Lv5→6 | Lv6→7 | Lv7→8 | Lv8→9 | Lv9→10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 所需经验 | 50 | 50 | 100 | 150 | 200 | 250 | 300 | 350 | 400 | 450 |

Lv0→Lv10 累计 **2300 经验(= 23000 卡路里)**。一次喂下大餐可以连升多级(据 Feed 的循环结算);经验溢出在到顶后被截断,不再保留。

- **喂食门槛**:该色基因等级 ≥ 触手当前等级时才能继续喂(据 CanFeed 的 `触手Lv < 上限` 判定);到顶后 tooltip 提示「已到上限:本体{0}支基因 Lv{1},基因再升一级才能继续长」(据 zh.csv tip.adult.capped)。
- **等级上限** = **min(10, 对应支基因等级 + 1)**(据 Genes.cs TentacleCap):基因 Lv0 时触手最高 Lv1,基因 Lv9 起触手可满 Lv10。注意上限挂钩的是**对应支基因等级**,不是本体(触巢)等级——本体等级只决定吞噬与巢穴功能的解锁。
- **出场等级**:幼体长成的成体从 **Lv0** 起步,「共生能力还没生效,喂食物升到 Lv1」(据 NestCycle.cs Mature 与 zh.csv tip.adult.lv0;Lv0 时各色部署加成均为 0)。
- **升级表现**:名字变为「{触手} Lv{N}」并说一句「{0} 吃饱了,长大了一圈。」(据 zh.csv item.adult.named 与 tentacle.levelup);贴图不随等级变化,等级只影响部署加成数值(据 TentacleItems.cs RefreshName 与 Abilities.Describe)。

## 升级循环:喂养 × 吞噬

```html
<div class="flow-chart">
  <div class="flow-node">
    <div class="t">任意食物</div>
    <div class="d">任意带卡路里的食物;堆叠按 卡路里×数量 结算</div>
  </div>
  <div class="flow-arrow"><div class="stem"></div><span class="lbl">卡路里 ÷10(每 10 卡 = 1 经验,向下取整)</span><div class="stem"></div><div class="head"></div></div>
  <div class="flow-node">
    <div class="t">触手经验</div>
    <div class="d">仅五色功能触手可喂;白触手是口粮不是功能体,不能被喂</div>
  </div>
  <div class="flow-arrow"><div class="stem"></div><span class="lbl">每级经验满(每级需 50×当前等级,Lv0、Lv1 均按 1 计)</span><div class="stem"></div><div class="head"></div></div>
  <div class="flow-node">
    <div class="t">触手升级(可连升)</div>
    <div class="d">一次大餐可连升多级;到顶后溢出经验截断</div>
  </div>
  <div class="flow-arrow"><div class="stem"></div><span class="lbl">本体吞噬该触手(需巢穴觉醒)</span><div class="stem"></div><div class="head"></div></div>
  <div class="flow-node">
    <div class="t">基因经验 +20+8×触手Lv</div>
    <div class="d">同化加成至多 +30%(Lv10 触手给 130)</div>
  </div>
  <div class="flow-arrow"><div class="stem"></div><span class="lbl">每级需 100+20×当前等级,封顶 Lv10</span><div class="stem"></div><div class="head"></div></div>
  <div class="flow-node">
    <div class="t">对应支基因升级</div>
    <div class="d">Lv0→10 累计 1900 经验;另提高该色孵化权重(每级 +5%)</div>
  </div>
  <div class="flow-arrow"><div class="stem"></div><span class="lbl">触手上限 +1 = min(10, 基因等级+1)</span><div class="stem"></div><div class="head"></div></div>
  <div class="flow-loop">
    <div class="flow-node">
      <div class="t">喂出更高等级的触手 → 再吞噬 → …</div>
      <div class="d">直到基因 Lv10 / 触手 Lv10</div>
    </div>
  </div>
</div>
```

玩家操作流程(以一支从零养起的色系为例):

1. [[brood_egg]] 孵化 → [[brood_larva]] 长成成体(出场 Lv0)。
2. 拖食物喂到当前上限(基因 Lv0 时上限 Lv1,只需 50 经验 = 500 卡)。
3. 把升好级的触手拖到本体上吞噬:一只 Lv1 触手 = 28 基因经验;基因 Lv1 需 100 经验,**约 4 只 Lv1 触手**。
4. 该色上限变为 Lv2;继续喂到 Lv2 → 吞噬(每只 44 经验)→ …
5. 循环往复:吞噬高等级触手回本、基因升级抬高上限,直到基因 Lv10(累计 1900 经验,全用 Lv10 触手约 19 只)、触手 Lv10。

一句话定位:**功能触手本质是可反复"喂养—回收"的活体插件——升级吃的是任意食物的卡路里,回本靠本体吞噬把等级折算成基因经验;养成循环 = 喂养升级 + 吞噬回收**(据 BodyActions/Genes/TentacleItems 反编译源码与 zh.csv gene./tip.adult. 系列词条)。

## 相关页面

- [共生巢部署](brood-symbiotic-nest.html) —— 升满级的触手去哪里发光
- [触手卵孵化](brood-incubation.html) —— 精华与适应点作用的孵化线
- [苗床与少女养成](maiden-husbandry.html) —— 被吞噬者的来源
