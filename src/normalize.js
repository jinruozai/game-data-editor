/**
 * Value normalization + struct_def validation.
 * Normalize value toward target base_type: int | float | string | array.
 * Returns { value, changed, failed, original }.
 */
(function () {
  'use strict';

  function toInt(v) {
    if (typeof v === 'number' && isFinite(v)) return { ok: true, v: Math.trunc(v) };
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return { ok: false };
      var n = Number(s);
      if (isFinite(n)) return { ok: true, v: Math.trunc(n) };
      return { ok: false };
    }
    if (typeof v === 'boolean') return { ok: true, v: v ? 1 : 0 };
    return { ok: false };
  }
  function toFloat(v) {
    if (typeof v === 'number' && isFinite(v)) return { ok: true, v: v };
    if (typeof v === 'string') {
      var s = v.trim().replace(/%$/, '');
      if (!s) return { ok: false };
      var n = Number(s);
      if (isFinite(n)) return { ok: true, v: n };
      return { ok: false };
    }
    if (typeof v === 'boolean') return { ok: true, v: v ? 1 : 0 };
    return { ok: false };
  }
  function toString(v) {
    if (v == null) return { ok: true, v: '' };
    if (typeof v === 'string') return { ok: true, v: v };
    if (typeof v === 'number' || typeof v === 'boolean') return { ok: true, v: String(v) };
    try { return { ok: true, v: JSON.stringify(v) }; } catch (_) { return { ok: false }; }
  }
  function toArray(v) {
    if (Array.isArray(v)) return { ok: true, v: v };
    if (v == null || v === '') return { ok: true, v: [] };
    return { ok: true, v: [v] };
  }

  function normalizeValue(value, baseType) {
    var original = value;
    var res;
    switch (baseType) {
      case 'int': res = toInt(value); break;
      case 'float': res = toFloat(value); break;
      case 'string': res = toString(value); break;
      case 'array': res = toArray(value); break;
      default: return { value: value, changed: false, failed: false, original: original };
    }
    if (res.ok) {
      var changed = res.v !== value;
      return { value: res.v, changed: changed, failed: false, original: original };
    }
    // fallback to empty
    var empty = baseType === 'int' ? 0 : baseType === 'float' ? 0.0 : baseType === 'string' ? '' : [];
    return { value: empty, changed: true, failed: true, original: original };
  }

  // Parse "array[X]" -> elementType
  function parseArrayType(typeName) {
    if (typeof typeName !== 'string') return null;
    var m = typeName.match(/^array\[(.+)\]$/);
    return m ? m[1] : null;
  }

  function getBaseType(typeName) {
    if (!typeName) return 'string';
    if (parseArrayType(typeName)) return 'array';
    var rt = State.resolveType(typeName);
    if (!rt) return 'string';
    return rt.base_type || 'string';
  }

  /**
   * Run through all tables, normalize every entity against its struct_def,
   * log changes/failures, and detect duplicate IDs (but data is already keyed by id
   * so duplicates are logged from loader, not from this pass).
   */
  function normalizeAll() {
    var tm = State.tableMap();
    var gd = Object.assign({}, State.gameData());
    var changedCount = 0, failedCount = 0;

    Object.keys(tm).forEach(function (pk) {
      var sd = tm[pk].struct_def || {};
      (tm[pk].id || []).forEach(function (id) {
        var entity = gd[id]; if (!entity) return;
        var next = Object.assign({}, entity);
        var touched = false;
        Object.keys(sd).forEach(function (field) {
          var fd = sd[field]; if (!fd || !fd.type) return;
          var baseType = getBaseType(fd.type);
          if (entity[field] === undefined) {
            var rfd = State.resolveFieldDef(fd);
            next[field] = (rfd && rfd.default !== undefined)
              ? JSON.parse(JSON.stringify(rfd.default)) : null;
            touched = true;
            return;
          }
          var r = normalizeValue(entity[field], baseType);
          if (r.changed) {
            if (r.failed) {
              State.log('warn',
                'Normalize failed: ' + pk + '/' + id + '/' + field +
                ' (target ' + baseType + ') -> empty',
                { pathKey: pk, id: id, field: field, original: r.original, value: r.value }
              );
              failedCount++;
            } else {
              State.log('info',
                'Normalize: ' + pk + '/' + id + '/' + field +
                ' = ' + JSON.stringify(r.original) + ' -> ' + JSON.stringify(r.value),
                { pathKey: pk, id: id, field: field, original: r.original, value: r.value }
              );
              changedCount++;
            }
            next[field] = r.value;
            touched = true;
          }
        });
        if (touched) gd[id] = next;
      });
    });

    State.setGameData(gd);
    if (changedCount || failedCount) {
      State.log('info', 'Normalization complete: ' + changedCount + ' converted, ' + failedCount + ' failed');
    }
  }

  /**
   * Validate a single value against its FieldDef (for log hints only).
   * Returns null if ok, or an error string.
   */
  function validateValue(value, fieldDef) {
    var rfd = State.resolveFieldDef(fieldDef);
    if (!rfd) return null;
    var agv = rfd.type_agv || {};
    if (rfd.type_render === 'enum' && agv.options) {
      var opts = agv.options;
      var keys = Array.isArray(opts) ? opts.map(function (o) { return o.value; }) : Object.keys(opts);
      var sv = rfd.base_type === 'int' ? Number(value) : value;
      var matched = keys.some(function (k) {
        return rfd.base_type === 'int' ? Number(k) === sv : String(k) === String(sv);
      });
      if (!matched) return 'Value not in enum options';
    }
    if (rfd.type_render === 'range') {
      var n = Number(value);
      if (agv.min != null && n < agv.min) return 'Value < min (' + agv.min + ')';
      if (agv.max != null && n > agv.max) return 'Value > max (' + agv.max + ')';
    }
    return null;
  }

  window.Normalize = {
    normalizeValue: normalizeValue,
    normalizeAll: normalizeAll,
    parseArrayType: parseArrayType,
    getBaseType: getBaseType,
    validateValue: validateValue,
  };
})();
