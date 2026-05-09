/**
 * CardStyle node tree 閳?left dock panel that shows the active cardStyle's
 * tree (root 閳?descendants). Subscribes to State.activeCardStyle.
 *
 * Selection in the tree 閳?State.setSelection({kind:'card_component',
 * styleKey, nodeId(s)}) so Inspector reflects the chosen node(s).
 *
 * Empty state when no cardStyle is active.
 *
 * Drag-reparent + multi-select are inherited from ui.tree.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // Walk a TreeNode 閳?flat ui.tree input (id/label/icon/children).
  function flatten(node) {
    if (!node) return [];
    return [toTreeRow(node)];
  }
  function toTreeRow(n) {
    var spec = null;
    try { spec = EF.resolveComponent(n.component); } catch (_) {}
    var label = n.component;
    var bound = n.bindings && Object.keys(n.bindings).length;
    if (bound) {
      var b = n.bindings[Object.keys(n.bindings)[0]];
      label = n.component + (b && b.field ? ' -> ' + b.field : '');
    }
    return {
      id:       n.id,
      label:    label,
      icon:     (spec && spec.icon) || 'square',
      // Preserve the component name so consumers like contextMenu(node)
      // can re-resolve the spec.
      component: n.component,
      children: (n.children || []).map(toTreeRow),
    };
  }

  function expandableIds(node) {
    var ids = new Set();
    function walk(n) {
      var kids = n && n.children ? n.children : [];
      if (kids.length) ids.add(n.id);
      kids.forEach(walk);
    }
    walk(node);
    return ids;
  }

  // Module-local node clipboard. Holds JSON-serialized TreeNode objects
  // so paste works across cardStyles too 閳?every TreeNode is the same
  // shape regardless of which cardStyle it came from. Paste deep-clones
  // and rewrites every id so duplicates don't collide.
  var Actions = GDE.cardStyleActions;
  var clipboard = Actions.clipboard;

  function factory(_propsSig, ctx) {
    var root = ui.h('div', 'gde-cs-tree');

    // 閳光偓閳光偓 Header: title + filter input + add button 閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓閳光偓
    var header = ui.h('div', 'gde-cs-tree-header');
    var titleEl = ui.h('span', 'gde-cs-tree-title', { text: '' });
    header.appendChild(titleEl);
    root.appendChild(header);

    var bar = ui.h('div', 'gde-cs-tree-bar');
    var filterSig = EF.signal('');
    var search = ui.searchInput({ value: filterSig, placeholder: I18N.text('cardstyle.filter') });
    search.style.cssText = 'flex:1 1 auto;min-width:0;';
    var addBtn = ui.iconButton({
      icon: 'plus', kind: 'primary', size: 'sm', title: I18N.text('cardstyle.add_component'),
      onClick: function (ev) { showAddMenu(ev); },
    });
    bar.appendChild(search); bar.appendChild(addBtn);
    root.appendChild(bar);

    var empty = ui.h('div', 'gde-cs-tree-empty', {
      text: '',
    });
    EF.ui.collect(empty, I18N.bindText(empty, 'cardstyle.empty_hint'));

    var itemsSig    = EF.signal([]);
    var selectedSig = EF.signal([]);
    var expandedSig = EF.signal(new Set());
    var expandedSeedKey = null;

    var tree = ui.tree({
      items:    itemsSig,
      selected: selectedSig,
      expanded: expandedSig,
      search:   filterSig,
      searchBehavior: 'filter',
      multi:    true,
      defaultExpanded: 'all',
      onSelect: function (ids) {
        var key = State.activeCardStyle.peek();
        if (!key) return;
        if (!ids || !ids.length) State.setSelection({ kind: 'card_style', key: key });
        else State.setSelection({ kind: 'card_component', styleKey: key, nodeIds: ids });
      },
      contextMenu: function (node) {
        var spec = null; try { spec = EF.resolveComponent(node.component); } catch (_) {}
        var canPaste = (clipboard.peek() || []).length > 0;
        var key = keyFromState();
        var items = [];
        if (key && GDE.ai && GDE.ai.sendTargetsToAI) {
          items.push({
            label: t('common.add_to_chat'),
            icon: 'message-circle',
            onSelect: function () { GDE.ai.sendTargetsToAI([GDE.ai.cardNodeTarget(key, node.id)], 'Inspect this card style node.'); },
          });
        }
        items.push.apply(items, [
          { label: t('common.copy'), icon: 'copy', onSelect: function () { copyNodes(); } },
          { label: t('common.paste'), icon: 'paste', disabled: !canPaste, onSelect: function () { Actions.paste(keyFromState()); } },
          { label: t('common.duplicate'), icon: 'copy', onSelect: function () { duplicateNodes(); } },
          { label: t('cardstyle.copy_scene_text'), icon: 'copy', onSelect: function () { copySceneText(); } },
          { label: 'Copy Subtree Text', icon: 'copy', onSelect: function () { copySceneText(node.id); } },
          { label: 'Paste as sibling', disabled: !canPaste, icon: 'paste',
            onSelect: function () { pasteAsSibling(node.id); } },
          { label: 'Paste as child', disabled: !canPaste, icon: 'paste',
            onSelect: function () { pasteAsChild(node.id); } },
          { type: 'divider' },
          { label: 'Delete', icon: 'trash', danger: true, onSelect: function () { deleteNode(node.id); } },
        ]);
        return items;
      },
      dnd: {
        dropZones: function (targetNode) {
          return ['before', 'inside', 'after'];
        },
        onDrop: function (targetNode, position, dragData) {
          reparent(dragData.payload, targetNode.id, position);
        },
      },
    });
    tree.style.cssText = 'flex:1 1 0;';
    var lastPointer = null;
    root.tabIndex = -1;
    tree.addEventListener('pointerdown', function (ev) { root.focus(); lastPointer = { x: ev.clientX, y: ev.clientY }; });
    tree.addEventListener('pointermove', function (ev) { lastPointer = { x: ev.clientX, y: ev.clientY }; });
    tree.addEventListener('dragover', function (ev) {
      if (!hasComponentPayload(ev)) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    });
    tree.addEventListener('drop', function (ev) {
      if (!hasComponentPayload(ev)) return;
      ev.preventDefault();
      var payload = readComponentPayload(ev);
      if (!payload || !payload.name) return;
      addComponent(payload.name, dropTargetNodeId(ev));
    });
    tree.addEventListener('contextmenu', function (ev) {
      if (ev.target.closest && ev.target.closest('.ef-ui-tree-row')) return;
      ev.preventDefault();
      root.focus();
      var key = State.activeCardStyle.peek();
      var def = key ? State.projectCardStyles()[key] : null;
      var items = [];
      if (key) items.push({ label: t('cardstyle.add_node'), icon: 'plus', onSelect: function () { openAddMenu({ x: ev.clientX, y: ev.clientY }, null); } });
      if (def && def.root && (clipboard.peek() || []).length) {
        items.push({ label: t('common.paste'), icon: 'paste', onSelect: function () { Actions.paste(key); } });
        items.push({ label: 'Paste as child of Root', icon: 'paste', onSelect: function () { pasteAsChild(def.root.id); } });
      }
      if (def && def.root) {
        if (items.length) items.push({ type: 'divider' });
        items.push({ label: t('cardstyle.copy_scene_text'), icon: 'copy', onSelect: function () { copySceneText(); } });
        items.push({ label: 'Copy', icon: 'copy', disabled: !currentSelectedIds().length, onSelect: function () { Actions.copy(key); } });
        items.push({ label: 'Duplicate', icon: 'copy', disabled: !currentSelectedIds().length, onSelect: function () { Actions.duplicate(key); } });
      }
      if (!items.length) items.push({ label: 'No cardStyle selected', disabled: true });
      EF.ui.contextMenu({ x: ev.clientX, y: ev.clientY }, items);
    });

    function refresh() {
      var key = State.activeCardStyle();
      var cs = State.projectCardStyles();
      var def = key ? cs[key] : null;
      titleEl.textContent = def ? (def.name || key) : t('cardstyle.none_selected');
      if (!def || !def.root) {
        if (root.contains(tree)) root.removeChild(tree);
        if (!root.contains(empty)) root.appendChild(empty);
        itemsSig.set([]);
        expandedSeedKey = null;
        expandedSig.set(new Set());
        return;
      }
      if (root.contains(empty)) root.removeChild(empty);
      if (!root.contains(tree)) root.appendChild(tree);
      itemsSig.set(flatten(def.root));
      var seedKey = key + ':' + def.root.id;
      if (expandedSeedKey !== seedKey) {
        expandedSeedKey = seedKey;
        expandedSig.set(expandableIds(def.root));
      }
      // Sync selection from State
      var sel = State.selection();
      if (sel && sel.kind === 'card_component' && sel.styleKey === key) {
        var ids = sel.nodeIds || (sel.nodeId ? [sel.nodeId] : []);
        selectedSig.set(ids);
      } else {
        selectedSig.set([]);
      }
    }

    // The local selectedSig (the one ui.tree writes only when no onSelect
    // is provided) is read-only here 閳?our onSelect routes through State.
    // So always source the live selection from State.selection().
    function currentSelectedIds() {
      var key = State.activeCardStyle.peek();
      var sel = State.selection();
      if (!sel || sel.kind !== 'card_component' || sel.styleKey !== key) return [];
      return sel.nodeIds || [];
    }
    function keyFromState() {
      return State.activeCardStyle.peek();
    }
    function expandNode(id) {
      var next = new Set(expandedSig.peek());
      next.add(id);
      expandedSig.set(next);
    }

    // Move srcIds into target relative to the targetId. Cut first (so target
     // index stays valid for in-tree moves), then splice in. Cycle prevention
     // (dropping a parent into its descendant) is enforced upstream by
     // tree-dnd; we just write what comes through.
    function reparent(srcIds, targetId, position) {
      var key = State.activeCardStyle.peek();
      if (!key) return;
      var cs = State.projectCardStyles()[key];
      if (!cs || !cs.root) return;
      // Don't allow dropping the root or making the root a child of someone.
      if (srcIds.indexOf(cs.root.id) >= 0) return;
      State.mutateCardStyle(key, function (clone) {
        var moving = [];
        // Cut in reverse so multiple cuts under the same parent stay correct.
        var ordered = SceneNode.orderByDepth(clone.root, srcIds);
        ordered.forEach(function (id) {
          var hit = SceneNode.find(clone.root, id);
          if (hit && hit.parent) {
            moving.unshift(hit.parent.children.splice(hit.index, 1)[0]);
          }
        });
        var dst = SceneNode.find(clone.root, targetId);
        if (!dst) return false;
        if (position === 'inside') {
          dst.node.children = dst.node.children || [];
          moving.forEach(function (n) { n.layout = SceneNode.layoutForParent(dst.node, n.component, n.layout); });
          Array.prototype.push.apply(dst.node.children, moving);
        } else if (position === 'before' && dst.parent) {
          moving.forEach(function (n) { n.layout = SceneNode.layoutForParent(dst.parent, n.component, n.layout); });
          Array.prototype.splice.apply(dst.parent.children, [dst.index, 0].concat(moving));
        } else if (position === 'after' && dst.parent) {
          moving.forEach(function (n) { n.layout = SceneNode.layoutForParent(dst.parent, n.component, n.layout); });
          Array.prototype.splice.apply(dst.parent.children, [dst.index + 1, 0].concat(moving));
        } else {
          return false;
        }
      });
    }
    // Order ids by descending depth so we cut leaves before their parents
    // when both are in the moving set (otherwise the parent cut detaches
    // the descendant before we get to it).
    // Build an add-component menu listing every registered component
    // grouped by category. Picking one inserts a fresh node under the
    // currently selected node (if it's a container or its parent if not),
    // or as a root if the cardStyle is empty.
    var ADD_CATS = ['layout', 'display', 'base', 'form', 'editor'];
    function showAddMenu(ev) {
      openAddMenu({ x: ev.clientX, y: ev.clientY }, null);
    }
    function openAddMenu(point, parentId) {
      var key = State.activeCardStyle.peek();
      if (!key) { State.log('warn', 'Pick a cardStyle first.'); return; }
      var groups = {};
      EF.listComponents().forEach(function (c) {
        if (!c.category || ADD_CATS.indexOf(c.category) < 0) return;
        (groups[c.category] = groups[c.category] || []).push(c);
      });
      var items = [];
      ADD_CATS.forEach(function (cat) {
        var entries = (groups[cat] || []).sort(function (a, b) {
          return (a.label || a.name).localeCompare(b.label || b.name);
        });
        if (!entries.length) return;
        entries.forEach(function (spec) {
          items.push({
            label: spec.label || spec.name,
            value: spec.name,
            icon:  spec.icon  || 'square',
            group: cat,
            onSelect: function () { addComponent(spec.name, parentId); },
          });
        });
      });
      ui.searchMenu({
        pos: point,
        items: items,
        placeholder: 'Search components...',
        side: 'bottom',
        align: 'start',
        width: 300,
        maxHeight: 520,
      });
    }
    function hasComponentPayload(ev) {
      return ev.dataTransfer && Array.from(ev.dataTransfer.types).indexOf('application/ef.component+json') >= 0;
    }
    function readComponentPayload(ev) {
      var raw = ev.dataTransfer && ev.dataTransfer.getData('application/ef.component+json');
      if (!raw) return null;
      try { return JSON.parse(raw); } catch (_) { return null; }
    }
    function dropTargetNodeId(ev) {
      var row = ev.target && ev.target.closest ? ev.target.closest('[data-tree-node-id]') : null;
      return row ? row.dataset.treeNodeId : null;
    }

    function addComponent(name, parentId) {
      var key = State.activeCardStyle.peek();
      if (!key) return;
      var newNode = SceneNode.create(name);
      var selectedNodeId = null;
      var parentToExpand = null;
      State.mutateCardStyle(key, function (clone) {
        if (!clone.root) {
          delete newNode.layout;
          clone.root = newNode;
          selectedNodeId = newNode.id;
          return;
        }
        // Otherwise insert under the current selection. Every scene node can
        // own children; layout behavior is resolved by the renderer.
        var selIds = currentSelectedIds() || [];
        var anchorId = parentId || selIds[selIds.length - 1] || clone.root.id;
        var hit = SceneNode.find(clone.root, anchorId);
        if (hit) {
          hit.node.children = hit.node.children || [];
          newNode.layout = SceneNode.layoutForParent(hit.node, newNode.component, newNode.layout);
          hit.node.children.push(newNode);
          parentToExpand = hit.node.id;
        } else {
          clone.root.children = clone.root.children || [];
          newNode.layout = SceneNode.layoutForParent(clone.root, newNode.component, newNode.layout);
          clone.root.children.push(newNode);
          parentToExpand = clone.root.id;
        }
        selectedNodeId = newNode.id;
      });
      if (parentToExpand) expandNode(parentToExpand);
      if (selectedNodeId) State.setSelection({ kind: 'card_component', styleKey: key, nodeIds: [selectedNodeId] });
    }

    // Copy the current tree-multi-selection (or fall back to the right-
    // clicked node if nothing is multi-selected) into the module clipboard.
    // We snapshot `JSON.stringify` payloads so the clipboard survives later
    // edits to the source cardStyle. Root cannot be copied 閳?copying root
    // and pasting back would overwrite or duplicate the entire style.
    function sceneText(nodeId) {
      var key = State.activeCardStyle.peek();
      if (!key) return '';
      var cs = State.projectCardStyles()[key];
      if (!cs || !cs.root) return '';
      var rootNode = cs.root;
      if (nodeId) {
        var hit = SceneNode.find(cs.root, nodeId);
        if (!hit) return '';
        rootNode = hit.node;
      }
      return JSON.stringify({
        format: 'gde.cardStyle.scene',
        version: 1,
        cardStyle: key,
        name: cs.name || key,
        scope: nodeId ? 'subtree' : 'scene',
        root: JSON.parse(JSON.stringify(rootNode)),
      }, null, 2);
    }
    function copySceneText(nodeId) {
      var text = sceneText(nodeId);
      if (!text) return;
      copyText(text).then(function () {
        State.log('info', nodeId ? 'Copied subtree scene text.' : 'Copied cardStyle scene text.');
      });
    }
    function copyText(text) {
      return EF.ui.copyText(text);
    }
    function duplicateNodes() {
      Actions.duplicate(State.activeCardStyle.peek());
    }

    function copyNodes() {
      var key = State.activeCardStyle.peek();
      if (!key) return;
      var cs = State.projectCardStyles()[key]; if (!cs || !cs.root) return;
      var ids = (currentSelectedIds() || []).filter(function (id) { return id !== cs.root.id; });
      if (!ids.length) { State.log('warn', 'Nothing to copy (root cannot be copied).'); return; }
      var payloads = ids.map(function (id) {
        var hit = SceneNode.find(cs.root, id);
        return hit ? JSON.parse(JSON.stringify(hit.node)) : null;
      }).filter(Boolean);
      clipboard.set(payloads);
      State.log('info', 'Copied ' + payloads.length + ' node(s).');
    }
    function pasteAsSibling(targetId) {
      var key = State.activeCardStyle.peek(); if (!key) return;
      var cs = State.projectCardStyles()[key]; if (!cs || !cs.root) return;
      if (cs.root.id === targetId) { return pasteAsChild(targetId); }
      var clip = clipboard.peek() || [];
      if (!clip.length) return;
      var fresh = clip.map(SceneNode.cloneWithFreshIds);
      var changed = State.mutateCardStyle(key, function (clone) {
        var hit = SceneNode.find(clone.root, targetId);
        if (!hit || !hit.parent) return false;
        fresh.forEach(function (n) { n.layout = SceneNode.layoutForParent(hit.parent, n.component, n.layout); });
        Array.prototype.splice.apply(hit.parent.children, [hit.index + 1, 0].concat(fresh));
      });
      if (!changed) return;
      expandNode(targetId);
      State.setSelection({ kind: 'card_component', styleKey: key, nodeIds: fresh.map(function (n) { return n.id; }) });
    }
    function pasteAsChild(targetId) {
      var key = State.activeCardStyle.peek(); if (!key) return;
      var cs = State.projectCardStyles()[key]; if (!cs || !cs.root) return;
      var clip = clipboard.peek() || [];
      if (!clip.length) return;
      var fresh = clip.map(SceneNode.cloneWithFreshIds);
      var changed = State.mutateCardStyle(key, function (clone) {
        var hit = SceneNode.find(clone.root, targetId);
        if (!hit) return false;
        hit.node.children = hit.node.children || [];
        fresh.forEach(function (n) { n.layout = SceneNode.layoutForParent(hit.node, n.component, n.layout); });
        Array.prototype.push.apply(hit.node.children, fresh);
      });
      if (!changed) return;
      State.setSelection({ kind: 'card_component', styleKey: key, nodeIds: fresh.map(function (n) { return n.id; }) });
    }

    function deleteNode(id) {
      var key = State.activeCardStyle.peek();
      if (!key) return;
      var cs = State.projectCardStyles();
      var def = cs[key]; if (!def) return;
      // Don't allow deleting the root via the context menu 閳?that would
      // leave an inconsistent CardStyleDef. Use the inspector's "clear root"
      // affordance for that.
      if (def.root && def.root.id === id) {
        State.log('warn', 'Use the inspector to clear the root node.');
        return;
      }
      State.mutateCardStyle(key, function (clone) {
        var hit = SceneNode.find(clone.root, id);
        if (!hit || !hit.parent) return false;
        hit.parent.children.splice(hit.index, 1);
      });
    }

    function isTreeActive() {
      return root.isConnected && root.contains(document.activeElement);
    }
    EF.shortcuts.register({ key: 'a', shift: true, when: isTreeActive, run: function () { openAddMenu(lastPointer || treeCenterPoint(), null); } }, root);
    EF.shortcuts.register({ key: 'c', ctrl: true, when: isTreeActive, run: function () { Actions.copy(State.activeCardStyle.peek()); } }, root);
    EF.shortcuts.register({ key: 'v', ctrl: true, when: isTreeActive, run: function () { Actions.paste(State.activeCardStyle.peek()); } }, root);
    EF.shortcuts.register({ key: 'd', shift: true, when: isTreeActive, run: function () { Actions.duplicate(State.activeCardStyle.peek()); } }, root);
    function treeCenterPoint() {
      var r = tree.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + Math.min(120, Math.max(24, r.height / 3)) };
    }

    GDE.effect(root, refresh);
    ctx.bus.on('cardstyles:changed', refresh);
    ctx.bus.on('selection:changed',  refresh);

    return root;
  }

  EF.registerComponent('gde-cardstyle-tree', {
    category: 'panel',
    label: 'Object Tree',
    icon: 'list',
    defaults: function () { return { title: t('panel.object_tree'), icon: 'list' }; },
    factory:  factory,
  });
})();
