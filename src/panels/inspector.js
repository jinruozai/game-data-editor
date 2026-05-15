/**
 * Inspector panel - generic schema-driven property editor.
 *
 * This file only owns the Inspector shell and provider registry. Project-specific
 * renderers and selection providers live in src/inspector/** so the shell can be
 * reused by other EditorFrame apps.
 *
 * Provider shape:
 *   title(sel):              string
 *   schema(sel):             struct_def-shaped object
 *   value(sel):              plain object
 *   targets(sel):            plain object[]
 *   onChange(sel,field,nv):  void
 *   dataTopic(sel)?:         string | null
 *   render(sel,ctx)?:        HTMLElement
 *   key(sel)?:               string
 *   copyText(sel)?:          string
 *   fieldTargets(sel,field)?: AI target[]
 */
(function () {
  'use strict';

  var ui = EF.ui;

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
    var currentFieldTargets = null;

    var form = ui.propertyPanel({
      schema:   schemaSig,
      targets:  targetsSig,
      disabled: disabledSig,
      onChange: function (field, nv) { if (currentOnChange) currentOnChange(field, nv); },
      ctx:      function (field) { return { source: 'gde-inspector', field: field, selectionSig: State.selection }; },
    });

    function fieldTargetsForCurrentSelection(field) {
      return currentFieldTargets ? currentFieldTargets(field) : [];
    }

    // Dynamic bus subscription: the current kind decides which topic should
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
      decorateFieldRows(form, schemaSig.peek(), fieldTargetsForCurrentSelection);
    }

    // Custom-render path. A kind that declares `render(sel, ctx) -> el`
    // opts out of the propertyPanel pipeline; Inspector mounts the
    // returned element under the header and keeps it alive while the
    // (kind, identity) pair stays the same. Downstream data changes are
    // the custom element's responsibility (its own effects / bus subs).
    var currentCustom = null;
    var currentCustomKey = null;
    // A kind that doesn't fit `pathKey | key | id` (e.g. card_component
    // selects N nodes inside one cardStyle) can supply its own `key(sel)` string
    // to drive identity. Without this the dispatcher would
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
      if (key === currentCustomKey && currentCustom) return; // same selection: leave mounted
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

    function renderTitle(sel, kind, fallback) {
      clearTitle();
      titleTextEl.textContent = fallback;
      var copyText = kind && typeof kind.copyText === 'function' ? kind.copyText(sel) : '';
      if (copyText) {
        titleEl.appendChild(ui.copyButton({ text: copyText, title: 'Copy ID', copiedTitle: 'Copied ID', size: 'sm' }));
      }
    }
    function refresh() {
      var sel  = State.selection();
      var kind = sel && _kinds[sel.kind];
      if (!kind) {
        currentOnChange = null;
        currentFieldTargets = null;
        ensureDataSub(null);
        disposeCustom();
        renderEmpty();
        return;
      }
      ensureDataSub(kind.dataTopic ? kind.dataTopic(sel) : null);
      renderTitle(sel, kind, kind.title(sel));
      var isDisabled = !!(kind.disabled && kind.disabled(sel));
      roLabel.hidden = !isDisabled;
      currentFieldTargets = kind.fieldTargets ? function (field) { return kind.fieldTargets(sel, field); } : null;
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


  // Public API - project modules teach the Inspector about their selection kinds.
  window.Inspector = { registerKind: registerKind };
})();
