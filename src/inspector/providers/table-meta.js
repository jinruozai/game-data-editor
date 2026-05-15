/**
 * GameDataEditor Inspector provider for table metadata and struct_def editing.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // ── Built-in provider: editing the table itself ──────────────
  // Uses the `render` escape hatch instead of the propertyPanel
  // pipeline because the form mixes a path input, a dynamic list of
  // field sections, a picker popover, and three action buttons �?
  // none of which fit a flat struct_def schema cleanly.
  Inspector.registerKind('table_meta', {
    title:     function (sel) { return 'Table: ' + sel.pathKey; },
    dataTopic: function ()    { return 'tables:changed'; },
    render:    function (sel, ctx) { return buildTableMetaForm(sel.pathKey, ctx); },
  });

  function buildTableMetaForm(pathKey, ctx) {
    // pathSig tracks the *current* path �?renames rewrite it and re-emit
    // a 'table_meta' selection with the new key, so this sub-form rebuilds
    // via the inspector's renderCustom identity check.
    var root = ui.h('div', 'gde-table-meta');

    // ── Path ────────────────────────────────────────────────
    var pathSig = EF.signal(pathKey);
    var pathLab = ui.h('div', 'gde-tm-section-label', { text: 'Path' });
    var pathIn = ui.input({ value: pathSig });
    pathIn.addEventListener('blur', function () {
      var nv = String(pathSig.peek() || '').trim();
      if (!nv || nv === pathKey) { pathSig.set(pathKey); return; }
      try {
        State.renameTable(pathKey, nv);
        State.setSelection({ kind: 'table_meta', pathKey: nv });
      } catch (e) {
        State.log('error', String(e.message || e));
        pathSig.set(pathKey);
      }
    });
    root.appendChild(pathLab);
    root.appendChild(pathIn);

    // ── Card Style ──────────────────────────────────────────
    // Tables reference cardStyles by key (cardStyles are project-level �?
    // multiple tables can share the same one). The dropdown is rebuilt
    // when the cardStyle catalog changes (add / rename / delete) so the
    // option list stays current; the value signal handles the per-table
    // record changes (cascade on rename / delete).
    var styleSig = EF.signal(currentStyleKey());
    function currentStyleKey() {
      var rec = State.tableMap()[pathKey];
      return (rec && rec.card_style) || 'default';
    }
    function styleOptions() {
      var cs = State.projectCardStyles();
      return Object.keys(cs).sort().map(function (k) {
        return { value: k, label: cs[k].name || k };
      });
    }
    var styleLab  = ui.h('div', 'gde-tm-section-label', { text: 'Card Style' });
    var styleHost = ui.h('div', 'gde-tm-cardstyle');
    root.appendChild(styleLab);
    root.appendChild(styleHost);
    function mountStyleSelect() {
      Array.from(styleHost.children).forEach(function (c) { ui.dispose(c); c.remove(); });
      styleHost.appendChild(ui.select({
        value:   styleSig,
        options: styleOptions(),
        onChange: function (v) { State.setTableCardStyle(pathKey, v); styleSig.set(v); },
      }));
    }
    mountStyleSelect();
    ui.collect(root, ctx.bus.on('cardstyles:changed', mountStyleSelect));
    ui.collect(root, ctx.bus.on('tables:changed', function () { styleSig.set(currentStyleKey()); }));
    // Reference display. These are table-level id metadata: ref_name drives
    // picker/list labels; ref_icon optionally paints a small icon before it.
    var refLab = ui.h('div', 'gde-tm-section-label', { text: 'Reference Display' });
    var refBox = ui.h('div', 'gde-tm-ref-display');
    root.appendChild(refLab);
    root.appendChild(refBox);
    mountRefDisplay();

    function mountRefDisplay() {
      Array.from(refBox.children).forEach(function (c) { ui.dispose(c); c.remove(); });
      var rec = State.tableMap()[pathKey] || {};
      var sd = rec.struct_def || {};
      var idDef = sd.id || {};
      var fields = Object.keys(sd).filter(function (k) { return k !== 'id'; }).sort();
      var opts = [{ value: '', label: '(default)' }];
      fields.forEach(function (k) { opts.push({ value: k, label: k }); });
      var nameSig = EF.signal(idDef.ref_name || 'name');
      var iconSig = EF.signal(idDef.ref_icon || 'icon');
      refBox.appendChild(refRow('ref_name', nameSig, opts, function (v) { setRefDisplay('ref_name', v); }));
      refBox.appendChild(refRow('ref_icon', iconSig, opts, function (v) { setRefDisplay('ref_icon', v); }));
    }
    ui.collect(root, ctx.bus.on('tables:changed', mountRefDisplay));

    function refRow(label, sig, opts, onChange) {
      var row = ui.h('div', 'gde-tm-ref-row');
      row.appendChild(ui.h('span', 'gde-tm-ref-label', { text: label }));
      row.appendChild(ui.combobox({ value: sig, options: opts, placeholder: '(default)', onChange: onChange }));
      return row;
    }

    function setRefDisplay(key, value) {
      var rec = State.tableMap()[pathKey] || {};
      var sd = Object.assign({}, rec.struct_def || {});
      var idDef = Object.assign({}, sd.id || { type: 'id' });
      if (value) idDef[key] = value;
      else delete idDef[key];
      if (!idDef.ref_name && !idDef.ref_icon && idDef.type === 'id') delete sd.id;
      else sd.id = idDef;
      State.updateStructDef(pathKey, sd);
    }

    // ── Fields ──────────────────────────────────────────────
    var fieldsLab = ui.h('div', 'gde-tm-section-label gde-tm-fields-label', { text: 'Fields' });
    var fieldsWrap = ui.h('div', 'gde-tm-fields');
    root.appendChild(fieldsLab);
    root.appendChild(fieldsWrap);

    // renderFields skips rebuild when the struct_def's *key set* is unchanged.
    // Per-field override edits shouldn't tear down rows �?that used to kill
    // input focus after every keystroke. Structural changes (add / delete
    // field, Merge) still go through a full rebuild. Row-internal effects
    // (override state, name color) handle the rest reactively.
    var lastKeySig = '';
    function renderFields(force) {
      var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
      var fieldKeys = Object.keys(sd).filter(function (k) { return k !== 'id'; });
      var keySig = fieldKeys.sort().join('|');
      if (!force && keySig === lastKeySig && fieldsWrap.children.length > 0) return;
      lastKeySig = keySig;
      Array.from(fieldsWrap.children).forEach(function (c) { try { ui.dispose(c); } catch (_) {} });
      GDE.clear(fieldsWrap);
      fieldKeys.forEach(function (k) { fieldsWrap.appendChild(buildFieldRow(k)); });
      var addBtn = ui.button({
        kind: 'ghost', size: 'sm', text: '+ Add field',
        onClick: function (ev) { openFieldPicker(ev.currentTarget); },
      });
      addBtn.classList.add('gde-tm-add-field');
      fieldsWrap.appendChild(addBtn);
    }

    // The set of "override-shaped" rows mirrors TypeConfig's schema 1:1,
    // minus the identity keys. Single source of truth lives in
    // src/typeconfig/schema.js (window.TypeDefSchema).
    function overridableKeys() {
      var all = Object.keys(TypeDefSchema.build());
      var identity = TypeDefSchema.IDENTITY_KEYS;
      return all.filter(function (k) { return identity.indexOf(k) < 0; });
    }

    function buildFieldRow(fieldName) {
      // Look up the *type* this field uses (struct_def[field].type), not
      // the field name itself, against the type registry. The pre-1.3
      // code did `tc[fieldName]` and so painted "unknown type" on every
      // row �?fields rarely share names with registered types.
      var tc = ui.getTypeConfig();
      var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
      var fd = sd[fieldName] || {};
      var typeKey = fd.type || ''; 
      var def = typeKey ? tc[typeKey] : null;
      var known = !!def;

      var row = ui.h('div', 'gde-tm-field' + (known ? '' : ' is-unknown'));
      var head = ui.h('div', 'gde-tm-field-head');
      var caret = ui.h('span', 'gde-tm-caret', { text: '>' });
      var nameEl = ui.h('span', 'gde-tm-field-name', { text: fieldName });
      var typeEl = ui.h('span', 'gde-tm-field-type', {
        text: known ? ((def.base_type || '?') + ' / ' + (def.type_render || '?')) : 'unknown type',
      });
      var delBtn = ui.iconButton({
        icon: 'trash', title: 'Delete field', size: 'sm', kind: 'ghost',
        onClick: function () { deleteField(fieldName); },
      });
      head.appendChild(caret); head.appendChild(nameEl);
      head.appendChild(typeEl); head.appendChild(delBtn);
      row.appendChild(head);

      // Row header gets a "has-override" class (�?orange name) when any
      // non-identity TypeDef key is overridden. Reactive so Merge /
      // unlock / revert updates the color live without a full rebuild.
      var overridableKeySet = overridableKeys();
      var stopHeadTint = EF.effect(function () {
        var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
        var o = sd[fieldName] || {};
        var overridden = overridableKeySet.some(function (k) { return k in o; });
        EF.untracked(function () { row.classList.toggle('has-override', overridden); });
      });
      ui.collect(row, stopHeadTint);

      var body = ui.h('div', 'gde-tm-field-body');
      body.style.display = 'none';
      row.appendChild(body);

      var expanded = false, bodyMounted = false;
      head.addEventListener('click', function (ev) {
        if (delBtn.contains(ev.target)) return;
        expanded = !expanded;
        caret.textContent = expanded ? 'v' : '>';
        row.classList.toggle('is-expanded', expanded);
        body.style.display = expanded ? '' : 'none';
        if (expanded && !bodyMounted) {
          bodyMounted = true;
          body.appendChild(known
            ? buildOverrideEditor(fieldName, def)
            : ui.h('div', 'gde-tm-unknown-hint', {
                text: 'Field "' + fieldName + '" uses unknown type "' + (typeKey || '(none)') + '". '
                    + 'Pick a registered TypeConfig entry for this field.',
              }));
        }
      });
      return row;
    }

    // Override editor �?mirrors TypeConfig's 7-row schema exactly:
    //   �?key / name / base_type �?always read-only, no action button
    //   �?type_render / default / mem / type_agv �?overridable via lock/revert
    //
    // Each row uses `ui.editorFor` so enum rows render as proper selects
    // (base_type, type_render), matching the TypeConfig panel visually.
    function buildOverrideEditor(fieldName, typeDef) {
      var schema = TypeDefSchema.build(typeDef.base_type || 'string');
      var identity = TypeDefSchema.IDENTITY_KEYS;
      var editor = ui.h('div', 'gde-tm-override-editor');
      Object.keys(schema).forEach(function (sub) {
        editor.appendChild(identity.indexOf(sub) >= 0
          ? buildIdentityRow(fieldName, sub, schema[sub], typeDef)
          : buildOverridableSubRow(fieldName, sub, schema[sub], typeDef));
      });
      return editor;
    }

    // Stringified form of a typeDef[sub] value for the editor component.
    // `default` and `type_agv` carry JSON-shaped values in struct_def but
    // are edited as text, so we pre-stringify / post-parse through JSON.
    function isJsonSub(sub) { return sub === 'default' || sub === 'type_agv'; }
    function subToStr(sub, v) {
      if (v === undefined || v === null) return '';
      return isJsonSub(sub) ? JSON.stringify(v) : String(v);
    }

    function buildIdentityRow(fieldName, sub, fieldDef, typeDef) {
      var row = ui.h('div', 'gde-tm-override-row is-identity');
      row.appendChild(ui.h('span', 'gde-tm-override-label', { text: sub }));
      var cell = ui.h('span', 'gde-tm-override-cell');
      var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
      var val  = (sub === 'key') ? ((sd[fieldName] || {}).type || fieldName) : typeDef[sub];
      var sig  = EF.signal(subToStr(sub, val));
      var editorEl = ui.editorFor(fieldDef, sig, function () {}, {});
      editorEl.classList.add('gde-tm-override-component');
      cell.appendChild(editorEl);
      row.appendChild(cell);
      return row;
    }

    function buildOverridableSubRow(fieldName, sub, fieldDef, typeDef) {
      var row = ui.h('div', 'gde-tm-override-row');
      row.appendChild(ui.h('span', 'gde-tm-override-label', { text: sub }));
      var cell = ui.h('span', 'gde-tm-override-cell');

      var jsonSub = isJsonSub(sub);
      function inheritedStr() { return subToStr(sub, typeDef[sub]); }
      function readOverride() {
        var o = (State.tableMap()[pathKey] || {}).struct_def[fieldName] || {};
        return (sub in o) ? { value: o[sub] } : null;
      }

      // Editor signal �?kept in sync with the displayed value (inherited
      // or override). Writes from the component are commit-only when we're
      // in override state; the effect below reconciles the signal after
      // each struct_def mutation.
      var vSig = EF.signal(inheritedStr());
      var editorEl = ui.editorFor(fieldDef, vSig, function (nv) {
        var sd = State.tableMap()[pathKey].struct_def || {};
        var o  = sd[fieldName] || {};
        if (!(sub in o)) return;               // inherited �?writes ignored
        var parsed = nv;
        if (jsonSub) {
          if (String(nv) === '') { revert(); return; }  // empty JSON �?revert
          try { parsed = JSON.parse(nv); } catch (_) { return; }
        } else if (String(nv) === '') {
          revert(); return;                     // empty text �?revert
        }
        var patch = Object.assign({}, o); patch[sub] = parsed;
        var next  = Object.assign({}, sd); next[fieldName] = patch;
        State.updateStructDef(pathKey, next);
      }, {});
      editorEl.classList.add('gde-tm-override-component');
      cell.appendChild(editorEl);

      function unlock() {
        var sd = State.tableMap()[pathKey].struct_def || {};
        var patch = Object.assign({}, sd[fieldName] || {});
        // Seed override with a value the resolver can round-trip.
        patch[sub] = jsonSub
          ? (typeDef[sub] !== undefined ? typeDef[sub] : (sub === 'type_agv' ? {} : ''))
          : (typeDef[sub] != null ? String(typeDef[sub]) : '');
        var next = Object.assign({}, sd); next[fieldName] = patch;
        State.updateStructDef(pathKey, next);
        setTimeout(function () {
          var input = editorEl.querySelector('input,select,textarea');
          if (input) { input.focus(); if (input.select) input.select(); }
        }, 0);
      }
      function revert() {
        var sd = State.tableMap()[pathKey].struct_def || {};
        var patch = Object.assign({}, sd[fieldName] || {});
        delete patch[sub];
        var next = Object.assign({}, sd); next[fieldName] = patch;
        State.updateStructDef(pathKey, next);
      }

      var lockBtn = ui.iconButton({
        icon: 'edit', title: 'Override this value',
        size: 'sm', kind: 'ghost', onClick: unlock,
      });
      var revertBtn = ui.iconButton({
        icon: 'x', title: 'Revert to inherited',
        size: 'sm', kind: 'ghost', onClick: revert,
      });
      lockBtn.classList.add('gde-tm-override-action');
      revertBtn.classList.add('gde-tm-override-action');
      cell.appendChild(lockBtn); cell.appendChild(revertBtn);
      row.appendChild(cell);

      // Reactive paint. The editor component itself (via ui.input / ui.select)
      // already avoids clobbering a focused input when its value signal
      // changes, so we can just push the current display value here.
      var stop = EF.effect(function () {
        var ov = readOverride();
        var overridden = !!ov;
        EF.untracked(function () {
          row.classList.toggle('is-overridden', overridden);
          row.classList.toggle('is-inherited',  !overridden);
          lockBtn.style.display   = overridden ? 'none' : '';
          revertBtn.style.display = overridden ? '' : 'none';
          vSig.set(overridden ? subToStr(sub, ov.value) : inheritedStr());
        });
      });
      ui.collect(row, stop);

      return row;
    }

    function deleteField(fieldName) {
      EF.ui.confirm({
        title: 'Delete field',
        message: 'Remove "' + fieldName + '" from table "' + pathKey + '"? Existing entity data for this field will remain untouched until you run Fix format.',
        okLabel: 'Delete', danger: true,
      }).then(function (ok) {
        if (!ok) return;
        var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
        var next = Object.assign({}, sd); delete next[fieldName];
        State.updateStructDef(pathKey, next);
      });
    }

    // ── Add field popover picker ───────────────────────────
    function openFieldPicker(anchor) {
      var tc = ui.getTypeConfig();
      var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
      var available = Object.keys(tc).filter(function (k) { return !(k in sd); }).sort();
      if (!available.length) {
        State.log('info', 'No more type_config entries to add. Define a new one in TypeConfig first.');
        return;
      }
      var container = ui.h('div', 'gde-tm-picker');
      var input = ui.h('input', 'gde-tm-picker-input', { type: 'text', placeholder: 'Field name...' });
      var listEl = ui.h('div', 'gde-tm-picker-list');
      container.appendChild(input); container.appendChild(listEl);
      var candidates = [], focusIdx = 0, pop = null;

      function rebuild() {
        var q = input.value.trim().toLowerCase();
        candidates = available.filter(function (k) { return !q || k.toLowerCase().indexOf(q) >= 0; }).slice(0, 50);
        focusIdx = 0;
        paint();
      }
      function paint() {
        GDE.clear(listEl);
        if (!candidates.length) {
          listEl.appendChild(ui.h('div', 'gde-tm-picker-empty', { text: 'No matches' }));
          return;
        }
        var q = input.value.trim();
        candidates.forEach(function (c, i) {
          var row = ui.h('div', 'gde-tm-picker-row' + (i === focusIdx ? ' is-focused' : ''));
          row.appendChild(hl(c, q));
          var info = ui.h('span', 'gde-tm-picker-type', { text: (tc[c].base_type || '?') });
          row.appendChild(info);
          row.addEventListener('mousedown', function (ev) { ev.preventDefault(); commit(c); });
          row.addEventListener('mouseenter', function () { focusIdx = i; refreshFocus(); });
          listEl.appendChild(row);
        });
      }
      function refreshFocus() {
        Array.from(listEl.children).forEach(function (r, i) { r.classList.toggle('is-focused', i === focusIdx); });
      }
      function hl(text, q) {
        var frag = document.createDocumentFragment();
        var s = String(text == null ? '' : text);
        if (!q) { frag.appendChild(document.createTextNode(s)); return frag; }
        var low = s.toLowerCase(), qL = q.toLowerCase();
        var i = 0;
        while (i < s.length) {
          var hit = low.indexOf(qL, i);
          if (hit < 0) { frag.appendChild(document.createTextNode(s.slice(i))); break; }
          if (hit > i) frag.appendChild(document.createTextNode(s.slice(i, hit)));
          var m = document.createElement('mark'); m.className = 'gde-tm-picker-hit';
          m.textContent = s.slice(hit, hit + q.length);
          frag.appendChild(m);
          i = hit + q.length;
        }
        return frag;
      }
      function commit(key) {
        var sd = (State.tableMap()[pathKey] || {}).struct_def || {};
        var next = Object.assign({}, sd); next[key] = { type: key };
        State.updateStructDef(pathKey, next);
        close();
      }
      function close() { if (pop) { pop.close(); pop = null; } }
      input.addEventListener('input', rebuild);
      input.addEventListener('keydown', function (ev) {
        if      (ev.key === 'ArrowDown') { focusIdx = Math.min(focusIdx + 1, candidates.length - 1); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'ArrowUp')   { focusIdx = Math.max(focusIdx - 1, 0); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'Enter')     { if (candidates[focusIdx]) commit(candidates[focusIdx]); ev.preventDefault(); }
        else if (ev.key === 'Escape')    { close(); ev.preventDefault(); }
      });
      rebuild();
      pop = ui.popover({
        anchor: anchor, content: container,
        side: 'bottom', align: 'start',
        onDismiss: function () { pop = null; },
      });
      setTimeout(function () { input.focus(); }, 0);
    }

    // ── Tools row ───────────────────────────────────────────
    var tools = ui.h('div', 'gde-tm-tools');
    tools.appendChild(ui.button({ size: 'sm', text: 'Check format',      onClick: function () { State.checkTableData(pathKey); } }));
    tools.appendChild(ui.button({ size: 'sm', text: 'Fix format',        onClick: function () { openFixConfirm(); } }));
    tools.appendChild(ui.button({ size: 'sm', text: 'Merge to TypeConfig', onClick: function () { openMergeConfirm(); } }));
    var delBtn = ui.button({ size: 'sm', kind: 'danger', text: 'Delete table', onClick: function () { handleDeleteTable(); } });
    delBtn.classList.add('gde-tm-tools-delete');
    tools.appendChild(delBtn);
    root.appendChild(tools);

    function openMergeConfirm() {
      var p = State.previewMergeStructDef(pathKey);
      var total = p.pushed.length + p.cleared.length + p.skipped.length;
      if (!total || (p.pushed.length === 0 && p.cleared.length === 0)) {
        State.log('info', 'Merge: "' + pathKey + '" already normalized - nothing to do');
        State.showLogPanel();
        return;
      }
      var body = ui.h('div', 'gde-tm-merge-preview');
      body.appendChild(ui.h('div', 'gde-tm-merge-line',
        { text: 'Push to TypeConfig (' + p.pushed.length + '): ' + (p.pushed.join(', ') || '-') }));
      body.appendChild(ui.h('div', 'gde-tm-merge-line',
        { text: 'Clear overrides (' + p.cleared.length + '): ' + (p.cleared.join(', ') || '-') }));
      body.appendChild(ui.h('div', 'gde-tm-merge-line gde-tm-merge-skip',
        { text: 'Already consistent (' + p.skipped.length + '): ' + (p.skipped.join(', ') || '-') }));
      var footer = ui.h('div', null, { style: 'display:flex;gap:6px;justify-content:flex-end;' });
      var cancelBtn = ui.button({ text: 'Cancel', onClick: function () { m.close(); } });
      var applyBtn = ui.button({
        text: 'Apply', kind: 'primary',
        onClick: function () { State.mergeStructDef(pathKey); m.close(); },
      });
      footer.appendChild(cancelBtn); footer.appendChild(applyBtn);
      var m = ui.modal({
        title:   'Merge "' + pathKey + '" struct_def into TypeConfig',
        content: body,
        footer:  footer,
      });
    }

    function openFixConfirm() {
      var plan = State.previewFixTable(pathKey);
      if (!plan.length) {
        State.log('info', 'Fix: table "' + pathKey + '" already matches struct_def');
        State.showLogPanel();
        return;
      }
      var body = ui.h('div', 'gde-tm-fix-preview');
      var summary = ui.h('div', 'gde-tm-fix-summary', {
        text: plan.length + ' change' + (plan.length === 1 ? '' : 's') + ' planned:',
      });
      body.appendChild(summary);
      var list = ui.h('div', 'gde-tm-fix-list');
      plan.slice(0, 200).forEach(function (c) {
        var line = ui.h('div', 'gde-tm-fix-line');
        var badge = ui.h('span', 'gde-tm-fix-badge gde-tm-fix-' + c.kind, { text: c.kind });
        var text = c.kind === 'set'
          ? (c.id + ' �� ' + c.field + ' -> ' + JSON.stringify(c.value) + '  (' + c.reason + ')')
          : (c.id + ' �� ' + c.field + '  (extra)');
        line.appendChild(badge);
        line.appendChild(document.createTextNode(' ' + text));
        list.appendChild(line);
      });
      if (plan.length > 200) {
        list.appendChild(ui.h('div', 'gde-tm-fix-line', { text: '... and ' + (plan.length - 200) + ' more' }));
      }
      body.appendChild(list);
      var footer = ui.h('div', null, { style: 'display:flex;gap:6px;justify-content:flex-end;' });
      var cancelBtn = ui.button({ text: 'Cancel', onClick: function () { m.close(); } });
      var applyBtn = ui.button({
        text: 'Apply ' + plan.length + ' change' + (plan.length === 1 ? '' : 's'),
        kind: 'primary',
        onClick: function () {
          var res = State.applyFixes(pathKey, plan);
          State.log('info', 'Fix: table "' + pathKey + '" - changed ' + res.changed + ' of ' + res.total + ' entities');
          State.showLogPanel();
          m.close();
        },
      });
      footer.appendChild(cancelBtn); footer.appendChild(applyBtn);
      var m = ui.modal({
        title:   'Fix table "' + pathKey + '"?',
        content: body,
        footer:  footer,
      });
    }

    function handleDeleteTable() {
      var n = ((State.tableMap()[pathKey] || {}).id || []).length;
      EF.ui.confirm({
        title:   'Delete table',
        message: 'Delete table "' + pathKey + '" and all its ' + n + ' entities?',
        okLabel: 'Delete', danger: true,
      }).then(function (ok) {
        if (!ok) return;
        State.deleteTable(pathKey);
        State.setSelection(null);
        State.log('warn', 'Deleted table: ' + pathKey);
      });
    }

    // React to external mutations.
    //   tables:changed     �?goes through key-set guard (only rebuilds when
    //                        the field set actually changed; per-value
    //                        edits keep the existing DOM and let the
    //                        per-row effects reconcile)
    //   typeconfig:changed �?forces a rebuild: the field set is the same
    //                        but each row's `known` status (and the
    //                        "type · type_render" summary text) depends
    //                        on what's in TypeConfig. Merge, in particular,
    //                        makes previously-unknown fields known without
    //                        touching the struct_def key set.
    ctx.bus.on('tables:changed',     function () { renderFields(false); });
    ctx.bus.on('typeconfig:changed', function () { renderFields(true);  });
    renderFields();
    return root;
  }


})();
