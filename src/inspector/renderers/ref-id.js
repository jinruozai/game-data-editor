/**
 * GameDataEditor Inspector ref_id renderer.
 */
(function () {
  'use strict';

  var ui = EF.ui;

  // Project-specific ref_id renderer.
  //
  // Display: shows the target entity name, with an optional icon before it.
  // Text comes from id.ref_name (default: name, falling back to id). Icon
  // comes from id.ref_icon (default: icon) only when that field exists and
  // resolves to a renderable asset URL.
  //
  // Edit: clicking the field opens a popover picker - text input + a
  // filtered list of `<id> : <ref_name>` rows, with typed substring
  // highlighted. Up/down / Enter / Esc / click-to-commit. Supports id or
  // ref_name matching.
  //
  // Drop target: accepts `application/ef.entity+json` dragged from the
  // left-side tree (or any source that emits that MIME), committing the
  // dropped entity's id.
  ui.registerRenderer('ref_id', function (args) {
    var sig = args.sig;
    var write = args.write;

    var root = ui.h('div', 'gde-refid');
    root.tabIndex = 0;
    root.title = 'Edit reference';
    var face = ui.h('div', 'gde-refid-face');
    var gotoBtn = ui.iconButton({
      icon: 'arrow-right', title: 'Go to target', size: 'sm', kind: 'ghost',
      onClick: function (ev) {
        if (ev) ev.stopPropagation();
        var id = sig.peek();
        if (id == null || id === 0) return;
        var info = State.resolveEntityDisplay(id);
        if (!info) { State.log('warn', 'Cannot jump: id ' + id + ' not found'); return; }
        // resolveEntityDisplay doesn't expose pathKey �?redo the lookup
        // once here (the only place that actually needs it).
        var tm = State.tableMap(), sid = String(id), pk = null;
        Object.keys(tm).some(function (k) { if ((tm[k].id || []).indexOf(sid) >= 0) { pk = k; return true; } return false; });
        if (pk) EF.bus.emit('nav:goto', { pathKey: pk, id: sid });
      },
    });
    root.appendChild(face); root.appendChild(gotoBtn);
    root.addEventListener('click', function () { openPicker(); });
    root.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { openPicker(); ev.preventDefault(); }
    });

    // Paint the display face. Re-runs on signal change + gameData change
    // (so e.g. renaming the target entity updates the face live).
    var faceCleanup = null;
    GDE.effect(root, function () {
      State.gameData();                             // subscribe
      var id = sig();
      if (faceCleanup) { try { faceCleanup() } catch (_) {} faceCleanup = null; }
      GDE.clear(face);
      if (id == null || id === '' || id === 0) {
        face.textContent = '(none)';
        face.classList.add('is-empty');
        return;
      }
      face.classList.remove('is-empty');
      var info = State.resolveEntityDisplay(id);
      var name = info ? info.name : String(id);
      var iconUrl = info && info.icon ? InspectorRenderers.resolveAssetPreview(info.icon) : '';
      if (iconUrl) {
        var img = ui.h('img', 'gde-refid-icon');
        img.src = iconUrl;
        img.alt = '';
        face.appendChild(img);
      }
      face.appendChild(ui.h('span', 'gde-refid-name', { text: name }));
    });

    // Drop target �?accept dragged entities or plain-text ids.
    ui.dropzone(root, {
      accept: ['application/ef.entity+json', 'text/plain'],
      canDrop: function (d) { return !!(d.entity && d.entity.id != null) || !!(d.text && /^\d+$/.test(String(d.text))); },
      onDrop: function (d) {
        var nid = (d.entity && d.entity.id != null) ? d.entity.id : d.text;
        commit(nid);
      },
    });

    function commit(id) {
      var n = Number(id);
      write(Number.isFinite(n) && String(n).length === String(id).length ? n : String(id));
    }

    // ── Picker popover ──────────────────────────────────────────
    var pop = null;
    function openPicker() {
      if (pop) return;
      var container = ui.h('div', 'gde-refid-picker');
      var input = ui.h('input', 'gde-refid-picker-input', { type: 'text' });
      input.value = String(sig.peek() == null ? '' : sig.peek());
      var listEl = ui.h('div', 'gde-refid-picker-list');
      container.appendChild(input); container.appendChild(listEl);

      var candidates = [];
      var focusIdx = 0;

      function rebuild() {
        var q = input.value.trim();
        var qLow = q.toLowerCase();
        var gd = State.gameData();
        var hits = [];
        Object.keys(gd).forEach(function (sid) {
          var info = State.resolveEntityDisplay(sid);
          if (!info) return;
          var label = info.name;
          if (!q
            || sid.toLowerCase().indexOf(qLow) >= 0
            || (label && label.toLowerCase().indexOf(qLow) >= 0)) {
            hits.push({ id: sid, label: label, icon: info.icon });
          }
        });
        candidates = hits.slice(0, 50);
        focusIdx = 0;
        paint();
      }
      function paint() {
        GDE.clear(listEl);
        if (!candidates.length) {
          var empty = ui.h('div', 'gde-refid-picker-empty', { text: 'No matches' });
          listEl.appendChild(empty); return;
        }
        var q = input.value.trim();
        candidates.forEach(function (c, i) {
          var row = ui.h('div', 'gde-refid-picker-row');
          if (i === focusIdx) row.classList.add('is-focused');
          var iconUrl = c.icon ? InspectorRenderers.resolveAssetPreview(c.icon) : '';
          if (iconUrl) {
            var icon = ui.h('img', 'gde-refid-icon');
            icon.src = iconUrl;
            icon.alt = '';
            row.appendChild(icon);
          }
          row.appendChild(mark(c.id, q));
          row.appendChild(ui.h('span', 'gde-refid-picker-sep', { text: ' : ' }));
          row.appendChild(mark(c.label, q));
          row.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
            commit(c.id); close();
          });
          row.addEventListener('mouseenter', function () {
            focusIdx = i;
            refreshFocus();
          });
          listEl.appendChild(row);
        });
      }
      function refreshFocus() {
        Array.from(listEl.children).forEach(function (r, i) {
          r.classList.toggle('is-focused', i === focusIdx);
        });
        var el = listEl.children[focusIdx];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      }
      function mark(text, q) {
        var frag = document.createDocumentFragment();
        var s = String(text == null ? '' : text);
        if (!q) { frag.appendChild(document.createTextNode(s)); return frag; }
        var low = s.toLowerCase(); var qL = q.toLowerCase();
        var i = 0;
        while (i < s.length) {
          var hit = low.indexOf(qL, i);
          if (hit < 0) { frag.appendChild(document.createTextNode(s.slice(i))); break; }
          if (hit > i) frag.appendChild(document.createTextNode(s.slice(i, hit)));
          var m = document.createElement('mark'); m.className = 'gde-refid-picker-hit';
          m.textContent = s.slice(hit, hit + q.length);
          frag.appendChild(m);
          i = hit + q.length;
        }
        return frag;
      }
      input.addEventListener('input', rebuild);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown') { focusIdx = Math.min(focusIdx + 1, candidates.length - 1); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'ArrowUp')   { focusIdx = Math.max(focusIdx - 1, 0); refreshFocus(); ev.preventDefault(); }
        else if (ev.key === 'Enter')     {
          if (candidates[focusIdx]) { commit(candidates[focusIdx].id); close(); }
          ev.preventDefault();
        }
        else if (ev.key === 'Escape')    { close(); ev.preventDefault(); }
      });

      rebuild();
      pop = ui.popover({
        anchor: root, content: container,
        side: 'bottom', align: 'start',
        onDismiss: function () { pop = null; },
      });
      setTimeout(function () { input.focus(); input.select(); }, 0);
    }
    function close() { if (pop) { pop.close(); pop = null; } }
    ui.collect(root, close);

    return root;
  });


})();
