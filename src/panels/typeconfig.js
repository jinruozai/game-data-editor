/**
 * Project TypeConfig panel.
 *
 * The list shows every project + built-in type. Clicking an item selects
 * it through State.selection with kind='typeconfig', which Inspector
 * renders as an editable TypeDef via the provider registered at the
 * bottom of this file. Edits persist into projectTypeConfig 鈥?so editing
 * a built-in type implicitly creates a project-level override.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // 鈹€鈹€ Inspector provider for kind='typeconfig' 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // Schema is memoized 鈥?propertyPanel only rebuilds its rows when the
  // schema *reference* changes (Object.is check inside the schema effect).
  // Returning a fresh object on every refresh() would rebuild every row's
  // DOM on every keystroke, losing focus. One stable reference = focus
  // survives edits. type_render options follow whichever renderers are
  // currently registered at first lookup; rebuilding the cache happens only
  // if a new renderer gets registered after this panel first opens.
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

  // Exposed so tables' struct_def override editor can render exactly the
  // same rows as the TypeConfig panel (single source of truth for the
  // TypeDef shape). Any change to the schema here flows to both UIs.
  window.TypeDefSchema = {
    build: buildTypeDefSchema,
    // Identity keys 鈥?those whose values *define the type itself*, hence
    // not overridable per-table. Consumers hide the edit/revert button
    // and keep the editor disabled for these rows.
    IDENTITY_KEYS: ['key', 'name', 'base_type'],
  };

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
    if (baseType === 'struct') return {};
    if (baseType === 'array') return [];
    return null;
  }

  function valueMatchesBase(baseType, value) {
    if (baseType === 'int' || baseType === 'float') return typeof value === 'number' && isFinite(value);
    if (baseType === 'string') return typeof value === 'string';
    if (baseType === 'struct') return !!value && typeof value === 'object' && !Array.isArray(value);
    if (baseType === 'array') return Array.isArray(value);
    return true;
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
      if (renderKindsForBase(nv).indexOf(current.type_render) < 0) patch.type_render = defaultRenderForBase(nv);
      if (!valueMatchesBase(nv, current.default)) patch.default = defaultValueForBase(nv);
    } else if (field === 'type_render') {
      if (renderKindsForBase(current.base_type || 'string').indexOf(nv) < 0) return;
      patch.type_render = nv;
    } else if (field === 'default') {
      try { patch[field] = JSON.parse(nv); } catch (_) { patch[field] = nv; }
    } else if (field === 'type_agv') {
      // Invalid JSON = silently skip; user keeps typing, the raw string
      // stays in the input field until they make it parse cleanly.
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
      return buildTypeDefSchema(td.base_type || 'string');
    },
    value:     function (sel) { return toFormValue(State.resolveType(sel.key), sel.key); },
    onChange:  function (sel, field, nv) { applyEdit(sel.key, field, nv); },
    dataTopic: function ()    { return 'typeconfig:changed'; },
  });

  // 鈹€鈹€ Panel component 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  function randomTypeName() {
    var existing = Object.assign({}, State.builtinTypeConfig(), State.projectTypeConfig());
    for (var i = 0; i < 100; i++) {
      var hex = Math.floor(Math.random() * 0xffffff).toString(16);
      while (hex.length < 6) hex = '0' + hex;
      var n = 'type_' + hex;
      if (!existing[n]) return n;
    }
    throw new Error('Could not generate a unique type name');
  }

  function createPanel(propsSig, ctx) {
    var props = propsSig.peek() || {};
    var root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;';

    // Toolbar: [search] [+]
    var bar = document.createElement('div');
    bar.className = 'gde-tm-toolbar';
    var filterSig      = EF.signal('');
    var placeholderSig = EF.signal('');
    var addTitleSig    = EF.signal(t('typeconfig.add'));
    var searchInput = ui.searchInput({ value: filterSig, placeholder: placeholderSig });
    searchInput.style.cssText = 'flex:1 1 auto;min-width:0;';
    var addBtn = ui.iconButton({
      icon: 'plus', kind: 'primary', title: addTitleSig,
      onClick: function () {
        var key = randomTypeName();
        State.upsertProjectType(key, {
          name: '', base_type: 'string', type_render: 'input_string',
          default: '', mem: '', type_agv: {},
        });
        State.setSelection({ kind: 'typeconfig', key: key });
      },
    });
    bar.appendChild(searchInput); bar.appendChild(addBtn);

    var list = document.createElement('div');
    list.style.cssText = 'flex:1;overflow:auto;';
    list.addEventListener('click', function (ev) {
      if (ev.target !== list) return;
      var sel = State.selection();
      if (sel && sel.kind === 'typeconfig') State.setSelection(null);
    });

    root.appendChild(bar); root.appendChild(list);

    // Collapsed state per section survives re-renders.
    var collapsed = { project: false, builtin: false };

    function sectionHeader(id, text) {
      var h = document.createElement('div');
      h.className = 'gde-tc-section-head' + (collapsed[id] ? ' is-collapsed' : '');
      var caret = document.createElement('span');
      caret.className = 'gde-tc-section-caret';
      caret.textContent = '>';
      var label = document.createElement('span');
      label.textContent = text;
      h.appendChild(caret); h.appendChild(label);
      h.addEventListener('click', function () { collapsed[id] = !collapsed[id]; render(); });
      return h;
    }

    function sectionBody(id) {
      var b = document.createElement('div');
      b.className = 'gde-tc-section-body' + (collapsed[id] ? ' is-collapsed' : '');
      return b;
    }

    function buildItem(key, cfg, editable, active) {
      var item = document.createElement('div');
      item.className = 'gde-tc-item' + (active ? ' is-active' : '');
      var nameRow = document.createElement('div');
      nameRow.className = 'gde-tc-name';
      var keyEl = document.createElement('span');
      keyEl.className = 'gde-tc-key';
      keyEl.textContent = key;
      nameRow.appendChild(keyEl);
      if (cfg.name) {
        var badge = document.createElement('span');
        badge.className = 'gde-tc-badge';
        badge.textContent = cfg.name;
        nameRow.appendChild(badge);
      }
      var desc = document.createElement('span');
      desc.className = 'gde-tc-desc';
      desc.textContent = (cfg.base_type || '?') + ' / ' + (cfg.type_render || '?') + (cfg.mem ? ' - ' + cfg.mem : '');
      nameRow.appendChild(desc);
      item.appendChild(nameRow);

      item.addEventListener('click', function () {
        State.setSelection({ kind: 'typeconfig', key: key });
      });
      if (GDE.ai && GDE.ai.bindTarget) {
        GDE.ai.bindTarget(item, function () { return GDE.ai.typeTarget(key); }, { draggable: true });
      }
      item.addEventListener('contextmenu', function (e) {
        var items = [];
        if (GDE.ai && GDE.ai.sendTargetsToAI) {
          items.push({
            label: t('common.add_to_chat'),
            icon: 'message-circle',
            onSelect: function () { GDE.ai.sendTargetsToAI([GDE.ai.typeTarget(key)], 'Inspect this TypeConfig entry.'); },
          });
        }
        if (editable) items.push({ label: t('typeconfig.ctx.delete'), danger: true, onSelect: function () { deleteType(key); } });
        if (!items.length) return;
        e.preventDefault();
        EF.ui.contextMenu({ x: e.clientX, y: e.clientY }, items);
      });
      return item;
    }

    function render() {
      GDE.clear(list);
      var filter    = (filterSig.peek() || '').toLowerCase();
      var proj      = State.projectTypeConfig();
      // All types known to the framework, minus the ones the project
      // already overrides 鈥?the rest are shown as "built-in / read-only".
      // Editing one of them creates a project override and moves it to
      // the project section on next render.
      var merged  = ui.getTypeConfig();
      var builtin = {};
      Object.keys(merged).forEach(function (k) { if (!(k in proj)) builtin[k] = merged[k]; });
      var sel       = State.selection();
      var activeKey = (sel && sel.kind === 'typeconfig') ? sel.key : null;

      function matches(k) { return !filter || k.toLowerCase().indexOf(filter) >= 0; }

      var projKeys = Object.keys(proj).filter(matches).sort();
      var biKeys   = Object.keys(builtin).filter(matches).sort();

      if (projKeys.length) {
        list.appendChild(sectionHeader('project', t('typeconfig.project_note')));
        var pBody = sectionBody('project');
        projKeys.forEach(function (k) { pBody.appendChild(buildItem(k, proj[k], true, activeKey === k)); });
        list.appendChild(pBody);
      }
      if (biKeys.length) {
        list.appendChild(sectionHeader('builtin', t('typeconfig.builtin_note')));
        var bBody = sectionBody('builtin');
        biKeys.forEach(function (k) { bBody.appendChild(buildItem(k, builtin[k], false, activeKey === k)); });
        list.appendChild(bBody);
      }
      if (!projKeys.length && !biKeys.length) {
        var empty = document.createElement('div');
        empty.style.cssText = 'padding:16px;color:var(--ef-fg-3);font-size:var(--ef-fs-sm);text-align:center;';
        empty.textContent = t('typeconfig.empty');
        list.appendChild(empty);
      }
    }

    function deleteType(key) {
      var usages = State.findTypeUsages(key);
      var title, msg;
      if (usages.length > 0) {
        title = t('typeconfig.delete_in_use_title') || 'Type is in use';
        msg = t('typeconfig.delete_in_use', { name: key, n: usages.length })
            + '\n\n' + usages.map(function (u) { return '-' + u.pathKey + '.' + u.field; }).join('\n');
      } else {
        title = t('typeconfig.delete_confirm_title') || 'Delete type';
        msg = t('typeconfig.delete_confirm', { name: key });
      }
      EF.ui.confirm({ title: title, message: msg, danger: true, okLabel: t('common.delete') || 'Delete' })
        .then(function (ok) {
          if (!ok) return;
          if (usages.length > 0) {
            var tm = State.tableMap();
            Object.keys(tm).forEach(function (pk) {
              var sd = Object.assign({}, tm[pk].struct_def || {});
              var changed = false;
              Object.keys(sd).forEach(function (f) {
                if (sd[f] && sd[f].type === key) { delete sd[f]; changed = true; }
              });
              if (changed) State.updateStructDef(pk, sd);
            });
          }
          // If the deleted type is currently selected in Inspector, clear.
          var sel = State.selection();
          if (sel && sel.kind === 'typeconfig' && sel.key === key) State.setSelection(null);
          State.deleteProjectType(key);
          State.log('warn', 'TypeConfig deleted: ' + key);
        });
    }

    GDE.effect(root, function () { filterSig(); render(); });
    ctx.bus.on('typeconfig:changed', render);
    ctx.bus.on('selection:changed',  render);

    function applyLocale() {
      (function (pt) {
        if (ctx.panel && ctx.panel.title && ctx.panel.title() !== pt) ctx.panel.setTitle(pt);
      })(t('panel.typeconfig'));
      placeholderSig.set(t('typeconfig.search_placeholder'));
      addTitleSig.set(t('typeconfig.add'));
      render();
    }
    var offLocale = I18N.onChange(applyLocale);
    ctx.onCleanup(offLocale);

    applyLocale();
    return root;
  }

  EF.registerComponent('gde-typeconfig', {
    category: 'panel',
    label: 'TypeConfig',
    icon: 'settings',
    factory: createPanel,
    defaults: function () { return { title: 'TypeConfig', props: {} }; },
  });
})();

