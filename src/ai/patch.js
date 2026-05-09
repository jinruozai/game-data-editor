/**
 * GDE.ai patch validation, preview, and apply.
 */
(function () {
  'use strict';

  var clone = GDE.ai.clone;
  var patchOps = GDE.ai.patchOps;

  function validatePatch(patch) {
    var errors = [];
    var ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
    var knownTypes = patchKnownTypes(ops);
    if (!patch || patch.type !== 'gde.patch') errors.push(err('type', 'Expected patch.type "gde.patch"'));
    if (!ops.length) errors.push(err('ops', 'Patch has no operations'));
    ops.forEach(function (op, i) { validateOp(op || {}, i, errors, knownTypes); });
    return { ok: errors.length === 0, errors: errors };
  }

  function patchKnownTypes(ops) {
    var out = Object.assign({}, State.builtinTypeConfig(), State.projectTypeConfig());
    (ops || []).forEach(function (op) {
      if (op && op.op === 'upsertType' && op.name && op.config) out[op.name] = op.config;
    });
    return out;
  }

  function validateOp(op, i, errors, knownTypes) {
    var p = 'ops[' + i + ']';
    var tm = State.tableMap();
    var gd = State.gameData();
    var table = op.table && tm[op.table];
    if (needsTable(op.op) && !table) errors.push(err(p + '.table', 'Table not found: ' + op.table, {
      code: 'TABLE_NOT_FOUND',
      expected: 'existing table path',
      received: op.table,
      allowedValues: Object.keys(tm).sort(),
      suggestedFix: 'Call gde.getProjectSummary or use an existing table path.',
    }));
    if (needsEntity(op.op) && (!op.id || !gd[String(op.id)] || !table || (table.id || []).indexOf(String(op.id)) < 0)) {
      errors.push(err(p + '.id', 'Entity not found in table: ' + op.id, {
        code: 'ENTITY_NOT_FOUND',
        expected: 'entity id in table ' + op.table,
        received: op.id,
        allowedValues: table ? (table.id || []).slice() : [],
        suggestedFix: 'Call gde.queryRows to enumerate ids before editing.',
      }));
    }
    if ((op.op === 'setField' || op.op === 'setFieldMany' || op.op === 'setFields' || op.op === 'setFieldsMany') && table) {
      var fields = (op.op === 'setField' || op.op === 'setFieldMany') ? [op.field] : Object.keys(op.fields || {});
      fields.forEach(function (field) {
        if (!field || !(rootField(field) in (table.struct_def || {}))) errors.push(err(p + '.field', 'Field not in struct_def: ' + field, {
          code: 'FIELD_NOT_FOUND',
          expected: 'field declared in table struct_def',
          received: field,
          allowedValues: Object.keys(table.struct_def || {}).sort(),
          suggestedFix: 'Call gde.getTableSchema and use a declared field, or add the field to struct_def in the same patch.',
        }));
        else validateValue((op.op === 'setField' || op.op === 'setFieldMany' ? op.value : op.fields[field]), table.struct_def[rootField(field)], p + '.' + field, errors);
      });
    }
    if ((op.op === 'addEntity' || op.op === 'updateEntity') && table) validateEntityFields(op.entity || op.fields || {}, table, p, errors);
    if (op.op === 'addEntity' && table && op.id && gd[String(op.id)]) errors.push(err(p + '.id', 'Duplicate entity id: ' + op.id));
    if (op.op === 'setFieldMany' && (!op.ids || !op.ids.length)) errors.push(err(p + '.ids', 'Expected ids'));
    if ((op.op === 'setFieldMany' || op.op === 'setFieldsMany' || op.op === 'deleteEntities') && table) {
      (op.ids || []).forEach(function (id) {
        if (!gd[String(id)] || (table.id || []).indexOf(String(id)) < 0) errors.push(err(p + '.ids', 'Entity not found in table: ' + id, {
          code: 'ENTITY_NOT_FOUND',
          expected: 'entity id in table ' + op.table,
          received: id,
          allowedValues: (table.id || []).slice(),
          suggestedFix: 'Call gde.queryRows to enumerate ids before bulk editing.',
        }));
      });
    }
    if (op.op === 'setFieldsMany' && (!op.ids || !op.ids.length || !op.fields || typeof op.fields !== 'object')) errors.push(err(p + '.fields', 'Expected ids and fields'));
    if (op.op === 'deleteEntities' && (!op.ids || !op.ids.length)) errors.push(err(p + '.ids', 'Expected ids'));
    if (op.op === 'reorderEntities' && table) {
      var ids = (op.ids || []).map(String);
      var existing = (table.id || []).slice().sort().join('\n');
      if (ids.slice().sort().join('\n') !== existing) errors.push(err(p + '.ids', 'reorderEntities must include the same ids'));
    }
    if (op.op === 'addTable' && State.tableMap()[op.table]) errors.push(err(p + '.table', 'Table already exists: ' + op.table));
    if (op.op === 'renameTable' && State.tableMap()[op.newTable]) errors.push(err(p + '.newTable', 'Table already exists: ' + op.newTable));
    if (op.op === 'addTable' || op.op === 'updateStructDef') validateStructDef(op.struct_def || {}, p + '.struct_def', errors, knownTypes);
    if (op.op === 'updateStructDef' && (!op.struct_def || typeof op.struct_def !== 'object' || Array.isArray(op.struct_def))) {
      errors.push(err(p + '.struct_def', 'Expected object struct_def'));
    }
    if (op.op === 'upsertType' && (!op.name || !op.config || typeof op.config !== 'object')) {
      errors.push(err(p + '.config', 'Expected type name and config'));
    } else if (op.op === 'upsertType') {
      validateTypeConfig(op.config, p + '.config', errors, knownTypes);
    }
    if (op.op === 'setTableCardStyle' && !State.projectCardStyles()[op.styleKey]) {
      errors.push(err(p + '.styleKey', 'CardStyle not found: ' + op.styleKey));
    }
    if (op.op === 'upsertCardStyle' && (!op.key || !op.cardStyle || typeof op.cardStyle !== 'object')) {
      errors.push(err(p + '.cardStyle', 'Expected key and cardStyle object'));
    }
    if (op.op === 'updateCardNode') validateUpdateCardNode(op, p, errors);
    if (op.op === 'addCardNode') validateAddCardNode(op, p, errors);
    if (op.op === 'deleteCardNode') validateDeleteCardNode(op, p, errors);
    if (!knownOp(op.op)) errors.push(err(p + '.op', 'Unsupported op: ' + op.op, {
      code: 'UNSUPPORTED_OP',
      expected: 'registered GDE patch op',
      received: op.op,
      allowedValues: patchOps.list().map(function (spec) { return spec.op; }).sort(),
      suggestedFix: 'Use one of the registered patch operations.',
    }));
  }

  function validateUpdateCardNode(op, path, errors) {
    var style = requireCardStyle(op.styleKey, path, errors);
    if (!op.nodeId) errors.push(err(path + '.nodeId', 'Expected nodeId'));
    var hit = style && findCardNode(style.root, op.nodeId);
    if (style && !hit) errors.push(err(path + '.nodeId', 'Card node not found: ' + op.nodeId));
    if (op.props != null && (!isObject(op.props))) errors.push(err(path + '.props', 'Expected object props'));
    if (op.bindings != null && (!isObject(op.bindings))) errors.push(err(path + '.bindings', 'Expected object bindings'));
    if (op.layout != null && (!isObject(op.layout))) errors.push(err(path + '.layout', 'Expected object layout'));
    if (op.component != null && typeof op.component !== 'string') errors.push(err(path + '.component', 'Expected component string'));
  }

  function validateAddCardNode(op, path, errors) {
    var style = requireCardStyle(op.styleKey, path, errors);
    if (!op.parentId) errors.push(err(path + '.parentId', 'Expected parentId'));
    if (style && !findCardNode(style.root, op.parentId)) errors.push(err(path + '.parentId', 'Parent card node not found: ' + op.parentId));
    validateCardNodeSpec(op.node, path + '.node', errors);
    if (style && op.node && op.node.id && findCardNode(style.root, op.node.id)) errors.push(err(path + '.node.id', 'Duplicate card node id: ' + op.node.id));
  }

  function validateDeleteCardNode(op, path, errors) {
    var style = requireCardStyle(op.styleKey, path, errors);
    if (!op.nodeId) errors.push(err(path + '.nodeId', 'Expected nodeId'));
    if (op.nodeId === 'root') errors.push(err(path + '.nodeId', 'Cannot delete root card node'));
    if (style && op.nodeId && !findCardNode(style.root, op.nodeId)) errors.push(err(path + '.nodeId', 'Card node not found: ' + op.nodeId));
  }

  function requireCardStyle(styleKey, path, errors) {
    var style = styleKey && State.projectCardStyles()[styleKey];
    if (!style) errors.push(err(path + '.styleKey', 'CardStyle not found: ' + styleKey));
    return style;
  }

  function validateCardNodeSpec(node, path, errors) {
    if (!isObject(node)) {
      errors.push(err(path, 'Expected card node object'));
      return;
    }
    if (!node.id || typeof node.id !== 'string') errors.push(err(path + '.id', 'Expected node id'));
    if (!node.component || typeof node.component !== 'string') errors.push(err(path + '.component', 'Expected component string'));
    if (node.props != null && !isObject(node.props)) errors.push(err(path + '.props', 'Expected object props'));
    if (node.bindings != null && !isObject(node.bindings)) errors.push(err(path + '.bindings', 'Expected object bindings'));
    if (node.layout != null && !isObject(node.layout)) errors.push(err(path + '.layout', 'Expected object layout'));
    if (!Array.isArray(node.children)) errors.push(err(path + '.children', 'Expected array children'));
    (node.children || []).forEach(function (child, i) {
      validateCardNodeSpec(child, path + '.children[' + i + ']', errors);
    });
  }

  function validateStructDef(structDef, path, errors, knownTypes) {
    if (!structDef || typeof structDef !== 'object' || Array.isArray(structDef)) return;
    Object.keys(structDef).forEach(function (field) {
      var def = structDef[field];
      var typeName = GDE.ai.fieldTypeName(def);
      if (!typeName) errors.push(err(path + '.' + field, 'Missing field type'));
      else if (!State.resolveFieldDef(def) && !(knownTypes && knownTypes[typeName])) errors.push(err(path + '.' + field, 'Unknown field type: ' + typeName));
    });
  }

  function validateTypeConfig(config, path, errors, knownTypes) {
    var bases = { int: true, float: true, string: true, bool: true, array: true, struct: true, var: true };
    if (!config.base_type) errors.push(err(path + '.base_type', 'Missing base_type'));
    else if (!bases[config.base_type]) errors.push(err(path + '.base_type', 'Unknown base_type: ' + config.base_type));
    if (!config.type_render) errors.push(err(path + '.type_render', 'Missing type_render'));
    if (config.struct_def) validateStructDef(flattenStructDef(config.struct_def), path + '.struct_def', errors, knownTypes);
  }

  function flattenStructDef(structDef) {
    var keys = Object.keys(structDef || {});
    if (keys.length === 1 && structDef[keys[0]] && typeof structDef[keys[0]] === 'object') return structDef[keys[0]];
    return structDef || {};
  }

  function validateEntityFields(fields, table, path, errors) {
    var sd = table.struct_def || {};
    Object.keys(fields || {}).forEach(function (field) {
      if (!(rootField(field) in sd)) errors.push(err(path + '.' + field, 'Field not in struct_def: ' + field, {
        code: 'FIELD_NOT_FOUND',
        expected: 'field declared in table struct_def',
        received: field,
        allowedValues: Object.keys(sd).sort(),
        suggestedFix: 'Use a declared field, or add it to struct_def in the same patch.',
      }));
      else validateValue(fields[field], sd[rootField(field)], path + '.' + field, errors);
    });
  }

  function validateValue(value, fieldDef, path, errors) {
    var resolved = State.resolveFieldDef(fieldDef);
    var nested = fieldPathTail(path);
    if (nested) {
      validateNestedValue(value, resolved, nested, path, errors);
      return;
    }
    validateResolvedValue(value, resolved, path, errors);
  }

  function validateNestedValue(value, resolved, nested, path, errors) {
    if (!resolved) return;
    var parts = nested.split('.');
    var currentDef = resolved;
    for (var i = 0; i < parts.length; i++) {
      if (!currentDef || !currentDef.struct_def) return;
      var structKey = currentDef.base_type === 'struct' ? Object.keys(currentDef.struct_def)[0] : null;
      var fields = structKey ? currentDef.struct_def[structKey] : currentDef.struct_def;
      var childDef = fields && fields[parts[i]];
      currentDef = State.resolveFieldDef(childDef);
    }
    validateResolvedValue(value, currentDef, path, errors);
  }

  function validateResolvedValue(value, resolved, path, errors) {
    var base = resolved && resolved.base_type;
    if (!resolved) return;
    if (base === 'int' && !(typeof value === 'number' && Number.isFinite(value) && Math.trunc(value) === value)) errors.push(err(path, 'Expected int'));
    else if (base === 'float' && !(typeof value === 'number' && Number.isFinite(value))) errors.push(err(path, 'Expected float'));
    else if (base === 'string' && typeof value !== 'string') errors.push(err(path, 'Expected string'));
    else if (base === 'bool' && typeof value !== 'boolean') errors.push(err(path, 'Expected bool'));
    else if (base === 'array' && !Array.isArray(value)) errors.push(err(path, 'Expected array'));
    else if ((base === 'struct' || base === 'var') && value != null && (typeof value !== 'object' || Array.isArray(value))) errors.push(err(path, 'Expected object'));
    if ((resolved.type_render === 'img' || resolved.type_render === 'snd') && typeof value === 'string' && value.indexOf('asset://') === 0) {
      if (window.ProjectIO && ProjectIO.assets && !ProjectIO.assets.exists(value)) errors.push(err(path, 'Asset not found: ' + value));
    }
    if (resolved.type_render === 'ref_id' && value != null && value !== '' && value !== 0 && !State.gameData()[String(value)]) {
      errors.push(err(path, 'Reference id not found: ' + value));
    }
  }

  function previewPatch(patch) {
    var validation = validatePatch(patch);
    var ops = patch && Array.isArray(patch.ops) ? patch.ops : [];
    return {
      ok: validation.ok,
      title: patch && patch.title || 'GDE patch',
      patch: clone(patch),
      validation: validation,
      changes: ops.map(previewOp),
    };
  }

  function previewOp(op, index) {
    var before = readTarget(op);
    var after = simulateOp(op, before);
    return {
      index: index,
      op: op.op,
      table: op.table || null,
      id: op.id != null ? String(op.id) : null,
      field: op.field || null,
      raw: clone(op),
      before: before,
      after: after,
      summary: summarizeOp(op, before, after),
    };
  }

  function applyPatch(patch) {
    var preview = previewPatch(patch);
    if (!preview.ok) return preview;
    var apply = function () {
      (patch.ops || []).forEach(applyOp);
    };
    if (window.GDE && GDE.history && GDE.history.pause) GDE.history.pause(apply);
    else apply();
    if (window.GDE && GDE.history && GDE.history.captureNow) {
      GDE.history.captureNow(patch.title || 'AI patch', { source: 'gde.ai', ops: (patch.ops || []).length });
    }
    State.log('info', 'Applied AI patch: ' + (patch.title || ((patch.ops || []).length + ' operation(s)')));
    return Object.assign({}, preview, { applied: true });
  }

  function runPatch(patch, opts) {
    opts = opts || {};
    if (opts.apply || opts.dryRun === false) return applyPatch(patch);
    return previewPatch(patch);
  }

  function applyOp(op) {
    if (op.op === 'setField') setFieldOp(String(op.id), op.field, clone(op.value));
    else if (op.op === 'setFieldMany') setFieldManyOp(op);
    else if (op.op === 'setFields') setFieldsOp(String(op.id), op.fields || {});
    else if (op.op === 'setFieldsMany') setFieldsManyOp(op);
    else if (op.op === 'addEntity') addEntityOp(op);
    else if (op.op === 'updateEntity') setFieldsOp(String(op.id), op.entity || op.fields || {});
    else if (op.op === 'deleteEntity') State.deleteEntities(op.table, [String(op.id)]);
    else if (op.op === 'deleteEntities') State.deleteEntities(op.table, (op.ids || []).map(String));
    else if (op.op === 'duplicateEntity') duplicateEntityOp(op);
    else if (op.op === 'reorderEntities') State.setTableIds(op.table, (op.ids || []).map(String));
    else if (op.op === 'addTable') State.addTable(op.table, clone(op.struct_def || {}));
    else if (op.op === 'renameTable') State.renameTable(op.table, op.newTable);
    else if (op.op === 'deleteTable') State.deleteTable(op.table);
    else if (op.op === 'updateStructDef') State.updateStructDef(op.table, clone(op.struct_def || {}));
    else if (op.op === 'upsertType') State.upsertProjectType(op.name, clone(op.config || {}));
    else if (op.op === 'deleteType') State.deleteProjectType(op.name);
    else if (op.op === 'setTableCardStyle') State.setTableCardStyle(op.table, op.styleKey);
    else if (op.op === 'upsertCardStyle') State.upsertCardStyle(op.key, clone(op.cardStyle));
    else if (op.op === 'updateCardNode') updateCardNodeOp(op);
    else if (op.op === 'addCardNode') addCardNodeOp(op);
    else if (op.op === 'deleteCardNode') deleteCardNodeOp(op);
    else if (op.op === 'setAssetReference') setFieldOp(String(op.id), op.field, op.url);
    else if (op.op === 'clearAssetReference') setFieldOp(String(op.id), op.field, '');
  }

  function setFieldOp(id, field, value) {
    if (String(field).indexOf('.') < 0) {
      State.setEntityField(id, field, value);
      return;
    }
    var root = rootField(field);
    var entity = State.gameData()[id] || {};
    var nextRoot = setAt(clone(entity[root] || {}), String(field).split('.').slice(1), value);
    State.setEntityField(id, root, nextRoot);
  }

  function setFieldManyOp(op) {
    if (String(op.field).indexOf('.') < 0) {
      State.setEntityFieldMany((op.ids || []).map(String), op.field, clone(op.value));
      return;
    }
    (op.ids || []).forEach(function (id) {
      setFieldOp(String(id), op.field, clone(op.value));
    });
  }

  function setFieldsOp(id, fields) {
    var flat = {};
    var nested = [];
    Object.keys(fields || {}).forEach(function (field) {
      if (String(field).indexOf('.') >= 0) nested.push(field);
      else flat[field] = clone(fields[field]);
    });
    if (Object.keys(flat).length) State.updateEntity(id, flat);
    nested.forEach(function (field) {
      setFieldOp(id, field, clone(fields[field]));
    });
  }

  function setFieldsManyOp(op) {
    (op.ids || []).forEach(function (id) {
      setFieldsOp(String(id), op.fields || {});
    });
  }

  function addEntityOp(op) {
    var id = State.addEntity(op.table, clone(op.entity || {}));
    if (!op.id || String(op.id) === String(id)) return;
    var gd = Object.assign({}, State.gameData());
    gd[String(op.id)] = gd[id];
    delete gd[id];
    State.setGameData(gd);
    var table = State.tableMap()[op.table];
    State.setTableIds(op.table, (table.id || []).map(function (item) { return item === id ? String(op.id) : item; }));
  }

  function duplicateEntityOp(op) {
    var src = State.gameData()[String(op.id)];
    if (src) State.addEntity(op.table, clone(src));
  }

  function updateCardNodeOp(op) {
    mutateCardStyle(op.styleKey, function (style) {
      var hit = findCardNode(style.root, op.nodeId);
      if (op.component != null) hit.node.component = op.component;
      if (op.props != null) hit.node.props = mergeObject(hit.node.props || {}, op.props);
      if (op.bindings != null) hit.node.bindings = mergeObject(hit.node.bindings || {}, op.bindings);
      if (op.layout != null) hit.node.layout = mergeObject(hit.node.layout || {}, op.layout);
    });
  }

  function addCardNodeOp(op) {
    mutateCardStyle(op.styleKey, function (style) {
      var parent = findCardNode(style.root, op.parentId).node;
      parent.children = (parent.children || []).concat([clone(op.node)]);
    });
  }

  function deleteCardNodeOp(op) {
    mutateCardStyle(op.styleKey, function (style) {
      removeCardNode(style.root, op.nodeId);
    });
  }

  function mutateCardStyle(styleKey, fn) {
    if (State.mutateCardStyle) {
      State.mutateCardStyle(styleKey, fn);
      return;
    }
    var style = clone(State.projectCardStyles()[styleKey]);
    fn(style);
    State.upsertCardStyle(styleKey, style);
  }

  function readTarget(op) {
    var tm = State.tableMap();
    var gd = State.gameData();
    if (op.op === 'setField') return clone(getFieldValue(gd[String(op.id)], op.field));
    if (op.op === 'setFieldMany' || op.op === 'setFieldsMany' || op.op === 'deleteEntities') {
      return (op.ids || []).map(function (id) { return { id: String(id), entity: clone(gd[String(id)] || null) }; });
    }
    if (op.op === 'setFields' || op.op === 'updateEntity' || op.op === 'deleteEntity' || op.op === 'duplicateEntity') return clone(gd[String(op.id)] || null);
    if (op.op === 'updateStructDef' || op.op === 'setTableCardStyle' || op.op === 'deleteTable' || op.op === 'reorderEntities') return clone(tm[op.table] || null);
    if (op.op === 'upsertType' || op.op === 'deleteType') return clone(State.projectTypeConfig()[op.name] || null);
    if (op.op === 'upsertCardStyle') return clone(State.projectCardStyles()[op.key] || null);
    if (op.op === 'updateCardNode' || op.op === 'deleteCardNode') return clone(cardNode(op.styleKey, op.nodeId));
    if (op.op === 'addCardNode') return clone(cardNode(op.styleKey, op.parentId));
    return null;
  }

  function simulateOp(op, before) {
    if (op.op === 'setField') return clone(op.value);
    if (op.op === 'setFieldMany') return (before || []).map(function (row) {
      var entity = Object.assign({}, row.entity || {});
      setEntityFieldValue(entity, op.field, clone(op.value));
      return { id: row.id, entity: entity };
    });
    if (op.op === 'setFields' || op.op === 'updateEntity') return mergeEntityFields(before || {}, op.fields || op.entity || {});
    if (op.op === 'setFieldsMany') return (before || []).map(function (row) {
      var entity = Object.assign({}, row.entity || {});
      Object.keys(op.fields || {}).forEach(function (field) {
        setEntityFieldValue(entity, field, clone(op.fields[field]));
      });
      return { id: row.id, entity: entity };
    });
    if (op.op === 'deleteEntities') return [];
    if (op.op === 'deleteEntity' || op.op === 'deleteTable' || op.op === 'deleteType') return null;
    if (op.op === 'updateStructDef') return Object.assign({}, before || {}, { struct_def: clone(op.struct_def || {}) });
    if (op.op === 'setTableCardStyle') return Object.assign({}, before || {}, { card_style: op.styleKey });
    if (op.op === 'reorderEntities') return Object.assign({}, before || {}, { id: (op.ids || []).map(String) });
    if (op.op === 'upsertType') return clone(op.config || {});
    if (op.op === 'upsertCardStyle') return clone(op.cardStyle || {});
    if (op.op === 'updateCardNode') return previewUpdatedCardNode(before, op);
    if (op.op === 'addCardNode') {
      var parent = clone(before || {});
      parent.children = (parent.children || []).concat([clone(op.node)]);
      return parent;
    }
    if (op.op === 'deleteCardNode') return null;
    if (op.op === 'setAssetReference') return op.url || '';
    if (op.op === 'clearAssetReference') return '';
    return clone(op);
  }

  function summarizeOp(op) {
    if (op.op === 'setField') return op.table + '/' + op.id + '.' + op.field + ' = ' + JSON.stringify(op.value);
    if (op.op === 'setFieldMany') return op.table + ' set ' + op.field + ' on ' + (op.ids || []).length + ' entities';
    if (op.op === 'setFields') return op.table + '/' + op.id + ' set ' + Object.keys(op.fields || {}).join(', ');
    if (op.op === 'setFieldsMany') return op.table + ' set ' + Object.keys(op.fields || {}).join(', ') + ' on ' + (op.ids || []).length + ' entities';
    if (op.op === 'deleteEntities') return op.table + ' delete ' + (op.ids || []).length + ' entities';
    if (op.op === 'updateCardNode') return op.styleKey + '/' + op.nodeId + ' update card node';
    if (op.op === 'addCardNode') return op.styleKey + '/' + op.parentId + ' add card node ' + (op.node && op.node.id || '');
    if (op.op === 'deleteCardNode') return op.styleKey + '/' + op.nodeId + ' delete card node';
    return op.op;
  }

  function needsTable(op) {
    return patchOps.requiresTable(op);
  }

  function needsEntity(op) {
    return patchOps.requiresEntity(op);
  }

  function knownOp(op) {
    return patchOps.has(op);
  }

  function rootField(field) {
    return String(field || '').split('.')[0];
  }

  function fieldPathTail(path) {
    var m = String(path || '').match(/\.([^.[\]]+(?:\.[^.[\]]+)*)$/);
    return m && m[1].indexOf('.') >= 0 ? m[1].split('.').slice(1).join('.') : '';
  }

  function getFieldValue(entity, field) {
    if (!entity) return undefined;
    var parts = String(field || '').split('.');
    var value = entity;
    for (var i = 0; i < parts.length; i++) {
      value = value == null ? undefined : value[parts[i]];
    }
    return value;
  }

  function setEntityFieldValue(entity, field, value) {
    var parts = String(field || '').split('.');
    if (parts.length === 1) {
      entity[field] = value;
      return entity;
    }
    entity[parts[0]] = setAt(clone(entity[parts[0]] || {}), parts.slice(1), value);
    return entity;
  }

  function mergeEntityFields(entity, fields) {
    var out = clone(entity || {});
    Object.keys(fields || {}).forEach(function (field) {
      setEntityFieldValue(out, field, clone(fields[field]));
    });
    return out;
  }

  function previewUpdatedCardNode(before, op) {
    var out = clone(before || {});
    if (op.component != null) out.component = op.component;
    if (op.props != null) out.props = mergeObject(out.props || {}, op.props);
    if (op.bindings != null) out.bindings = mergeObject(out.bindings || {}, op.bindings);
    if (op.layout != null) out.layout = mergeObject(out.layout || {}, op.layout);
    return out;
  }

  function cardNode(styleKey, nodeId) {
    var style = State.projectCardStyles()[styleKey];
    var hit = style && findCardNode(style.root, nodeId);
    return hit && hit.node || null;
  }

  function findCardNode(node, nodeId, parent) {
    if (!node) return null;
    if (String(node.id) === String(nodeId)) return { node: node, parent: parent || null };
    var children = node.children || [];
    for (var i = 0; i < children.length; i++) {
      var hit = findCardNode(children[i], nodeId, node);
      if (hit) return hit;
    }
    return null;
  }

  function removeCardNode(root, nodeId) {
    var children = root.children || [];
    for (var i = 0; i < children.length; i++) {
      if (String(children[i].id) === String(nodeId)) {
        children.splice(i, 1);
        return true;
      }
      if (removeCardNode(children[i], nodeId)) return true;
    }
    return false;
  }

  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function mergeObject(base, patch) {
    var out = clone(base || {});
    Object.keys(patch || {}).forEach(function (key) {
      out[key] = isObject(out[key]) && isObject(patch[key]) ? mergeObject(out[key], patch[key]) : clone(patch[key]);
    });
    return out;
  }

  function setAt(target, parts, value) {
    var cursor = target;
    for (var i = 0; i < parts.length - 1; i++) {
      var key = parts[i];
      cursor[key] = cursor[key] && typeof cursor[key] === 'object' ? clone(cursor[key]) : {};
      cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
    return target;
  }

  function err(path, message, extra) {
    var code = extra && extra.code || inferErrorCode(message);
    if (GDE.ai.error) return GDE.ai.error(code, path, message, extra);
    return Object.assign({ code: code, path: path, message: message }, extra || {});
  }

  function inferErrorCode(message) {
    if (/Table not found/.test(message)) return 'TABLE_NOT_FOUND';
    if (/Entity not found/.test(message)) return 'ENTITY_NOT_FOUND';
    if (/Field not in struct_def/.test(message)) return 'FIELD_NOT_FOUND';
    if (/Reference id not found/.test(message)) return 'REFERENCE_NOT_FOUND';
    if (/Asset not found/.test(message)) return 'ASSET_NOT_FOUND';
    if (/Unknown field type/.test(message)) return 'UNKNOWN_FIELD_TYPE';
    if (/Unsupported op/.test(message)) return 'UNSUPPORTED_OP';
    if (/Expected/.test(message)) return 'INVALID_TYPE';
    return 'VALIDATION_ERROR';
  }

  GDE.ai.validatePatch = validatePatch;
  GDE.ai.previewPatch = previewPatch;
  GDE.ai.applyPatch = applyPatch;
  GDE.ai.patch = runPatch;
})();
