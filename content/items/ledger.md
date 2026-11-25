---
slug: 'ledger'
price: 0
usage:
  - type: 'use'
    text: '双击打开账本:第一页「昨夜账目」来客明细(来客/少女/命中/过夜费/推销/收入);第二页「侍奉汇报」是昨夜一位少女的侍奉记录、客人满意度与随机的枕边吐槽'
    source: '据 zh.csv ledger.* 与 report.page2.* 词条、PatchLedgerDoubleClick.cs'
  - type: 'use'
    text: '账本还记录固定服饰商人的来访与成交次数(来访 {0} 次 · 成交 {1} 次)'
    source: '据 zh.csv ledger.merchantRole / merchantVisits 与 MerchantService.cs onItemSold'
sources:
  - source: '职业解锁发放'
    detail: '解锁青楼职业后自动发到库存/柜台(优先背包,其次后柜台、前柜台);丢失会重新补发'
    probability: '必得(据 LedgerService.cs 发放逻辑)'
categories:
  - '文件'
related:
  - 'palm'
  - 'merchant'
notes: '占格 1×1,带【不可转售】标签,单击不激活(双击查看)(据 BrothelItemCatalog.cs CreateLedger)。'
---
