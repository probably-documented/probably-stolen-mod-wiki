---
item_id: 'tentacle_archive'
mod: lewd_meme
title: ''
usage:
  - type: 'use'
    text: '放入物品栏后点击激活:打开纸质「触手档案」窗口,一页看完统计表(触手武力/智力/魅力/侵蚀力、本体等级与经验、捕获与破处统计、淫纹四档人数)与图鉴表(触手/触手侵蚀等分类,条目带介绍、获得方法、前置,部分可「生长」,冷却 7 天)'
    source: '据反编译产物 2.5.5 TentacleArchive.cs(onActivateSlotItemFunc→ArchivePaper.Open)与 manifest 1.10.0/2.3.0 段'
  - type: 'process'
    text: '统计为打开时现扫(卖掉或丢掉少女,捕获数随之减少,累计次数不减);淫纹四档为持久化计数,少女被放生也不减'
    source: '据 manifest 1.9.3/1.9.4 段'
sources:
  - source: '开局发放'
    detail: '选择「触手起源」天赋开局,与 [[tentacle_body]]、[[corrupt_tentacle]]、[[tentacle_manual]]、[[customer_archive]] 五件一起发放;图鉴另注「由触手本体长出」'
    probability: '唯一常规途径(据反编译产物 2.5.5 Perks.cs OnNewGameStarted 与 Codex.cs)'
related:
  - 'tentacle_body'
  - 'customer_archive'
  - 'tentacle_manual'
notes: '文档类,3×2,基价 50(据反编译产物 2.5.5 TentacleArchive.cs Create);1.10.2 起侵蚀区/触手区「标签或分类」命中其一即可收纳。'
---
