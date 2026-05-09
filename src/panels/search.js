/**
 * Global Search panel component.
 */
(function () {
  'use strict';

  function createPanel(propsSig, ctx) {
    var props = propsSig.peek() || {};
    var root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:8px;';

    var inputSig = EF.signal('');
    var input = EF.ui.searchInput({ value: inputSig, placeholder: t('search.placeholder') });

    var countLine = document.createElement('div');
    countLine.style.cssText = 'font-size:var(--ef-fs-xs);color:var(--ef-fg-3);margin-bottom:4px;';

    var results = document.createElement('div');
    results.style.cssText = 'flex:1;overflow:auto;margin-top:4px;';

    root.appendChild(input); root.appendChild(countLine); root.appendChild(results);

    var query = '';

    function search() {
      GDE.clear(results);
      if (!query) {
        countLine.textContent = '';
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;color:var(--ef-fg-3);font-size:var(--ef-fs-sm);text-align:center;';
        empty.textContent = t('search.empty');
        results.appendChild(empty);
        return;
      }
      var q = query.toLowerCase();
      var tm = State.tableMap();
      var gd = State.gameData();
      var hits = [];
      Object.keys(tm).forEach(function (pk) {
        (tm[pk].id || []).forEach(function (id) {
          var e = gd[id] || {};
          var hit = null;
          if (id.indexOf(q) >= 0) hit = { field: 'id', value: id };
          else {
            Object.keys(e).some(function (f) {
              var v = e[f];
              if (v == null) return false;
              var s = typeof v === 'string' ? v : JSON.stringify(v);
              if (s.toLowerCase().indexOf(q) >= 0) {
                hit = { field: f, value: s };
                return true;
              }
              return false;
            });
          }
          if (hit) hits.push({ pathKey: pk, id: id, field: hit.field, value: hit.value });
        });
      });
      countLine.textContent = hits.length ? t('search.result_count', { n: hits.length }) : t('search.no_results');
      hits.slice(0, 200).forEach(function (h) {
        var row = document.createElement('div');
        row.className = 'gde-search-result';
        var line1 = document.createElement('div');
        var idLabel = document.createElement('b');
        idLabel.textContent = h.id;
        var match = document.createElement('span');
        match.className = 'gde-sr-match';
        match.textContent = '· ' + h.field;
        line1.appendChild(idLabel);
        line1.appendChild(document.createTextNode(' '));
        line1.appendChild(match);
        var line2 = document.createElement('div');
        line2.className = 'gde-sr-path';
        line2.textContent = h.pathKey + ' — ' + (h.value.length > 80 ? h.value.slice(0, 80) + '…' : h.value);
        row.appendChild(line1); row.appendChild(line2);
        row.addEventListener('click', function () {
          EF.bus.emit('nav:goto', { pathKey: h.pathKey, id: h.id, field: h.field });
        });
        results.appendChild(row);
      });
    }

    EF.ui.bind(root, inputSig, function (v) { query = v || ''; search(); });

    function applyLocale() {
      var inner = input.querySelector('input');
      if (inner) inner.placeholder = t('search.placeholder');
      (function(__t){ if (ctx.panel && ctx.panel.title && ctx.panel.title()!==__t) ctx.panel.setTitle(__t); })(t('panel.search'));
      search();
    }
    var offLocale = I18N.onChange(applyLocale);
    ctx.onCleanup(offLocale);
    ctx.bus.on('data:changed', search);
    ctx.bus.on('search:set', function (payload) {
      inputSig.set((payload && payload.query) || '');
      var inner = input.querySelector('input');
      if (inner) inner.focus();
    });

    applyLocale();
    return root;
  }

  EF.registerComponent('gde-search', {
    category: 'panel',
    label: 'Search',
    icon: 'search',
    factory: createPanel,
    defaults: function () { return { title: 'Search', props: {} }; },
  });
})();
