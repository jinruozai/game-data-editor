/**
 * Project TypeConfig panel.
 *
 * The list shows every project + built-in type. Clicking an item selects it
 * through State.selection with kind='typeconfig'. The Inspector provider for
 * that selection lives in src/inspector/providers/typeconfig.js.
 */
(function () {
  'use strict';

  var ui = EF.ui;

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
