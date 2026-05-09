/**
 * GDE.ai resource resolvers and context providers.
 */
(function () {
  'use strict';

  var clone = GDE.ai.clone;

  function tablePayload(pathKey, opts) {
    var table = State.tableMap()[pathKey];
    if (!table) return null;
    opts = opts || {};
    var gd = State.gameData();
    var ids = (table.id || []).slice();
    var page = pageIds(ids, opts);
    var selected = GDE.ai.selectedEntityRefs(State.selection()).filter(function (ref) {
      return ref.table === pathKey;
    }).map(function (ref) { return ref.id; });
    return {
      pathKey: pathKey,
      struct_def: clone(table.struct_def || {}),
      card_style: table.card_style || 'default',
      ids: ids,
      page: page.meta,
      fields: normalizeFields(opts.fields || opts.projection),
      rows: page.ids.map(function (id) { return rowPayload(pathKey, id, opts.fields || opts.projection, gd); }),
      sampleEntities: ids.slice(0, 20).map(function (id) { return { id: id, entity: clone(gd[id] || {}) }; }),
      selectedEntities: selected.map(function (id) { return { id: id, entity: clone(gd[id] || {}) }; }),
    };
  }

  function entityPayload(pathKey, id) {
    var table = State.tableMap()[pathKey];
    var entity = State.gameData()[String(id)];
    if (!table || !entity) return null;
    return {
      id: String(id),
      table: pathKey,
      struct_def: clone(table.struct_def || {}),
      entity: clone(entity),
    };
  }

  function fieldPayload(pathKey, id, field) {
    var table = State.tableMap()[pathKey];
    var entity = State.gameData()[String(id)];
    if (!table || !entity) return null;
    var root = String(field || '').split('.')[0];
    var fieldDef = (table.struct_def || {})[root];
    var resolved = fieldDef ? State.resolveFieldDef(fieldDef) : null;
    return {
      table: pathKey,
      id: String(id),
      field: field,
      value: clone(getAt(entity, String(field || '').split('.'))),
      fieldDef: clone(fieldDef || null),
      resolvedType: clone(resolved || null),
      typeConfigEntry: clone(resolved || null),
    };
  }

  function queryRows(args) {
    args = args || {};
    var pathKey = args.table || args.pathKey;
    var table = State.tableMap()[pathKey];
    if (!table) return null;
    var ids = args.ids && args.ids.length ? args.ids.map(String) : (table.id || []).slice();
    var filtered = filterIds(pathKey, ids, args);
    var page = pageIds(filtered, args);
    var gd = State.gameData();
    return {
      table: pathKey,
      total: filtered.length,
      page: page.meta,
      fields: normalizeFields(args.fields || args.projection),
      rows: page.ids.map(function (id) { return rowPayload(pathKey, id, args.fields || args.projection, gd); }),
    };
  }

  function assetPayload(path) {
    var url = path.indexOf('asset://') === 0 ? path : ProjectIO.assets.makeUrl(path);
    var info = ProjectIO.assets.get(url);
    return info ? Object.assign({}, info, { refs: State.findAssetReferences([url]) }) : { url: url, missing: true };
  }

  function cardStylePayload(styleKey) {
    var cs = State.projectCardStyles()[styleKey];
    if (!cs) return null;
    var size = State.cardStyleRootSize(styleKey);
    return {
      styleKey: styleKey,
      name: cs.name || styleKey,
      root: clone(cs.root || null),
      selectedNodes: selectedCardNodes(styleKey),
      bindings: collectBindings(cs.root),
      size: size,
    };
  }

  function typePayload(name) {
    var builtin = State.builtinTypeConfig()[name] || null;
    var project = State.projectTypeConfig()[name] || null;
    return {
      name: name,
      builtin: clone(builtin),
      project: clone(project),
      resolved: clone(project || builtin),
      usages: State.findTypeUsages ? clone(State.findTypeUsages(name)) : [],
    };
  }

  function cardStyleNodePayload(styleKey, nodeId) {
    var cs = State.projectCardStyles()[styleKey];
    if (!cs || !cs.root) return null;
    var found = findNode(cs.root, nodeId, null);
    if (!found) return null;
    return {
      styleKey: styleKey,
      nodeId: String(nodeId),
      node: clone(found.node),
      parentId: found.parent ? found.parent.id : null,
      selected: selectedCardNodes(styleKey).indexOf(String(nodeId)) >= 0,
    };
  }

  function selectedCardNodes(styleKey) {
    var sel = State.selection();
    if (!sel || sel.kind !== 'card_component' || sel.styleKey !== styleKey) return [];
    return (sel.nodeIds || []).slice();
  }

  function collectBindings(node, out) {
    out = out || [];
    if (!node) return out;
    Object.keys(node.bindings || {}).forEach(function (key) {
      out.push({ nodeId: node.id, prop: key, binding: clone(node.bindings[key]) });
    });
    (node.children || []).forEach(function (child) { collectBindings(child, out); });
    return out;
  }

  function resolve(ref) {
    var uri = String(ref && ref.uri || '');
    if (uri === 'gde://project') return GDE.ai.projectSummary();
    if (uri === 'gde://type-config') {
      return {
        builtin: clone(State.builtinTypeConfig()),
        project: clone(State.projectTypeConfig()),
        mergedKeys: Object.keys(Object.assign({}, State.builtinTypeConfig(), State.projectTypeConfig())).sort(),
      };
    }
    var m = uri.match(/^gde:\/\/table\/(.+)$/);
    if (m) return tablePayload(decodeURIComponent(m[1]));
    m = uri.match(/^gde:\/\/entity\/(.+)\/([^/]+)$/);
    if (m) return entityPayload(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    m = uri.match(/^gde:\/\/field\/(.+)\/([^/]+)\/([^/]+)$/);
    if (m) return fieldPayload(decodeURIComponent(m[1]), decodeURIComponent(m[2]), decodeURIComponent(m[3]));
    m = uri.match(/^gde:\/\/asset\/(.+)$/);
    if (m) return assetPayload(decodeURIComponent(m[1]));
    m = uri.match(/^gde:\/\/card-style\/(.+)\/node\/([^/]+)$/);
    if (m) return cardStyleNodePayload(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
    m = uri.match(/^gde:\/\/card-style\/(.+)$/);
    if (m) return cardStylePayload(decodeURIComponent(m[1]));
    m = uri.match(/^gde:\/\/type\/(.+)$/);
    if (m) return typePayload(decodeURIComponent(m[1]));
    return { uri: uri, missing: true };
  }

  function summarize(ref) {
    return { title: ref.title || ref.uri, kind: ref.kind || 'gde.resource', uri: ref.uri };
  }

  function registerResourceResolvers() {
    EF.ai.registerResourceResolver('gde', {
      canResolve: function (ref) { return !!(ref && /^gde:\/\//.test(ref.uri || '')); },
      resolve: resolve,
      summarize: summarize,
    });
  }

  function registerContextProviders() {
    EF.ai.registerContextProvider('gde.project', {
      capture: function () {
        return {
          resolver: 'gde',
          uri: 'gde://project',
          kind: 'gde.project',
          title: 'Project summary',
          summary: JSON.stringify(GDE.ai.projectSummary()),
        };
      },
    });
    EF.ai.registerContextProvider('gde.selection', {
      capture: function () { return GDE.ai.selectionContext(); },
    });
    EF.ai.registerContextProvider('gde.active-table', {
      capture: function () {
        var pathKey = State.activeTable.peek();
        return pathKey ? GDE.ai.tableTarget(pathKey) : null;
      },
    });
  }

  GDE.ai.resolveResource = resolve;
  GDE.ai.tablePayload = tablePayload;
  GDE.ai.entityPayload = entityPayload;
  GDE.ai.fieldPayload = fieldPayload;
  GDE.ai.queryRows = queryRows;
  GDE.ai.cardStylePayload = cardStylePayload;
  GDE.ai.typePayload = typePayload;
  GDE.ai.cardStyleNodePayload = cardStyleNodePayload;
  GDE.ai.registerResourceResolvers = registerResourceResolvers;
  GDE.ai.registerContextProviders = registerContextProviders;

  function rowPayload(pathKey, id, fields, gd) {
    var entity = gd[String(id)] || {};
    var projection = projectEntity(entity, fields);
    return { id: String(id), entity: projection };
  }

  function projectEntity(entity, fields) {
    var list = normalizeFields(fields);
    if (!list.length) return clone(entity || {});
    var out = {};
    list.forEach(function (field) {
      out[field] = clone(getAt(entity, String(field).split('.')));
    });
    return out;
  }

  function filterIds(pathKey, ids, args) {
    if (!args.field && !args.query) return ids;
    var gd = State.gameData();
    var q = args.query == null ? null : String(args.query).toLowerCase();
    return ids.filter(function (id) {
      var entity = gd[id] || {};
      if (args.field) {
        var value = getAt(entity, String(args.field).split('.'));
        if (args.value !== undefined) return String(value) === String(args.value);
        if (q != null) return String(value == null ? '' : value).toLowerCase().indexOf(q) >= 0;
        return value !== undefined;
      }
      if (String(pathKey).toLowerCase().indexOf(q) >= 0 || String(id).toLowerCase().indexOf(q) >= 0) return true;
      return Object.keys(entity).some(function (field) {
        return String(entity[field] == null ? '' : entity[field]).toLowerCase().indexOf(q) >= 0;
      });
    });
  }

  function pageIds(ids, opts) {
    opts = opts || {};
    var offset = Math.max(0, Number(opts.offset || opts.cursor || 0));
    var limit = Math.max(1, Math.min(1000, Number(opts.limit || 50)));
    var page = ids.slice(offset, offset + limit);
    return {
      ids: page,
      meta: {
        offset: offset,
        limit: limit,
        total: ids.length,
        nextOffset: offset + page.length < ids.length ? offset + page.length : null,
      },
    };
  }

  function normalizeFields(fields) {
    if (!fields) return [];
    if (typeof fields === 'string') return fields.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return (fields || []).map(String).filter(Boolean);
  }

  function getAt(obj, parts) {
    var value = obj;
    for (var i = 0; i < parts.length; i++) {
      value = value == null ? undefined : value[parts[i]];
    }
    return value;
  }

  function findNode(node, nodeId, parent) {
    if (!node) return null;
    if (String(node.id) === String(nodeId)) return { node: node, parent: parent };
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) {
      var hit = findNode(children[i], nodeId, node);
      if (hit) return hit;
    }
    return null;
  }
})();
