/**
 * Core state: builtin type_config, project type_config, gameData, tableMap, version.
 * Exposes window.State with signals + mutators. All changes ripple via EF.bus events.
 *
 * Signals:
 *   version()                number
 *   builtinTypeConfig()      { [type]: TypeConfigItem }
 *   projectTypeConfig()      { [type]: TypeConfigItem }
 *   gameData()               { [id]: entity }
 *   tableMap()               { [pathKey]: { struct_def, id[] } }
 *   projectName()            string
 *   selection()              { pathKey, ids: string[], lastId } | null
 *   activeTable()            pathKey | null  (synced FROM the layout tree)
 *   dirty()                  boolean
 *   workspaceInfo()          { kind, name } | null
 *
 * Bus events:
 *   'tables:changed', 'data:changed:<pathKey>', 'selection:changed',
 *   'typeconfig:changed', 'log'
 *
 * Tab management: openTabs is NOT a separate signal. The center dock's
 * panels ARE the open tabs. openTable/closeTab/pinTab call into the EF
 * LayoutHandle. activeTable signal is kept in sync via an effect in main.js.
 */
(function () {
  'use strict';

  // ---------- Signals ----------
  var version = EF.signal(0);
  var builtinTypeConfig = EF.signal({});
  var projectTypeConfig = EF.signal({});
  var gameData = EF.signal({});
  var tableMap = EF.signal({}); // { pathKey: { struct_def, id: [], card_style? } }
  var projectName = EF.signal('Untitled');
  var dirty = EF.signal(false);
  var workspaceInfo = EF.signal(null);
  var activeTable = EF.signal(null);
  var selection = EF.signal(null); // { pathKey, ids: [], lastId }
  // Project-level UI tree library — each entry is a CardStyleDef:
  //   { name: string, root: TreeNode | null }
  // Tables reference one by key via tableMap[pk].card_style (string).
  // Built-in 'default' is seeded by seed.js; user can add more.
  var projectCardStyles = EF.signal({});
  // "Which cardStyle is the editor focused on" — drives the node-tree panel
  // in the left dock. Not the same as State.selection (which can be any
  // kind), but updated whenever a card_style / card_component is selected.
  var activeCardStyle = EF.signal(null);

  // ---------- Layout handle (set by main.js after createDockLayout) ----------
  var _handle = null;
  var _centerDockName = 'center';

  function _setLayout(handle, centerDockName) {
    _handle = handle;
    if (centerDockName) _centerDockName = centerDockName;
  }

  function destroy() {
    stopTypeConfigEffect();
    _handle = null;
  }

  function _centerDockId() {
    if (!_handle) return null;
    var tree = _handle.tree();
    var id = null;
    (function walk(n) {
      if (!n) return;
      if (n.type === 'dock' && n.name === _centerDockName) id = n.id;
      else if (n.type === 'split') n.children.forEach(walk);
    })(tree);
    return id;
  }

  function _stableStringify(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + _stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function _samePanelIntent(a, b) {
    if (!a || !b || a.component !== b.component) return false;
    if (a.name && b.name) return a.name === b.name;
    return _stableStringify(a.props || {}) === _stableStringify(b.props || {});
  }

  function _findMainPanel(panel) {
    if (!_handle || !panel) return null;
    var tree = _handle.tree();
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.type === 'dock' && n.name === _centerDockName) {
        for (var i = 0; i < n.panels.length; i++) {
          if (_samePanelIntent(n.panels[i], panel)) {
            found = { panel: n.panels[i], dockId: n.id };
            return;
          }
        }
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(tree);
    return found;
  }

  function _findTablePanel(pathKey) {
    if (!_handle) return null;
    var tree = _handle.tree();
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.type === 'dock' && n.name === _centerDockName) {
        for (var i = 0; i < n.panels.length; i++) {
          var p = n.panels[i];
          if (p.component === 'gde-table-data' && p.props && p.props.pathKey === pathKey) {
            found = { panel: p, dockId: n.id };
            return;
          }
        }
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(tree);
    return found;
  }

  function _findCardStylePanel(styleKey) {
    if (!_handle) return null;
    var tree = _handle.tree();
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.type === 'dock' && n.name === _centerDockName) {
        for (var i = 0; i < n.panels.length; i++) {
          var p = n.panels[i];
          if (p.component === 'gde-cardstyle-editor' && p.props && p.props.styleKey === styleKey) {
            found = { panel: p, dockId: n.id };
            return;
          }
        }
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(tree);
    return found;
  }

  function _allCenterPanels() {
    if (!_handle) return [];
    var tree = _handle.tree();
    var out = [];
    (function walk(n) {
      if (!n) return;
      if (n.type === 'dock' && n.name === _centerDockName) {
        n.panels.forEach(function (p) { out.push(p); });
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(tree);
    return out;
  }

  function _findPanelByComponent(component) {
    if (!_handle) return null;
    var tree = _handle.tree();
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.type === 'dock') {
        for (var i = 0; i < n.panels.length; i++) {
          if (n.panels[i].component === component) {
            found = { panel: n.panels[i], dockId: n.id, dockName: n.name };
            return;
          }
        }
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(tree);
    return found;
  }

  function showCardStyleTree() {
    var hit = _findPanelByComponent('gde-cardstyle-tree');
    if (hit && _handle) _handle.activatePanel(hit.panel.id);
  }

  function showSearchPanel(query) {
    var hit = _findPanelByComponent('gde-search');
    if (hit && _handle) _handle.activatePanel(hit.panel.id);
    if (query != null) {
      setTimeout(function () {
        EF.bus.emit('search:set', { query: String(query || '') });
      }, 0);
    }
  }

  function _shortName(pathKey) {
    var parts = String(pathKey || '').split('/');
    return parts[parts.length - 1] || pathKey;
  }

  // ---------- Helpers ----------
  function isDirtyEvent(ev) {
    return ev === 'tables:changed'
        || ev === 'typeconfig:changed'
        || ev === 'cardstyles:changed'
        || ev.indexOf('data:changed') === 0;
  }
  function emit(ev, payload) {
    if (isDirtyEvent(ev)) dirty.set(true);
    EF.bus.emit(ev, payload);
    if (isDirtyEvent(ev) && window.GDE && GDE.history) GDE.history.captureEvent(ev, payload);
  }

  // Whenever either TypeConfig signal changes, push the merged view into the
  // framework so EF.ui.propertyPanel / propertyEditor / resolveFieldDef pick
  // up project types and overrides automatically.
  var stopTypeConfigEffect = EF.effect(function () {
    EF.ui.setTypeConfig(builtinTypeConfig(), { overrides: projectTypeConfig() });
  });

  // Thin delegations — keep the State.* API for existing callers.
  function resolveType(typeName)     { return EF.ui.resolveType(typeName); }
  function resolveFieldDef(fieldDef) { return EF.ui.resolveFieldDef(fieldDef); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // ---------- ID generator ----------
  function genId(maxRetry) {
    var data = gameData();
    var retry = maxRetry || 100;
    for (var i = 0; i < retry; i++) {
      // 15-digit positive decimal (safe within 2^53-1 so JS numbers & strings agree)
      var hi = Math.floor(Math.random() * 9) + 1; // 1..9
      var rest = '';
      for (var j = 0; j < 14; j++) rest += Math.floor(Math.random() * 10);
      var id = String(hi) + rest;
      if (!data[id]) return id;
    }
    throw new Error('Failed to generate unique ID after ' + retry + ' retries');
  }

  // ---------- Mutators ----------
  function setBuiltinTypeConfig(tc) {
    builtinTypeConfig.set(Object.assign({}, tc));
    emit('typeconfig:changed');
  }
  function setProjectTypeConfig(tc) {
    projectTypeConfig.set(Object.assign({}, tc));
    emit('typeconfig:changed');
  }
  function upsertProjectType(name, cfg) {
    var tc = Object.assign({}, projectTypeConfig());
    tc[name] = cfg;
    projectTypeConfig.set(tc);
    emit('typeconfig:changed');
  }
  function deleteProjectType(name) {
    var tc = Object.assign({}, projectTypeConfig());
    delete tc[name];
    projectTypeConfig.set(tc);
    emit('typeconfig:changed');
  }
  function renameProjectType(oldKey, newKey) {
    if (!oldKey || !newKey || oldKey === newKey) return;
    var tc = Object.assign({}, projectTypeConfig());
    if (!tc[oldKey]) throw new Error('Not a project type: ' + oldKey);
    if (tc[newKey] || builtinTypeConfig()[newKey]) {
      throw new Error('Type name already exists: ' + newKey);
    }
    tc[newKey] = tc[oldKey];
    delete tc[oldKey];
    projectTypeConfig.set(tc);
    // Patch every FieldDef in every table's struct_def that referenced oldKey.
    var tm = tableMap();
    var nextTm = null;
    Object.keys(tm).forEach(function (pk) {
      var sd = (tm[pk] && tm[pk].struct_def) || {};
      var nextSd = null;
      Object.keys(sd).forEach(function (f) {
        var fd = sd[f];
        if (fd && fd.type === oldKey) {
          if (!nextSd) nextSd = Object.assign({}, sd);
          nextSd[f] = Object.assign({}, fd, { type: newKey });
        }
      });
      if (nextSd) {
        if (!nextTm) nextTm = Object.assign({}, tm);
        nextTm[pk] = Object.assign({}, tm[pk], { struct_def: nextSd });
      }
    });
    if (nextTm) { tableMap.set(nextTm); emit('tables:changed'); }
    emit('typeconfig:changed');
  }
  function findTypeUsages(typeName) {
    var tm = tableMap(); var out = [];
    Object.keys(tm).forEach(function (pk) {
      var sd = tm[pk].struct_def || {};
      Object.keys(sd).forEach(function (f) {
        if (sd[f] && sd[f].type === typeName) out.push({ pathKey: pk, field: f });
      });
    });
    return out;
  }

  // ---------- CardStyle mutators ----------
  function setProjectCardStyles(cs) {
    projectCardStyles.set(Object.assign({}, cs));
    emit('cardstyles:changed');
  }
  function upsertCardStyle(key, def) {
    var cs = Object.assign({}, projectCardStyles());
    cs[key] = def;
    projectCardStyles.set(cs);
    emit('cardstyles:changed');
  }
  function mutateCardStyle(key, fn) {
    var current = projectCardStyles()[key];
    if (!current) return null;
    var next = JSON.parse(JSON.stringify(current));
    if (fn(next) === false) return null;
    upsertCardStyle(key, next);
    return next;
  }
  function deleteCardStyle(key) {
    if (key === 'default') throw new Error('Cannot delete the built-in default cardStyle');
    var cs = Object.assign({}, projectCardStyles());
    delete cs[key];
    projectCardStyles.set(cs);
    // Cascade: tables referencing this style fall back to 'default'.
    var tm = tableMap();
    var nextTm = null;
    Object.keys(tm).forEach(function (pk) {
      if (tm[pk].card_style === key) {
        if (!nextTm) nextTm = Object.assign({}, tm);
        nextTm[pk] = Object.assign({}, tm[pk], { card_style: 'default' });
      }
    });
    if (nextTm) { tableMap.set(nextTm); emit('tables:changed'); }
    if (_handle) {
      var hit = _findCardStylePanel(key);
      if (hit) _handle.removePanel(hit.panel.id);
    }
    if (activeCardStyle.peek() === key) activeCardStyle.set(null);
    var sel = selection.peek();
    if (sel && ((sel.kind === 'card_style' && sel.key === key)
             || (sel.kind === 'card_component' && sel.styleKey === key))) {
      setSelection(null);
    }
    emit('cardstyles:changed');
  }
  function renameCardStyle(oldKey, newKey) {
    if (oldKey === 'default') throw new Error('Cannot rename the built-in default cardStyle');
    if (!oldKey || !newKey || oldKey === newKey) return;
    var cs = Object.assign({}, projectCardStyles());
    if (!cs[oldKey]) throw new Error('Not a project cardStyle: ' + oldKey);
    if (cs[newKey]) throw new Error('CardStyle key already exists: ' + newKey);
    cs[newKey] = cs[oldKey];
    delete cs[oldKey];
    projectCardStyles.set(cs);
    var tm = tableMap();
    var nextTm = null;
    Object.keys(tm).forEach(function (pk) {
      if (tm[pk].card_style === oldKey) {
        if (!nextTm) nextTm = Object.assign({}, tm);
        nextTm[pk] = Object.assign({}, tm[pk], { card_style: newKey });
      }
    });
    if (nextTm) { tableMap.set(nextTm); emit('tables:changed'); }
    if (_handle) {
      var hit = _findCardStylePanel(oldKey);
      if (hit) {
        var tree = _handle.tree();
        tree = EF.updatePanel(tree, hit.panel.id, {
          title: (cs[newKey] && cs[newKey].name) || newKey,
          props: Object.assign({}, hit.panel.props, { styleKey: newKey }),
        });
        _handle.setTree(tree);
      }
    }
    if (activeCardStyle.peek() === oldKey) activeCardStyle.set(newKey);
    var sel = selection.peek();
    if (sel && sel.kind === 'card_style' && sel.key === oldKey) {
      setSelection({ kind: 'card_style', key: newKey });
    } else if (sel && sel.kind === 'card_component' && sel.styleKey === oldKey) {
      setSelection(Object.assign({}, sel, { styleKey: newKey }));
    }
    emit('cardstyles:changed');
  }
  function setTableCardStyle(pathKey, styleKey) {
    var tm = tableMap();
    if (!tm[pathKey]) return;
    var nextTm = Object.assign({}, tm);
    nextTm[pathKey] = Object.assign({}, tm[pathKey], { card_style: styleKey });
    tableMap.set(nextTm);
    emit('tables:changed');
  }
  // Resolve the CardStyleDef a table renders with. Falls back to 'default'
  // when the table didn't pick one or its key is stale (cascade also
  // rewrites stale refs, so this is just defense in depth).
  function resolveCardStyleForTable(pathKey) {
    var cs = projectCardStyles();
    var tm = tableMap();
    var key = (tm[pathKey] && tm[pathKey].card_style) || 'default';
    return cs[key] || cs['default'] || null;
  }
  function cardStyleRootSize(styleOrKey) {
    var def = typeof styleOrKey === 'string' ? projectCardStyles()[styleOrKey] : styleOrKey;
    var root = def && def.root;
    var props = (root && root.props) || {};
    var w = Number(props.width);
    var h = Number(props.height);
    if (!Number.isFinite(w) || w <= 0) w = 120;
    if (!Number.isFinite(h) || h <= 0) h = w;
    return { w: w, h: h };
  }

  function setTableMap(tm) { tableMap.set(Object.assign({}, tm)); emit('tables:changed'); }
  function setGameData(gd) { gameData.set(Object.assign({}, gd)); }

  function addTable(pathKey, struct_def) {
    var tm = Object.assign({}, tableMap());
    if (tm[pathKey]) throw new Error('Table already exists: ' + pathKey);
    tm[pathKey] = { struct_def: struct_def || {}, id: [], card_style: 'default' };
    tableMap.set(tm);
    emit('tables:changed');
  }
  function renameTable(oldKey, newKey) {
    var tm = Object.assign({}, tableMap());
    if (!tm[oldKey]) return;
    if (tm[newKey]) throw new Error('Table name already exists: ' + newKey);
    tm[newKey] = tm[oldKey]; delete tm[oldKey];
    tableMap.set(tm);
    // Sync any open panel for this table → patch props.pathKey + title.
    if (_handle) {
      var hit = _findTablePanel(oldKey);
      if (hit) {
        var tree = _handle.tree();
        tree = EF.updatePanel(tree, hit.panel.id, {
          title: _shortName(newKey),
          props: Object.assign({}, hit.panel.props, { pathKey: newKey }),
        });
        _handle.setTree(tree);
      }
    }
    emit('tables:changed');
  }
  function deleteTable(pathKey) {
    var tm = Object.assign({}, tableMap());
    var t = tm[pathKey]; if (!t) return;
    // Remove its entities from gameData
    var gd = Object.assign({}, gameData());
    (t.id || []).forEach(function (id) { delete gd[id]; });
    gameData.set(gd);
    delete tm[pathKey];
    tableMap.set(tm);
    // Close the panel for this table if open (LayoutHandle handles
    // active re-selection automatically via activation-history).
    if (_handle) {
      var hit = _findTablePanel(pathKey);
      if (hit) _handle.removePanel(hit.panel.id);
    }
    emit('tables:changed');
  }
  function updateStructDef(pathKey, struct_def) {
    var tm = Object.assign({}, tableMap());
    if (!tm[pathKey]) return;
    tm[pathKey] = Object.assign({}, tm[pathKey], { struct_def: struct_def });
    tableMap.set(tm);
    emit('tables:changed');
    emit('data:changed:' + pathKey);
  }
  function setTableIds(pathKey, ids) {
    var tm = Object.assign({}, tableMap());
    if (!tm[pathKey]) return;
    tm[pathKey] = Object.assign({}, tm[pathKey], { id: ids.slice() });
    tableMap.set(tm);
    emit('data:changed:' + pathKey);
  }

  function tableDefinition(pathKey) {
    var t = tableMap()[pathKey];
    if (!t) return null;
    return {
      sourcePathKey: pathKey,
      struct_def: clone(t.struct_def || {}),
      card_style: t.card_style || 'default',
    };
  }

  function pasteTableDefinition(def, basePathKey) {
    if (!def || !def.struct_def) return null;
    var pathKey = uniqueTablePath(basePathKey || def.sourcePathKey || 'new_table', tableMap());
    addTable(pathKey, clone(def.struct_def || {}));
    if (def.card_style) setTableCardStyle(pathKey, def.card_style);
    return pathKey;
  }

  function addEntity(pathKey, seed) {
    var tm = Object.assign({}, tableMap());
    if (!tm[pathKey]) throw new Error('Table not found: ' + pathKey);
    var id = genId();
    var data = Object.assign({}, seed || {});
    // Apply defaults based on struct_def
    var sd = tm[pathKey].struct_def || {};
    Object.keys(sd).forEach(function (f) {
      if (data[f] === undefined) {
        var rfd = resolveFieldDef(sd[f]);
        data[f] = (rfd && rfd.default !== undefined) ? JSON.parse(JSON.stringify(rfd.default)) : null;
      }
    });
    var gd = Object.assign({}, gameData());
    gd[id] = data;
    gameData.set(gd);
    tm[pathKey] = Object.assign({}, tm[pathKey], { id: tm[pathKey].id.concat([id]) });
    tableMap.set(tm);
    emit('data:changed:' + pathKey);
    return id;
  }

  function pasteEntities(pathKey, entities) {
    var t = tableMap()[pathKey];
    if (!t) return [];
    var sd = t.struct_def || {};
    var out = [];
    (entities || []).forEach(function (src) {
      var seed = {};
      Object.keys(sd).forEach(function (field) {
        if (field === 'id') return;
        if (src && Object.prototype.hasOwnProperty.call(src, field)) seed[field] = clone(src[field]);
      });
      out.push(addEntity(pathKey, seed));
    });
    return out;
  }
  function deleteEntities(pathKey, ids) {
    var tm = Object.assign({}, tableMap());
    var t = tm[pathKey]; if (!t) return;
    var set = {}; ids.forEach(function (id) { set[id] = true; });
    var gd = Object.assign({}, gameData());
    ids.forEach(function (id) { delete gd[id]; });
    gameData.set(gd);
    tm[pathKey] = Object.assign({}, t, { id: t.id.filter(function (id) { return !set[id]; }) });
    tableMap.set(tm);
    emit('data:changed:' + pathKey);
  }
  function updateEntity(id, patch) {
    var gd = Object.assign({}, gameData());
    if (!gd[id]) return;
    gd[id] = Object.assign({}, gd[id], patch);
    gameData.set(gd);
    // Find owning table
    var tm = tableMap();
    var owner = null;
    Object.keys(tm).some(function (pk) { if (tm[pk].id.indexOf(id) >= 0) { owner = pk; return true; } return false; });
    if (owner) emit('data:changed:' + owner);
  }
  function setEntityField(id, field, value) {
    var gd = Object.assign({}, gameData());
    if (!gd[id]) return;
    gd[id] = Object.assign({}, gd[id]);
    gd[id][field] = value;
    gameData.set(gd);
    var tm = tableMap();
    var owner = null;
    Object.keys(tm).some(function (pk) { if (tm[pk].id.indexOf(id) >= 0) { owner = pk; return true; } return false; });
    if (owner) emit('data:changed:' + owner);
  }
  function setEntityFieldMany(ids, field, value) {
    var list = (ids || []).map(String);
    if (!list.length) return;
    var gd = Object.assign({}, gameData());
    var touched = {};
    list.forEach(function (id) {
      if (!gd[id]) return;
      gd[id] = Object.assign({}, gd[id]);
      gd[id][field] = value;
      touched[id] = true;
    });
    if (!Object.keys(touched).length) return;
    gameData.set(gd);
    var tm = tableMap();
    Object.keys(tm).forEach(function (pk) {
      var idsInTable = tm[pk].id || [];
      for (var i = 0; i < idsInTable.length; i++) {
        if (touched[idsInTable[i]]) { emit('data:changed:' + pk); break; }
      }
    });
    emit('data:changed', {});
  }

  function findAssetReferences(urls) {
    var urlSet = {};
    (urls || []).forEach(function (url) { if (url) urlSet[url] = true; });
    var out = [];
    var gd = gameData();
    var tm = tableMap();
    Object.keys(tm).forEach(function (pk) {
      (tm[pk].id || []).forEach(function (id) {
        var entity = gd[id];
        if (!entity) return;
        Object.keys(entity).forEach(function (field) {
          walkAssetValue(entity[field], field, function (url, path) {
            if (urlSet[url]) out.push({ pathKey: pk, id: id, field: field, path: path, url: url });
          });
        });
      });
    });
    return out;
  }

  function clearAssetReferences(urls) {
    var urlSet = {};
    (urls || []).forEach(function (url) { if (url) urlSet[url] = true; });
    var gd = Object.assign({}, gameData());
    var touched = {};
    Object.keys(gd).forEach(function (id) {
      var entity = gd[id];
      if (!entity) return;
      var changed = false;
      var next = Object.assign({}, entity);
      Object.keys(entity).forEach(function (field) {
        var ret = clearAssetValue(entity[field], urlSet, false);
        if (ret.changed) {
          next[field] = ret.value;
          changed = true;
        }
      });
      if (changed) {
        gd[id] = next;
        touched[id] = true;
      }
    });
    if (!Object.keys(touched).length) return 0;
    gameData.set(gd);
    var tm = tableMap();
    Object.keys(tm).forEach(function (pk) {
      var idsInTable = tm[pk].id || [];
      for (var i = 0; i < idsInTable.length; i++) {
        if (touched[idsInTable[i]]) { emit('data:changed:' + pk); break; }
      }
    });
    emit('data:changed', {});
    return Object.keys(touched).length;
  }

  function walkAssetValue(value, path, visit) {
    if (typeof value === 'string') {
      visit(value, path);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(function (item, i) { walkAssetValue(item, path + '[' + i + ']', visit); });
      return;
    }
    Object.keys(value).forEach(function (key) {
      walkAssetValue(value[key], path ? path + '.' + key : key, visit);
    });
  }

  function clearAssetValue(value, urlSet, inArray) {
    if (typeof value === 'string') {
      if (!urlSet[value]) return { value: value, changed: false, remove: false };
      return inArray ? { value: value, changed: true, remove: true } : { value: '', changed: true, remove: false };
    }
    if (!value || typeof value !== 'object') return { value: value, changed: false, remove: false };
    if (Array.isArray(value)) {
      var arrChanged = false;
      var arr = [];
      value.forEach(function (item) {
        var ret = clearAssetValue(item, urlSet, true);
        if (ret.changed) arrChanged = true;
        if (!ret.remove) arr.push(ret.value);
      });
      return { value: arrChanged ? arr : value, changed: arrChanged, remove: false };
    }
    var changed = false;
    var out = {};
    Object.keys(value).forEach(function (key) {
      var ret = clearAssetValue(value[key], urlSet, false);
      out[key] = ret.value;
      if (ret.changed) changed = true;
    });
    return { value: changed ? out : value, changed: changed, remove: false };
  }

  // setActiveTable(pathKey) — selects the panel for pathKey in the center
  // dock. If no such panel exists this is a no-op (use openTable instead).
  // activeTable signal auto-updates via main.js effect (sync from tree).
  function cleanTablePath(s) {
    return String(s || 'new_table')
      .trim()
      .replace(/\\/g, '/')
      .replace(/\.\./g, '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/[<>:"|?*\x00-\x1f]/g, '_') || 'new_table';
  }

  function uniqueTablePath(base, tm) {
    base = cleanTablePath(base);
    if (!tm[base]) return base;
    var slash = base.lastIndexOf('/');
    var dir = slash >= 0 ? base.slice(0, slash + 1) : '';
    var name = slash >= 0 ? base.slice(slash + 1) : base;
    for (var i = 2; i < 10000; i++) {
      var next = dir + name + '_' + i;
      if (!tm[next]) return next;
    }
    return dir + name + '_' + Date.now();
  }

  function setActiveTable(pathKey) {
    if (!_handle || !pathKey) { activeTable.set(pathKey); return; }
    var hit = _findTablePanel(pathKey);
    if (hit) _handle.activatePanel(hit.panel.id);
  }

  function firstTablePath() {
    var keys = Object.keys(tableMap()).sort();
    return keys[0] || null;
  }

  function selectFirstTable(opts) {
    var pathKey = firstTablePath();
    if (!pathKey) {
      setSelection(null);
      return null;
    }
    if (!opts || opts.open !== false) openTable(pathKey, { transient: false });
    setSelection({ kind: 'table_meta', pathKey: pathKey });
    return pathKey;
  }

  // ---------- Tab management ----------
  function openMainPanel(panel, opts) {
    if (!panel || !_handle) return null;
    opts = opts || {};
    var transient = opts.transient != null ? !!opts.transient : true;
    var hit = _findMainPanel(panel);
    if (hit) {
      _handle.activatePanel(hit.panel.id);
      if (!transient && hit.panel.transient) _handle.promotePanel(hit.panel.id);
      return { panelId: hit.panel.id, created: false };
    }
    var dockId = _centerDockId();
    if (!dockId) return null;
    var ret = _handle.addPanel(dockId, panel, { transient: transient });
    return { panelId: ret && ret.panelId, created: true };
  }

  // openTable(pathKey, { transient }) — opens or activates the table panel.
  // If a panel for this pathKey already exists, it's activated (and optionally
  // promoted). Otherwise a new panel is added to the center dock. Framework-
  // level transient slot auto-evicts an existing transient panel (§ 4.4).
  function openTable(pathKey, opts) {
    if (!pathKey || !_handle) return;
    openMainPanel({
      name: 'table:' + pathKey,
      component: 'gde-table-data',
      title:  _shortName(pathKey),
      props:  { pathKey: pathKey },
    }, opts);
  }
  function openCardStyle(styleKey, opts) {
    if (!styleKey || !_handle) return;
    var def = projectCardStyles()[styleKey] || {};
    openMainPanel({
      name: 'cardstyle:' + styleKey,
      component: 'gde-cardstyle-editor',
      title:  def.name || styleKey,
      icon:   'columns',
      props:  { styleKey: styleKey },
    }, opts);
  }
  function openSettings() {
    if (!_handle) return;
    openMainPanel({
      name: 'settings',
      component: 'settings',
      title: t('panel.settings') || 'Settings',
      icon: 'settings',
      props: {},
    }, { transient: false });
  }
  function closeTab(pathKey) {
    var hit = _findTablePanel(pathKey);
    if (hit) _handle.removePanel(hit.panel.id);
  }
  function pinTab(pathKey) {
    var hit = _findTablePanel(pathKey);
    if (hit) _handle.promotePanel(hit.panel.id);
  }
  function closeAllTabs() {
    _allCenterPanels().forEach(function (p) { _handle.removePanel(p.id); });
  }
  function setSelection(sel) {
    if (sel && sel.kind === 'card_style') {
      activeCardStyle.set(sel.key || null);
    } else if (sel && sel.kind === 'card_component') {
      activeCardStyle.set(sel.styleKey || null);
    }
    selection.set(sel);
    emit('selection:changed', sel);
  }

  // resolveEntityDisplay(id) — single entry point for "how does this
  // entity present itself elsewhere?". Driven entirely by the owning
  // table's struct_def.id contract:
  //   ref_name (default 'name') — text shown for this entity.
  //   ref_icon (default 'icon') — optional image shown before the text.
  // Callers don't care which table owns the id — that stays internal.
  function resolveEntityDisplay(id) {
    if (!id) return null;
    var sid = String(id);
    var tm = tableMap();
    var owner = null;
    var keys = Object.keys(tm);
    for (var i = 0; i < keys.length; i++) {
      if ((tm[keys[i]].id || []).indexOf(sid) >= 0) { owner = keys[i]; break; }
    }
    if (!owner) return null;
    var sd = tm[owner].struct_def || {};
    var idDef = sd.id || {};
    var refName = idDef.ref_name || 'name';
    var refIcon = idDef.ref_icon || 'icon';
    var entity = gameData()[sid] || null;
    var nameVal = refName && sd[refName] && entity ? entity[refName] : null;
    var iconVal = refIcon && sd[refIcon] && entity ? entity[refIcon] : undefined;
    return {
      name:   (nameVal != null && nameVal !== '') ? String(nameVal) : sid,
      icon:   iconVal,
      entity: entity,
    };
  }

  // ---------- Table format tools ----------
  // A "fix plan" is an array of change descriptors. Two kinds:
  //   { id, field, kind: 'set',    value }   // add missing / coerce type
  //   { id, field, kind: 'delete' }          // drop extra field
  // previewFixTable never mutates — it's a pure read that UI uses to
  // render a confirm dialog; applyFixes executes the plan in one batch.
  function _coerceValue(v, baseType) {
    if (baseType === 'int') {
      if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
      var n = Number(v);
      return Number.isFinite(n) ? Math.trunc(n) : 0;
    }
    if (baseType === 'float') {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      var f = Number(v);
      return Number.isFinite(f) ? f : 0;
    }
    if (baseType === 'string') {
      if (v == null) return '';
      if (typeof v === 'string') return v;
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }
    if (baseType === 'bool') {
      return !!v;
    }
    if (baseType === 'array') return Array.isArray(v) ? v : [];
    if (baseType === 'struct' || baseType === 'var') return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
    return v;
  }
  function _baseTypeOk(v, baseType) {
    if (baseType === 'int')    return typeof v === 'number' && Number.isFinite(v) && Math.trunc(v) === v;
    if (baseType === 'float')  return typeof v === 'number' && Number.isFinite(v);
    if (baseType === 'string') return typeof v === 'string';
    if (baseType === 'bool')   return typeof v === 'boolean';
    if (baseType === 'array')  return Array.isArray(v);
    if (baseType === 'struct' || baseType === 'var') return v && typeof v === 'object' && !Array.isArray(v);
    return true;  // id, ref_id, enum_* — treat leniently
  }
  function _defaultFor(fd) {
    if (fd == null) return '';
    if (fd.default !== undefined) {
      try { return JSON.parse(JSON.stringify(fd.default)); } catch (_) { return fd.default; }
    }
    var bt = fd.base_type;
    if (bt === 'int' || bt === 'float') return 0;
    if (bt === 'string') return '';
    if (bt === 'bool') return false;
    if (bt === 'array') return [];
    if (bt === 'struct' || bt === 'var') return {};
    return null;
  }

  function checkTableData(pathKey) {
    var tbl = tableMap()[pathKey];
    if (!tbl) return [];
    var sd = tbl.struct_def || {};
    var ids = tbl.id || [];
    var gd = gameData();
    var issues = [];
    // Unknown type names (not in type_config) — collected once per table.
    var knownTypes = Object.assign({}, builtinTypeConfig(), projectTypeConfig());
    Object.keys(sd).forEach(function (f) {
      if (!knownTypes[f]) issues.push({ kind: 'unknown-type', field: f });
    });
    ids.forEach(function (id) {
      var e = gd[id] || {};
      // Missing / type-mismatched
      Object.keys(sd).forEach(function (f) {
        var fd = resolveFieldDef(sd[f]);
        if (!fd) return;
        if (!(f in e)) issues.push({ kind: 'missing', id: id, field: f });
        else if (!_baseTypeOk(e[f], fd.base_type)) issues.push({ kind: 'mismatch', id: id, field: f, have: typeof e[f], want: fd.base_type });
      });
      // Extra
      Object.keys(e).forEach(function (f) {
        if (!(f in sd)) issues.push({ kind: 'extra', id: id, field: f });
      });
    });
    // Log summary + per-issue
    if (!issues.length) {
      log('info', 'Check: table "' + pathKey + '" OK — no issues');
    } else {
      log('warn', 'Check: table "' + pathKey + '" has ' + issues.length + ' issue(s)');
      issues.slice(0, 50).forEach(function (i) {
        var msg = i.kind === 'unknown-type' ? 'unknown field type "' + i.field + '" (not in type_config)'
                : i.kind === 'missing'      ? 'entity ' + i.id + ': missing "' + i.field + '"'
                : i.kind === 'mismatch'     ? 'entity ' + i.id + ': "' + i.field + '" has ' + i.have + ', want ' + i.want
                : /* extra */                 'entity ' + i.id + ': extra field "' + i.field + '"';
        log('warn', msg);
      });
      if (issues.length > 50) log('warn', '… and ' + (issues.length - 50) + ' more');
    }
    showLogPanel();
    return issues;
  }

  function previewFixTable(pathKey) {
    var tbl = tableMap()[pathKey];
    if (!tbl) return [];
    var sd = tbl.struct_def || {};
    var ids = tbl.id || [];
    var gd = gameData();
    var plan = [];
    ids.forEach(function (id) {
      var e = gd[id] || {};
      Object.keys(sd).forEach(function (f) {
        var fd = resolveFieldDef(sd[f]);
        if (!fd) return;
        if (!(f in e)) plan.push({ id: id, field: f, kind: 'set', value: _defaultFor(fd), reason: 'missing' });
        else if (!_baseTypeOk(e[f], fd.base_type)) {
          plan.push({ id: id, field: f, kind: 'set', value: _coerceValue(e[f], fd.base_type), reason: 'mismatch' });
        }
      });
      Object.keys(e).forEach(function (f) {
        if (!(f in sd)) plan.push({ id: id, field: f, kind: 'delete', reason: 'extra' });
      });
    });
    return plan;
  }

  function applyFixes(pathKey, plan) {
    var tbl = tableMap()[pathKey];
    if (!tbl) return { total: 0, changed: 0 };
    var gd = Object.assign({}, gameData());
    var touched = new Set();
    plan.forEach(function (c) {
      var e = Object.assign({}, gd[c.id] || {});
      if (c.kind === 'set') e[c.field] = c.value;
      else if (c.kind === 'delete') delete e[c.field];
      gd[c.id] = e;
      touched.add(c.id);
    });
    gameData.set(gd);
    emit('data:changed:' + pathKey);
    emit('data:changed', { pathKey: pathKey });
    return { total: (tbl.id || []).length, changed: touched.size };
  }

  // mergeStructDef(pathKey) — normalize a table's struct_def against the
  // project/builtin TypeConfig, promoting "ad-hoc" field definitions into
  // reusable project dictionary entries.
  //
  //   missing in TC            → push resolved identity as a new project TC
  //                              entry; struct_def entry reduces to { type: name }
  //   in TC, format matches    → skip (leave overrides intact)
  //   in TC, format mismatches  → reduce struct_def entry to { type: name } so
  //                              field inherits TC cleanly (the rejected
  //                              overrides disappear)
  //
  // "format" here = base_type + type_render (the type's identity). Non-identity
  // attributes (mem / default / type_agv / card_style / ref_name / ref_icon)
  // migrate into the newly-pushed TC entry on push; they get dropped on clear.
  function previewMergeStructDef(pathKey) {
    var tbl = tableMap()[pathKey];
    if (!tbl) return { pushed: [], cleared: [], skipped: [] };
    var sd = tbl.struct_def || {};
    var tc = Object.assign({}, builtinTypeConfig(), projectTypeConfig());
    var pushed = [], cleared = [], skipped = [];
    Object.keys(sd).forEach(function (f) {
      var r = resolveFieldDef(sd[f]);
      var existing = tc[f];
      if (!existing) {
        if (r) pushed.push(f);
        else   cleared.push(f);   // no identity anywhere — best we can do is strip
      } else {
        var resolvedBase   = (r && r.base_type)   || '';
        var resolvedRender = (r && r.type_render) || '';
        if (resolvedBase === (existing.base_type || '')
         && resolvedRender === (existing.type_render || '')) {
          skipped.push(f);
        } else {
          cleared.push(f);
        }
      }
    });
    return { pushed: pushed, cleared: cleared, skipped: skipped };
  }

  function mergeStructDef(pathKey) {
    var tbl = tableMap()[pathKey];
    if (!tbl) return null;
    var sd = tbl.struct_def || {};
    var tcMerged = Object.assign({}, builtinTypeConfig(), projectTypeConfig());
    var newPTC = Object.assign({}, projectTypeConfig());
    var newSd = Object.assign({}, sd);
    var pushed = [], cleared = [], skipped = [];

    Object.keys(sd).forEach(function (f) {
      var entry = sd[f];
      var resolved = resolveFieldDef(entry);
      var existing = tcMerged[f];

      if (!existing) {
        if (!resolved) { newSd[f] = { type: f }; cleared.push(f); return; }
        var nu = {
          name:        entry.name || f,
          base_type:   resolved.base_type   || 'string',
          type_render: resolved.type_render || 'input_string',
        };
        ['default','mem','type_agv','card_style','ref_name','ref_icon'].forEach(function (k) {
          if (resolved[k] !== undefined) nu[k] = resolved[k];
        });
        newPTC[f] = nu;
        newSd[f]  = { type: f };
        pushed.push(f);
      } else {
        var rb = (resolved && resolved.base_type)   || '';
        var rr = (resolved && resolved.type_render) || '';
        if (rb === (existing.base_type || '') && rr === (existing.type_render || '')) {
          skipped.push(f);
        } else {
          newSd[f] = { type: f };
          cleared.push(f);
        }
      }
    });

    // Commit once each — avoid double-emitting tables:changed if nothing changed.
    if (pushed.length) setProjectTypeConfig(newPTC);
    if (pushed.length || cleared.length) updateStructDef(pathKey, newSd);

    log('info', 'Merge: "' + pathKey + '" — pushed ' + pushed.length
                + ', cleared ' + cleared.length
                + ', skipped ' + skipped.length);
    if (pushed.length)  log('info', 'Pushed to TypeConfig: ' + pushed.join(', '));
    if (cleared.length) log('warn', 'Cleared overrides (format mismatch or no identity): ' + cleared.join(', '));
    showLogPanel();
    return { pushed: pushed, cleared: cleared, skipped: skipped };
  }

  function showLogPanel() {
    if (!_handle || !_handle.setDockCollapsed) return;
    _handle.setDockCollapsed('log', false);
    // Find + activate log panel too so it's in front.
    var t = _handle.tree(), logPanelId = null;
    (function walk(n) {
      if (!n) return;
      if (n.type === 'dock') {
        (n.panels || []).forEach(function (p) { if (p.component === 'log') logPanelId = p.id; });
      } else if (n.children) {
        n.children.forEach(walk);
      }
    })(t);
    if (logPanelId) _handle.activatePanel(logPanelId);
  }

  // ---------- Logging ----------
  // All logging flows through EF.log (framework signal). State.log is a
  // thin convenience wrapper that fixes scope='gde' so the built-in 'log'
  // component can group app messages.
  function log(level, message, meta) {
    return EF.log.push(level || 'info', Object.assign({ scope: 'gde' }, meta || {}), message);
  }
  function clearLogs() { EF.log.clear(); }
  function markDirty() { dirty.set(true); }
  function clearDirty() { dirty.set(false); }
  function setWorkspaceInfo(info) { workspaceInfo.set(info || null); }

  // ---------- Expose ----------
  window.State = {
    // signals
    version: version,
    builtinTypeConfig: builtinTypeConfig,
    projectTypeConfig: projectTypeConfig,
    projectCardStyles: projectCardStyles,
    activeCardStyle:   activeCardStyle,
    gameData: gameData,
    tableMap: tableMap,
    projectName: projectName,
    dirty: dirty,
    workspaceInfo: workspaceInfo,
    activeTable: activeTable,
    selection: selection,
    // Framework-native log signal — gde widgets and framework widgets see
    // the same entries. Exposed for callers that read State.logs().
    logs: EF.log,

    // Layout glue — called once from main.js after createDockLayout.
    _setLayout: _setLayout,
    destroy: destroy,

    // resolvers
    resolveType: resolveType,
    resolveFieldDef: resolveFieldDef,
    resolveEntityDisplay: resolveEntityDisplay,
    findTypeUsages: findTypeUsages,
    findAssetReferences: findAssetReferences,
    genId: genId,
    tableDefinition: tableDefinition,

    // table format tools
    checkTableData: checkTableData,
    previewFixTable: previewFixTable,
    applyFixes: applyFixes,
    previewMergeStructDef: previewMergeStructDef,
    mergeStructDef: mergeStructDef,
    showLogPanel: showLogPanel,
    showCardStyleTree: showCardStyleTree,
    showSearchPanel: showSearchPanel,

    // mutators
    setBuiltinTypeConfig: setBuiltinTypeConfig,
    setProjectTypeConfig: setProjectTypeConfig,
    upsertProjectType: upsertProjectType,
    deleteProjectType: deleteProjectType,
    renameProjectType: renameProjectType,
    setProjectCardStyles: setProjectCardStyles,
    upsertCardStyle:      upsertCardStyle,
    mutateCardStyle:      mutateCardStyle,
    deleteCardStyle:      deleteCardStyle,
    renameCardStyle:      renameCardStyle,
    setTableCardStyle:    setTableCardStyle,
    resolveCardStyleForTable: resolveCardStyleForTable,
    cardStyleRootSize: cardStyleRootSize,
    setTableMap: setTableMap,
    setGameData: setGameData,
    addTable: addTable,
    renameTable: renameTable,
    deleteTable: deleteTable,
    updateStructDef: updateStructDef,
    setTableIds: setTableIds,
    addEntity: addEntity,
    pasteEntities: pasteEntities,
    deleteEntities: deleteEntities,
    updateEntity: updateEntity,
    setEntityField: setEntityField,
    setEntityFieldMany: setEntityFieldMany,
    clearAssetReferences: clearAssetReferences,
    setActiveTable: setActiveTable,
    firstTablePath: firstTablePath,
    selectFirstTable: selectFirstTable,
    openMainPanel: openMainPanel,
    openTable: openTable,
    openCardStyle: openCardStyle,
    openSettings: openSettings,
    closeTab: closeTab,
    pinTab: pinTab,
    closeAllTabs: closeAllTabs,
    setSelection: setSelection,
    markDirty: markDirty,
    clearDirty: clearDirty,
    setWorkspaceInfo: setWorkspaceInfo,
    pasteTableDefinition: pasteTableDefinition,
    log: log,
    clearLogs: clearLogs,
  };
})();
