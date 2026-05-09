/**
 * CardStyle editor �?main dock panel. Toolbar + canvas. The canvas
 * renders the cardStyle's root via EF.ui.renderUITree and accepts drops
 * of palette components to add new TreeNodes.
 *
 * The panel binds to a styleKey via panel props (set by the cardstyle-list
 * tile click); changing styleKey is handled by opening a different panel.
 *
 * Toolbar:
 *   [name] · [size info] · preview source [▾]
 *
 * Canvas:
 *   - sized to root.props.width × root.props.height
 *   - dropzone for application/ef.component+json
 *   - clicking a child marks it selected (for inspector)
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // Build a fresh scene node from a component name. All nodes may own
  // children; parent layout is assigned by the insertion path.
  function nodeFromComponent(name) {
    return SceneNode.create(name);
  }

  function factory(propsSig, ctx) {
    var root = ui.h('div', 'gde-cs-editor');
    root.tabIndex = -1;
    var styleKey = (propsSig.peek() || {}).styleKey;

    var bar = ui.h('div', 'gde-cs-editor-bar');
    var nameEl = ui.h('div', 'gde-cs-editor-name', { text: '' });
    var sizeEl = ui.h('div', 'gde-cs-editor-size', { text: '' });
    bar.appendChild(nameEl); bar.appendChild(sizeEl);

    var gridVisible = EF.signal(true);
    var snapEnabled = EF.signal(false);
    var gridSize = EF.signal(16);
    var snapGrid = EF.signal(true);
    var snapParent = EF.signal(false);
    var snapSiblings = EF.signal(false);
    var gridBtn = ui.iconButton({
      icon: 'grid',
      title: I18N.text('cardstyle.show_grid'),
      kind: 'ghost',
      onClick: function () { gridVisible.set(!gridVisible.peek()); },
    });
    var gridSizeEl = ui.numberInput({ value: gridSize, min: 1, max: 128, step: 1, precision: 0 });
    var snapBtn = ui.iconButton({
      icon: 'magnet',
      title: I18N.text('cardstyle.snap'),
      kind: 'ghost',
      onClick: function () { snapEnabled.set(!snapEnabled.peek()); },
    });
    var snapGridBtn = snapSourceButton('Grid', snapGrid, 'Snap to grid');
    var snapParentBtn = snapSourceButton('Parent', snapParent, 'Snap to parent edges and center');
    var snapSiblingsBtn = snapSourceButton('Siblings', snapSiblings, 'Snap to sibling edges and centers');
    var alignMenuBtn = ui.iconButton({
      icon: 'more-horizontal',
      title: I18N.text('cardstyle.align_menu'),
      kind: 'ghost',
      onClick: function () { openAlignMenu(alignMenuBtn); },
    });
    gridBtn.classList.add('gde-cs-toggle');
    snapBtn.classList.add('gde-cs-toggle');
    gridSizeEl.classList.add('gde-cs-grid-size');
    snapGridBtn.classList.add('gde-cs-toggle');
    snapParentBtn.classList.add('gde-cs-toggle');
    snapSiblingsBtn.classList.add('gde-cs-toggle');
    alignMenuBtn.classList.add('gde-cs-align-menu-btn');

    // Zoom �?applied to canvas via CSS transform. Range chosen wide enough
    // to peek at small text + back out to layout overview without becoming
    // a scrubbable axis (numberInput is a deliberate two-click affair).
    var zoom = EF.signal(100);
    var zoomEl = ui.numberInput({ value: zoom, min: 25, max: 400, step: 25, precision: 0 });
    var zoomWrap = ui.h('div', 'gde-cs-editor-zoom');
    zoomWrap.appendChild(gridBtn);
    zoomWrap.appendChild(gridSizeEl);
    zoomWrap.appendChild(snapBtn);
    zoomWrap.appendChild(snapGridBtn);
    zoomWrap.appendChild(snapParentBtn);
    zoomWrap.appendChild(snapSiblingsBtn);
    zoomWrap.appendChild(alignMenuBtn);
    zoomWrap.appendChild(ui.h('span', 'gde-cs-editor-zoom-label', { text: 'Zoom %' }));
    zoomWrap.appendChild(zoomEl);
    bar.appendChild(zoomWrap);

    root.appendChild(bar);

    var stage = ui.h('div', 'gde-cs-stage');
    root.appendChild(stage);
    stage.addEventListener('pointerdown', function (ev) { root.focus(); lastPointer = { x: ev.clientX, y: ev.clientY }; });
    GDE.effect(root, function () {
      var n = Math.max(1, Number(gridSize()) || 16);
      stage.style.setProperty('--gde-cs-grid-size', n + 'px');
      stage.toggleAttribute('data-grid', !!gridVisible());
      gridBtn.classList.toggle('is-on', !!gridVisible.peek());
      snapBtn.classList.toggle('is-on', !!snapEnabled());
      snapGridBtn.classList.toggle('is-on', !!snapGrid());
      snapParentBtn.classList.toggle('is-on', !!snapParent());
      snapSiblingsBtn.classList.toggle('is-on', !!snapSiblings());
      setAlignEnabled(canAlignSelection());
    });

    var canvas = ui.h('div', 'gde-cs-canvas');
    stage.appendChild(canvas);
    var lastPointer = null;
    stage.addEventListener('pointermove', function (ev) { lastPointer = { x: ev.clientX, y: ev.clientY }; });
    var guideLayer = ui.h('div', 'gde-cs-guides');
    var marqueeEl = ui.h('div', 'gde-cs-marquee');
    GDE.effect(root, function () {
      var z = Math.max(25, Math.min(400, Number(zoom()) || 100)) / 100;
      canvas.style.transform = 'scale(' + z + ')';
      canvas.style.transformOrigin = 'center';
    });

    function snapSourceButton(label, sig, title) {
      var btn = ui.button({
        text: label,
        kind: 'ghost',
        size: 'sm',
        onClick: function () { sig.set(!sig.peek()); },
      });
      btn.setAttribute('title', title);
      return btn;
    }
    function openAlignMenu(anchor) {
      var disabled = !canAlignSelection();
      ui.menu({
        anchor: anchor,
        side: 'bottom',
        align: 'end',
        items: [
          { type: 'header', label: t('cardstyle.align') },
          { label: t('cardstyle.align.left'), disabled: disabled, onSelect: function () { applyAlign('left'); } },
          { label: t('cardstyle.align.center_x'), disabled: disabled, onSelect: function () { applyAlign('center-x'); } },
          { label: t('cardstyle.align.right'), disabled: disabled, onSelect: function () { applyAlign('right'); } },
          { type: 'divider' },
          { label: t('cardstyle.align.top'), disabled: disabled, onSelect: function () { applyAlign('top'); } },
          { label: t('cardstyle.align.center_y'), disabled: disabled, onSelect: function () { applyAlign('center-y'); } },
          { label: t('cardstyle.align.bottom'), disabled: disabled, onSelect: function () { applyAlign('bottom'); } },
          { type: 'divider' },
          { label: t('cardstyle.align.distribute_x'), disabled: disabled, onSelect: function () { applyAlign('distribute-x'); } },
          { label: t('cardstyle.align.distribute_y'), disabled: disabled, onSelect: function () { applyAlign('distribute-y'); } },
        ],
      });
    }
    function setAlignEnabled(enabled) {
      alignMenuBtn.disabled = !enabled;
    }
    function canAlignSelection() {
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return false;
      var ids = SceneSelection.idsFromSelection(State.selection(), styleKey);
      return SceneNode.topLevelIds(cs.root, ids).length >= 2;
    }

    // Wheel / trackpad-pinch �?zoom. Step is proportional to current zoom
    // so the perceived speed stays constant at any level (logarithmic
    // feel �?many editors do the same). preventDefault stops the page
    // from scrolling underneath us; the stage doesn't need natural scroll
    // because zoom is the primary interaction here.
    // Click on the stage's empty area (the checkered background outside the
     // canvas) deselects. The canvas's own click handler covers clicks
     // INSIDE the card; this one catches the rest.
    stage.addEventListener('click', function (ev) {
      if (dragSuppressClick) return;
      if (ev.target === stage) {
        State.setSelection(null);
        anchorId = null;
      }
    });

    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var current = Number(zoom.peek()) || 100;
      var step = Math.max(2, current * 0.1);          // 10% of current, floored
      var next = current + Math.sign(-ev.deltaY) * step;
      zoom.set(Math.max(25, Math.min(400, Math.round(next))));
    }, { passive: false });

    stage.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.target !== stage) return;
      startMarquee(ev);
    });

    // Sample-row signal �?uses the first table's first entity if any
    // exists, otherwise just '#sample' so bindings resolve to undefined
    // (and the renderer paints blanks). The cardstyle is meant to work
    // against any compatible struct; the editor doesn't bind to a
    // specific table.
    var sampleSig = GDE.derived(root, function () {
      var tm = State.tableMap();
      var keys = Object.keys(tm);
      for (var i = 0; i < keys.length; i++) {
        var t = tm[keys[i]];
        if (t && t.id && t.id.length) {
          var firstId = t.id[0];
          var data = State.gameData();
          return Object.assign({ id: firstId }, data[firstId] || {});
        }
      }
      return { id: '#sample' };
    });

    function rerender() {
      var cs = State.projectCardStyles()[styleKey];
      GDE.clear(canvas);
      if (!cs) {
        nameEl.textContent = '(missing cardStyle: ' + styleKey + ')';
        sizeEl.textContent = '';
        return;
      }
      nameEl.textContent = cs.name || styleKey;
      var size = State.cardStyleRootSize(cs);
      sizeEl.textContent = size.w + ' × ' + size.h;
      if (!cs.root) {
        canvas.appendChild(ui.h('div', 'gde-cs-canvas-empty', {
          text: 'Drop a Layout component here to begin.',
        }));
        return;
      }
      var inner = ui.renderUITree(cs.root, { data: sampleSig });
      SceneDOM.annotate(inner, cs.root);
      canvas.appendChild(inner);
      canvas.appendChild(guideLayer);
      bindCanvasNodeTargets();
    }

    function bindCanvasNodeTargets() {
      if (!GDE.ai || !GDE.ai.bindTarget) return;
      SceneDOM.selectableTargets(canvas).forEach(function (el) {
        var nodeId = el.dataset && el.dataset.nodeId;
        GDE.ai.bindTarget(el, function () {
          return GDE.ai.cardNodeTarget(styleKey, nodeId);
        }, { draggable: true });
      });
    }

    function selectedNodeTargets(targetId) {
      var selected = SceneSelection.idsFromSelection(State.selection(), styleKey);
      if (targetId && selected.indexOf(targetId) < 0) selected = [targetId];
      return selected.map(function (id) { return GDE.ai.cardNodeTarget(styleKey, id); });
    }

    var anchorId = null;
    canvas.addEventListener('click', function (ev) {
      // The pointerup that ends a drag fires a click immediately after.
      // dragSuppressClick is set right before we commit and cleared on the
      // next tick, so clicks induced by drags don't reshape the selection.
      if (dragSuppressClick) return;
      var clickedId = SceneDOM.idFromEvent(ev, canvas);
      if (!clickedId) {
        State.setSelection(null);
        anchorId = null;
        return;
      }
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return;
      var next = SceneSelection.click(
        cs.root,
        SceneSelection.idsFromSelection(State.selection(), styleKey),
        anchorId,
        clickedId,
        ev
      );
      anchorId = next.anchorId;
      State.setSelection({ kind: 'card_component', styleKey: styleKey, nodeIds: next.ids });
    });

    // Drop palette components onto canvas. Find target node by hit-testing
    // ancestors with dataset.nodeId; fall back to root.
    canvas.addEventListener('dragover', function (ev) {
      var ok = ev.dataTransfer && Array.from(ev.dataTransfer.types).indexOf('application/ef.component+json') >= 0;
      if (ok) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
    });
    canvas.addEventListener('drop', function (ev) {
      var raw = ev.dataTransfer && ev.dataTransfer.getData('application/ef.component+json');
      if (!raw) return;
      ev.preventDefault();
      var payload = null; try { payload = JSON.parse(raw); } catch (_) { return; }
      if (!payload || !payload.name) return;

      var insertedId = null;
      State.mutateCardStyle(styleKey, function (clone) {
        // Empty cardStyle: drop becomes the root.
        if (!clone.root) {
          clone.root = nodeFromComponent(payload.name);
          delete clone.root.layout;  // root has no parent layout
          insertedId = clone.root.id;
          return;
        }
        // Find the most specific scene node under cursor. Every node can own
        // children; non-layout components use the default overlay child layer.
        var targetId = SceneDOM.idFromEvent(ev, canvas) || clone.root.id;
        var hit2 = SceneNode.find(clone.root, targetId);
        if (!hit2) return false;
        var node = nodeFromComponent(payload.name);
        var layout = layoutForDrop(hit2.node, payload.name, ev);
        if (layout) node.layout = layout;
        else delete node.layout;
        hit2.node.children = hit2.node.children || [];
        hit2.node.children.push(node);
        insertedId = node.id;
      });
      if (insertedId) State.setSelection({ kind: 'card_component', styleKey: styleKey, nodeIds: [insertedId] });
    });

    function layoutForDrop(parentNode, childName, ev) {
      var spec = null; try { spec = EF.resolveComponent(parentNode.component); } catch (_) {}
      if (spec && spec.appendChild && parentNode.component !== 'absolute') return null;
      var parentEl = SceneDOM.layoutElement(canvas, parentNode);
      if (!parentEl) return null;
      var rect = parentEl.getBoundingClientRect();
      var z = getZoom();
      var size = SceneNode.defaultSize(childName);
      var x = Math.round((ev.clientX - rect.left) / z - size.w / 2);
      var y = Math.round((ev.clientY - rect.top) / z - size.h / 2);
      return SceneNode.defaultLayout(childName, Math.max(0, x), Math.max(0, y));
    }

    var ADD_CATS = ['layout', 'display', 'base', 'form', 'editor'];
    function componentItems(point, parentId) {
      var groups = {};
      EF.listComponents().forEach(function (c) {
        if (!c.category || ADD_CATS.indexOf(c.category) < 0) return;
        (groups[c.category] = groups[c.category] || []).push(c);
      });
      var items = [];
      ADD_CATS.forEach(function (cat) {
        (groups[cat] || []).sort(function (a, b) {
          return (a.label || a.name).localeCompare(b.label || b.name);
        }).forEach(function (spec) {
          items.push({
            label: spec.label || spec.name,
            value: spec.name,
            icon: spec.icon || 'square',
            group: cat,
            onSelect: function () { addNodeAt(spec.name, point, parentId); },
          });
        });
      });
      return items;
    }

    function openAddMenu(point, parentId) {
      ui.searchMenu({
        items: componentItems(point, parentId),
        pos: point || canvasCenterPoint(),
        placeholder: t('cardstyle.search_components'),
        side: 'bottom',
        align: 'start',
        width: 300,
        maxHeight: 520,
      });
    }

    function addNodeAt(name, point, parentId) {
      var insertedId = null;
      State.mutateCardStyle(styleKey, function (clone) {
        var node = nodeFromComponent(name);
        if (!clone.root) {
          delete node.layout;
          clone.root = node;
          insertedId = node.id;
          return;
        }
        var targetId = parentId || selectedParentId(clone.root) || clone.root.id;
        var hit = SceneNode.find(clone.root, targetId) || SceneNode.find(clone.root, clone.root.id);
        if (!hit) return false;
        var layout = point ? layoutForPoint(hit.node, name, point) : SceneNode.layoutForParent(hit.node, name, node.layout);
        if (layout) node.layout = layout;
        else delete node.layout;
        hit.node.children = hit.node.children || [];
        hit.node.children.push(node);
        insertedId = node.id;
      });
      if (insertedId) State.setSelection({ kind: 'card_component', styleKey: styleKey, nodeIds: [insertedId] });
    }

    function selectedParentId(rootNode) {
      var ids = SceneSelection.idsFromSelection(State.selection(), styleKey);
      var id = ids.length ? ids[ids.length - 1] : null;
      if (!id) return null;
      var hit = SceneNode.find(rootNode, id);
      if (!hit) return null;
      var spec = null; try { spec = EF.resolveComponent(hit.node.component); } catch (_) {}
      return (spec && spec.appendChild && hit.node.component !== 'absolute' && hit.parent) ? hit.parent.id : hit.node.id;
    }

    function layoutForPoint(parentNode, childName, point) {
      var spec = null; try { spec = EF.resolveComponent(parentNode.component); } catch (_) {}
      if (spec && spec.appendChild && parentNode.component !== 'absolute') return null;
      var parentEl = SceneDOM.layoutElement(canvas, parentNode);
      if (!parentEl) return null;
      var rect = parentEl.getBoundingClientRect();
      var z = getZoom();
      var size = SceneNode.defaultSize(childName);
      var x = Math.round((point.x - rect.left) / z - size.w / 2);
      var y = Math.round((point.y - rect.top) / z - size.h / 2);
      return SceneNode.defaultLayout(childName, Math.max(0, x), Math.max(0, y));
    }

    stage.addEventListener('contextmenu', function (ev) {
      ev.preventDefault();
      root.focus();
      lastPointer = { x: ev.clientX, y: ev.clientY };
      var targetId = SceneDOM.idFromEvent(ev, canvas);
      var selected = SceneSelection.idsFromSelection(State.selection(), styleKey);
      if (targetId && selected.indexOf(targetId) < 0) {
        selected = [targetId];
        anchorId = targetId;
        State.setSelection({ kind: 'card_component', styleKey: styleKey, nodeIds: selected });
      }
      var hasSelection = selected.length > 0;
      var items = [];
      if (targetId && GDE.ai && GDE.ai.sendTargetsToAI) {
        items.push(
          {
            label: t('common.add_to_chat'),
            icon: 'message-circle',
            onSelect: function () {
              GDE.ai.sendTargetsToAI(selectedNodeTargets(targetId), t('cardstyle.ask_ai_prompt'));
            },
          },
          { type: 'divider' }
        );
      }
      items.push.apply(items, [
        { label: t('cardstyle.add_node'), icon: 'plus', onSelect: function () { openAddMenu({ x: ev.clientX, y: ev.clientY }, targetId || null); } },
        { type: 'divider' },
        { label: t('common.copy'), icon: 'copy', disabled: !hasSelection, onSelect: function () { GDE.cardStyleActions.copy(styleKey); } },
        { label: t('common.paste'), icon: 'paste', disabled: !GDE.cardStyleActions.canPaste(), onSelect: function () { GDE.cardStyleActions.paste(styleKey); } },
        { label: t('common.duplicate'), icon: 'copy', disabled: !hasSelection, onSelect: function () { GDE.cardStyleActions.duplicate(styleKey); } },
      ]);
      EF.ui.contextMenu({ x: ev.clientX, y: ev.clientY }, items);
    });
    // ── WYSIWYG drag / resize ─────────────────────────────────────
    // Each render rebuilds slot elements, so we wire drag handlers per
    // node fresh each time. Only nodes inside an `absolute` container
    // (i.e. with a LayoutRect `layout` field) participate;
    // flex children fall through to the click handler.
    //
    // First click on a node = select. Second click on the already-selected
    // node initiates drag. This matches Figma/Godot/the rest-of-the-world
    // muscle memory and keeps simple selection clicks free of jitter.
    var dragSuppressClick = false;

    // Each TreeNode has exactly one DOM element tagged with data-node-id;
    // for absolute children this IS the slot wrapper.
    function findSlot(nodeId) {
      return SceneDOM.slot(canvas, nodeId);
    }
    function getZoom() {
      var m = /scale\(([\d.]+)\)/.exec(canvas.style.transform || '');
      return m ? parseFloat(m[1]) : 1;
    }

    function applySelectionAffordances() {
      // Clear stale handle wrappers + highlight class.
      Array.from(canvas.querySelectorAll('.gde-cs-handles')).forEach(function (h) { h.remove(); });
      var ids = SceneSelection.idsFromSelection(State.selection(), styleKey);
      SceneDOM.applySelection(canvas, ids);
      var activeId = activeTransformId(ids);
      if (activeId) mountHandles(activeId);
    }

    function activeTransformId(ids) {
      for (var i = 0; i < (ids || []).length; i++) {
        if (findSlot(ids[i])) return ids[i];
      }
      return null;
    }

    function mountHandles(nodeId) {
      var slot = findSlot(nodeId);
      if (!slot) return;
      var wrap = ui.h('div', 'gde-cs-handles');
      ['n','s','e','w','ne','nw','se','sw'].forEach(function (h) {
        var d = ui.h('div', 'gde-cs-handle gde-cs-handle-' + h);
        d.dataset.handle = h;
        wrap.appendChild(d);
      });
      slot.appendChild(wrap);
      // Resize via handles
      wrap.addEventListener('pointerdown', function (ev) {
        if (!ev.target || !ev.target.dataset.handle) return;
        ev.stopPropagation(); ev.preventDefault();
        startResize(ev, slot, nodeId, ev.target.dataset.handle);
      });
    }

    canvas.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return;
      if (ev.target.closest && ev.target.closest('.gde-cs-handle')) return;
      var nodeId = SceneDOM.idFromEvent(ev, canvas);
      var csForPointer = State.projectCardStyles()[styleKey];
      if (!nodeId || (csForPointer && csForPointer.root && nodeId === csForPointer.root.id)) {
        startMarquee(ev);
        return;
      }
      var selected = SceneSelection.idsFromSelection(State.selection(), styleKey);
      if (selected.indexOf(nodeId) < 0) return;
      var slot = findSlot(nodeId);
      if (!slot) return;
      ev.preventDefault();
      startMove(ev, slot, nodeId);
    });

    function startMarquee(ev) {
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return;
      ev.preventDefault();
      var baseIds = SceneSelection.idsFromSelection(State.selection(), styleKey);
      var additive = !!(ev.ctrlKey || ev.metaKey);
      var start = { x: ev.clientX, y: ev.clientY };
      if (!marqueeEl.parentNode) stage.appendChild(marqueeEl);
      paintMarquee(start, start);
      previewMarquee(start);
      function selectionAt(point) {
        var rect = rectFromPoints(start, point);
        var hitIds = marqueeHitIds(cs.root, rect);
        return {
          rect: rect,
          ids: SceneSelection.marquee(cs.root, baseIds, hitIds, additive),
        };
      }
      function previewMarquee(point) {
        var next = selectionAt(point).ids;
        SceneDOM.applySelection(canvas, next);
      }
      function move(e) {
        var point = { x: e.clientX, y: e.clientY };
        paintMarquee(start, point);
        previewMarquee(point);
      }
      function up(e) {
        if (marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
        var result = selectionAt({ x: e.clientX, y: e.clientY });
        if (result.rect.width > 2 || result.rect.height > 2) {
          dragSuppressClick = true;
          setTimeout(function () { dragSuppressClick = false; }, 120);
        }
        anchorId = result.ids.length ? result.ids[result.ids.length - 1] : null;
        if (result.ids.length) State.setSelection({ kind: 'card_component', styleKey: styleKey, nodeIds: result.ids });
        else State.setSelection(null);
      }
      bindPointerSession(move, up, function () {
        if (marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
        applySelectionAffordances();
      });
    }


    function marqueeHitIds(rootNode, rect) {
      if (!rootNode) return [];
      var ids = SceneNode.collectIds(rootNode).filter(function (id) { return id !== rootNode.id; });
      return ids.filter(function (id) {
        var el = SceneDOM.hitTarget(canvas, id) || SceneDOM.wrapper(canvas, id);
        if (!el) return false;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        return rectsIntersect(rect, r);
      });
    }

    function rectsIntersect(a, b) {
      return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    }
    function paintMarquee(a, b) {
      var rect = rectFromPoints(a, b);
      var stageRect = stage.getBoundingClientRect();
      marqueeEl.style.left = (rect.left - stageRect.left) + 'px';
      marqueeEl.style.top = (rect.top - stageRect.top) + 'px';
      marqueeEl.style.width = rect.width + 'px';
      marqueeEl.style.height = rect.height + 'px';
    }

    function rectFromPoints(a, b) {
      var left = Math.min(a.x, b.x);
      var top = Math.min(a.y, b.y);
      var right = Math.max(a.x, b.x);
      var bottom = Math.max(a.y, b.y);
      return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
    }

    // Move + resize share the visual-only / commit-on-up shape: while
    // dragging we mutate slot.style directly so we don't trip a State
    // re-render every frame. State writes happen once on pointerup.
    function startMove(ev, slot, nodeId) {
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return;
      var selected = SceneSelection.idsFromSelection(State.selection(), styleKey);
      var movingIds = SceneNode.topLevelIds(cs.root, selected.indexOf(nodeId) >= 0 ? selected : [nodeId]);
      var moving = movingNodes(cs.root, movingIds);
      if (!moving.length) return;
      var primary = moving.filter(function (m) { return m.id === nodeId; })[0] || moving[0];
      var sx = ev.clientX, sy = ev.clientY;
      var z = getZoom();
      var parentSize = parentSizeForSlot(primary.slot, z);
      var snapCtx = snapContext(primary.slot, movingIds, parentSize);
      var groupStartBox = moving.length > 1 ? groupBox(moving) : null;
      var groupSnapCtx = groupStartBox ? canvasSnapContext(movingIds) : null;
      function move(e) {
        var layouts = movedLayouts(primary, moving, e, sx, sy, z, parentSize, snapCtx, groupStartBox, groupSnapCtx);
        previewLayouts(layouts);
      }
      function up(e) {
        var layouts = movedLayouts(primary, moving, e, sx, sy, z, parentSize, snapCtx, groupStartBox, groupSnapCtx);
        clearGuides();
        var startBox = EF.ui.layoutRect.toBox(primary.start, parentSize);
        var endBox = EF.ui.layoutRect.toBox(layouts[primary.id], parentSize);
        if (Math.abs(endBox.l - startBox.l) < 1 && Math.abs(endBox.t - startBox.t) < 1) return;
        dragSuppressClick = true;
        commitLayouts(layouts);
        setTimeout(function () { dragSuppressClick = false; }, 120);
      }
      bindPointerSession(move, up, cancelTransformPreview);
    }
    function movingNodes(rootNode, ids) {
      return ids.map(function (id) {
        var hit = SceneNode.find(rootNode, id);
        var slot = findSlot(id);
        if (!hit || !hit.node.layout || !slot) return null;
        return { id: id, slot: slot, start: JSON.parse(JSON.stringify(hit.node.layout)) };
      }).filter(Boolean);
    }
    function movedLayouts(primary, moving, e, sx, sy, zoom, parentSize, snapCtx, groupStartBox, groupSnapCtx) {
      if (groupStartBox) return groupMoveLayouts(moving, groupStartBox, e, sx, sy, zoom, groupSnapCtx);
      var primaryLayout = snappedMoveLayout(primary.start, e, sx, sy, zoom, parentSize, snapCtx);
      var a = EF.ui.layoutRect.toBox(primary.start, parentSize);
      var b = EF.ui.layoutRect.toBox(primaryLayout, parentSize);
      var dx = Math.round(b.l - a.l);
      var dy = Math.round(b.t - a.t);
      var out = {};
      moving.forEach(function (m) {
        out[m.id] = m.id === primary.id ? primaryLayout : EF.ui.layoutRect.translate(m.start, dx, dy);
      });
      return out;
    }
    function groupMoveLayouts(moving, startBox, e, sx, sy, zoom, snapCtx) {
      var nextBox = snappedGroupMoveBox(startBox, e, sx, sy, zoom, snapCtx);
      var dx = Math.round(nextBox.l - startBox.l);
      var dy = Math.round(nextBox.t - startBox.t);
      var out = {};
      moving.forEach(function (m) {
        out[m.id] = EF.ui.layoutRect.translate(m.start, dx, dy);
      });
      return out;
    }
    function snappedGroupMoveBox(startBox, e, sx, sy, zoom, snapCtx) {
      var d = dragDelta(e, sx, sy, zoom, true);
      var raw = { l: startBox.l + d.x, t: startBox.t + d.y, w: startBox.w, h: startBox.h };
      var res = CardStyleSnapping.computeMove(raw, snapCtx, snapSettings(e, zoom));
      showGuides(res.guides);
      return res.box;
    }
    function startResize(ev, slot, nodeId, handle) {
      var cs = State.projectCardStyles()[styleKey];
      var hit = SceneNode.find(cs && cs.root, nodeId);
      if (!hit || !hit.node.layout) return;
      var start = JSON.parse(JSON.stringify(hit.node.layout));
      var sx = ev.clientX, sy = ev.clientY;
      var z = getZoom();
      var parentSize = parentSizeForSlot(slot, z);
      var snapCtx = snapContext(slot, nodeId, parentSize);
      function move(e) {
        var layout = snappedResizeLayout(start, e, sx, sy, z, handle, parentSize, snapCtx);
        previewLayout(slot, layout);
      }
      function up(e) {
        var layout = snappedResizeLayout(start, e, sx, sy, z, handle, parentSize, snapCtx);
        clearGuides();
        var startBox = EF.ui.layoutRect.toBox(start, parentSize);
        var endBox = EF.ui.layoutRect.toBox(layout, parentSize);
        if (Math.abs(endBox.l - startBox.l) < 1 &&
            Math.abs(endBox.t - startBox.t) < 1 &&
            Math.abs(endBox.w - startBox.w) < 1 &&
            Math.abs(endBox.h - startBox.h) < 1) return;
        dragSuppressClick = true;
        commitLayout(nodeId, layout);
        setTimeout(function () { dragSuppressClick = false; }, 120);
      }
      bindPointerSession(move, up, cancelTransformPreview);
    }

    // Move + resize work on a LayoutRect (see EF.ui.layoutRect): translation
    // shifts both oMin and oMax; per-edge resize moves only the corresponding
    // corner. Anchors are preserved so the relationship to the parent
    // (fixed point vs. stretched) survives editing.
    function snappedMoveLayout(start, e, sx, sy, zoom, parentSize, snapCtx) {
      var d = dragDelta(e, sx, sy, zoom, true);
      var raw = withMove(start, d.x, d.y);
      var rawBox = EF.ui.layoutRect.toBox(raw, parentSize);
      var res = CardStyleSnapping.computeMove(rawBox, snapCtx, snapSettings(e, zoom));
      showGuides(res.guides);
      return EF.ui.layoutRect.fromBox(res.box, start, parentSize);
    }
    function snappedResizeLayout(start, e, sx, sy, zoom, handle, parentSize, snapCtx) {
      var d = dragDelta(e, sx, sy, zoom, false);
      var raw = withResize(start, d.x, d.y, handle, parentSize);
      var rawBox = EF.ui.layoutRect.toBox(raw, parentSize);
      var res = CardStyleSnapping.computeResize(rawBox, handle, snapCtx, snapSettings(e, zoom));
      showGuides(res.guides);
      return EF.ui.layoutRect.fromBox(res.box, start, parentSize);
    }
    function dragDelta(e, sx, sy, zoom, axisLock) {
      var dx = (e.clientX - sx) / zoom;
      var dy = (e.clientY - sy) / zoom;
      if (axisLock && e.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      return { x: Math.round(dx), y: Math.round(dy) };
    }
    function snapSettings(e, zoom) {
      return {
        enabled: !!snapEnabled.peek(),
        disabled: !!e.altKey,
        grid: !!snapGrid.peek(),
        parent: !!snapParent.peek(),
        siblings: !!snapSiblings.peek(),
        gridSize: Math.max(1, Number(gridSize.peek()) || 16),
        zoom: zoom,
      };
    }
    function snapContext(slot, excludeIds, parentSize) {
      return {
        parentSize: parentSize,
        origin: parentOrigin(slot),
        siblings: siblingBoxes(slot, excludeIds, parentSize),
      };
    }
    function canvasSnapContext(excludeIds) {
      return {
        parentSize: canvasSize(),
        origin: { x: 0, y: 0 },
        siblings: sceneBoxes(excludeIds),
      };
    }
    function parentOrigin(slot) {
      var parent = slot.parentElement;
      if (!parent) return { x: 0, y: 0 };
      var pr = parent.getBoundingClientRect();
      var cr = canvas.getBoundingClientRect();
      var z = getZoom();
      return { x: (pr.left - cr.left) / z, y: (pr.top - cr.top) / z };
    }
    function siblingBoxes(slot, excludeIds, parentSize) {
      var parent = slot.parentElement;
      if (!parent) return [];
      var pr = parent.getBoundingClientRect();
      var z = getZoom();
      var exclude = new Set(Array.isArray(excludeIds) ? excludeIds : [excludeIds]);
      return Array.from(parent.children).filter(function (el) {
        return el !== slot && el.classList && el.classList.contains('ef-ui-abs-slot') &&
          (!el.dataset || !exclude.has(el.dataset.nodeId));
      }).map(function (el) {
        var r = el.getBoundingClientRect();
        return {
          l: (r.left - pr.left) / z,
          t: (r.top - pr.top) / z,
          w: r.width / z,
          h: r.height / z,
        };
      }).filter(function (b) { return b.w > 0 && b.h > 0; });
    }
    function sceneBoxes(excludeIds) {
      var cs = State.projectCardStyles()[styleKey];
      var rootId = cs && cs.root && cs.root.id;
      var excludeList = Array.isArray(excludeIds) ? excludeIds : [excludeIds];
      var exclude = new Set(cs && cs.root ? SceneNode.coveredIds(cs.root, excludeList) : excludeList);
      var seen = {};
      return SceneDOM.selectableTargets(canvas).filter(function (el) {
        var id = el.dataset && el.dataset.nodeId;
        if (!id || id === rootId || exclude.has(id) || seen[id]) return false;
        seen[id] = true;
        return true;
      }).map(function (el) {
        return boxForElement(el, canvas);
      }).filter(function (b) { return b.w > 0 && b.h > 0; });
    }
    function showGuides(guides) {
      GDE.clear(guideLayer);
      (guides || []).forEach(function (g) {
        if (g.source === 'grid') return;
        var line = ui.h('div', 'gde-cs-guide gde-cs-guide-' + g.axis + ' is-' + g.source);
        var origin = g.origin || { x: 0, y: 0 };
        if (g.axis === 'x') line.style.left = (origin.x + g.pos) + 'px';
        else line.style.top = (origin.y + g.pos) + 'px';
        guideLayer.appendChild(line);
      });
    }
    function clearGuides() {
      GDE.clear(guideLayer);
    }
    function bindPointerSession(move, up, cancel) {
      function cleanup() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
      }
      function onUp(e) {
        cleanup();
        up(e);
      }
      function onCancel() {
        cleanup();
        if (cancel) cancel();
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
    }
    function cancelTransformPreview() {
      clearGuides();
      rerender();
      applySelectionAffordances();
    }
    function withMove(layout, dx, dy) { return EF.ui.layoutRect.translate(layout, dx, dy); }
    function withResize(layout, dx, dy, edges, parentSize) {
      return EF.ui.layoutRect.resize(layout, edges, dx, dy, parentSize);
    }
    function parentSizeForSlot(slot, zoom) {
      var parent = slot.parentElement;
      if (!parent) return null;
      var r = parent.getBoundingClientRect();
      var z = zoom || 1;
      return { w: r.width / z, h: r.height / z };
    }
    function canvasSize() {
      var r = canvas.getBoundingClientRect();
      var z = getZoom();
      return { w: r.width / z, h: r.height / z };
    }
    function boxForSlot(slot, rootEl) {
      return boxForElement(slot, rootEl);
    }
    function boxForElement(el, rootEl) {
      var r = el.getBoundingClientRect();
      var cr = rootEl.getBoundingClientRect();
      var z = getZoom();
      return { l: (r.left - cr.left) / z, t: (r.top - cr.top) / z, w: r.width / z, h: r.height / z };
    }
    function groupBox(items) {
      var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      items.forEach(function (item) {
        var box = boxForSlot(item.slot, canvas);
        l = Math.min(l, box.l); t = Math.min(t, box.t);
        r = Math.max(r, box.l + box.w); b = Math.max(b, box.t + box.h);
      });
      return { l: l, t: t, w: r - l, h: b - t };
    }

    function applyAlign(op) {
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return;
      var ids = SceneSelection.idsFromSelection(State.selection(), styleKey);
      var movingIds = SceneNode.topLevelIds(cs.root, ids);
      var moving = movingNodes(cs.root, movingIds);
      if (moving.length < 2) return;
      var items = moving.map(function (m) {
        var slot = findSlot(m.id);
        return {
          id: m.id,
          layout: m.start,
          box: boxForSlot(slot, canvas),
          origin: parentOrigin(slot),
          parentSize: parentSizeForSlot(slot, getZoom()),
        };
      });
      var layouts = SceneAlign.apply(items, op);
      if (Object.keys(layouts).length) commitLayouts(layouts);
    }

    // Inline-style preview during drag. Mirrors absolute.js's appendChild
    // path on an existing slot element.
    function previewLayout(slot, layout) {
      EF.ui.layoutRect.applyToSlot(slot, layout);
    }
    function previewLayouts(layouts) {
      Object.keys(layouts).forEach(function (id) {
        var slot = findSlot(id);
        if (slot) previewLayout(slot, layouts[id]);
      });
    }
    function commitLayout(nodeId, layout) {
      State.mutateCardStyle(styleKey, function (clone) {
        var hit = SceneNode.find(clone.root, nodeId);
        if (!hit) return false;
        hit.node.layout = layout;
      });
    }
    function commitLayouts(layouts) {
      State.mutateCardStyle(styleKey, function (clone) {
        Object.keys(layouts).forEach(function (id) {
          var hit = SceneNode.find(clone.root, id);
          if (hit) hit.node.layout = layouts[id];
        });
      });
    }

    function startKeyboardMove() {
      var cs = State.projectCardStyles()[styleKey];
      if (!cs || !cs.root) return;
      var ids = SceneSelection.idsFromSelection(State.selection(), styleKey);
      var movingIds = SceneNode.topLevelIds(cs.root, ids);
      var moving = movingNodes(cs.root, movingIds);
      if (!moving.length) return;
      var primary = moving[0];
      var start = lastPointer || canvasCenterPoint();
      var cursor = { x: start.x, y: start.y };
      var axis = '';
      var typed = '';
      var z = getZoom();
      var parentSize = parentSizeForSlot(primary.slot, z);
      var snapCtx = snapContext(primary.slot, movingIds, parentSize);
      var groupStartBox = moving.length > 1 ? groupBox(moving) : null;
      var groupSnapCtx = groupStartBox ? canvasSnapContext(movingIds) : null;
      var done = false;
      root.setAttribute('data-transform-mode', 'move');

      function eventFromCursor() {
        var x = cursor.x, y = cursor.y;
        if (typed) {
          var n = Number(typed);
          if (Number.isFinite(n)) {
            if (axis === 'y') { x = start.x; y = start.y + n * z; }
            else { x = start.x + n * z; y = start.y; }
          }
        } else if (axis === 'x') y = start.y;
        else if (axis === 'y') x = start.x;
        return { clientX: x, clientY: y, shiftKey: false, altKey: false };
      }
      function currentLayouts() {
        return movedLayouts(primary, moving, eventFromCursor(), start.x, start.y, z, parentSize, snapCtx, groupStartBox, groupSnapCtx);
      }
      function preview() { previewLayouts(currentLayouts()); }
      function cleanup() {
        if (done) return;
        done = true;
        root.removeAttribute('data-transform-mode');
        clearGuides();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('keydown', onKey, true);
        document.removeEventListener('pointerdown', onPointer, true);
        document.removeEventListener('mousedown', onMouse, true);
        window.removeEventListener('blur', cancel);
      }
      function commit() {
        var layouts = currentLayouts();
        cleanup();
        commitLayouts(layouts);
      }
      function cancel() {
        cleanup();
        cancelTransformPreview();
      }
      function onMove(ev) {
        cursor = { x: ev.clientX, y: ev.clientY };
        lastPointer = cursor;
        if (!typed) preview();
      }
      function onMouse(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.button === 0) commit();
        else cancel();
      }
      function onPointer(ev) {
        onMouse(ev);
      }
      function onKey(ev) {
        var k = ev.key;
        if (k === 'Escape') { ev.preventDefault(); cancel(); return; }
        if (k === 'Enter') { ev.preventDefault(); commit(); return; }
        if (k === 'x' || k === 'X') { ev.preventDefault(); axis = axis === 'x' ? '' : 'x'; preview(); return; }
        if (k === 'y' || k === 'Y') { ev.preventDefault(); axis = axis === 'y' ? '' : 'y'; preview(); return; }
        if (k === 'Backspace') { ev.preventDefault(); typed = typed.slice(0, -1); preview(); return; }
        if (/^[0-9.-]$/.test(k)) { ev.preventDefault(); typed += k; preview(); }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('pointerdown', onPointer, true);
      document.addEventListener('mousedown', onMouse, true);
      window.addEventListener('blur', cancel);
    }

    function canvasCenterPoint() {
      var r = canvas.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function editorActive() {
      return root.isConnected && root.contains(document.activeElement);
    }

    EF.shortcuts.register({ key: 'a', shift: true, when: editorActive, run: function () { openAddMenu(lastPointer || canvasCenterPoint(), null); } }, root);
    EF.shortcuts.register({ key: 'g', when: editorActive, run: startKeyboardMove }, root);
    EF.shortcuts.register({ key: 'c', ctrl: true, when: editorActive, run: function () { GDE.cardStyleActions.copy(styleKey); } }, root);
    EF.shortcuts.register({ key: 'v', ctrl: true, when: editorActive, run: function () { GDE.cardStyleActions.paste(styleKey); } }, root);
    EF.shortcuts.register({ key: 'd', shift: true, when: editorActive, run: function () { GDE.cardStyleActions.duplicate(styleKey); } }, root);
    GDE.effect(root, rerender);
    ctx.bus.on('cardstyles:changed', rerender);
    // selection:changed �?rebuild affordances (highlight + handles).
    // cardstyles:changed must ALSO re-run them: rerender above wipes the
    // canvas (which destroys our handle DOM), so we need to remount onto
    // the freshly-rendered slot. Order matters �?rerender is subscribed
    // first so canvas is already rebuilt by the time affordances fire.
    ctx.bus.on('selection:changed',  applySelectionAffordances);
    ctx.bus.on('cardstyle:move-request', function (payload) {
      if (payload && payload.styleKey === styleKey) startKeyboardMove();
    });
    ctx.bus.on('cardstyles:changed', applySelectionAffordances);
    GDE.effect(root, applySelectionAffordances);

    // When activeCardStyle changes externally (e.g. user clicked a tile in
    // cardstyle-list), keep this panel pointed at its own styleKey �?list
    // opens a different panel for a different key, so we just stay put.
    return root;
  }

  EF.registerComponent('gde-cardstyle-editor', {
    category: 'panel',
    label: 'CardStyle',
    icon: 'columns',
    defaults: function () { return { title: t('panel.cardstyle'), icon: 'columns' }; },
    factory:  factory,
  });
})();




