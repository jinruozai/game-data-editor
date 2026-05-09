/**
 * GameDataEditor application helpers.
 *
 * These helpers are intentionally thin wrappers over EditorFrame contracts.
 * They keep app code from bypassing EF.ui cleanup when rebuilding DOM by hand.
 */
(function () {
  'use strict';

  var GDE = window.GDE = window.GDE || {};

  function disposeNode(node) {
    if (!node) return;
    if (window.EF && EF.ui && EF.ui.dispose) EF.ui.dispose(node);
    else if (node.remove) node.remove();
  }

  function clear(el) {
    if (window.EF && EF.ui && EF.ui.disposeChildren) {
      EF.ui.disposeChildren(el);
      return;
    }
    while (el && el.firstChild) disposeNode(el.firstChild);
  }

  function effect(owner, fn) {
    var stop = EF.effect(fn);
    if (owner && EF.ui && EF.ui.collect) EF.ui.collect(owner, stop);
    return stop;
  }

  function derived(owner, fn) {
    var sig = EF.derived(fn);
    if (owner && EF.ui && EF.ui.collect) EF.ui.collect(owner, sig.dispose);
    return sig;
  }

  function on(owner, target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    var off = function () { target.removeEventListener(type, handler, opts); };
    if (owner && EF.ui && EF.ui.collect) EF.ui.collect(owner, off);
    return off;
  }

  GDE.dispose = disposeNode;
  GDE.clear = clear;
  GDE.effect = effect;
  GDE.derived = derived;
  GDE.on = on;
})();
