/**
 * SceneNode utilities for cardStyle UI trees.
 *
 * Shape:
 *   { id, component, props, bindings, layout, children }
 *
 * The renderer treats every node as a parent-capable scene node. Components
 * may provide custom child layout via spec.appendChild; otherwise children
 * are placed in the default absolute overlay layer.
 */
(function () {
  'use strict';

  var nextId = 1;

  function uid(prefix) {
    return (prefix || 'node') + '-' + (nextId++) + '-' + Date.now().toString(36);
  }

  function create(componentName, opts) {
    var o = opts || {};
    var spec = EF.resolveComponent(componentName);
    var node = {
      id:        o.id || uid(componentName),
      component: componentName,
      props:     Object.assign({}, spec.defaultProps || {}, o.props || {}),
      bindings:  Object.assign({}, o.bindings || {}),
      children:  [],
    };
    if (o.children) node.children = o.children.map(clone);
    if (o.layout === false) return node;
    node.layout = o.layout || defaultLayout(componentName, o.x == null ? 8 : o.x, o.y == null ? 8 : o.y);
    return node;
  }

  function defaultLayout(componentName, x, y) {
    var size = defaultSize(componentName);
    return {
      aMin: { x: 0, y: 0 }, aMax: { x: 0, y: 0 },
      oMin: { x: x, y: y }, oMax: { x: x + size.w, y: y + size.h },
    };
  }

  function defaultSize(componentName) {
    var spec = EF.resolveComponent(componentName);
    var p = spec.defaultProps || {};
    var w = Number(p.width) || (componentName === 'image' ? 80 : 96);
    var h = Number(p.height) || (componentName === 'image' ? 80 : 28);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function layoutForParent(parentNode, childComponent, currentLayout) {
    var spec = null;
    try { spec = parentNode ? EF.resolveComponent(parentNode.component) : null; } catch (_) {}
    if (spec && spec.appendChild && parentNode.component !== 'absolute') return null;
    return currentLayout || defaultLayout(childComponent, 8, 8);
  }

  function find(root, id, parent, index) {
    if (!root) return null;
    if (root.id === id) return { node: root, parent: parent || null, index: index == null ? -1 : index };
    var kids = root.children || [];
    for (var i = 0; i < kids.length; i++) {
      var hit = find(kids[i], id, root, i);
      if (hit) return hit;
    }
    return null;
  }

  function orderByDepth(root, ids) {
    var depths = {};
    function walk(n, d) {
      if (!n) return;
      depths[n.id] = d;
      (n.children || []).forEach(function (c) { walk(c, d + 1); });
    }
    walk(root, 0);
    return (ids || []).slice().sort(function (a, b) { return (depths[b] || 0) - (depths[a] || 0); });
  }

  function clone(node) {
    return JSON.parse(JSON.stringify(node));
  }

  function cloneWithFreshIds(node) {
    var c = clone(node);
    retag(c);
    return c;
  }

  function retag(node) {
    if (!node) return;
    node.id = uid(node.component);
    (node.children || []).forEach(retag);
  }

  function collectIds(root) {
    var out = [];
    (function walk(n) {
      if (!n) return;
      out.push(n.id);
      (n.children || []).forEach(walk);
    })(root);
    return out;
  }

  function topLevelIds(root, ids) {
    var selected = new Set(ids || []);
    var out = [];
    function walk(node, blocked) {
      if (!node) return;
      var isSelected = selected.has(node.id);
      if (isSelected && !blocked) out.push(node.id);
      (node.children || []).forEach(function (child) { walk(child, blocked || isSelected); });
    }
    walk(root, false);
    return out;
  }

  function coveredIds(root, ids) {
    var targets = new Set(ids || []);
    var out = [];
    function walk(node, covered) {
      if (!node) return;
      var nextCovered = covered || targets.has(node.id);
      if (nextCovered) out.push(node.id);
      (node.children || []).forEach(function (child) { walk(child, nextCovered); });
    }
    walk(root, false);
    return out;
  }

  window.SceneNode = {
    uid: uid,
    create: create,
    defaultLayout: defaultLayout,
    defaultSize: defaultSize,
    layoutForParent: layoutForParent,
    find: find,
    orderByDepth: orderByDepth,
    clone: clone,
    retag: retag,
    cloneWithFreshIds: cloneWithFreshIds,
    collectIds: collectIds,
    topLevelIds: topLevelIds,
    coveredIds: coveredIds,
  };
})();
