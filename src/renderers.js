/**
 * Renderers — tiny utility helpers retained from the pre-propertyPanel era.
 *
 * All schema-driven field rendering now lives in the framework (EF.ui.
 * propertyEditor / propertyPanel / registerRenderer). This file exists
 * only because `card.js` still reads enum options + int-to-hex from the
 * two pure functions below. When card.js is next refactored these can
 * move alongside it and this file will disappear.
 */
(function () {
  'use strict';

  function normOptions(opts) {
    if (!opts) return [];
    if (Array.isArray(opts)) return opts.slice();
    return Object.keys(opts).map(function (k) {
      var raw = opts[k];
      if (raw && typeof raw === 'object') return { value: k, label: raw.label || raw.value || k, color: raw.color };
      var s = String(raw);
      var ci = s.indexOf(':');
      if (ci >= 0 && /^#|^rgb/.test(s.slice(ci + 1).trim())) {
        return { value: k, label: s.slice(0, ci), color: s.slice(ci + 1).trim() };
      }
      return { value: k, label: s };
    });
  }

  function toHex6(n) {
    var v = Math.max(0, Math.min(0xffffff, Math.trunc(Number(n) || 0)));
    var s = v.toString(16).toUpperCase();
    while (s.length < 6) s = '0' + s;
    return '#' + s;
  }

  window.Renderers = { normOptions: normOptions, toHex6: toHex6 };
})();
