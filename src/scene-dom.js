/**
 * SceneDOM bridges rendered EF.ui.renderUITree DOM and SceneNode ids.
 *
 * EF.ui.renderUITree marks every component wrapper with data-ef-node-id.
 * SceneDOM adds one editor hit target per node via data-node-id:
 *   - absolute/overlay children: their absolute slot owns geometry
 *   - flow children: the node wrapper owns geometry
 */
(function () {
  'use strict';

  function cssEscape(value) {
    return String(value).replace(/(["\\])/g, '\\$1');
  }

  function annotate(rootEl, rootNode) {
    if (!rootNode) return;
    rootEl.dataset.nodeId = rootNode.id;
    walk(rootEl, rootNode);
  }

  function walk(domEl, treeNode) {
    var spec = null;
    try { spec = EF.resolveComponent(treeNode.component); } catch (_) {}
    if (!treeNode.children || !treeNode.children.length) return;

    if (treeNode.component === 'absolute') {
      var slots = Array.from(domEl.querySelectorAll(':scope > .ef-ui-node-body > .ef-ui-absolute > .ef-ui-abs-slot'));
      slots.forEach(function (slot, i) {
        var child = treeNode.children[i];
        if (!child) return;
        slot.dataset.nodeId = child.id;
        if (slot.firstElementChild) walk(slot.firstElementChild, child);
      });
      return;
    }

    if (spec && spec.appendChild) {
      var kids = Array.from(domEl.querySelectorAll(':scope > .ef-ui-node-body > :first-child > .ef-ui-node'));
      kids.forEach(function (kidEl, i) {
        var child = treeNode.children[i];
        if (!child) return;
        kidEl.dataset.nodeId = child.id;
        walk(kidEl, child);
      });
      return;
    }

    var overlaySlots = Array.from(domEl.querySelectorAll(':scope > .ef-ui-node-children > .ef-ui-abs-slot'));
    overlaySlots.forEach(function (slot, i) {
      var child = treeNode.children[i];
      if (!child) return;
      slot.dataset.nodeId = child.id;
      if (slot.firstElementChild) walk(slot.firstElementChild, child);
    });
  }

  function idFromEvent(ev, stopEl) {
    var t = ev.target;
    while (t && t !== stopEl) {
      if (t.dataset && t.dataset.nodeId) return t.dataset.nodeId;
      t = t.parentElement;
    }
    return null;
  }

  function hitTarget(rootEl, nodeId) {
    var all = Array.from(rootEl.querySelectorAll('[data-node-id="' + cssEscape(nodeId) + '"]'));
    for (var i = 0; i < all.length; i++) {
      if (all[i].classList.contains('ef-ui-abs-slot')) return all[i];
    }
    return all[0] || null;
  }

  function wrapper(rootEl, nodeId) {
    return rootEl.querySelector('[data-ef-node-id="' + cssEscape(nodeId) + '"]');
  }

  function slot(rootEl, nodeId) {
    var el = hitTarget(rootEl, nodeId);
    return el && el.classList.contains('ef-ui-abs-slot') ? el : null;
  }

  function layoutElement(rootEl, node) {
    var wrap = wrapper(rootEl, node.id);
    if (!wrap) return null;
    if (node.component === 'absolute') {
      return wrap.querySelector(':scope > .ef-ui-node-body > .ef-ui-absolute') || wrap;
    }
    return wrap;
  }

  function selectedTargets(rootEl) {
    return Array.from(rootEl.querySelectorAll('[data-node-id].is-selected-node'));
  }

  function selectableTargets(rootEl) {
    var byId = {};
    Array.from(rootEl.querySelectorAll('[data-node-id]')).forEach(function (el) {
      var id = el.dataset && el.dataset.nodeId;
      if (!id || el.offsetWidth <= 0 || el.offsetHeight <= 0) return;
      if (!byId[id] || el.classList.contains('ef-ui-abs-slot')) byId[id] = el;
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function idsInRect(rootEl, rect) {
    return selectableTargets(rootEl).filter(function (el) {
      var r = el.getBoundingClientRect();
      return rectsIntersect(rect, r);
    }).map(function (el) { return el.dataset.nodeId; });
  }

  function rectsIntersect(a, b) {
    return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
  }

  function applySelection(rootEl, ids) {
    selectedTargets(rootEl).forEach(function (el) { el.classList.remove('is-selected-node'); });
    (ids || []).forEach(function (id) {
      var el = hitTarget(rootEl, id);
      if (el) el.classList.add('is-selected-node');
    });
  }

  window.SceneDOM = {
    annotate: annotate,
    idFromEvent: idFromEvent,
    hitTarget: hitTarget,
    wrapper: wrapper,
    slot: slot,
    layoutElement: layoutElement,
    selectableTargets: selectableTargets,
    idsInRect: idsInRect,
    selectedTargets: selectedTargets,
    applySelection: applySelection,
  };
})();
