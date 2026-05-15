/**
 * GameDataEditor Inspector provider for table entity selection.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // ── Built-in provider: editing an entity in a table ───────────
  Inspector.registerKind('card_data', {
    title: function (sel) {
      var refs = selectedEntityRefs(sel);
      if (refs.length > 1) {
        var samePath = refs.every(function (r) { return r.pathKey === refs[0].pathKey; });
        return refs.length + ' selected' + (samePath ? ' �� ' + refs[0].pathKey : '');
      }
      var id = refs[0] ? refs[0].id : sel.id;
      return t('inspector.id_label') + ': ' + id;
    },
    schema:    function (sel) { return commonEntitySchema(selectedEntityRefs(sel)); },
    value:     function (sel) { return State.gameData()[sel.id] || {}; },
    targets:   function (sel) {
      var gd = State.gameData();
      return selectedEntityRefs(sel).map(function (ref) { return gd[ref.id] || {}; });
    },
    onChange:  function (sel, field, nv) {
      State.setEntityFieldMany(selectedEntityRefs(sel).map(function (ref) { return ref.id; }), field, nv);
    },
    dataTopic: function (sel) {
      var refs = selectedEntityRefs(sel);
      if (!refs.length) return null;
      var samePath = refs.every(function (r) { return r.pathKey === refs[0].pathKey; });
      return samePath ? 'data:changed:' + refs[0].pathKey : 'data:changed';
    },
    copyText: function (sel) {
      var refs = selectedEntityRefs(sel);
      return refs.length === 1 ? refs[0].id : '';
    },
    fieldTargets: function (sel, field) { return fieldTargetsForSelection(sel, field); },
  });

  function selectedEntityRefs(sel) {
    if (sel && sel.items && sel.items.length) {
      return sel.items.map(function (it) { return { pathKey: it.pathKey, id: String(it.id) }; });
    }
    var ids = sel && sel.ids && sel.ids.length ? sel.ids : (sel && sel.id != null ? [sel.id] : []);
    return ids.map(function (id) { return { pathKey: sel.pathKey, id: String(id) }; });
  }
  function commonEntitySchema(refs) {
    var tm = State.tableMap();
    if (!refs.length) return {};
    var first = (tm[refs[0].pathKey] || {}).struct_def || {};
    var out = {};
    Object.keys(first).filter(function (field) { return field !== 'id'; }).forEach(function (field) {
      var sig = fieldTypeSignature(first[field]);
      for (var i = 1; i < refs.length; i++) {
        var sd = (tm[refs[i].pathKey] || {}).struct_def || {};
        if (!sd[field] || fieldTypeSignature(sd[field]) !== sig) return;
      }
      out[field] = first[field];
    });
    return out;
  }
  function fieldTypeSignature(def) {
    if (typeof def === 'string') return def;
    return def && typeof def === 'object' ? String(def.type || '') : '';
  }
  function fieldTargetsForSelection(sel, field) {
    if (!sel || sel.kind !== 'card_data' || !window.GDE || !GDE.ai || !GDE.ai.fieldTarget) return [];
    var tm = State.tableMap();
    return selectedEntityRefs(sel).filter(function (ref) {
      var sd = (tm[ref.pathKey] || {}).struct_def || {};
      return Object.prototype.hasOwnProperty.call(sd, field);
    }).map(function (ref) {
      return GDE.ai.fieldTarget(ref.pathKey, ref.id, field);
    });
  }

})();
