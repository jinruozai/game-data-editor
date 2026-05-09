/**
 * Inspector panel �?schema-driven property editor for whatever the current
 * selection points at. Knows nothing about specific selection kinds. Each
 * kind registers its own provider via `Inspector.registerKind(kind, cfg)`.
 * Adding a new kind is a one-line register call �?Inspector stays
 * untouched.
 *
 * Provider shape:
 *   title(sel):              string                 header text
 *   schema(sel):             struct_def-shaped obj  drives propertyPanel rows
 *   value(sel):              plain object           current value
 *   targets(sel):            plain object[]         optional batch-edit values
 *   onChange(sel,field,nv):  void                   persistence
 *   dataTopic(sel)?:         string | null          bus topic watched for refresh
 */
(function () {
  'use strict';

  var ui = EF.ui;

  function isExternalAssetUrl(value) {
    return /^(https?:|data:|blob:)/i.test(String(value || ''));
  }

  function resolveAssetPreview(value) {
    if (!value) return '';
    if (ProjectIO.assets.isAssetUrl(value)) return ProjectIO.assets.urlFor(value);
    return isExternalAssetUrl(value) ? String(value) : '';
  }

  function assetValueExists(value) {
    if (!value) return true;
    if (ProjectIO.assets.isAssetUrl(value)) return ProjectIO.assets.exists(value);
    return isExternalAssetUrl(value);
  }

  function registerAssetRenderers() {
    function assetRenderer(kind, accept) {
      return function (args) {
        var agv = args.fieldDef.type_agv || {};
        return ui.assetPicker({
          value: args.sig,
          onChange: args.write,
          kind: kind,
          accept: agv.accept || accept,
          placeholder: agv.placeholder || agv.suffix || '',
          resolveSrc: resolveAssetPreview,
          exists: assetValueExists,
          onFile: function (file) {
            return ProjectIO.assets.importFile(file, kind, {
              mode: 'property',
              kind: kind,
              field: args.ctx && args.ctx.field,
              selection: args.ctx && args.ctx.selectionSig ? args.ctx.selectionSig.peek() : null,
            });
          },
        });
      };
    }
    ui.registerRenderer('img', assetRenderer('image', '.png,.jpg,.jpeg,.gif,.webp'));
    ui.registerRenderer('snd', assetRenderer('audio', '.mp3,.wav,.ogg'));
  }
  registerAssetRenderers();

  // Project-specific ref_id renderer.
  //
  // Display: shows the target entity name, with an optional icon before it.
  // Text comes from id.ref_name (default: name, falling back to id). Icon
  // comes from id.ref_icon (default: icon) only when that field exists and
  // resolves to a renderable asset URL.
  //
  // Edit: clicking the field opens a popover picker - text input + a
  // filtered list of `<id> : <ref_name>` rows, with typed substring
  // highlighted. Up/down / Enter / Esc / click-to-commit. Supports id or
  // ref_name matching.
  //
  // Drop target: accepts `application/ef.entity+json` dragged from the
  // left-side tree (or any source that emits that MIME), committing the
  // dropped entity's id.
  ui.registerRenderer('ref_id', function (args) {
    var sig = args.sig;
    var write = args.write;

    var root = ui.h('div', 'gde-refid');
    root.tabIndex = 0;
    root.title = 'Edit reference';
    var face = ui.h('div', 'gde-refid-face');
    var gotoBtn = ui.iconButton({
      icon: 'arrow-right', title: 'Go to target', size: 'sm', kind: 'ghost',
      onClick: function (ev) {
        if (ev) ev.stopPropagation();
        var id = sig.peek();
        if (id == null || id === 0) return;
        var info = State.resolveEntityDisplay(id);
        if (!info) { State.log('warn', 'Cannot jump: id ' + id + ' not found'); return; }
        // resolveEntityDisplay doesn't expose pathKey �?redo the lookup
        // once here (the only place that actually needs it).
        var tm = State.tableMap(), sid = String(id), pk = null;
        Object.keys(tm).some(function (k) { if ((tm[k].id || []).indexOf(sid) >= 0) { pk = k; return true; } return false; });
        if (pk) EF.bus.emit('nav:goto', { pathKey: pk, id: sid });
      },
    });
    root.appendChild(face); root.appendChild(gotoBtn);
    root.addEventListener('click', function () { openPicker(); });
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { openPicker(); ev.preventDefault(); }
    });

    // Paint the display face. Re-runs on signal change + gameData change
    // (so e.g. renaming the target entity updates the face live).
    var faceCleanup = null;
    GDE.effect(root, function () {
      State.gameData();                             // subscribe
      var id = sig();
      if (faceCleanup) { try { faceCleanup() } catch (_) {} faceCleanup = null; }
      GDE.clear(face);
      if (id == null || id === '' || id === 0) {
        face.textContent = '(none)';
        face.classList.add('is-empty');
        return;
      }
      face.classList.remove('is-empty');
      var info = State.resolveEntityDisplay(id);
      var name = info ? info.name : String(id);
      var iconUrl = info && info.icon ? resolveAssetPreview(info.icon) : '';
      if (iconUrl) {
        var img = ui.h('img', 'gde-refid-icon');
        img.src = iconUrl;
        img.alt = '';
        face.appendChild(img);
      }
      face.appendChild(ui.h('span', 'gde-refid-name', { text: name }));
    });

    // Drop target �?accept dragged entities or plain-text ids.
    ui.dropzone(root, {
      accept: ['application/ef.entity+json', 'text/plain'],
      canDrop: function (d) { return !!(d.entity && d.entity.id != null) || !!(d.text && /^\d+$/.test(String(d.text))); },
      onDrop: function (d) {
        var nid = (d.entity && d.entity.id != null) ? d.entity.id : d.text;
        commit(nid);
      },
    });

    function commit(id) {
      var n = Number(id);
      write(Number.isFinite(n) && String(n).length === String(id).length ? n : String(id));
    }

    // ── Picker popover ──────────────────────────────────────────
    var pop = null;
    function openPicker() {
      if (pop) return;
      var container = ui.h('div', 'gde-refid-picker');
      var input = ui.h('input', 'gde-refid-picker-input', { type: 'text' });
      input.value = String(sig.peek() == null ? '' : sig.peek());
      var listEl = ui.h('div', 'gde-refid-picker-list');
      container.appendChild(input); container.appendChild(listEl);

      var candidates = [];
      var focusIdx = 0;

      function rebuild() {
        var q = input.value.trim();
        var qLow = q.toLowerCase();
        var gd = State.gameData();
        var hits = [];
        Object.keys(gd).forEach(function (sid) {
          var info = State.resolveEntityDisplay(sid);
          if (!info) return;
          var label = info.name;
          if (!q
            || sid.toLowerCase().indexOf(qLow) >= 0
            || (label && label.toLowerCase().indexOf(qLow) >= 0)) {
            hits.push({ id: sid, label: label, icon: info.icon });
          }
        });
        candidates = hits.slice(0, 50);
        focusIdx = 0;
        paint();
      }
      function paint() {
        GDE.clear(listEl);
        if (!candidates.length) {
          var empty = ui.h('div', 'gde-refid-picker-empty', { text: 'No matches' });
          listEl.appendChild(empty); return;
        }
        var q = input.value.trim();
        candidates.forEach(function (c, i) {
          var row = ui.h('div', 'gde-refid-picker-row');
          if (i === focusIdx) row.classList.add('is-focused');
          var iconUrl = c.icon ? resolveAssetPreview(c.icon) : '';
          if (iconUrl) {
            var icon = ui.h('img', 'gde-refid-icon');
            icon.src = iconUrl;
            icon.alt = '';
            row.appendChild(icon);
          }
          row.appendChild(mark(c.id, q));
          row.appendChild(ui.h('span', 'gde-refid-picker-sep', { text: ' : ' }));
          row.appendChild(mark(c.label, q));
          row.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            commit(c.id); close();
          });
          row.addEventListener('mouseenter', function () {
            focusIdx = i;
            refreshFocus();
          });
          listEl.appendChild(row);
        });
      }
      function refreshFocus() {
        Array.from(listEl.children).forEach(function (r, i) {
          r.classList.toggle('is-focused', i === focusIdx);
        });
        var el = listEl.children[focusIdx];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }
      function mark(text, q) {
        var frag = document.createDocumentFragment();
        var s = String(text == null ? '' : text);
        if (!q) { frag.appendChild(document.createTextNode(s)); return frag; }
        var low = s.toLowerCase(); var qL = q.toLowerCase();
        var i = 0;
        while (i < s.length) {
          var hit = low.indexOf(qL, i);
          if (hit < 0) { frag.appendChild(document.createTextNode(s.slice(i))); break; }
          if (hit > i) frag.appendChild(document.createTextNode(s.slice(i, hit)));
          var m = document.createElement('mark'); m.className = 'gde-refid-picker-hit';
          m.textContent = s.slice(hit, hit + q.length);
          frag.appendChild(m);
          i = hit + q.length;
        }
        return frag;
      }
      input.addEventListener('input', rebuild);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { focusIdx = Math.min(focusIdx + 1, candidates.length - 1); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'ArrowUp')   { focusIdx = Math.max(focusIdx - 1, 0); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'Enter')     {
          if (candidates[focusIdx]) { commit(candidates[focusIdx].id); close(); }
          ev.preventDefault();
        }
        else if (ev.key === 'Escape')    { close(); ev.preventDefault(); }
      });

      rebuild();
      pop = ui.popover({
        anchor: root, content: container,
        side: 'bottom', align: 'start',
        onDismiss: function () { pop = null; },
      });
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }
    function close() { if (pop) { pop.close(); pop = null; } }
    ui.collect(root, close);

    return root;
  });

  // ── Kind registry ─────────────────────────────────────────────
  var _kinds = Object.create(null);
  function registerKind(kind, provider) { _kinds[kind] = provider; }

  function createPanel(propsSig, ctx) {
    var props = propsSig.peek() || {};
    var root = document.createElement('div');
    root.className = 'gde-inspector';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:auto;';

    function detachRoot() {
      while (root.firstChild) root.firstChild.remove();
    }

    var header       = document.createElement('div'); header.className  = 'gde-inspector-header';
    var titleEl      = document.createElement('div'); titleEl.className = 'gde-name';
    var titleTextEl  = document.createElement('span'); titleEl.appendChild(titleTextEl);
    var roLabel      = document.createElement('span'); roLabel.className = 'gde-inspector-ro-badge';
    roLabel.textContent = 'read-only'; roLabel.hidden = true;
    header.appendChild(titleEl); header.appendChild(roLabel);

    var schemaSig    = EF.signal({});
    var targetsSig   = EF.signal([]);
    var disabledSig  = EF.signal(false);
    var currentOnChange = null;

    var form = ui.propertyPanel({
      schema:   schemaSig,
      targets:  targetsSig,
      disabled: disabledSig,
      onChange: function (field, nv) { if (currentOnChange) currentOnChange(field, nv); },
      ctx:      function (field) { return { source: 'gde-inspector', field: field, selectionSig: State.selection }; },
    });

    function currentFieldTargets(field) {
      return fieldTargetsForSelection(State.selection(), field);
    }

    // Dynamic bus subscription �?the current kind decides which topic should
    // trigger a refresh (e.g., 'data:changed:<pathKey>' for card_data,
    // 'typeconfig:changed' for typeconfig). Swap whenever kind/sel changes.
    var offData = null;
    var dataTopic = null;
    function ensureDataSub(topic) {
      if (topic === dataTopic) return;
      if (offData) { offData(); offData = null; }
      dataTopic = topic;
      if (topic) offData = ctx.bus.on(topic, refresh);
    }

    function renderEmpty() {
      detachRoot();
      var empty = document.createElement('div');
      empty.className = 'gde-inspector-empty';
      var title = document.createElement('div');
      title.style.cssText = 'font-size:var(--ef-fs-md);font-weight:600;margin-bottom:4px;';
      title.textContent = t('inspector.empty_title');
      var hint  = document.createElement('div');
      hint.style.cssText = 'font-size:var(--ef-fs-sm);';
      hint.textContent  = t('inspector.empty_hint');
      empty.appendChild(title); empty.appendChild(hint);
      root.appendChild(empty);
    }

    function renderForm() {
      if (!root.contains(form)) {
        detachRoot();
        root.appendChild(header);
        root.appendChild(form);
      }
      decorateFieldRows(form, schemaSig.peek(), currentFieldTargets);
    }

    // Custom-render path. A kind that declares `render(sel, ctx) -> el`
    // opts out of the propertyPanel pipeline; Inspector mounts the
    // returned element under the header and keeps it alive while the
    // (kind, identity) pair stays the same. Downstream data changes are
    // the custom element's responsibility (its own effects / bus subs).
    var currentCustom = null;
    var currentCustomKey = null;
    // A kind that doesn't fit `pathKey | key | id` (e.g. card_component
    // selects N nodes inside one cardStyle) can supply its own `key(sel)
    // �?string` to drive identity. Without this the dispatcher would
    // collapse every selection of the same kind into a single key, reuse
    // the first-mounted form, and any `rebuild` inside that form would
    // read stale closure state.
    function kindSelKey(sel, kind) {
      if (kind && typeof kind.key === 'function') return sel.kind + ':' + kind.key(sel);
      return sel.kind + ':' + (sel.pathKey || sel.key || sel.id || '');
    }
    function disposeCustom() {
      if (currentCustom) {
        try { ui.dispose(currentCustom); } catch (_) {}
        currentCustom = null;
        currentCustomKey = null;
      }
    }
    function renderCustom(kind, sel) {
      var key = kindSelKey(sel, kind);
      if (key === currentCustomKey && currentCustom) return;  // same selection �?leave mounted
      disposeCustom();
      currentCustomKey = key;
      currentCustom = kind.render(sel, ctx);
      detachRoot();
      root.appendChild(header);
      root.appendChild(currentCustom);
    }

    function clearTitle() {
      Array.from(titleEl.children).forEach(function (c) { try { ui.dispose(c); } catch (_) {} c.remove(); });
      titleTextEl = document.createElement('span');
      titleEl.appendChild(titleTextEl);
    }

    function renderTitle(sel, fallback) {
      clearTitle();
      var refs = sel && sel.kind === 'card_data' ? selectedEntityRefs(sel) : [];
      if (refs.length === 1) {
        var id = refs[0].id;
        titleTextEl.textContent = t('inspector.id_label') + ': ' + id;
        titleEl.appendChild(ui.copyButton({ text: id, title: 'Copy ID', copiedTitle: 'Copied ID', size: 'sm' }));
        return;
      }
      titleTextEl.textContent = fallback;
    }
    function refresh() {
      var sel  = State.selection();
      var kind = sel && _kinds[sel.kind];
      if (!kind) { ensureDataSub(null); disposeCustom(); renderEmpty(); return; }
      ensureDataSub(kind.dataTopic ? kind.dataTopic(sel) : null);
      renderTitle(sel, kind.title(sel));
      var isDisabled = !!(kind.disabled && kind.disabled(sel));
      roLabel.hidden = !isDisabled;
      if (kind.render) {
        disabledSig.set(false);
        renderCustom(kind, sel);
        return;
      }
      disposeCustom();
      // Blur before pushing the new value: the input bind effect skips writes
      // while the input has focus, so propagating the new selection's value
      // first would leave the previous user-typed text stranded in the DOM.
      // Going inert also requires no descendant has focus.
      if (isDisabled && form.contains(document.activeElement)) document.activeElement.blur();
      disabledSig.set(isDisabled);
      schemaSig.set(kind.schema(sel) || {});
      targetsSig.set(kind.targets ? (kind.targets(sel) || []) : [kind.value(sel) || {}]);
      currentOnChange = function (field, nv) { kind.onChange(sel, field, nv, targetsSig.peek()); };
      renderForm();
    }

    function applyLocale() {
      var pt = t('panel.inspector');
      if (ctx.panel && ctx.panel.title() !== pt) ctx.panel.setTitle(pt);
      refresh();
    }
    var offLocale = I18N.onChange(applyLocale);
    ctx.onCleanup(offLocale);
    ctx.bus.on('selection:changed', refresh);
    ctx.bus.on('tables:changed',    refresh);

    applyLocale();
    return root;
  }

  EF.registerComponent('gde-inspector', {
    category: 'panel',
    label: 'Inspector',
    icon: 'settings',
    factory: createPanel,
    defaults: function () { return { title: 'Inspector', props: {} }; },
  });

  // ── Built-in provider: editing an entity in a table ───────────
  registerKind('card_data', {
    title: function (sel) {
      var refs = selectedEntityRefs(sel);
      if (refs.length > 1) {
        var samePath = refs.every(function (r) { return r.pathKey === refs[0].pathKey; });
        return refs.length + ' selected' + (samePath ? ' �� ' + refs[0].pathKey : '');
      }
      var id = refs[0] ? refs[0].id : sel.id;
      return t('inspector.id_label') + ': ' + id;
    },
    schema:    function (sel) { return commonEntitySchema(selectedEntityRefs(sel)); },
    value:     function (sel) { return State.gameData()[sel.id] || {}; },
    targets:   function (sel) {
      var gd = State.gameData();
      return selectedEntityRefs(sel).map(function (ref) { return gd[ref.id] || {}; });
    },
    onChange:  function (sel, field, nv) {
      State.setEntityFieldMany(selectedEntityRefs(sel).map(function (ref) { return ref.id; }), field, nv);
    },
    dataTopic: function (sel) {
      var refs = selectedEntityRefs(sel);
      if (!refs.length) return null;
      var samePath = refs.every(function (r) { return r.pathKey === refs[0].pathKey; });
      return samePath ? 'data:changed:' + refs[0].pathKey : 'data:changed';
    },
  });

  function selectedEntityRefs(sel) {
    if (sel && sel.items && sel.items.length) {
      return sel.items.map(function (it) { return { pathKey: it.pathKey, id: String(it.id) }; });
    }
    var ids = sel && sel.ids && sel.ids.length ? sel.ids : (sel && sel.id != null ? [sel.id] : []);
    return ids.map(function (id) { return { pathKey: sel.pathKey, id: String(id) }; });
  }
  function commonEntitySchema(refs) {
    var tm = State.tableMap();
    if (!refs.length) return {};
    var first = (tm[refs[0].pathKey] || {}).struct_def || {};
    var out = {};
    Object.keys(first).filter(function (field) { return field !== 'id'; }).forEach(function (field) {
      var sig = fieldTypeSignature(first[field]);
      for (var i = 1; i < refs.length; i++) {
        var sd = (tm[refs[i].pathKey] || {}).struct_def || {};
        if (!sd[field] || fieldTypeSignature(sd[field]) !== sig) return;
      }
      out[field] = first[field];
    });
    return out;
  }
  function fieldTypeSignature(def) {
    if (typeof def === 'string') return def;
    return def && typeof def === 'object' ? String(def.type || '') : '';
  }
  function fieldTargetsForSelection(sel, field) {
    if (!sel || sel.kind !== 'card_data' || !window.GDE || !GDE.ai || !GDE.ai.fieldTarget) return [];
    var tm = State.tableMap();
    return selectedEntityRefs(sel).filter(function (ref) {
      var sd = (tm[ref.pathKey] || {}).struct_def || {};
      return Object.prototype.hasOwnProperty.call(sd, field);
    }).map(function (ref) {
      return GDE.ai.fieldTarget(ref.pathKey, ref.id, field);
    });
  }
  function decorateFieldRows(form, schema, targetFn) {
    if (!window.GDE || !GDE.ai || !GDE.ai.bindTarget) return;
    var fields = orderedSchemaFields(schema || {});
    var rows = form.querySelectorAll('.ef-ui-struct-input-row');
    Array.prototype.forEach.call(rows, function (row, i) {
      var field = row.dataset.efFieldKey || fields[i];
      if (!field || !Object.prototype.hasOwnProperty.call(schema || {}, field) || row.dataset.gdeAiField === field) return;
      row.dataset.gdeAiField = field;
      row.title = row.title || t('inspector.field_drag_hint');
      GDE.ai.bindTarget(row, function () { return targetFn(field); }, { draggable: true });
      row.addEventListener('contextmenu', function (ev) {
        var targets = targetFn(field);
        if (!targets.length || !EF.ui || !EF.ui.contextMenu) return;
        ev.preventDefault();
        EF.ui.contextMenu({ x: ev.clientX, y: ev.clientY }, [{
          label: t('common.add_to_chat'),
          icon: 'message-circle',
          onSelect: function () {
            if (GDE.ai && GDE.ai.sendTargetsToAI) {
              GDE.ai.sendTargetsToAI(targets, t('inspector.ask_ai_field_prompt'));
            }
          },
        }]);
      });
    });
  }
  function orderedSchemaFields(schema) {
    var buckets = Object.create(null);
    var seen = [];
    Object.keys(schema || {}).forEach(function (k) {
      var fd = schema[k] || {};
      var tag = fd.group || '';
      if (!buckets[tag]) { buckets[tag] = []; seen.push(tag); }
      buckets[tag].push(k);
    });
    var order = [];
    if (buckets['']) order.push('');
    (ui.PROP_GROUPS || []).forEach(function (g) { if (buckets[g]) order.push(g); });
    seen.forEach(function (g) { if (g && order.indexOf(g) < 0) order.push(g); });
    var out = [];
    order.forEach(function (g) { out = out.concat(buckets[g] || []); });
    return out;
  }
  // ── Built-in provider: editing the table itself ──────────────
  // Uses the `render` escape hatch instead of the propertyPanel
  // pipeline because the form mixes a path input, a dynamic list of
  // field sections, a picker popover, and three action buttons �?
  // none of which fit a flat struct_def schema cleanly.
  registerKind('table_meta', {
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
    // widgets/typeconfig.js (window.TypeDefSchema).
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

  // ── card_style �?edits the cardStyle's own meta (name) ───────────
  // The root node's props are edited via card_component selection on the
  // root id; this kind covers the cardStyle envelope.
  registerKind('card_style', {
    title:    function (sel) { return (State.projectCardStyles()[sel.key] || {}).name || sel.key; },
    schema:   function ()    { return { name: { type: 'string' } }; },
    value:    function (sel) {
      var cs = State.projectCardStyles()[sel.key] || {};
      return { name: cs.name || '' };
    },
    onChange: function (sel, field, nv) {
      var cs = Object.assign({}, State.projectCardStyles()[sel.key] || {});
      cs[field] = nv;
      State.upsertCardStyle(sel.key, cs);
    },
    dataTopic: function () { return 'cardstyles:changed'; },
  });

  // ── card_component �?edits one or more nodes inside a cardStyle ──
  // sel.styleKey + sel.nodeIds[] (length�?). Schema comes from the
  // component's spec.schema; multi-target shows the first selected node's
  // values and writes edits to every selected node.
  registerKind('card_component', {
    title: function (sel) {
      var ids = sel.nodeIds || [];
      if (ids.length > 1) return ids.length + ' components';
      var n = findNodeInStyle(sel.styleKey, ids[0]);
      return n ? n.component : '(missing)';
    },
    // Identity = which cardStyle + which node ids are selected. Without this
    // every card_component selection collapsed to the same key, leaving the
    // first form mounted forever and showing stale schema for newer picks.
    key: function (sel) { return (sel.styleKey || '') + '/' + (sel.nodeIds || []).join(','); },
    render: function (sel, ctx) { return buildComponentPropsForm(sel, ctx); },
    dataTopic: function () { return 'cardstyles:changed'; },
  });

  function findNodeInStyle(styleKey, nodeId) {
    var cs = State.projectCardStyles()[styleKey];
    if (!cs || !cs.root) return null;
    var hit = SceneNode.find(cs.root, nodeId);
    return hit ? hit.node : null;
  }

  // Builds a custom-render component-props panel: schema-driven form +
  // per-prop bind-to-field toggles. Multi-select feeds propertyPanel with
  // all node.props as targets so edits fan out.
  //
  // Critically: the form is built ONCE per selection. propertyPanel takes
  // a `targets` signal and reactively diffs rows when that signal updates
  // �?recreating the form on every keystroke would tear the input out
  // from under the user (focus loss). On cardstyles:changed we just push
  // a fresh targets snapshot; bindings UI is rebuilt because its
  // dropdowns are simple commit-on-click controls with no focus concern.
  function buildComponentPropsForm(sel, panelCtx) {
    var root = ui.h('div', 'gde-cs-comp-form');
    var styleKey = sel.styleKey;
    var ids = sel.nodeIds || [];

    var initial = ids.map(function (id) { return findNodeInStyle(styleKey, id); }).filter(Boolean);
    if (!initial.length) {
      root.appendChild(ui.h('div', 'gde-inspector-empty', { text: '(no node)' }));
      return root;
    }
    var firstComponent = initial[0].component;
    if (initial.some(function (n) { return n.component !== firstComponent; })) {
      root.appendChild(ui.h('div', 'gde-inspector-empty', {
        text: 'Selection has different component types - pick a single kind to edit.',
      }));
      return root;
    }
    var spec; try { spec = EF.resolveComponent(firstComponent); } catch (_) { return root; }
    var schema = spec.schema || {};
    var bindable = spec.bindable || [];

    var targetsSig = EF.signal(initial.map(function (n) { return n.props || {}; }));

    var form = ui.propertyPanel({
      schema:   schema,
      targets:  targetsSig,
      defaults: spec.defaultProps || null,
      ctx:      function (field) { return { source: 'gde-cardstyle', field: field, selectionSig: State.selection }; },
      onChange: function (field, nv) {
        mutateNodes(styleKey, ids, function (node) {
          node.props = Object.assign({}, node.props || {});
          node.props[field] = nv;
          // Editing a literal value clears any binding on this prop.
          if (node.bindings && node.bindings[field]) {
            node.bindings = Object.assign({}, node.bindings);
            delete node.bindings[field];
          }
        });
      },
    });
    root.appendChild(form);

    // Layout editor (single-selection only �?layout is per-node). Shown when this node lives
    // inside an absolute parent (i.e. has a LayoutRect).
    var layoutSig = null;
    var parentSizeSig = null;
    if (ids.length === 1 && initial[0].layout) {
      layoutSig = EF.signal(initial[0].layout);
      parentSizeSig = EF.signal(State.cardStyleRootSize(styleKey));
      root.appendChild(ui.h('div', 'gde-cs-bindings-head', { text: 'Layout' }));
      var pickerBox = ui.h('div', 'gde-cs-layout');
      pickerBox.appendChild(ui.anchorPicker({
        value: layoutSig,
        parentSize: parentSizeSig,
        onChange: function (next) {
          layoutSig.set(next);
          mutateNodes(styleKey, ids, function (n) { n.layout = next; });
        },
      }));
      root.appendChild(pickerBox);
    }

    var bindingsBox = null;
    if (bindable.length) {
      root.appendChild(ui.h('div', 'gde-cs-bindings-head', { text: 'Bindings' }));
      bindingsBox = ui.h('div', 'gde-cs-bindings');
      root.appendChild(bindingsBox);
    }
    function refreshBindings() {
      if (!bindingsBox) return;
      GDE.clear(bindingsBox);
      bindable.forEach(function (key) { bindingsBox.appendChild(buildBindingRow(key)); });
    }
    refreshBindings();

    panelCtx.bus.on('cardstyles:changed', function () {
      var nodes = ids.map(function (id) { return findNodeInStyle(styleKey, id); }).filter(Boolean);
      if (!nodes.length) return;
      targetsSig.set(nodes.map(function (n) { return n.props || {}; }));
      refreshBindings();
      // Keep the layout picker in sync with WYSIWYG drag/resize commits.
      if (layoutSig && nodes[0].layout) layoutSig.set(nodes[0].layout);
      if (parentSizeSig) parentSizeSig.set(State.cardStyleRootSize(styleKey));
    });

    // Build one binding row. Multi-select shows the first selected node's
    // binding; picking a value overwrites every selected node.
    function buildBindingRow(propKey) {
      var row = ui.h('div', 'gde-cs-binding-row');
      row.appendChild(ui.h('span', 'gde-cs-binding-key', { text: propKey }));

      var fieldsForSelect = collectAvailableFields();
      var sig = EF.signal(firstBindingValue(propKey));
      var options = [{ value: '', label: '(literal)' }];
      fieldsForSelect.forEach(function (f) { options.push({ value: f, label: f }); });

      var sel = ui.combobox({
        value: sig,
        options: options,
        placeholder: 'Search fields...',
        onChange: function (v) {
          mutateNodes(styleKey, ids, function (n) {
            n.bindings = Object.assign({}, n.bindings || {});
            if (!v) delete n.bindings[propKey];
            else n.bindings[propKey] = { source: 'field', field: v };
          });
        },
      });
      row.appendChild(sel);
      return row;
    }
    function firstBindingValue(propKey) {
      var n = findNodeInStyle(styleKey, ids[0]);
      return (n && n.bindings && n.bindings[propKey] && n.bindings[propKey].field) || '';
    }
    function collectAvailableFields() {
      // Union of every table's struct_def field names �?cardStyles aren't
      // bound to a specific struct, but offering "any field name we know
      // about" is useful guidance.
      var s = new Set();
      var tm = State.tableMap();
      Object.keys(tm).forEach(function (pk) {
        var sd = tm[pk].struct_def || {};
        Object.keys(sd).forEach(function (k) { s.add(k); });
      });
      // Always offer 'id' (every entity has one).
      s.add('id');
      return Array.from(s).sort();
    }
    function mutateNodes(styleKey, ids, fn) {
      State.mutateCardStyle(styleKey, function (clone) {
        ids.forEach(function (id) {
          var hit = SceneNode.find(clone.root, id);
          if (hit) fn(hit.node);
        });
      });
    }

    return root;
  }

  // Public API �?other widgets teach the Inspector about their selection kinds.
  window.Inspector = { registerKind: registerKind };
})();




