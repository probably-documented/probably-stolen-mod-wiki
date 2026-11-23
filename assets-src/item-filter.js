/* item-filter: 点击 chip 按品类/来源两维与逻辑过滤卡片,再点同一 chip 取消 */
(function () {
  var state = { category: '', mod: '' };
  var cards = [].slice.call(document.querySelectorAll('a.item-card'));
  var status = document.getElementById('item-filter-status');
  function visible(c) {
    var cats = ' ' + (c.getAttribute('data-category') || '') + ' ';
    return (!state.category || cats.indexOf(' ' + state.category + ' ') >= 0)
      && (!state.mod || c.getAttribute('data-mod') === state.mod);
  }
  function apply() {
    var n = 0;
    cards.forEach(function (c) { var ok = visible(c); c.style.display = ok ? '' : 'none'; if (ok) n++; });
    [].slice.call(document.querySelectorAll('section[data-mod]')).forEach(function (s) {
      var any = [].slice.call(s.querySelectorAll('a.item-card')).some(visible);
      s.style.display = any ? '' : 'none';
    });
    if (status) status.textContent = '当前筛选:' + (state.category || '全部品类') + ' × ' + (state.mod || '全部模组') + ' · 命中 ' + n + ' 件';
  }
  ['category', 'mod'].forEach(function (dim) {
    [].slice.call(document.querySelectorAll('span.item-inline[data-' + dim + ']')).forEach(function (ch) {
      ch.style.cursor = 'pointer';
      ch.addEventListener('click', function () {
        var v = ch.getAttribute('data-' + dim) || '';
        state[dim] = state[dim] === v ? '' : v;
        [].slice.call(document.querySelectorAll('span.item-inline[data-' + dim + ']')).forEach(function (o) {
          o.style.borderColor = ''; o.style.color = '';
        });
        if (state[dim]) { ch.style.borderColor = 'var(--dk-accent)'; ch.style.color = 'var(--dk-accent)'; }
        else {
          /* Minor 9:取消筛选后「全部」chip 恢复高亮 */
          var all = document.querySelector('span.item-inline[data-' + dim + '=""]');
          if (all) { all.style.borderColor = 'var(--dk-accent)'; all.style.color = 'var(--dk-accent)'; }
        }
        apply();
      });
    });
  });
  apply();
})();
