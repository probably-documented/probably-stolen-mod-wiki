---
item_id: 'customer_archive'
mod: lewd_meme
title: ''
usage:
  - type: 'use'
    text: '点击打开「顾客档案」窗口:首页为最近 3 位到店顾客的卡片,点身份名进入身份详情;身份列表一行 2 个、竖 5 行,每页 10 个,可翻页,默认 37 种身份,见过的会自动补进列表'
    source: '据反编译产物 2.5.5 CustomerArchive.cs(SLOTS=3/COLS=2/ROWS=5/PER_PAGE=10/DEFAULT_IDENTITIES)与 manifest 2.5.3/2.4.1 段'
  - type: 'process'
    text: '详情页显示名称/姓/名/身份/体型/胸型/武力/智力/魅力/好感/信任/催眠/调教值/淫纹刻印/特性/口交·性交·肛交次数/状态;数据随角色存进顾客池——同一位身份下次遇到沿用同样的名字、立绘、属性与观感,好感变化实时写回'
    source: '据 manifest 2.5.4/2.5.5 段(2.5.5 起统一以中文身份名为键、属性以角色池为准)'
sources:
  - source: '开局发放'
    detail: '选择「触手起源」天赋开局直接给,无前置、不需要图鉴生长(与 [[tentacle_archive]] 一同)'
    probability: '唯一途径(据 manifest 2.5.0【顾客档案获得方式】与反编译产物 2.5.5 Perks.cs)'
related:
  - 'tentacle_body'
  - 'tentacle_archive'
notes: '文档类,3×2,基价 60(据反编译产物 2.5.5 CustomerArchive.cs Create);拉黑某位顾客后档案里对应一格清空变回【???】(据 manifest 2.4.0)。'
---
