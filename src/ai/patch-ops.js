/**
 * GDE.ai patch operation registry.
 *
 * This is intentionally metadata-first. The patch runner still owns state
 * mutation, but operation names, target requirements, and review categories
 * live in one table so tools, validators, and future schemas do not drift.
 */
(function () {
  'use strict';

  var ops = {};

  function register(spec) {
    ops[spec.op] = spec;
    return spec;
  }

  function get(op) {
    return ops[op] || null;
  }

  function has(op) {
    return !!ops[op];
  }

  function list() {
    return Object.keys(ops).map(function (op) { return ops[op]; });
  }

  function requiresTable(op) {
    var spec = get(op);
    return !!(spec && spec.requiresTable);
  }

  function requiresEntity(op) {
    var spec = get(op);
    return !!(spec && spec.requiresEntity);
  }

  function operation(op) {
    var spec = get(op);
    return spec && spec.operation || 'update';
  }

  function target(op) {
    var spec = get(op);
    return spec && spec.target || 'project';
  }

  function opSchema(op) {
    var spec = get(op);
    return spec && spec.schema || null;
  }

  function patchSchema() {
    return {
      type: 'object',
      required: ['type', 'ops'],
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['gde.patch'] },
        title: { type: 'string' },
        ops: {
          type: 'array',
          minItems: 1,
          items: { oneOf: list().map(function (spec) { return spec.schema; }).filter(Boolean) },
        },
      },
    };
  }

  function str(desc) { return Object.assign({ type: 'string' }, desc ? { description: desc } : {}); }
  function num(desc) { return Object.assign({ type: 'number' }, desc ? { description: desc } : {}); }
  function bool(desc) { return Object.assign({ type: 'boolean' }, desc ? { description: desc } : {}); }
  function any(desc) { return desc ? { description: desc } : {}; }
  function obj(desc) { return Object.assign({ type: 'object' }, desc ? { description: desc } : {}); }
  function arr(items, desc) { return Object.assign({ type: 'array', items: items || {} }, desc ? { description: desc } : {}); }
  function ids() { return arr(str('Entity id'), 'Entity ids'); }
  function opLiteral(op) { return { type: 'string', enum: [op] }; }
  function schema(op, required, props) {
    return {
      type: 'object',
      required: ['op'].concat(required || []),
      additionalProperties: false,
      properties: Object.assign({ op: opLiteral(op) }, props || {}),
    };
  }

  function installDefaults() {
    [
      { op: 'setField', title: 'Set field', operation: 'update', target: 'field', requiresTable: true, requiresEntity: true,
        schema: schema('setField', ['table', 'id', 'field', 'value'], { table: str(), id: str(), field: str(), value: any() }) },
      { op: 'setFieldMany', title: 'Set field on many entities', operation: 'update', target: 'entityList', requiresTable: true,
        schema: schema('setFieldMany', ['table', 'ids', 'field', 'value'], { table: str(), ids: ids(), field: str(), value: any() }) },
      { op: 'setFields', title: 'Set fields', operation: 'update', target: 'entity', requiresTable: true, requiresEntity: true,
        schema: schema('setFields', ['table', 'id', 'fields'], { table: str(), id: str(), fields: obj('Field values keyed by field path') }) },
      { op: 'setFieldsMany', title: 'Set fields on many entities', operation: 'update', target: 'entityList', requiresTable: true,
        schema: schema('setFieldsMany', ['table', 'ids', 'fields'], { table: str(), ids: ids(), fields: obj('Field values keyed by field path') }) },
      { op: 'addEntity', title: 'Add entity', operation: 'insert', target: 'entity', requiresTable: true,
        schema: schema('addEntity', ['table', 'entity'], { table: str(), id: str('Optional requested id'), entity: obj('Entity field values') }) },
      { op: 'updateEntity', title: 'Update entity', operation: 'update', target: 'entity', requiresTable: true, requiresEntity: true,
        schema: schema('updateEntity', ['table', 'id'], { table: str(), id: str(), entity: obj('Entity field values'), fields: obj('Entity field values') }) },
      { op: 'deleteEntity', title: 'Delete entity', operation: 'delete', target: 'entity', requiresTable: true, requiresEntity: true,
        schema: schema('deleteEntity', ['table', 'id'], { table: str(), id: str() }) },
      { op: 'deleteEntities', title: 'Delete entities', operation: 'delete', target: 'entityList', requiresTable: true,
        schema: schema('deleteEntities', ['table', 'ids'], { table: str(), ids: ids() }) },
      { op: 'duplicateEntity', title: 'Duplicate entity', operation: 'insert', target: 'entity', requiresTable: true, requiresEntity: true,
        schema: schema('duplicateEntity', ['table', 'id'], { table: str(), id: str() }) },
      { op: 'reorderEntities', title: 'Reorder entities', operation: 'update', target: 'table', requiresTable: true,
        schema: schema('reorderEntities', ['table', 'ids'], { table: str(), ids: ids() }) },

      { op: 'addTable', title: 'Add table', operation: 'insert', target: 'table',
        schema: schema('addTable', ['table', 'struct_def'], { table: str(), struct_def: obj('Table struct_def') }) },
      { op: 'renameTable', title: 'Rename table', operation: 'update', target: 'table', requiresTable: true,
        schema: schema('renameTable', ['table', 'newTable'], { table: str(), newTable: str() }) },
      { op: 'deleteTable', title: 'Delete table', operation: 'delete', target: 'table', requiresTable: true,
        schema: schema('deleteTable', ['table'], { table: str() }) },
      { op: 'updateStructDef', title: 'Update table schema', operation: 'update', target: 'table', requiresTable: true,
        schema: schema('updateStructDef', ['table', 'struct_def'], { table: str(), struct_def: obj('Complete replacement struct_def') }) },
      { op: 'setTableCardStyle', title: 'Set table CardStyle', operation: 'update', target: 'table', requiresTable: true,
        schema: schema('setTableCardStyle', ['table', 'styleKey'], { table: str(), styleKey: str() }) },

      { op: 'upsertType', title: 'Upsert TypeConfig entry', operation: 'insert', target: 'type',
        schema: schema('upsertType', ['name', 'config'], { name: str(), config: obj('TypeConfig entry') }) },
      { op: 'deleteType', title: 'Delete TypeConfig entry', operation: 'delete', target: 'type',
        schema: schema('deleteType', ['name'], { name: str() }) },

      { op: 'upsertCardStyle', title: 'Upsert CardStyle', operation: 'insert', target: 'cardStyle',
        schema: schema('upsertCardStyle', ['key', 'cardStyle'], { key: str(), cardStyle: obj('CardStyle definition') }) },
      { op: 'updateCardNode', title: 'Update CardStyle node', operation: 'update', target: 'cardNode',
        schema: schema('updateCardNode', ['styleKey', 'nodeId'], { styleKey: str(), nodeId: str(), component: str(), props: obj(), bindings: obj(), layout: obj() }) },
      { op: 'addCardNode', title: 'Add CardStyle node', operation: 'insert', target: 'cardNode',
        schema: schema('addCardNode', ['styleKey', 'parentId', 'node'], { styleKey: str(), parentId: str(), node: obj('CardStyle node') }) },
      { op: 'deleteCardNode', title: 'Delete CardStyle node', operation: 'delete', target: 'cardNode',
        schema: schema('deleteCardNode', ['styleKey', 'nodeId'], { styleKey: str(), nodeId: str() }) },

      { op: 'setAssetReference', title: 'Set asset reference', operation: 'update', target: 'field', requiresTable: true, requiresEntity: true,
        schema: schema('setAssetReference', ['table', 'id', 'field', 'url'], { table: str(), id: str(), field: str(), url: str('asset:// URL') }) },
      { op: 'clearAssetReference', title: 'Clear asset reference', operation: 'update', target: 'field', requiresTable: true, requiresEntity: true,
        schema: schema('clearAssetReference', ['table', 'id', 'field'], { table: str(), id: str(), field: str() }) },
    ].forEach(register);
  }

  window.GDE = window.GDE || {};
  GDE.ai = GDE.ai || {};
  GDE.ai.patchOps = {
    register: register,
    get: get,
    has: has,
    list: list,
    requiresTable: requiresTable,
    requiresEntity: requiresEntity,
    operation: operation,
    target: target,
    schema: opSchema,
    patchSchema: patchSchema,
  };

  installDefaults();
})();
