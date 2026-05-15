/**
 * GameDataEditor Inspector providers for cardStyle metadata and components.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // ── card_style �?edits the cardStyle's own meta (name) ───────────
  // The root node's props are edited via card_component selection on the
  // root id; this kind covers the cardStyle envelope.
  Inspector.registerKind('card_style', {
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
  Inspector.registerKind('card_component', {
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


})();
