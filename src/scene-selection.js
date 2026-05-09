/**
 * Pure selection rules for scene-node editors.
 *
 * Mirrors the rest of GameDataEditor lists:
 *   click       -> single selection
 *   ctrl/cmd    -> toggle item
 *   shift       -> range from anchor through tree preorder
 *   blank click -> clear selection
 */
(function () {
  'use strict';

  function click(rootNode, currentIds, anchorId, clickedId, ev) {
    if (!clickedId) return { ids: [], anchorId: null };

    var cur = currentIds || [];
    if (ev && ev.shiftKey && anchorId) {
      var order = SceneNode.collectIds(rootNode);
      var i = order.indexOf(anchorId);
      var j = order.indexOf(clickedId);
      if (i >= 0 && j >= 0) {
        var lo = Math.min(i, j);
        var hi = Math.max(i, j);
        return { ids: order.slice(lo, hi + 1), anchorId: anchorId };
      }
    }

    if (ev && (ev.metaKey || ev.ctrlKey)) {
      var idx = cur.indexOf(clickedId);
      var next = idx >= 0
        ? cur.filter(function (id) { return id !== clickedId; })
        : cur.concat([clickedId]);
      return { ids: next, anchorId: clickedId };
    }

    return { ids: [clickedId], anchorId: clickedId };
  }

  function idsFromSelection(sel, styleKey) {
    return (sel && sel.kind === 'card_component' && sel.styleKey === styleKey)
      ? (sel.nodeIds || [])
      : [];
  }

  function marquee(rootNode, currentIds, hitIds, additive) {
    var normalized = uniqueInTreeOrder(rootNode, hitIds || []);
    if (!additive) return normalized;
    var set = new Set(currentIds || []);
    normalized.forEach(function (id) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    });
    return uniqueInTreeOrder(rootNode, Array.from(set));
  }

  function uniqueInTreeOrder(rootNode, ids) {
    var set = new Set(ids || []);
    return SceneNode.collectIds(rootNode).filter(function (id) { return set.has(id); });
  }

  window.SceneSelection = {
    click: click,
    idsFromSelection: idsFromSelection,
    marquee: marquee,
  };
})();
