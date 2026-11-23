/* modwiki 客户端搜索 —— 纯静态,file:// 双击可用(无 fetch、无框架)。
 *
 * 数据源:window.WIKI_DATA.search —— 构建期由 tools/build/search-index.js
 * 生成:{ docs, grams }(docs + 2-gram 倒排表)。索引缺失/未生成时展示
 * 提示,不抛错。
 *
 * ⚠ 与 tools/build/search-index.js 保持同步:下方 tokenize / searchDocs
 * 分别是索引端 tokenize / queryIndex 的内联副本(切分规则:CJK 相邻二字
 * 滑窗 + ASCII 连续段整词小写;查询:各 token 计分求和,全部命中的 doc
 * 排最前,部分命中按命中数排序)。两端任何改动须一并同步。
 * 故意不用 ES module:file:// 下普通 <script> 兼容性最稳。
 *
 * 挂载 window.__wikiSearch = { tokenize, searchDocs, renderResults,
 * readInitialQuery, init } —— 兼作 node --test 的 DOM-stub 测试钩子。
 */
(function (root) {
  'use strict';

  // ---- 与 tools/build/search-index.js 的 tokenize 保持同步 ----
  function isAsciiWordChar(ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
  }

  function isCjkChar(ch) {
    const code = ch.codePointAt(0);
    return (code >= 0x2e80 && code <= 0x9fff) // CJK 部首/注音/假名/统一表意
      || (code >= 0xac00 && code <= 0xd7af)   // 谚文音节
      || (code >= 0xf900 && code <= 0xfaff);  // CJK 兼容表意
  }

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
          out.push(cjk);
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

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- 与 tools/build/search-index.js 的 queryIndex 保持同步 ----
  function searchDocs(index, query) {
    const docs = (index && index.docs) || [];
    const grams = (index && index.grams) || {};
    const uniq = Array.from(new Set(tokenize(query)));
    if (uniq.length === 0) return [];

    const counts = new Map();
    for (let i = 0; i < uniq.length; i++) {
      const token = uniq[i];
      const matched = new Set();
      if (token.length === 1 && isCjkChar(token)) {
        // 单字中文 token:2-gram 表无同名键,扫描所有含该字的键取并集
        //(如「乳」→ 奇乳/乳汁 键),该 token 对每个 doc 仍只计 1。
        for (const key of Object.keys(grams)) {
          if (key.indexOf(token) !== -1) {
            const postings = grams[key];
            for (let j = 0; j < postings.length; j++) matched.add(postings[j]);
          }
        }
      } else {
        const postings = Object.prototype.hasOwnProperty.call(grams, token) ? grams[token] : null;
        if (postings != null) {
          for (let j = 0; j < postings.length; j++) matched.add(postings[j]);
        }
      }
      matched.forEach(function (di) {
        counts.set(di, (counts.get(di) || 0) + 1);
      });
    }

    const scored = [];
    counts.forEach((hits, di) => {
      const titleSet = new Set(tokenize(docs[di] && docs[di].title));
      let titleHits = 0;
      for (let i = 0; i < uniq.length; i++) if (titleSet.has(uniq[i])) titleHits++;
      scored.push({ di: di, hits: hits, titleHits: titleHits });
    });
    scored.sort(function (a, b) {
      return (b.hits - a.hits) || (b.titleHits - a.titleHits) || (a.di - b.di);
    });
    return scored.map(function (s) { return { doc: docs[s.di], hits: s.hits }; });
  }

  // file:// 下 GET 表单的 ?q= 可能丢参(Task 7 Concerns):
  // 双读 location.search 与 location.hash(#q=…),search 优先、hash 兜底。
  function readInitialQuery(loc) {
    if (!loc) return '';
    let q = '';
    const search = String(loc.search == null ? '' : loc.search);
    if (search !== '') {
      try { q = new URLSearchParams(search).get('q') || ''; } catch (err) { q = ''; }
    }
    if (q !== '') return q;
    const hash = String(loc.hash == null ? '' : loc.hash);
    const m = hash.match(/[?#&]q=([^&]*)/);
    if (m) {
      try { q = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (err) { q = m[1]; }
    }
    return q;
  }

  const TYPE_LABELS = { item: '物品', mechanic: '机制' };

  function renderResults(index, query) {
    const q = String(query == null ? '' : query).trim();
    if (q === '') {
      return '<p class="search-hint">输入关键词即可即时检索:支持中文名称、英文词、标签与品类。</p>';
    }
    const hits = searchDocs(index, q);
    if (hits.length === 0) {
      return '<p class="search-empty">没有匹配「' + esc(q) + '」的条目。</p>';
    }
    const lis = hits.map(function (h) {
      const doc = h.doc || {};
      const label = TYPE_LABELS[doc.type] || doc.type || '';
      return '<li class="search-hit search-hit-' + esc(doc.type || 'unknown') + '">'
        + '<a href="' + esc(doc.url || '#') + '">' + esc(doc.title || doc.id || '') + '</a>'
        + '<span class="search-badge">' + esc(label) + '</span>'
        + (doc.summary ? '<p class="search-summary">' + esc(doc.summary) + '</p>' : '')
        + '</li>';
    });
    return '<ul class="search-hits">' + lis.join('') + '</ul>';
  }

  /**
   * 初始化并返回 { run }。env: { data, input, resultsEl, location }。
   * data = window.WIKI_DATA(其 .search 为索引;缺失时只显示提示)。
   */
  function init(env) {
    const data = env && env.data;
    const input = env && env.input;
    const resultsEl = env && env.resultsEl;
    const search = data && data.search;
    const index = search && Array.isArray(search.docs) ? search : null;

    const run = function () {
      if (!resultsEl) return;
      resultsEl.innerHTML = index
        ? renderResults(index, input ? input.value : '')
        : '<p class="search-empty">搜索索引未生成(请重新构建站点)。</p>';
    };

    // keyup 实时查询
    if (input) input.addEventListener('keyup', run);

    const q0 = readInitialQuery(env && env.location);
    if (q0 !== '' && input) input.value = q0;
    run();
    return { run: run };
  }

  // 浏览器自动初始化;node --test 的 DOM-stub 环境(无 document)跳过。
  function autoInit() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const input = document.getElementById('search-input');
    // brief 目标容器 #results;现有 search.html 的容器 #search-results 作回退
    const resultsEl = document.getElementById('results') || document.getElementById('search-results');
    if (!resultsEl) return;
    const ctrl = init({ data: window.WIKI_DATA, input: input, resultsEl: resultsEl, location: window.location });
    // 页内 hash 变化(file:// 不重载页面)→ 同步输入框并重查
    window.addEventListener('hashchange', function () {
      const q = readInitialQuery({ search: '', hash: window.location.hash });
      if (input) input.value = q;
      ctrl.run();
    });
  }

  root.__wikiSearch = { tokenize: tokenize, searchDocs: searchDocs, renderResults: renderResults, readInitialQuery: readInitialQuery, init: init };
  autoInit();
})(typeof window !== 'undefined' ? window : globalThis);
