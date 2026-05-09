/**
 * ProjectIO.codec — pure conversion between State snapshots and the on-disk
 * GameDataEditor project format.
 *
 * Disk:
 *   gamedata.json                 optional project/type_config/card_styles
 *   <table path>.json             { _table:{struct_def,card_style}, <id>:entity }
 */
(function () {
  'use strict';

  function deepClone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function tablePathToFile(pathKey) {
    return String(pathKey).replace(/^\/+|\/+$/g, '') + '.json';
  }

  function fileToTablePath(filePath) {
    return String(filePath).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.json$/i, '');
  }

  function exportSnapshot() {
    var tm = State.tableMap();
    var gd = State.gameData();
    var tables = {};
    Object.keys(tm).sort().forEach(function (pathKey) {
      var table = tm[pathKey] || {};
      var ids = (table.id || []).slice();
      var entities = {};
      ids.forEach(function (id) {
        entities[id] = deepClone(gd[id] || {});
      });
      tables[pathKey] = {
        struct_def: deepClone(table.struct_def || {}),
        card_style: table.card_style || 'default',
        id: ids,
        entities: entities,
      };
    });
    return {
      project: {
        name: State.projectName() || 'Untitled',
        version: State.version(),
      },
      type_config: deepClone(State.projectTypeConfig() || {}),
      card_styles: deepClone(State.projectCardStyles() || {}),
      tables: tables,
    };
  }

  function applySnapshot(snapshot, sourceName, options) {
    options = options || {};
    var snap = normalizeSnapshot(snapshot);
    var merged = mergeStructDefsIntoTypeConfig(snap);
    if (merged.pushed.length) {
      log('info', 'Import merged struct_def fields into TypeConfig: ' + merged.pushed.join(', '));
    }
    validateStructTypes(snap.type_config, snap.tables);
    State.setProjectTypeConfig(snap.type_config);
    State.setProjectCardStyles(snap.card_styles);
    State.setGameData(flattenGameData(snap.tables));
    State.setTableMap(buildTableMap(snap.tables));
    if (!options.preserveProjectMeta) {
      State.projectName.set((snap.project && snap.project.name) || sourceName || 'Untitled');
      State.version.set((snap.project && Number(snap.project.version)) || 0);
    }
    if (!options.preserveTabs) State.closeAllTabs();
    if (!options.preserveSelection) State.selectFirstTable();
    Normalize.normalizeAll();
  }

  function normalizeSnapshot(snapshot) {
    var s = snapshot || {};
    var cardStyles = deepClone(s.card_styles || {});
    if (!cardStyles.default) cardStyles.default = defaultCardStyle();
    return {
      project: s.project || {},
      type_config: s.type_config || {},
      card_styles: cardStyles,
      tables: s.tables || {},
    };
  }

  function mergeStructDefsIntoTypeConfig(snap) {
    var projectTC = Object.assign({}, snap.type_config || {});
    var known = Object.assign({}, EF.ui.getTypeConfig ? EF.ui.getTypeConfig() : {}, projectTC);
    var pushed = [];

    Object.keys(snap.tables || {}).sort().forEach(function (pathKey) {
      var table = snap.tables[pathKey] || {};
      var sd = Object.assign({}, table.struct_def || {});
      var changed = false;

        Object.keys(sd).forEach(function (field) {
        if (projectTC[field]) return;
          var resolved = resolveFieldDefWithConfig(sd[field], known);
          if (!resolved) return;

        var entry = typeof sd[field] === 'string' ? { type: sd[field] } : (sd[field] || {});
        var promoted = {
          name:        entry.name || field,
          base_type:   resolved.base_type || 'string',
          type_render: resolved.type_render || 'input_string',
        };
        ['default','mem','type_agv','card_style','ref_name','ref_icon','support_render','struct_def'].forEach(function (k) {
          if (resolved[k] !== undefined) promoted[k] = deepClone(resolved[k]);
        });

          projectTC[field] = promoted;
          known[field] = promoted;
        sd[field] = { type: field };
        changed = true;
        pushed.push(pathKey + '.' + field);
      });

      if (changed) table.struct_def = sd;
    });

    snap.type_config = projectTC;
    return { pushed: pushed };
  }

  function resolveFieldDefWithConfig(fieldDef, typeConfig) {
    var typeName = fieldTypeName(fieldDef);
    if (!typeName || !typeConfig[typeName]) return null;
    var base = typeConfig[typeName];
    if (typeof fieldDef === 'string') return deepClone(base);
    return Object.assign({}, deepClone(base), deepClone(fieldDef || {}));
  }

  function defaultCardStyle() {
    return {
      name: 'Default',
      root: {
        id: 'root',
        component: 'absolute',
        props: { width: 120, height: 140, background: 'var(--ef-bg-0)', borderRadius: 10 },
        bindings: {},
        children: [
          {
            id: 'icon',
            component: 'image',
            props: {
              src: '',
              alt: '',
              objectFit: 'contain',
              padding: 10,
              borderWidth: 2,
              background: '#2a2a2a',
              borderRadius: 8,
              borderColor: '#9c9c9c',
            },
            bindings: { src: { source: 'field', field: 'icon' } },
            children: [],
            layout: {
              aMin: { x: 0, y: 0 },
              aMax: { x: 1, y: 1 },
              oMin: { x: 8, y: 8 },
              oMax: { x: -8, y: -32 },
            },
          },
          {
            id: 'name',
            component: 'text',
            props: {
              value: '',
              textAlign: 'center',
              verticalAlign: 'middle',
              size: 'md',
              borderWidth: 0,
              background: '#cfcfcf',
              color: '#000000',
              borderRadius: 3,
            },
            bindings: { value: { source: 'field', field: 'name' } },
            children: [],
            layout: {
              aMin: { x: 0, y: 1 },
              aMax: { x: 1, y: 1 },
              oMin: { x: 8, y: -30 },
              oMax: { x: -8, y: -6 },
            },
          },
        ],
      },
    };
  }

  function flattenGameData(tables) {
    var gd = {};
    Object.keys(tables || {}).forEach(function (pathKey) {
      var table = tables[pathKey] || {};
      var entities = table.entities || {};
      (table.id || Object.keys(entities)).forEach(function (id) {
        if (gd[id]) {
          log('error', 'Duplicate entity id "' + id + '" in table ' + pathKey);
          return;
        }
        gd[id] = deepClone(entities[id] || {});
      });
    });
    return gd;
  }

  function buildTableMap(tables) {
    var tm = {};
    Object.keys(tables || {}).forEach(function (pathKey) {
      var table = tables[pathKey] || {};
      var entities = table.entities || {};
      tm[pathKey] = {
        struct_def: deepClone(table.struct_def || {}),
        card_style: table.card_style || 'default',
        id: (table.id || Object.keys(entities)).slice(),
      };
    });
    return tm;
  }

  function snapshotToFiles(snapshot) {
    var snap = normalizeSnapshot(snapshot);
    var files = {};
    files['gamedata.json'] = stableStringify({
      project: snap.project || {},
      type_config: snap.type_config || {},
      card_styles: snap.card_styles || {},
    });
    Object.keys(snap.tables || {}).sort().forEach(function (pathKey) {
      var table = snap.tables[pathKey] || {};
      var out = {
        _table: {
          struct_def: table.struct_def || {},
          card_style: table.card_style || 'default',
        },
      };
      (table.id || Object.keys(table.entities || {})).forEach(function (id) {
        out[id] = (table.entities || {})[id] || {};
      });
      files[tablePathToFile(pathKey)] = stableStringify(out);
    });
    return files;
  }

  function filesToSnapshot(files) {
    var meta = parseJson('gamedata.json', files['gamedata.json']) || {};
    var tables = {};
    Object.keys(files).sort().forEach(function (path) {
      if (path === 'gamedata.json' || !/\.json$/i.test(path)) return;
      var raw = parseJson(path, files[path]);
      if (!raw) return;
      if (!raw._table) {
        log('error', 'JSON table missing _table: ' + path);
        return;
      }
      var tableDef = raw._table || {};
      var entities = {};
      var ids = [];
      Object.keys(raw).forEach(function (id) {
        if (id === '_table') return;
        ids.push(id);
        entities[id] = raw[id];
      });
      tables[fileToTablePath(path)] = {
        struct_def: tableDef.struct_def || {},
        card_style: tableDef.card_style || 'default',
        id: ids,
        entities: entities,
      };
    });
    return {
      project: meta.project || {},
      type_config: meta.type_config || {},
      card_styles: meta.card_styles || {},
      tables: tables,
    };
  }

  function parseJson(path, text) {
    if (text == null) return null;
    try { return JSON.parse(text); }
    catch (e) {
      log('error', 'Invalid JSON in ' + path + ': ' + e.message);
      return null;
    }
  }

  function validateStructTypes(projectTypeConfig, tables) {
    var known = Object.assign({}, EF.ui.getTypeConfig ? EF.ui.getTypeConfig() : {}, projectTypeConfig || {});
    Object.keys(tables || {}).forEach(function (pathKey) {
      var sd = (tables[pathKey] && tables[pathKey].struct_def) || {};
      Object.keys(sd).forEach(function (field) {
        var typeName = fieldTypeName(sd[field]);
        if (typeName && !known[typeName]) {
          log('error', 'Import type missing: ' + pathKey + '.' + field + ' uses "' + typeName + '"');
        }
      });
    });
  }

  function fieldTypeName(def) {
    if (typeof def === 'string') return def;
    if (def && typeof def === 'object' && typeof def.type === 'string') return def.type;
    return '';
  }

  function log(level, message) {
    if (window.State && State.log) State.log(level, message);
  }

  function stableStringify(obj) {
    return JSON.stringify(obj, null, 2) + '\n';
  }

  window.ProjectIO = window.ProjectIO || {};
  window.ProjectIO.codec = {
    exportSnapshot: exportSnapshot,
    applySnapshot: applySnapshot,
    snapshotToFiles: snapshotToFiles,
    filesToSnapshot: filesToSnapshot,
    tablePathToFile: tablePathToFile,
    fileToTablePath: fileToTablePath,
    defaultCardStyle: defaultCardStyle,
  };
})();
