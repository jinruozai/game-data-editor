/**
 * TypeConfig schema helpers shared by the TypeConfig panel and Inspector
 * providers.
 */
(function () {
  'use strict';

  var ui = EF.ui;
  var _schemaCache = {};
  var _schemaKindCount = -1;

  function buildTypeDefSchema(baseType) {
    var kinds = ui.listRenderKinds();
    var base = baseType || 'string';
    var cacheKey = base + ':' + kinds.length;
    if (_schemaCache[cacheKey] && _schemaKindCount === kinds.length) return _schemaCache[cacheKey];
    var kindOpts = {};
    renderKindsForBase(base, kinds).forEach(function (k) { kindOpts[k] = k; });
    _schemaCache[cacheKey] = {
      key:         { type: 'string', commit: 'blur' },
      name:        { type: 'string' },
      base_type:   { type: 'enum_string', type_agv: { options: { int: 'int', float: 'float', string: 'string', struct: 'struct', array: 'array', var: 'var' } } },
      type_render: { type: 'enum_string', type_agv: { options: kindOpts } },
      'default':   { type: 'string', mem: 'Default value (JSON literal)' },
      mem:         { type: 'string', mem: 'Description' },
      type_agv:    { type: 'string', mem: 'Render args (JSON object)' },
    };
    _schemaKindCount = kinds.length;
    return _schemaCache[cacheKey];
  }

  function renderKindsForBase(baseType, registered) {
    var base = State.resolveType(baseType) || ui.resolveType(baseType) || {};
    var support = base.support_render || [];
    if (!support.length) support = [base.type_render || baseType || 'input_string'];
    var available = {};
    (registered || ui.listRenderKinds()).forEach(function (k) { available[k] = true; });
    var out = support.filter(function (k) { return available[k]; });
    return out.length ? out : ['input_string'];
  }

  function defaultRenderForBase(baseType) {
    return renderKindsForBase(baseType)[0] || 'input_string';
  }

  function defaultValueForBase(baseType) {
    if (baseType === 'int') return 0;
    if (baseType === 'float') return 0;
    if (baseType === 'string') return '';
    if (baseType === 'struct') return [];
    if (baseType === 'array') return [];
    return null;
  }

  function valueMatchesBase(baseType, value) {
    if (baseType === 'int' || baseType === 'float') return typeof value === 'number' && isFinite(value);
    if (baseType === 'string') return typeof value === 'string';
    if (baseType === 'struct') return Array.isArray(value);
    if (baseType === 'array') return Array.isArray(value);
    return true;
  }

  window.TypeDefSchema = {
    build: buildTypeDefSchema,
    renderKindsForBase: renderKindsForBase,
    defaultRenderForBase: defaultRenderForBase,
    defaultValueForBase: defaultValueForBase,
    valueMatchesBase: valueMatchesBase,
    IDENTITY_KEYS: ['key', 'name', 'base_type'],
  };
})();
