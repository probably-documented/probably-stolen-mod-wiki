---
slug: 'maiden_ledger_item'
usage:
  - type: 'use'
    text: '点击翻页阅读:第一页汇总成交数、收入,之后每页 5 条,左侧苗床立绘 + 成交价,右侧详细数据,记录最近 100 笔交易;阅读中成交立即刷新'
    source: '据 MaidenLedger.cs(RecordsPerPage/MaxRecords)与 docs/玩法指南.md'
sources:
  - source: '自动发放'
    detail: '启用暗流交易后第一次开业时发到柜台外侧;读档后首次开门检测到场上已有触手本体但名册缺失时补发(档案存 ModData,物品丢了也能补)'
    probability: '必得(据 MaidenLedger.cs 首次开门补发注释)'
categories:
  - '文件'
related:
  - 'maiden_lower'
  - 'tentacle_body'
notes: '原生纸书:2×3 图标,保留当前无文盲阅读限制的行为(据玩法指南)。'
---
