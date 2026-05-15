/**
 * GameDataEditor Inspector provider for TypeConfig entries.
 */
(function () {
  'use strict';

  function toFormValue(td, key) {
    var t = td || {};
    return {
      key:         key || '',
      name:        t.name || '',
      base_type:   t.base_type || 'string',
      type_render: t.type_render || 'input_string',
      'default':   JSON.stringify(t.default == null ? '' : t.default),
      mem:         t.mem || '',
      type_agv:    JSON.stringify(t.type_agv || {}),
    };
  }

  function applyEdit(key, field, nv) {
    if (field === 'key') {
      if (!nv || nv === key) return;
      try {
        State.renameProjectType(key, nv);
        State.setSelection({ kind: 'typeconfig', key: nv });
      } catch (e) {
        State.log('error', String(e.message || e));
      }
      return;
    }

    var current = State.resolveType(key) || {};
    var patch = {};
    if (field === 'base_type') {
      patch.base_type = nv;
      if (TypeDefSchema.renderKindsForBase(nv).indexOf(current.type_render) < 0) {
        patch.type_render = TypeDefSchema.defaultRenderForBase(nv);
      }
      if (!TypeDefSchema.valueMatchesBase(nv, current.default)) {
        patch.default = TypeDefSchema.defaultValueForBase(nv);
      }
    } else if (field === 'type_render') {
      if (TypeDefSchema.renderKindsForBase(current.base_type || 'string').indexOf(nv) < 0) return;
      patch.type_render = nv;
    } else if (field === 'default') {
      try { patch[field] = JSON.parse(nv); } catch (_) { patch[field] = nv; }
    } else if (field === 'type_agv') {
      try { patch[field] = JSON.parse(nv); } catch (_) { return; }
    } else {
      patch[field] = nv;
    }
    State.upsertProjectType(key, Object.assign({}, current, patch));
  }

  Inspector.registerKind('typeconfig', {
    title:     function (sel) { return sel.key; },
    disabled:  function (sel) { return !State.projectTypeConfig()[sel.key]; },
    schema:    function (sel) {
      var td = State.resolveType(sel.key) || {};
      return TypeDefSchema.build(td.base_type || 'string');
    },
    value:     function (sel) { return toFormValue(State.resolveType(sel.key), sel.key); },
    onChange:  function (sel, field, nv) { applyEdit(sel.key, field, nv); },
    dataTopic: function ()    { return 'typeconfig:changed'; },
  });
})();
