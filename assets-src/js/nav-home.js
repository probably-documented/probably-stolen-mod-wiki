// 主页的搜索、限定范围和分区折叠（阶段 3 Task 2）。
//
// 普通脚本：不用模块，不发请求。数据在构建写出的 nav-search.js 里（window.NAV_SEARCH），
// 所以站点上和离线包里是同一套。移植自定稿的原型
// （modwiki/.superpowers/spike-nav-2026-11-26/proto-home/proto.js），
// 去掉了试验用的提示条，链接都换成了真实的。
//
//   window.__navHome = { splitQuery, matchMod, search, init }
//     splitQuery(text)                   → string[]   小写，按任意一段空白切开的词
//     matchMod(mod, words)               → { score, why } | null
//     search(model, { query, scope })    → { results, aliasHit }
//     init()                             页面上的交互（高亮、下拉面板、折叠）
//
// 计分：每个词都要在名称、ID、简介、别名或关键词里的至少一处连续出现（不分大小写）。
// 别名和关键词 100，名称 10，ID 5，简介 1；同分的按主页顺序。
(function () {
  'use strict';

  var data = window.NAV_SEARCH || { mods: [], sections: [] };

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase();
  }

  /** 全角空格（U+3000）和不换行空格（U+00A0）也是空白：\s 本来就认它们。 */
  function splitQuery(text) {
    return norm(text).split(/\s+/).filter(Boolean);
  }

  function matchMod(mod, words) {
    var score = 0;
    var why = [];
    var name = norm(mod.name);
    var id = norm(mod.id);
    var summary = norm(mod.summary);
    var tags = (mod.aliases || []).concat(mod.keywords || []);
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i];
      var byTag = false;
      for (var j = 0; j < tags.length; j += 1) {
        if (norm(tags[j]).indexOf(word) !== -1) {
          byTag = true;
          if (why.indexOf(tags[j]) === -1) why.push(tags[j]);
        }
      }
      if (byTag) {
        score += 100;
        continue;
      }
      if (name.indexOf(word) !== -1) {
        score += 10;
        continue;
      }
      if (id.indexOf(word) !== -1) {
        score += 5;
        continue;
      }
      if (summary.indexOf(word) !== -1) {
        score += 1;
        continue;
      }
      return null;
    }
    return { score: score, why: why };
  }

  /**
   * @param {{ mods: object[], sections: object[] }} model window.NAV_SEARCH
   * @param {{ query?: string, scope?: string[] }} options scope 是勾选的分区；空数组或没有就是全部
   * @returns {{ results: Array<{ mod: object, order: number, score: number, why: string[] }>, aliasHit: Object<string, boolean> }}
   */
  function search(model, options) {
    var opts = options || {};
    var words = splitQuery(opts.query);
    var scope = opts.scope || [];
    var results = [];
    var aliasHit = {};
    if (words.length === 0) return { results: results, aliasHit: aliasHit };
    ((model && model.mods) || []).forEach(function (mod, order) {
      var inScope = scope.length === 0 || (mod.sections || []).some(function (s) { return scope.indexOf(s) !== -1; });
      if (!inScope) return;
      var hit = matchMod(mod, words);
      if (hit === null) return;
      results.push({ mod: mod, order: order, score: hit.score, why: hit.why });
      aliasHit[mod.id] = hit.why.length > 0;
    });
    results.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
    return { results: results, aliasHit: aliasHit };
  }

  // ---------- 页面上的交互 ----------
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** 折叠状态记在浏览器里：key → 折叠起来的分区的 slug 列表。 */
  var COLLAPSED_KEY = 'nav-home-collapsed';
  function readCollapsed() {
    try {
      var list = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }
  function writeCollapsed(list) {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(list));
    } catch (e) {
      /* 存不下就算了：这一次还记着，刷新后回到默认 */
    }
  }

  function init() {
    var input = document.getElementById('nav-q');
    var form = document.getElementById('nav-search');
    var results = document.getElementById('nav-results');
    var status = document.getElementById('nav-status');
    var scope = document.getElementById('nav-scope');
    if (!input || !results || !status || !scope) return;
    var blocks = [].slice.call(document.querySelectorAll('.sec-block[data-sec]'));
    var bars = [].slice.call(document.querySelectorAll('.mod-bar[data-mod]'));
    var sectionTitle = {};
    (data.sections || []).forEach(function (s) { sectionTitle[s.slug] = s.title; });

    function selected() {
      return [].slice.call(scope.querySelectorAll('input:checked')).map(function (i) { return i.value; });
    }

    function collapse(block, yes) {
      block.classList.toggle('is-collapsed', yes);
      var toggle = block.querySelector('.sec-toggle');
      if (toggle) toggle.setAttribute('aria-expanded', yes ? 'false' : 'true');
    }

    function run() {
      var sel = selected();
      var found = search(data, { query: input.value, scope: sel }).results;
      var aliasHit = {};
      found.forEach(function (f) { aliasHit[f.mod.id] = f.why.length > 0; });
      bars.forEach(function (bar) { bar.classList.remove('is-dim', 'is-hit', 'is-alias'); });

      // 搜索框是空的：页面恢复原样。勾选的范围仍然生效，但不搜索时不把范围外的分区变淡。
      if (splitQuery(input.value).length === 0) {
        blocks.forEach(function (b) { b.classList.remove('is-out'); });
        results.hidden = true;
        results.innerHTML = '';
        status.hidden = true;
        status.textContent = '';
        return;
      }

      // 只在搜索时才把范围外的分区变淡
      blocks.forEach(function (b) {
        blockOut(b, sel.length > 0 && sel.indexOf(b.getAttribute('data-sec')) === -1);
      });
      // 页面上的模组条：命中的高亮，命中别名或关键词的换色，其余变暗；命中的条所在的分区自动展开。
      bars.forEach(function (bar) {
        var id = bar.getAttribute('data-mod');
        var block = bar.closest('.sec-block');
        var barInScope = sel.length === 0 || sel.indexOf(block.getAttribute('data-sec')) !== -1;
        if (Object.prototype.hasOwnProperty.call(aliasHit, id) && barInScope) {
          bar.classList.add('is-hit');
          if (aliasHit[id]) bar.classList.add('is-alias');
          collapse(block, false);
        } else {
          bar.classList.add('is-dim');
        }
      });

      results.innerHTML = found.map(function (f) {
        var names = (f.mod.sections || []).map(function (s) { return sectionTitle[s] || ''; }).filter(Boolean);
        return '<a class="nav-result" href="' + esc(modHref(f.mod.id)) + '" data-mod="' + esc(f.mod.id) + '">'
          + '<span class="r-name">' + esc(f.mod.name) + '</span>'
          + '<code class="r-id">' + esc(f.mod.id) + '</code>'
          + (f.why.length ? '<span class="r-why">别名或关键词:' + esc(f.why.slice(0, 3).join('、')) + '</span>' : '')
          + (names.length ? '<span class="r-sec">' + esc(names.join(' / ')) + '</span>' : '')
          + '<div class="r-sum">' + esc(f.mod.summary) + '</div></a>';
      }).join('');
      results.hidden = false;
      if (found.length) {
        status.textContent = '找到 ' + found.length + ' 个模组' + (sel.length ? '（只在勾选的分区里找）' : '');
      } else {
        status.innerHTML = '没有找到匹配的模组。可以换个词试试，或者<a href="' + esc(SEARCH_HREF) + '">去物品检索器搜词条</a>。';
      }
      status.hidden = false;
    }

    function blockOut(block, yes) {
      block.classList.toggle('is-out', yes);
    }

    // 主页在站点根目录：条和结果都指向 mods/<id>.html，检索器是 search.html
    function modHref(id) {
      return 'mods/' + encodeURIComponent(id) + '.html';
    }
    var SEARCH_HREF = 'search.html';

    // ---------- 分区折叠 ----------
    var collapsed = readCollapsed();
    blocks.forEach(function (block) {
      var slug = block.getAttribute('data-sec');
      if (collapsed.indexOf(slug) !== -1) collapse(block, true);
      var toggle = block.querySelector('.sec-toggle');
      if (!toggle) return;
      toggle.addEventListener('click', function () {
        var yes = !block.classList.contains('is-collapsed');
        collapse(block, yes);
        writeCollapsed(readCollapsed().filter(function (s) { return s !== slug; }).concat(yes ? [slug] : []));
      });
    });

    // ---------- 限定范围：默认收起，点开是一个下拉面板 ----------
    var scopeToggle = document.getElementById('nav-scope-toggle');
    var scopePanel = document.getElementById('nav-scope-panel');
    var scopeBadge = document.getElementById('nav-scope-badge');
    var scopeClear = document.getElementById('nav-scope-clear');
    if (scopeToggle && scopePanel && scopeBadge) {
      // 勾了几个就显示数字并换色，收起时也能看出搜索被限定了范围
      var syncScope = function () {
        var sel = selected();
        scopeBadge.textContent = String(sel.length);
        scopeBadge.hidden = sel.length === 0;
        scope.classList.toggle('has-selection', sel.length > 0);
        scopeToggle.title = sel.length
          ? '已限定在:' + sel.map(function (slug) { return sectionTitle[slug] || slug; }).join('、')
          : '点开勾选分区，只在勾选的分区里搜';
      };
      var setScopeOpen = function (yes) {
        scopePanel.hidden = !yes;
        scopeToggle.setAttribute('aria-expanded', yes ? 'true' : 'false');
      };
      scopeToggle.addEventListener('click', function () { setScopeOpen(scopePanel.hidden); });
      if (scopeClear) {
        scopeClear.addEventListener('click', function () {
          [].slice.call(scope.querySelectorAll('input:checked')).forEach(function (i) { i.checked = false; });
          syncScope();
          run();
        });
      }
      scope.addEventListener('change', syncScope);
      // 点外面或按 Esc 关闭面板，勾选保留
      document.addEventListener('click', function (e) { if (!scope.contains(e.target)) setScopeOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setScopeOpen(false); });
      syncScope();
    }

    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); });
    input.addEventListener('input', run);
    scope.addEventListener('change', run);
    run();
  }

  window.__navHome = { splitQuery: splitQuery, matchMod: matchMod, search: search, init: init };

  // 脚本在页面的末尾加载：DOM 已经在了就直接开始，否则等 DOMContentLoaded。
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})();
