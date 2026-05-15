/**
 * GDE.history - project history adapter.
 *
 * The framework EF.history owns the generic timeline. This file defines what
 * a GameDataEditor snapshot is and when project mutations should be captured.
 */
(function () {
  'use strict';

  var CAPTURE_DELAY = 180;
  var timer = null;
  var pendingLabel = '';
  var pendingMeta = null;
  var savedIndex = EF.signal(-1);

  function cloneJson(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function cloneSnapshot(snapshot) {
    var s = snapshot || {};
    return {
      project: cloneJson(s.project || {}),
      type_config: cloneJson(s.type_config || {}),
      card_styles: cloneJson(s.card_styles || {}),
      tables: cloneJson(s.tables || {}),
      assets: cloneAssetSnapshot(s.assets || {}),
    };
  }

  function cloneAssetSnapshot(assetSnap) {
    var outFiles = {};
    Object.keys(assetSnap.files || {}).forEach(function (path) {
      var f = assetSnap.files[path];
      outFiles[path] = {
        path: f.path,
        url: f.url,
        name: f.name,
        dir: f.dir,
        kind: f.kind,
        size: f.size,
        blob: f.blob,
        hash: f.hash || '',
        ctime: f.ctime || 0,
        mtime: f.mtime || 0,
      };
    });
    return {
      files: outFiles,
      hashes: Object.assign({}, assetSnap.hashes || {}),
      folders: Object.assign({}, assetSnap.folders || {}),
    };
  }

  function compareSnapshot(snapshot) {
    var s = cloneSnapshot(snapshot);
    Object.keys(s.assets.files || {}).forEach(function (path) {
      var f = s.assets.files[path];
      f.blob = null;
    });
    return JSON.stringify(s);
  }

  function captureProject() {
    var snap = ProjectIO.codec.exportSnapshot();
    snap.assets = ProjectIO.assets.snapshot();
    return snap;
  }

  function applyProject(snapshot) {
    ProjectIO.codec.applySnapshot(snapshot, snapshot && snapshot.project && snapshot.project.name, {
      preserveTabs: true,
      preserveSelection: false,
    });
    ProjectIO.assets.restore(snapshot && snapshot.assets || null);
  }

  var engine = EF.history.create({
    capture: captureProject,
    apply: applyProject,
    clone: cloneSnapshot,
    equals: function (a, b) { return compareSnapshot(a) === compareSnapshot(b); },
    limit: 200,
  });

  EF.effect(function () {
    var idx = engine.index();
    var saved = savedIndex();
    if (saved >= 0 && idx === saved) State.clearDirty();
    else if (saved >= 0) State.markDirty();
  });

  function clearPending() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
    pendingLabel = '';
    pendingMeta = null;
  }

  function capture(label, meta) {
    if (engine.applying.peek()) return;
    pendingLabel = label || pendingLabel || t('history.edit_project');
    pendingMeta = meta || pendingMeta || null;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      engine.capture(pendingLabel, pendingMeta);
      pendingLabel = '';
      pendingMeta = null;
    }, CAPTURE_DELAY);
  }

  function captureNow(label, meta) {
    clearPending();
    return engine.capture(label || t('history.edit_project'), meta || null);
  }

  function flush() {
    if (!timer) return engine.current();
    clearTimeout(timer);
    timer = null;
    var entry = engine.capture(pendingLabel || t('history.edit_project'), pendingMeta || null);
    pendingLabel = '';
    pendingMeta = null;
    return entry;
  }

  function reset(label, options) {
    clearPending();
    var entry = engine.reset(label || t('history.open_demo'), { kind: 'baseline' });
    if (options && options.saved) savedIndex.set(engine.index.peek());
    else savedIndex.set(-1);
    return entry;
  }

  function markSaved() {
    flush();
    savedIndex.set(engine.index.peek());
    State.clearDirty();
  }

  function pause(fn) {
    clearPending();
    return engine.pause(fn);
  }

  function captureEvent(ev, payload) {
    if (engine.applying.peek()) return;
    capture(labelForEvent(ev, payload), { event: ev });
  }

  function labelForEvent(ev, payload) {
    if (ev === 'assets:changed') return t('history.edit_assets');
    if (ev === 'typeconfig:changed') return t('history.edit_typeconfig');
    if (ev === 'cardstyles:changed') return t('history.edit_cardstyle');
    if (ev === 'tables:changed') return t('history.edit_tables');
    if (ev.indexOf('data:changed:') === 0) return t('history.edit_table', { name: ev.slice('data:changed:'.length) });
    return t('history.edit_project');
  }

  function jump(index) {
    clearPending();
    return engine.jump(index, 'jump');
  }

  function undo() {
    clearPending();
    return engine.undo();
  }

  function redo() {
    clearPending();
    return engine.redo();
  }

  function installShortcuts() {
    var off = [
      EF.shortcuts.register({ key: 'z', ctrl: true, priority: 10, run: undo }),
      EF.shortcuts.register({ key: 'z', ctrl: true, shift: true, priority: 10, run: redo }),
      EF.shortcuts.register({ key: 'y', ctrl: true, priority: 10, run: redo }),
    ];
    return function () { off.forEach(function (fn) { fn(); }); };
  }

  window.GDE = window.GDE || {};
  window.GDE.history = {
    entries: engine.entries,
    index: engine.index,
    applying: engine.applying,
    current: engine.current,
    canUndo: engine.canUndo,
    canRedo: engine.canRedo,
    capture: capture,
    captureNow: captureNow,
    flush: flush,
    captureEvent: captureEvent,
    reset: reset,
    markSaved: markSaved,
    pause: pause,
    jump: jump,
    undo: undo,
    redo: redo,
    installShortcuts: installShortcuts,
  };
})();
