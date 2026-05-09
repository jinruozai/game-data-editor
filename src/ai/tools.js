/**
 * GDE.ai tool registrations.
 */
(function () {
  'use strict';

  var clone = GDE.ai.clone;

  function registerTools() {
    tool('gde.getProjectSummary', 'Get project summary', 'Read project counts and high-level metadata.', {}, function () {
      return GDE.ai.projectSummary();
    });
    tool('gde.getTypeConfig', 'Get TypeConfig', 'Read builtin and project TypeConfig.', {}, function () {
      return GDE.ai.resolveResource({ uri: 'gde://type-config' });
    });
    tool('gde.getType', 'Get type', 'Read one builtin/project TypeConfig entry and its usages.', { name: 'string' }, function (args) {
      return GDE.ai.typePayload(args.name || args.type || args.key);
    });
    tool('gde.getTableSchema', 'Get table schema', 'Read a table struct_def and card style key.', { pathKey: 'string' }, function (args) {
      var t = State.tableMap()[args.pathKey];
      return t ? { pathKey: args.pathKey, struct_def: clone(t.struct_def || {}), card_style: t.card_style || 'default', ids: (t.id || []).slice() } : null;
    });
    tool('gde.getTableEntities', 'Get table entities', 'Read paged/projected entities from a table.', {
      pathKey: 'string', table: 'string', ids: 'array', fields: 'array', offset: 'number', limit: 'number', field: 'string', value: {}, query: 'string'
    }, function (args) {
      return GDE.ai.queryRows(args);
    });
    tool('gde.queryRows', 'Query table rows', 'Read rows by table/id/field with pagination, projection, and simple filters.', {
      table: 'string', ids: 'array', fields: 'array', offset: 'number', limit: 'number', field: 'string', value: {}, query: 'string'
    }, function (args) {
      return GDE.ai.queryRows(args);
    });
    tool('gde.getEntity', 'Get entity', 'Read one entity with its table schema.', { table: 'string', id: 'string' }, function (args) {
      return GDE.ai.entityPayload(args.table, args.id);
    });
    tool('gde.getField', 'Get field', 'Read one field value with FieldDef and resolved TypeConfig.', { table: 'string', id: 'string', field: 'string' }, function (args) {
      return GDE.ai.fieldPayload(args.table, args.id, args.field);
    });
    tool('gde.validatePatch', 'Validate GDE patch', 'Validate a patch without applying it.', patchToolSchema(), function (args) {
      return GDE.ai.validatePatch(args.patch || args);
    });
    tool('gde.findReferences', 'Find references', 'Find ref_id and raw id references to an entity.', { id: 'string' }, function (args) {
      return findReferences(args.id);
    });
    tool('gde.findAssetReferences', 'Find asset references', 'Find project data references to asset URLs.', { urls: 'array' }, function (args) {
      return State.findAssetReferences(args.urls || (args.url ? [args.url] : []));
    });
    tool('gde.getAsset', 'Get asset', 'Read one asset metadata and references.', { url: 'string' }, function (args) {
      return GDE.ai.resolveResource({ uri: 'gde://asset/' + String(args.url || args.path || '').replace(/^asset:\/\//, '') });
    });
    tool('gde.searchData', 'Search data', 'Search tables, ids, field names, and values.', { query: 'string', limit: 'number' }, function (args) {
      return searchData(args.query, args.limit || 50);
    });
    tool('gde.getCardStyle', 'Get CardStyle', 'Read a project CardStyle tree and bindings.', { styleKey: 'string' }, function (args) {
      return GDE.ai.cardStylePayload(args.styleKey || 'default');
    });
    tool('gde.getCardStyleNode', 'Get CardStyle node', 'Read one CardStyle node with parent metadata.', { styleKey: 'string', nodeId: 'string' }, function (args) {
      return GDE.ai.cardStyleNodePayload(args.styleKey || args.cardStyle || 'default', args.nodeId || args.id);
    });
    tool('gde.summarizeTable', 'Summarize table', 'Return compact table statistics for balancing and audits.', { table: 'string' }, function (args) {
      return summarizeTable(args.table || args.pathKey);
    });
    tool('gde.findInvalidRefs', 'Find invalid refs', 'Find ref_id fields that point to missing entities.', { table: 'string' }, function (args) {
      return findInvalidRefs(args.table || args.pathKey || null);
    });
    tool('gde.findUnknownStructFields', 'Find unknown struct fields', 'Find struct_def fields whose types are not known in TypeConfig.', { table: 'string' }, function (args) {
      return findUnknownStructFields(args.table || args.pathKey || null);
    });
    tool('gde.planTypeConfigMerge', 'Plan TypeConfig merge', 'Return upsertType patch ops for struct_def fields that are missing from TypeConfig.', { tables: 'array' }, function (args) {
      return planTypeConfigMerge(args.tables || args.table || args.pathKey || null);
    });
    tool('gde.replaceAssetReferences', 'Replace asset references', 'Return a patch that replaces asset URLs across table fields.', { from: 'string', to: 'string' }, function (args) {
      return replaceAssetReferences(args.from, args.to);
    });
    tool('gde.planBatchSetFields', 'Plan batch field update', 'Create a preview for setting one or more fields on enumerated or queried rows.', batchSetFieldsSchema(), function (args) {
      return planBatchSetFields(args || {});
    });
    tool('gde.planBatchCreateEntities', 'Plan batch entity creation', 'Create a preview for adding multiple entities to a table.', batchCreateEntitiesSchema(), function (args) {
      return planBatchCreateEntities(args || {});
    });
    tool('gde.planBatchDeleteEntities', 'Plan batch entity deletion', 'Create a preview for deleting enumerated or queried rows.', batchDeleteEntitiesSchema(), function (args) {
      return planBatchDeleteEntities(args || {});
    });
    tool('gde.planBalanceNumericField', 'Plan numeric field balance', 'Create a preview for multiplying, adding, clamping, and rounding a numeric field.', balanceNumericFieldSchema(), function (args) {
      return planBalanceNumericField(args || {});
    });

    EF.ai.registerTool('gde.previewPatch', {
      title: 'Preview GDE patch',
      description: 'Validate and preview a GDE patch. The approved preview can be applied from the message UI.',
      schema: patchToolSchema(),
      permissions: { call: true, apply: true },
      preview: GDE.ai.previewPatchChangeSet,
      run: GDE.ai.previewPatchChangeSet,
      apply: GDE.ai.applyPatchChangeSet,
    });
    EF.ai.registerTool('gde.applyPatch', {
      title: 'Apply GDE patch',
      description: 'Apply an approved GDE patch through State and History.',
      schema: patchToolSchema(),
      permissions: { call: true, apply: true },
      preview: GDE.ai.previewPatchChangeSet,
      run: GDE.ai.previewPatchChangeSet,
      apply: GDE.ai.applyPatchChangeSet,
    });
  }

  function tool(id, title, description, schema, run) {
    EF.ai.registerTool(id, {
      title: title,
      description: description,
      schema: schema,
      permissions: { call: true, apply: false },
      run: run,
    });
  }

  function patchToolSchema() {
    return {
      type: 'object',
      required: ['patch'],
      additionalProperties: false,
      properties: {
        patch: GDE.ai.patchOps.patchSchema(),
      },
    };
  }

  function batchSetFieldsSchema() {
    return {
      type: 'object',
      required: ['table'],
      additionalProperties: false,
      properties: {
        table: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        field: { type: 'string', description: 'Single field to edit when fields is omitted.' },
        value: { description: 'Value for field.' },
        fields: { type: 'object', description: 'Field values keyed by field path.' },
        query: { type: 'string' },
        filterField: { type: 'string' },
        filterValue: {},
        title: { type: 'string' },
      },
    };
  }

  function batchCreateEntitiesSchema() {
    return {
      type: 'object',
      required: ['table', 'entities'],
      additionalProperties: false,
      properties: {
        table: { type: 'string' },
        entities: { type: 'array', minItems: 1, items: { type: 'object' } },
        title: { type: 'string' },
      },
    };
  }

  function batchDeleteEntitiesSchema() {
    return {
      type: 'object',
      required: ['table'],
      additionalProperties: false,
      properties: {
        table: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        filterField: { type: 'string' },
        filterValue: {},
        title: { type: 'string' },
      },
    };
  }

  function balanceNumericFieldSchema() {
    return {
      type: 'object',
      required: ['table', 'field'],
      additionalProperties: false,
      properties: {
        table: { type: 'string' },
        field: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        multiplier: { type: 'number', description: 'Default 1.' },
        add: { type: 'number', description: 'Default 0.' },
        min: { type: 'number' },
        max: { type: 'number' },
        round: { type: 'boolean' },
        title: { type: 'string' },
      },
    };
  }

  function findReferences(id) {
    var sid = String(id);
    var out = [];
    var tm = State.tableMap();
    var gd = State.gameData();
    Object.keys(tm).forEach(function (pathKey) {
      var sd = tm[pathKey].struct_def || {};
      (tm[pathKey].id || []).forEach(function (entityId) {
        var entity = gd[entityId] || {};
        Object.keys(entity).forEach(function (field) {
          if (String(entity[field]) === sid) {
            out.push({ table: pathKey, id: entityId, field: field, kind: GDE.ai.fieldTypeName(sd[field]) === 'ref_id' ? 'ref_id' : 'value' });
          }
        });
      });
    });
    return out;
  }

  function searchData(query, limit) {
    var q = String(query || '').toLowerCase();
    var out = [];
    var tm = State.tableMap();
    var gd = State.gameData();
    Object.keys(tm).forEach(function (pathKey) {
      if (pathKey.toLowerCase().indexOf(q) >= 0) out.push({ kind: 'table', table: pathKey });
      Object.keys(tm[pathKey].struct_def || {}).forEach(function (field) {
        if (field.toLowerCase().indexOf(q) >= 0) out.push({ kind: 'field', table: pathKey, field: field });
      });
      (tm[pathKey].id || []).forEach(function (id) {
        var entity = gd[id] || {};
        if (String(id).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'entity', table: pathKey, id: id, entity: clone(entity) });
        Object.keys(entity).forEach(function (field) {
          var value = entity[field];
          if (String(value == null ? '' : value).toLowerCase().indexOf(q) >= 0) out.push({ kind: 'value', table: pathKey, id: id, field: field, value: clone(value) });
        });
      });
    });
    return out.slice(0, Math.max(1, Number(limit || 50)));
  }

  function summarizeTable(pathKey) {
    var table = State.tableMap()[pathKey];
    if (!table) return null;
    var gd = State.gameData();
    var ids = (table.id || []).slice();
    var fields = Object.keys(table.struct_def || {});
    var filled = {};
    fields.forEach(function (field) { filled[field] = 0; });
    ids.forEach(function (id) {
      var entity = gd[id] || {};
      fields.forEach(function (field) {
        var value = entity[field];
        if (value != null && value !== '' && !(Array.isArray(value) && !value.length)) filled[field]++;
      });
    });
    return {
      table: pathKey,
      entityCount: ids.length,
      fieldCount: fields.length,
      fields: fields.map(function (field) {
        return {
          name: field,
          type: GDE.ai.fieldTypeName(table.struct_def[field]),
          filled: filled[field],
          empty: ids.length - filled[field],
        };
      }),
    };
  }

  function findInvalidRefs(pathKey) {
    var out = [];
    var tm = State.tableMap();
    var gd = State.gameData();
    Object.keys(tm).forEach(function (tableKey) {
      if (pathKey && tableKey !== pathKey) return;
      var sd = tm[tableKey].struct_def || {};
      var refFields = Object.keys(sd).filter(function (field) {
        var resolved = State.resolveFieldDef(sd[field]);
        return resolved && resolved.type_render === 'ref_id';
      });
      (tm[tableKey].id || []).forEach(function (id) {
        var entity = gd[id] || {};
        refFields.forEach(function (field) {
          var value = entity[field];
          if (value != null && value !== '' && value !== 0 && !gd[String(value)]) {
            out.push({ table: tableKey, id: id, field: field, value: String(value) });
          }
        });
      });
    });
    return out;
  }

  function findUnknownStructFields(pathKey) {
    var out = [];
    var known = Object.assign({}, State.builtinTypeConfig(), State.projectTypeConfig());
    var tm = State.tableMap();
    Object.keys(tm).forEach(function (tableKey) {
      if (pathKey && tableKey !== pathKey) return;
      var sd = tm[tableKey].struct_def || {};
      Object.keys(sd).forEach(function (field) {
        var type = GDE.ai.fieldTypeName(sd[field]);
        if (type && !known[type]) out.push({ table: tableKey, field: field, type: type });
      });
    });
    return out;
  }

  function planTypeConfigMerge(tables) {
    var tableList = normalizeTableList(tables);
    var unknown = [];
    if (tableList.length) {
      tableList.forEach(function (table) {
        Array.prototype.push.apply(unknown, findUnknownStructFields(table));
      });
    } else {
      unknown = findUnknownStructFields(null);
    }
    var seen = {};
    var ops = [];
    unknown.forEach(function (item) {
      if (seen[item.type]) return;
      seen[item.type] = true;
      ops.push({
        op: 'upsertType',
        name: item.type,
        config: {
          base_type: 'string',
          type_render: 'input_string',
          mem: 'Imported from ' + item.table + '.' + item.field,
        },
      });
    });
    return { type: 'gde.patch', title: 'Merge missing TypeConfig fields', ops: ops };
  }

  function replaceAssetReferences(from, to) {
    var refs = State.findAssetReferences([from]);
    return {
      type: 'gde.patch',
      title: 'Replace asset references',
      ops: (refs || []).map(function (ref) {
        return { op: 'setAssetReference', table: ref.pathKey, id: ref.id, field: ref.path || ref.field, url: to };
      }),
    };
  }

  function planBatchSetFields(args) {
    var tableKey = args.table || args.pathKey;
    var table = State.tableMap()[tableKey];
    if (!table) return toolError('TABLE_NOT_FOUND', 'table', 'Table not found: ' + tableKey, {
      expected: 'existing table path',
      received: tableKey,
      allowedValues: Object.keys(State.tableMap()).sort(),
      suggestedFix: 'Call gde.getProjectSummary or use an existing table path.',
    });
    var fields = args.fields && typeof args.fields === 'object'
      ? clone(args.fields)
      : (args.field ? objectOf(args.field, clone(args.value)) : null);
    if (!fields || !Object.keys(fields).length) return toolError('MISSING_FIELDS', 'fields', 'Expected fields or field/value.');
    var fieldError = validatePatchFields(table, fields);
    if (fieldError) return fieldError;
    var ids = idsFromArgs(tableKey, args);
    if (!ids.length) return emptySelectionError(tableKey);
    var keys = Object.keys(fields);
    var op = keys.length === 1
      ? { op: 'setFieldMany', table: tableKey, ids: ids, field: keys[0], value: fields[keys[0]] }
      : { op: 'setFieldsMany', table: tableKey, ids: ids, fields: fields };
    return previewPatch({ title: args.title || 'Batch set fields', ops: [op] });
  }

  function planBatchCreateEntities(args) {
    var tableKey = args.table || args.pathKey;
    var table = State.tableMap()[tableKey];
    if (!table) return toolError('TABLE_NOT_FOUND', 'table', 'Table not found: ' + tableKey, {
      expected: 'existing table path',
      received: tableKey,
      allowedValues: Object.keys(State.tableMap()).sort(),
      suggestedFix: 'Call gde.getTableSchema before generating entities.',
    });
    var entities = Array.isArray(args.entities) ? args.entities : [];
    if (!entities.length) return toolError('MISSING_ENTITIES', 'entities', 'Expected non-empty entities array.');
    var ops = [];
    for (var i = 0; i < entities.length; i++) {
      var entity = clone(entities[i] || {});
      var id = entity.id != null ? String(entity.id) : null;
      delete entity.id;
      var fieldError = validatePatchFields(table, entity, 'entities[' + i + ']');
      if (fieldError) return fieldError;
      var op = { op: 'addEntity', table: tableKey, entity: entity };
      if (id) op.id = id;
      ops.push(op);
    }
    return previewPatch({ title: args.title || 'Batch create entities', ops: ops });
  }

  function planBatchDeleteEntities(args) {
    var tableKey = args.table || args.pathKey;
    var table = State.tableMap()[tableKey];
    if (!table) return toolError('TABLE_NOT_FOUND', 'table', 'Table not found: ' + tableKey, {
      expected: 'existing table path',
      received: tableKey,
      allowedValues: Object.keys(State.tableMap()).sort(),
    });
    var ids = idsFromArgs(tableKey, args);
    if (!ids.length) return emptySelectionError(tableKey);
    return previewPatch({
      title: args.title || 'Batch delete entities',
      ops: [{ op: 'deleteEntities', table: tableKey, ids: ids }],
    });
  }

  function planBalanceNumericField(args) {
    var tableKey = args.table || args.pathKey;
    var table = State.tableMap()[tableKey];
    if (!table) return toolError('TABLE_NOT_FOUND', 'table', 'Table not found: ' + tableKey, {
      expected: 'existing table path',
      received: tableKey,
      allowedValues: Object.keys(State.tableMap()).sort(),
    });
    var field = args.field;
    var fieldError = validateKnownField(table, field, 'field');
    if (fieldError) return fieldError;
    var ids = idsFromArgs(tableKey, args);
    if (!ids.length) return emptySelectionError(tableKey);
    var gd = State.gameData();
    var multiplier = numberOr(args.multiplier, 1);
    var add = numberOr(args.add, 0);
    var ops = [];
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i];
      var current = Number((gd[id] || {})[field]);
      if (!Number.isFinite(current)) return toolError('NON_NUMERIC_VALUE', 'field', 'Value is not numeric: ' + tableKey + '/' + id + '.' + field, {
        expected: 'numeric field value',
        received: (gd[id] || {})[field],
        suggestedFix: 'Use gde.queryRows to inspect values, or choose a numeric field.',
      });
      var next = current * multiplier + add;
      if (typeof args.min === 'number') next = Math.max(args.min, next);
      if (typeof args.max === 'number') next = Math.min(args.max, next);
      if (args.round) next = Math.round(next);
      ops.push({ op: 'setField', table: tableKey, id: id, field: field, value: next });
    }
    return previewPatch({ title: args.title || 'Balance numeric field', ops: ops });
  }

  function previewPatch(patch) {
    return GDE.ai.previewPatchChangeSet({ patch: Object.assign({ type: 'gde.patch' }, patch) });
  }

  function idsFromArgs(tableKey, args) {
    if (args.ids && args.ids.length) return args.ids.map(String);
    var rows = GDE.ai.queryRows({
      table: tableKey,
      field: args.filterField || args.fieldFilter || args.field,
      value: args.filterValue,
      query: args.query,
      limit: 1000,
    });
    return rows && rows.rows ? rows.rows.map(function (row) { return String(row.id); }) : [];
  }

  function validatePatchFields(table, fields, path) {
    var keys = Object.keys(fields || {});
    for (var i = 0; i < keys.length; i++) {
      var hit = validateKnownField(table, keys[i], (path || 'fields') + '.' + keys[i]);
      if (hit) return hit;
    }
    return null;
  }

  function validateKnownField(table, field, path) {
    var root = String(field || '').split('.')[0];
    if (field && root in (table.struct_def || {})) return null;
    return toolError('FIELD_NOT_FOUND', path || 'field', 'Field not in struct_def: ' + field, {
      expected: 'field declared in table struct_def',
      received: field,
      allowedValues: Object.keys(table.struct_def || {}).sort(),
      suggestedFix: 'Call gde.getTableSchema and use a declared field, or add the field to struct_def in the same patch.',
    });
  }

  function emptySelectionError(tableKey) {
    return toolError('EMPTY_SELECTION', 'ids', 'No entity ids matched for table: ' + tableKey, {
      expected: 'non-empty ids array or query/filter matching rows',
      suggestedFix: 'Call gde.queryRows to enumerate affected ids before planning the batch edit.',
    });
  }

  function toolError(code, path, message, extra) {
    if (GDE.ai.errorResult) return GDE.ai.errorResult(code, path, message, extra);
    return { ok: false, errors: [Object.assign({ code: code, path: path, message: message }, extra || {})] };
  }

  function objectOf(key, value) {
    var out = {};
    out[key] = value;
    return out;
  }

  function numberOr(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeTableList(value) {
    if (!value) return [];
    if (typeof value === 'string') return [value];
    return (value || []).map(String).filter(Boolean);
  }

  GDE.ai.findReferences = findReferences;
  GDE.ai.findInvalidRefs = findInvalidRefs;
  GDE.ai.findUnknownStructFields = findUnknownStructFields;
  GDE.ai.registerTools = registerTools;
})();
