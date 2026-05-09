/**
 * Seed data - builtin TypeConfig and optional project templates.
 */
(function () {
  'use strict';

  var BUILTIN = {
    "id_num":     { name: "ID+Num",        base_type: "struct", type_render: "struct", default: { id: 0, num: 0 },    mem: "Reference id + quantity",       struct_def: { id_num:     { id: "ref_id", num: "int" } } },
    "id_string":  { name: "ID+String",     base_type: "struct", type_render: "struct", default: { id: 0, str: "" },   mem: "Reference id + free text",      struct_def: { id_string:  { id: "ref_id", str: "string" } } },
    "string_num": { name: "String+Num",    base_type: "struct", type_render: "struct", default: { str: "", num: 0 },  mem: "Free text + quantity",          struct_def: { string_num: { str: "string", num: "int" } } },
    "img_num":    { name: "Image+Num",     base_type: "struct", type_render: "struct", default: { img: "", num: 0 },  mem: "Image asset + quantity",        struct_def: { img_num:    { img: "img", num: "int" } } },
    "snd_num":    { name: "Audio+Num",     base_type: "struct", type_render: "struct", default: { snd: "", num: 0 },  mem: "Audio asset + quantity",        struct_def: { snd_num:    { snd: "snd", num: "int" } } },
    "img_string": { name: "Image+String",  base_type: "struct", type_render: "struct", default: { img: "", str: "" }, mem: "Image asset + label",           struct_def: { img_string: { img: "img", str: "string" } } },
    "snd_string": { name: "Audio+String",  base_type: "struct", type_render: "struct", default: { snd: "", str: "" }, mem: "Audio asset + label",           struct_def: { snd_string: { snd: "snd", str: "string" } } }
  };

  function icon(name, color) {
    return 'https://api.iconify.design/game-icons:' + name + '.svg?color=%23' + color;
  }

  function installBuiltins() {
    State.setBuiltinTypeConfig(BUILTIN);
  }

  function applyProject(snapshot, sourceName) {
    installBuiltins();
    ProjectIO.codec.applySnapshot(snapshot, sourceName);
  }

  function newProject(options) {
    options = options || {};
    installBuiltins();
    if (window.ProjectIO && ProjectIO.assets) ProjectIO.assets.clear();
    applyProject({
      project: { name: options.name || 'Untitled', version: 0 },
      type_config: {},
      card_styles: { 'default': ProjectIO.codec.defaultCardStyle() },
      tables: {},
    }, options.name || 'Untitled');
    State.setWorkspaceInfo(null);
    if (options.dirty) State.markDirty();
    else State.clearDirty();
    if (window.GDE && GDE.history) GDE.history.reset(t('history.new_project'), { saved: !options.dirty });
  }

  function table(structDef, entities) {
    return { struct_def: structDef, entities: entities };
  }

  function baseStruct(extra) {
    return Object.assign({
      id:   { type: 'id', ref_name: 'name', ref_icon: 'icon' },
      name: { type: 'string', mem: 'Display name' },
      icon: { type: 'img', mem: 'Icon asset' },
    }, extra || {});
  }

  function buildDemoSnapshot() {
    var currency = table(baseStruct(), [
      { name: '金币', icon: icon('two-coins', 'f5c84c') },
      { name: '钻石', icon: icon('cut-diamond', '67d8ff') },
    ]);

    var attrs = table(baseStruct(), [
      { name: '血量', icon: icon('heart-plus', 'ef5b5b') },
      { name: '攻击', icon: icon('sword-wound', 'f08a42') },
      { name: '防御', icon: icon('shield', '72a8ff') },
      { name: '移动速度', icon: icon('run', '6ee7b7') },
    ]);

    var roles = table(baseStruct({
      mem: { type: 'string', mem: 'Description' },
      property: { type: 'array', mem: 'Character properties', type_agv: { elem_type: 'id_num' } },
    }), [
      { name: '张三', icon: icon('person', '7dd3fc'), mem: '均衡型角色。', property: [] },
      { name: '李四', icon: icon('hooded-figure', 'c4b5fd'), mem: '高攻击角色。', property: [] },
      { name: '王五', icon: icon('guards', '86efac'), mem: '防御型角色。', property: [] },
      { name: '赵六', icon: icon('running-ninja', 'fda4af'), mem: '高速角色。', property: [] },
    ]);

    return {
      project: { name: 'Demo Project', version: 0 },
      type_config: {},
      card_styles: buildDemoCardStyles(),
      tables: {
        '货币': currency,
        '属性': attrs,
        '角色': roles,
      },
    };
  }

  function materializeTables(rawTables) {
    var tables = {};
    Object.keys(rawTables).forEach(function (pathKey) {
      var raw = rawTables[pathKey];
      var ids = [];
      var entities = {};
      raw.entities.forEach(function (entity) {
        var id = State.genId();
        ids.push(id);
        entities[id] = Object.assign({}, entity);
      });
      tables[pathKey] = {
        struct_def: raw.struct_def,
        id: ids,
        entities: entities,
        card_style: 'default',
      };
    });
    return tables;
  }

  function wireDemoRefs(tables) {
    var attrIds = tables['属性'].id;
    var roleIds = tables['角色'].id;
    var data = tables['角色'].entities;
    var values = [
      [[0, 120], [1, 18], [2, 10], [3, 8]],
      [[0, 95],  [1, 32], [2, 6],  [3, 10]],
      [[0, 160], [1, 14], [2, 28], [3, 6]],
      [[0, 85],  [1, 20], [2, 8],  [3, 16]],
    ];
    roleIds.forEach(function (id, i) {
      data[id].property = values[i].map(function (pair) { return { id: attrIds[pair[0]], num: pair[1] }; });
    });
  }

  function loadTemplate(key) {
    if (key !== 'demo') throw new Error('Unknown template: ' + key);
    installBuiltins();
    if (window.ProjectIO && ProjectIO.assets) ProjectIO.assets.clear();
    var snapshot = buildDemoSnapshot();
    snapshot.tables = materializeTables(snapshot.tables);
    wireDemoRefs(snapshot.tables);
    applyProject(snapshot, 'Demo Project');
    State.setWorkspaceInfo({ kind: 'template', name: 'Demo Project' });
    State.clearDirty();
    if (window.GDE && GDE.history) GDE.history.reset(t('history.open_demo'), { saved: true });
  }

  function buildDemoCardStyles() {
    return { 'default': ProjectIO.codec.defaultCardStyle() };
  }

  window.Seed = {
    BUILTIN: BUILTIN,
    installBuiltins: installBuiltins,
    newProject: newProject,
    loadTemplate: loadTemplate,
    install: function () { loadTemplate('demo'); },
  };
})();
