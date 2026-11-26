/* item-filter: 分区物品图鉴的筛选(阶段 5 Task 4)。
   点一个品类或一个来源(mod),只留符合的卡片;再点同一个取消;两维同时生效。
   只动自己容器(#section-items)里的东西;不跑脚本时全部物品照常显示。
   普通脚本,不发请求,站上和离线包里一样能用。 */
(function () {
  /** 一张卡片在当前筛选下留不留。card: { categories, mod };state: { category, mod },哪一维是空串就是「全部」。 */
  function matches(card, state) {
    if (state.mod && card.mod !== state.mod) return false;
    if (state.category) {
      var cats = Array.isArray(card.categories) ? card.categories : String(card.categories == null ? '' : card.categories).split(/\s+/);
      if (cats.indexOf(state.category) < 0) return false;
    }
    return true;
  }

  function init(scope) {
    var root = scope || document.getElementById('section-items');
    if (!root) return;
    var status = document.getElementById('item-filter-status');
    var state = { category: '', mod: '' };
    var cards = [].slice.call(root.querySelectorAll('.item-grid a.item-card'));
    var sections = [].slice.call(root.querySelectorAll('section[data-mod]'));
    var chips = [].slice.call(root.querySelectorAll('.item-chip[data-category], .item-chip[data-mod]'));

    function dimension(chip) {
      return chip.hasAttribute('data-category') ? 'category' : 'mod';
    }

    function apply() {
      var shown = 0;
      cards.forEach(function (card) {
        var keep = matches({ categories: card.getAttribute('data-category'), mod: card.getAttribute('data-mod') }, state);
        card.hidden = !keep;
        if (keep) shown += 1;
      });
      // 一个 mod 的卡片全被筛掉时,它那一节整个收起来
      sections.forEach(function (section) {
        var any = [].slice.call(section.querySelectorAll('a.item-card')).some(function (card) { return !card.hidden; });
        section.hidden = !any;
      });
      chips.forEach(function (chip) {
        var dim = dimension(chip);
        var on = state[dim] === (chip.getAttribute('data-' + dim) || '');
        chip.setAttribute('aria-pressed', on ? 'true' : 'false');
        chip.classList.toggle('is-on', on);
      });
      if (status) {
        // 状态行说的是标签上的字:选中的那一个;一维没选时选中的就是「全部」
        var picked = function (dim) {
          var chip = chips.filter(function (c) { return dimension(c) === dim && c.classList.contains('is-on'); })[0];
          return chip ? chip.textContent : '';
        };
        status.textContent = '当前筛选:' + picked('category') + ' × ' + picked('mod') + ' · 命中 ' + shown + ' 件';
      }
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var dim = dimension(chip);
        var value = chip.getAttribute('data-' + dim) || '';
        state[dim] = state[dim] === value ? '' : value;
        apply();
      });
    });
    apply();
  }

  window.__itemFilter = { matches: matches, init: init };

  // 脚本在页面的末尾加载:DOM 已经在了就直接开始,否则等 DOMContentLoaded。
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
  }
})();
