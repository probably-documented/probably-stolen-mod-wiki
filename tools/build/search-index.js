'use strict';

// Task 9: 2-gram search index + shared tokenizer.
//
// buildSearchIndex(items, mechanics) -> { docs, grams }
//   docs: [{ id, type: 'item'|'mechanic', title, url, summary }]
//     — item:  url = `item/<id>.html`,title = name ?? id(回退),
//       summary = description 压空白后截前 80 字符(超出补 …)
//     — mechanic: url = `mechanics/<slug>.html`,mechanics 数据无
//       description,summary 为 ''
//   grams: null-prototype 倒排表 { [token]: docIdx[] },postings 升序无重复。
//     token = CJK 相邻二字滑窗(「神奇乳汁」→ 神奇/奇乳/乳汁;单字段退化
//     为单字)或 ASCII 连续段整词([a-z0-9]+ 小写化,如 Milk → milk,整词
//     入表使前缀搜索可命中)。索引域:title(含 id 与别名)+ categories +
//     tags + description + flavor;同一 doc 先入 title 域再入 body 域,因此
//     每个 gram 的 postings 里 title 命中的 docIdx 排在 body-only 之前。
//
// queryIndex(index, query) -> [{ doc, hits }]:
//   并集计分(每个 token 命中 +1),hits 降序——hits === token 数即全部
//   token 命中(= 交集路径)自然排最前,部分命中(= 降级并集路径)在后,
//   不会丢弃结果。次级决胜:title 命中数(标题权重);末级:docIdx 稳定序。
//
// ⚠ assets-src/search.js 内联了 tokenize / queryIndex 的同逻辑副本(两端
// 保持同步,file:// 下用普通 script,不走 ES module),改动须一并同步。

function isAsciiWordChar(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
}

function isCjkChar(ch) {
  const code = ch.codePointAt(0);
  return (code >= 0x2e80 && code <= 0x9fff) // CJK 部首/注音/假名/统一表意
    || (code >= 0xac00 && code <= 0xd7af)   // 谚文音节
    || (code >= 0xf900 && code <= 0xfaff);  // CJK 兼容表意
}

/** 查询与索引共用的切分:CJK 相邻二字滑窗 + ASCII 整词(附 2-gram 前缀)。 */
function tokenize(text) {
  const s = String(text ?? '').toLowerCase();
  const out = [];
  let ascii = null;
  let cjk = null;
  const flush = () => {
    if (ascii !== null) {
      out.push(ascii); // 整词入表
      // 附加 2-gram 使前缀搜索命中:「milks」→ mi/il/lk/ks,查 milk/mi 皆可命中
      if (ascii.length >= 3) {
        for (let i = 0; i + 1 < ascii.length; i++) out.push(ascii.slice(i, i + 2));
      }
      ascii = null;
    }
    if (cjk !== null) {
      if (cjk.length >= 2) {
        for (let i = 0; i + 1 < cjk.length; i++) out.push(cjk.slice(i, i + 2));
      } else {
        out.push(cjk); // 单字段退化为单字 token
      }
      cjk = null;
    }
  };
  for (const ch of s) {
    // flush 只在类别切换时调用:同类字符连续积累(ASCII 整词 / CJK 滑窗段)
    if (isAsciiWordChar(ch)) {
      if (cjk !== null) flush();
      ascii = (ascii ?? '') + ch;
    } else if (isCjkChar(ch)) {
      if (ascii !== null) flush();
      cjk = (cjk ?? '') + ch;
    } else flush();
  }
  flush();
  return out;
}

/** 摘要:压空白后按码点截前 80 字符(超出补 …,不产生孤立代理);null/空 → ''。 */
function truncateSummary(text, max = 80) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s === '') return '';
  const cps = Array.from(s);
  return cps.length <= max ? s : `${cps.slice(0, max).join('')}…`;
}

function buildSearchIndex(items, mechanics) {
  const docs = [];
  const grams = Object.create(null); // null 原型:防 '__proto__'/'constructor' 词键冲突

  const pushGram = (gram, idx) => {
    const list = grams[gram];
    if (list === undefined) grams[gram] = [idx];
    else if (!list.includes(idx)) list.push(idx);
  };

  for (const it of items ?? []) {
    const id = String(it?.id ?? '');
    if (id === '') continue;
    const title = it.name == null ? id : String(it.name);
    const idx = docs.length;
    docs.push({
      id,
      type: 'item',
      title,
      url: `item/${id}.html`,
      summary: truncateSummary(it.description),
    });
    // 先 title 后 body:postings 插入序使 title 命中的 docIdx 排前。
    // title 域 = 名称 + 物品 ID + 别名(final review Important:infobox 展示
    // 的 ID/别名是页面文案承诺的检索域,与 title 同级权重)。
    const titleTerms = [title, id, ...(Array.isArray(it?.aliases) ? it.aliases.map(String) : [])];
    for (const term of titleTerms) {
      for (const gram of new Set(tokenize(term))) pushGram(gram, idx);
    }
    const body = [
      ...(Array.isArray(it.categories) ? it.categories : []),
      ...(Array.isArray(it.tags) ? it.tags : []),
      it.description,
      it.flavor,
    ];
    for (const part of body) {
      for (const gram of new Set(tokenize(part))) pushGram(gram, idx);
    }
  }

  for (const m of mechanics ?? []) {
    const slug = String(m?.slug ?? '');
    if (slug === '') continue;
    const title = m.title == null ? slug : String(m.title);
    const idx = docs.length;
    docs.push({
      id: slug,
      type: 'mechanic',
      title,
      url: `mechanics/${slug}.html`,
      summary: '',
    });
    for (const gram of new Set(tokenize(title))) pushGram(gram, idx);
  }

  return { docs, grams };
}

function queryIndex(index, query) {
  const docs = index?.docs ?? [];
  const grams = index?.grams ?? Object.create(null);
  const uniq = [...new Set(tokenize(query))];
  if (uniq.length === 0) return [];

  const counts = new Map(); // docIdx -> 命中 token 数
  for (const token of uniq) {
    const matched = new Set();
    if (token.length === 1 && isCjkChar(token)) {
      // 单字中文 token:2-gram 表无同名键,扫描所有含该字的键取并集
      //(如「乳」→ 奇乳/乳汁 键),该 token 对每个 doc 仍只计 1。
      for (const key of Object.keys(grams)) {
        if (key.includes(token)) {
          for (const di of grams[key]) matched.add(di);
        }
      }
    } else {
      const postings = Object.prototype.hasOwnProperty.call(grams, token) ? grams[token] : null;
      if (postings != null) {
        for (const di of postings) matched.add(di);
      }
    }
    for (const di of matched) counts.set(di, (counts.get(di) ?? 0) + 1);
  }

  const scored = [];
  for (const [di, hits] of counts) {
    const titleSet = new Set(tokenize(docs[di]?.title));
    let titleHits = 0;
    for (const token of uniq) if (titleSet.has(token)) titleHits++;
    scored.push({ di, hits, titleHits });
  }
  scored.sort((a, b) => (b.hits - a.hits) || (b.titleHits - a.titleHits) || (a.di - b.di));
  return scored.map((s) => ({ doc: docs[s.di], hits: s.hits }));
}

module.exports = { tokenize, buildSearchIndex, queryIndex };
