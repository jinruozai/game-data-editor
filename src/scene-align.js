/**
 * SceneAlign — pure-ish layout operations for selected absolute/overlay nodes.
 *
 * Works in canvas coordinate space, then converts each target back into its
 * own parent coordinate space before producing LayoutRect updates.
 */
(function () {
  'use strict';

  function apply(items, op) {
    if (!items || items.length < 2) return {};
    var boxes = items.map(function (it) { return it.box; });
    var bounds = bound(boxes);
    var next = boxes.map(cloneBox);

    if (op === 'left') each(next, function (b) { b.l = bounds.l; });
    else if (op === 'center-x') each(next, function (b) { b.l = bounds.l + (bounds.w - b.w) / 2; });
    else if (op === 'right') each(next, function (b) { b.l = bounds.r - b.w; });
    else if (op === 'top') each(next, function (b) { b.t = bounds.t; });
    else if (op === 'center-y') each(next, function (b) { b.t = bounds.t + (bounds.h - b.h) / 2; });
    else if (op === 'bottom') each(next, function (b) { b.t = bounds.b - b.h; });
    else if (op === 'distribute-x') distribute(next, 'x');
    else if (op === 'distribute-y') distribute(next, 'y');
    else return {};

    var out = {};
    items.forEach(function (it, i) {
      out[it.id] = boxToLayout(next[i], it);
    });
    return out;
  }

  function each(list, fn) {
    for (var i = 0; i < list.length; i++) fn(list[i]);
  }

  function bound(boxes) {
    var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    boxes.forEach(function (box) {
      l = Math.min(l, box.l);
      t = Math.min(t, box.t);
      r = Math.max(r, box.l + box.w);
      b = Math.max(b, box.t + box.h);
    });
    return { l: l, t: t, r: r, b: b, w: r - l, h: b - t };
  }

  function distribute(boxes, axis) {
    if (boxes.length < 3) return;
    var pos = axis === 'x' ? 'l' : 't';
    var size = axis === 'x' ? 'w' : 'h';
    boxes.sort(function (a, b) { return a[pos] - b[pos]; });
    var first = boxes[0];
    var last = boxes[boxes.length - 1];
    var span = (last[pos] + last[size]) - first[pos];
    var total = boxes.reduce(function (sum, b) { return sum + b[size]; }, 0);
    var gap = (span - total) / (boxes.length - 1);
    var cursor = first[pos] + first[size] + gap;
    for (var i = 1; i < boxes.length - 1; i++) {
      boxes[i][pos] = cursor;
      cursor += boxes[i][size] + gap;
    }
  }

  function boxToLayout(box, item) {
    return EF.ui.layoutRect.fromBox({
      l: box.l - item.origin.x,
      t: box.t - item.origin.y,
      w: box.w,
      h: box.h,
    }, item.layout, item.parentSize);
  }

  function cloneBox(b) {
    return { l: b.l, t: b.t, w: b.w, h: b.h };
  }

  window.SceneAlign = {
    apply: apply,
  };
})();
