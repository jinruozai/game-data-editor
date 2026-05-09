/**
 * CardStyle snapping — pure pixel-space snapping for the WYSIWYG editor.
 *
 * LayoutRect stays in the editor/model layer. This helper works only with
 * resolved boxes so the same rules apply to fixed, stretched, and mixed
 * anchor layouts.
 */
(function () {
  'use strict';

  var TOLERANCE_PX = 6;

  function computeMove(box, ctx, settings) {
    if (!enabled(settings)) return { box: roundBox(box), guides: [] };
    var out = cloneBox(box);
    var guides = [];
    var x = snapAxis('x', [
      { key: 'left',   pos: out.l },
      { key: 'center', pos: out.l + out.w / 2 },
      { key: 'right',  pos: out.l + out.w },
    ], ctx, settings);
    var y = snapAxis('y', [
      { key: 'top',    pos: out.t },
      { key: 'middle', pos: out.t + out.h / 2 },
      { key: 'bottom', pos: out.t + out.h },
    ], ctx, settings);
    if (x) { out.l += x.delta; guides.push(x.guide); }
    if (y) { out.t += y.delta; guides.push(y.guide); }
    return { box: roundBox(out), guides: guides };
  }

  function computeResize(box, edges, ctx, settings) {
    if (!enabled(settings)) return { box: roundBox(box), guides: [] };
    var out = cloneBox(box);
    var guides = [];
    if (edges.indexOf('w') >= 0) {
      var wl = snapAxis('x', [{ key: 'left', pos: out.l }], ctx, settings);
      if (wl) { out.l += wl.delta; out.w -= wl.delta; guides.push(wl.guide); }
    }
    if (edges.indexOf('e') >= 0) {
      var er = snapAxis('x', [{ key: 'right', pos: out.l + out.w }], ctx, settings);
      if (er) { out.w += er.delta; guides.push(er.guide); }
    }
    if (edges.indexOf('n') >= 0) {
      var nt = snapAxis('y', [{ key: 'top', pos: out.t }], ctx, settings);
      if (nt) { out.t += nt.delta; out.h -= nt.delta; guides.push(nt.guide); }
    }
    if (edges.indexOf('s') >= 0) {
      var sb = snapAxis('y', [{ key: 'bottom', pos: out.t + out.h }], ctx, settings);
      if (sb) { out.h += sb.delta; guides.push(sb.guide); }
    }
    out.w = Math.max(1, out.w);
    out.h = Math.max(1, out.h);
    return { box: roundBox(out), guides: guides };
  }

  function enabled(settings) {
    return settings && settings.enabled && !settings.disabled;
  }

  function snapAxis(axis, points, ctx, settings) {
    var smart = smartCandidates(axis, ctx, settings);
    var tolerance = (settings.tolerance || TOLERANCE_PX) / Math.max(0.01, settings.zoom || 1);
    var best = null;
    points.forEach(function (point) {
      smart.forEach(function (candidate) {
        consider(point, candidate, tolerance);
      });
      if (settings.grid) {
        var step = Math.max(1, Number(settings.gridSize) || 1);
        var pos = Math.round(point.pos / step) * step;
        consider(point, { pos: pos, source: 'grid', origin: ctx.origin }, step / 2);
      }
    });
    function consider(point, candidate, maxDist) {
      var delta = candidate.pos - point.pos;
      var dist = Math.abs(delta);
      if (dist > maxDist) return;
      var rank = sourceRank(candidate.source);
      if (!best || dist < best.dist || (dist === best.dist && rank < best.rank)) {
        best = { delta: delta, dist: dist, rank: rank, point: point, candidate: candidate };
      }
    }
    if (!best && settings.grid) {
      var primary = points[0];
      var step = Math.max(1, Number(settings.gridSize) || 1);
      var pos = Math.round(primary.pos / step) * step;
      best = {
        delta: pos - primary.pos,
        dist: Math.abs(pos - primary.pos),
        rank: sourceRank('grid'),
        point: primary,
        candidate: { pos: pos, source: 'grid', origin: ctx.origin },
      };
    }
    if (!best || Math.abs(best.delta) < 0.001) return null;
    return {
      delta: best.delta,
      guide: {
        axis: axis,
        pos: best.candidate.pos,
        source: best.candidate.source,
        origin: best.candidate.origin || ctx.origin,
      },
    };
  }

  function smartCandidates(axis, ctx, settings) {
    var out = [];
    var size = axis === 'x' ? ctx.parentSize.w : ctx.parentSize.h;
    if (settings.parent) {
      out.push({ pos: 0, source: 'parent', origin: ctx.origin });
      out.push({ pos: size / 2, source: 'parent', origin: ctx.origin });
      out.push({ pos: size, source: 'parent', origin: ctx.origin });
    }
    if (settings.siblings) {
      (ctx.siblings || []).forEach(function (b) {
        if (axis === 'x') {
          out.push({ pos: b.l, source: 'sibling', origin: ctx.origin });
          out.push({ pos: b.l + b.w / 2, source: 'sibling', origin: ctx.origin });
          out.push({ pos: b.l + b.w, source: 'sibling', origin: ctx.origin });
        } else {
          out.push({ pos: b.t, source: 'sibling', origin: ctx.origin });
          out.push({ pos: b.t + b.h / 2, source: 'sibling', origin: ctx.origin });
          out.push({ pos: b.t + b.h, source: 'sibling', origin: ctx.origin });
        }
      });
    }
    return out;
  }

  function sourceRank(source) {
    if (source === 'parent') return 0;
    if (source === 'sibling') return 1;
    return 2;
  }

  function cloneBox(b) { return { l: b.l, t: b.t, w: b.w, h: b.h }; }
  function roundBox(b) {
    return {
      l: Math.round(b.l),
      t: Math.round(b.t),
      w: Math.max(1, Math.round(b.w)),
      h: Math.max(1, Math.round(b.h)),
    };
  }

  window.CardStyleSnapping = {
    computeMove: computeMove,
    computeResize: computeResize,
  };
})();
