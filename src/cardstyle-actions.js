/**
 * Shared CardStyle scene object actions.
 *
 * Object tree and scene canvas both operate on the same selected TreeNodes,
 * so copy/paste/duplicate live here instead of in either panel.
 */
(function () {
  'use strict';

  var GDE = window.GDE = window.GDE || {};
  var clipboard = EF.signal([]);

  function style(styleKey) {
    var key = styleKey || State.activeCardStyle.peek();
    var cs = key ? State.projectCardStyles()[key] : null;
    return cs && cs.root ? { key: key, def: cs } : null;
  }

  function selectedIds(styleKey) {
    var s = style(styleKey);
    var sel = State.selection();
    if (!s || !sel || sel.kind !== 'card_component' || sel.styleKey !== s.key) return [];
    return sel.nodeIds || (sel.nodeId ? [sel.nodeId] : []);
  }

  function activeNodeId(styleKey) {
    var ids = selectedIds(styleKey);
    return ids.length ? ids[ids.length - 1] : null;
  }

  function copy(styleKey, fallbackId) {
    var s = style(styleKey);
    if (!s) return false;
    var ids = (selectedIds(s.key).length ? selectedIds(s.key) : (fallbackId ? [fallbackId] : []))
      .filter(function (id) { return id !== s.def.root.id; });
    ids = SceneNode.topLevelIds(s.def.root, ids);
    if (!ids.length) { State.log('warn', 'Nothing to copy (root cannot be copied).'); return false; }
    var payloads = ids.map(function (id) {
      var hit = SceneNode.find(s.def.root, id);
      return hit ? SceneNode.clone(hit.node) : null;
    }).filter(Boolean);
    clipboard.set(payloads);
    State.log('info', 'Copied ' + payloads.length + ' node(s).');
    return true;
  }

  function paste(styleKey) {
    var s = style(styleKey);
    if (!s) return false;
    var targetId = activeNodeId(s.key) || s.def.root.id;
    return targetId === s.def.root.id ? pasteAsChild(s.key, targetId) : pasteAsSibling(s.key, targetId);
  }

  function pasteAsChild(styleKey, targetId) {
    var s = style(styleKey);
    var clip = clipboard.peek() || [];
    if (!s || !clip.length) return false;
    var fresh = clip.map(SceneNode.cloneWithFreshIds);
    var changed = State.mutateCardStyle(s.key, function (clone) {
      var hit = SceneNode.find(clone.root, targetId);
      if (!hit) return false;
      hit.node.children = hit.node.children || [];
      fresh.forEach(function (n) { n.layout = SceneNode.layoutForParent(hit.node, n.component, n.layout); });
      Array.prototype.push.apply(hit.node.children, fresh);
    });
    if (!changed) return false;
    State.setSelection({ kind: 'card_component', styleKey: s.key, nodeIds: fresh.map(function (n) { return n.id; }) });
    return true;
  }

  function pasteAsSibling(styleKey, targetId) {
    var s = style(styleKey);
    var clip = clipboard.peek() || [];
    if (!s || !clip.length) return false;
    if (s.def.root.id === targetId) return pasteAsChild(s.key, targetId);
    var fresh = clip.map(SceneNode.cloneWithFreshIds);
    var changed = State.mutateCardStyle(s.key, function (clone) {
      var hit = SceneNode.find(clone.root, targetId);
      if (!hit || !hit.parent) return false;
      fresh.forEach(function (n) { n.layout = SceneNode.layoutForParent(hit.parent, n.component, n.layout); });
      Array.prototype.splice.apply(hit.parent.children, [hit.index + 1, 0].concat(fresh));
    });
    if (!changed) return false;
    State.setSelection({ kind: 'card_component', styleKey: s.key, nodeIds: fresh.map(function (n) { return n.id; }) });
    return true;
  }

  function duplicate(styleKey) {
    var s = style(styleKey);
    if (!s) return false;
    var ids = SceneNode.topLevelIds(s.def.root, selectedIds(s.key)).filter(function (id) { return id !== s.def.root.id; });
    if (!ids.length) return false;
    var fresh = [];
    var changed = State.mutateCardStyle(s.key, function (clone) {
      ids.forEach(function (id) {
        var hit = SceneNode.find(clone.root, id);
        if (!hit || !hit.parent) return;
        var node = SceneNode.cloneWithFreshIds(hit.node);
        node.layout = SceneNode.layoutForParent(hit.parent, node.component, node.layout);
        hit.parent.children.splice(hit.index + 1, 0, node);
        fresh.push(node);
      });
      return fresh.length > 0;
    });
    if (!changed) return false;
    State.setSelection({ kind: 'card_component', styleKey: s.key, nodeIds: fresh.map(function (n) { return n.id; }) });
    EF.bus.emit('cardstyle:move-request', { styleKey: s.key });
    return true;
  }

  function sceneText(styleKey, nodeId) {
    var s = style(styleKey);
    if (!s) return '';
    var rootNode = s.def.root;
    if (nodeId) {
      var hit = SceneNode.find(s.def.root, nodeId);
      if (!hit) return '';
      rootNode = hit.node;
    }
    return JSON.stringify({
      format: 'gde.cardStyle.scene',
      version: 1,
      cardStyle: s.key,
      name: s.def.name || s.key,
      scope: nodeId ? 'subtree' : 'scene',
      root: SceneNode.clone(rootNode),
    }, null, 2);
  }

  function copySceneText(styleKey, nodeId) {
    var text = sceneText(styleKey, nodeId);
    if (!text) return false;
    copyText(text).then(function () {
      State.log('info', nodeId ? 'Copied subtree scene text.' : 'Copied cardStyle scene text.');
    });
    return true;
  }

  function copyText(text) {
    return EF.ui.copyText(text);
  }

  GDE.cardStyleActions = {
    clipboard: clipboard,
    selectedIds: selectedIds,
    activeNodeId: activeNodeId,
    canPaste: function () { return (clipboard.peek() || []).length > 0; },
    copy: copy,
    paste: paste,
    pasteAsChild: pasteAsChild,
    pasteAsSibling: pasteAsSibling,
    duplicate: duplicate,
    copySceneText: copySceneText,
    sceneText: sceneText,
  };
})();
