---
slug: 'tentacle_manual_remake'
description: '暗流交易规则的内置速查:夜间结算追加乳汁、疲劳与透支、桶装、收购与治安部支线四段说明(据 ItemFactory.cs RefreshManualDescription 全文概括)'
usage:
  - type: 'use'
    text: '点击阅读:夜间结算(先扣后产)、疲劳系数与透支门禁、桶装阈值与开关、交易与便签规则速查;详细机制见模组目录 README 与 docs'
    source: '据 ItemFactory.cs RefreshManualDescription 与 docs/玩法指南.md'
sources:
  - source: '自动补发'
    detail: '启用暗流交易后,打开本体窗口时便签区自动补发(便签区扩展到 2×4 以容纳两张说明书),已存在则不重复塞'
    probability: '必得(据 CompatOriginal.cs 便签区扩展/SeedNote)'
categories:
  - '工具'
related:
  - 'tentacle_manual'
notes: '带【重要物品】【不可转售】标签;数值位随读取刷新(onLoaded 挂 RefreshManualDescription)。'
---
