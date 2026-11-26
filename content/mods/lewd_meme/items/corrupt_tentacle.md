---
item_id: 'corrupt_tentacle'
mod: lewd_meme
title: ''
usage:
  - type: 'drag-target'
    text: '淫力满 100 时,把【物资箱】/【储藏区】拖到它身上侵蚀成 [[tentacle_box]];[[alarm_clock]]→[[tentacle_alarm]]、[[manhole_cover]]→[[tentacle_trap]]、原版 3D 打印机→[[tentacle_printer]] 走特殊转化(注意是把箱子拖到触手上,不是反过来)'
    source: '据 manifest 1.3.7 / 1.4.0 / 1.6.0 / 1.7.0 与机制页 tentacle-corruption'
  - type: 'drag-target'
    text: '把 [[tentacle_semen]] 拖到它身上恢复淫力,每瓶 +10,可多瓶一起拖;溢出不浪费瓶子'
    source: '据 manifest 1.9.2'
  - type: 'use'
    text: '淫力每天自动恢复 10 点;侵蚀一次消耗 100 点;触手自身及带【重要物品】标签的剧情道具(如卢的储物柜)不可侵蚀'
    source: '据 manifest 1.3.0 / 1.3.4 / CorruptPatch.cs 复刻名单'
sources:
  - source: '开局发放'
    detail: '选择「触手起源」天赋后,与 [[tentacle_body]]、[[tentacle_manual]] 三件一起发到仓库'
    probability: '唯一途径(据 manifest 1.4.4)'
related:
  - 'tentacle_body'
  - 'tentacle_box'
  - 'tentacle_semen'
  - 'tentacle_alarm'
  - 'tentacle_trap'
  - 'tentacle_printer'
notes: '1.9.2 起「充能」改叫「淫力」,上限 100;侵蚀被拒绝时日志留「侵蚀拒绝」记录便于排查(据 manifest 1.9.2 / 1.3.6)。'
---
