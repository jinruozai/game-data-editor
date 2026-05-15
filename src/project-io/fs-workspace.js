/**
 * ProjectIO.fsWorkspace — File System Access API workspace backend.
 */
(function () {
  'use strict';

  var codec = null;
  var current = null;

  function c() { return codec || (codec = window.ProjectIO.codec); }

  function supported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  async function openFolder(options) {
    options = options || {};
    if (!supported()) throw new Error('This browser does not support folder access.');
    var dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    await loadFromHandle(dir, options);
    current = { kind: 'folder', name: dir.name, handle: dir };
    return current;
  }

  async function saveAs(options) {
    options = options || {};
    if (!supported()) throw new Error('This browser does not support folder access.');
    var dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    current = { kind: 'folder', name: dir.name, handle: dir };
    await save(Object.assign({}, options, { full: true }));
    return current;
  }

  async function save(options) {
    options = options || {};
    if (!current || !current.handle) return saveAs(options);
    var progress = options.progress;
    report(progress, 'Checking folder permission...');
    await ensurePermission(current.handle);
    report(progress, 'Serializing project...');
    var snapshot = c().exportSnapshot();
    var files = c().snapshotToFiles(snapshot);
    var plan = options.plan || ProjectIO.savePlan.diff(files, { allAdded: !!options.full });
    await writeProjectFiles(current.handle, files, plan, progress, { full: !!options.full });
    await ProjectIO.assets.writeToDirectory(current.handle, { progress: progress, full: !!options.full, plan: options.assetPlan });
    ProjectIO.savePlan.markSaved(files, plan);
    report(progress, 'Save complete', 1, 1);
    return current;
  }

  async function loadFromHandle(dir, options) {
    options = options || {};
    var progress = options.progress;
    report(progress, 'Checking folder permission...');
    await ensurePermission(dir);
    var files = await readProjectFiles(dir, progress);
    await ProjectIO.assets.loadFromDirectory(dir, { progress: progress });
    report(progress, 'Applying project data...');
    c().applySnapshot(c().filesToSnapshot(files), dir.name);
    ProjectIO.savePlan.setBaseline(c().snapshotToFiles(c().exportSnapshot()));
    if (window.GDE && GDE.history) GDE.history.reset(t('history.open_project', { name: dir.name }), { saved: true });
    report(progress, 'Project loaded', 1, 1);
  }

  async function ensurePermission(handle) {
    if (handle.queryPermission) {
      var q = await handle.queryPermission({ mode: 'readwrite' });
      if (q === 'granted') return;
    }
    if (handle.requestPermission) {
      var r = await handle.requestPermission({ mode: 'readwrite' });
      if (r === 'granted') return;
    }
    throw new Error('Folder permission denied.');
  }

  async function readProjectFiles(dir, progress) {
    var files = {};
    var handles = [];
    report(progress, 'Scanning JSON files...');
    await walk(dir, '', async function (path, fileHandle) {
      if (isSpecialPath(path)) return;
      if (!/\.json$/i.test(path)) return;
      handles.push({ path: path, handle: fileHandle });
    });
    for (var i = 0; i < handles.length; i++) {
      report(progress, 'Reading JSON files...', i, handles.length, handles[i].path);
      var file = await handles[i].handle.getFile();
      files[handles[i].path] = await file.text();
      await yieldUI();
    }
    report(progress, 'Reading JSON files...', handles.length, handles.length);
    return files;
  }

  async function walk(dir, prefix, visitFile) {
    for await (var entry of dir.values()) {
      var path = prefix ? prefix + '/' + entry.name : entry.name;
      if (entry.kind === 'file') await visitFile(path, entry);
      else if (entry.kind === 'directory') await walk(entry, path, visitFile);
    }
  }

  async function writeProjectFiles(dir, files, plan, progress, options) {
    options = options || {};
    plan = plan || [];
    report(progress, 'Scanning old project files...');
    var existing = options.full ? await listProjectJsonFiles(dir) : [];
    var wanted = {};
    Object.keys(files).forEach(function (path) { wanted[path] = true; });

    if (options.full) {
      for (var i = 0; i < existing.length; i++) {
        var oldPath = existing[i];
        if (oldPath === 'gamedata.json') continue;
        if (!wanted[oldPath]) await removePath(dir, oldPath);
      }
    } else {
      for (var d = 0; d < plan.length; d++) {
        if (plan[d].status === 'deleted') await removePath(dir, plan[d].path);
      }
    }

    var writeItems = plan.filter(function (item) { return item.status === 'added' || item.status === 'modified'; });
    for (var j = 0; j < writeItems.length; j++) {
      report(progress, 'Writing JSON files...', j, writeItems.length, writeItems[j].path);
      await writeTextFile(dir, writeItems[j].path, files[writeItems[j].path]);
      await yieldUI();
    }
    report(progress, 'Writing JSON files...', writeItems.length, writeItems.length);
  }

  async function listProjectJsonFiles(dir) {
    var out = [];
    await walk(dir, '', async function (path, fileHandle) {
      if (isSpecialPath(path)) return;
      if (!/\.json$/i.test(path)) return;
      if (path === 'gamedata.json') { out.push(path); return; }
      var file = await fileHandle.getFile();
      var text = await file.text();
      try {
        var obj = JSON.parse(text);
        if (obj && obj._table) out.push(path);
      } catch (_) {}
    });
    return out;
  }

  function isSpecialPath(path) {
    return path === 'asset' || path.indexOf('asset/') === 0;
  }

  async function writeTextFile(root, path, text) {
    var parts = path.split('/');
    var name = parts.pop();
    var dir = root;
    for (var i = 0; i < parts.length; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    var file = await dir.getFileHandle(name, { create: true });
    var writable = await file.createWritable();
    await writable.write(text);
    await writable.close();
  }

  async function removePath(root, path) {
    var parts = path.split('/');
    var name = parts.pop();
    var dir = root;
    try {
      for (var i = 0; i < parts.length; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      }
      await dir.removeEntry(name);
    } catch (_) {}
  }

  function workspace() { return current; }
  function setWorkspace(ws) {
    current = ws || null;
    if (!current && ProjectIO.savePlan) ProjectIO.savePlan.clearBaseline();
  }

  function previewSavePlan(options) {
    options = options || {};
    var files = c().snapshotToFiles(c().exportSnapshot());
    var json = ProjectIO.savePlan.diff(files, { allAdded: !!options.full });
    var assets = ProjectIO.assets.savePlan({ full: !!options.full });
    return json.map(function (item) {
      return Object.assign({ kind: 'json' }, item);
    }).concat(assets.map(function (item) {
      return Object.assign({ kind: 'asset' }, item);
    })).sort(function (a, b) {
      return statusRank(a.status) - statusRank(b.status) || a.path.localeCompare(b.path, undefined, { numeric: true });
    });
  }

  function statusRank(status) {
    return status === 'added' ? 0 : status === 'modified' ? 1 : 2;
  }

  async function saveSelected(items, options) {
    options = options || {};
    var jsonPlan = (items || []).filter(function (item) { return item.kind === 'json'; });
    var assetPlan = (items || []).filter(function (item) { return item.kind === 'asset'; });
    return save(Object.assign({}, options, { plan: jsonPlan, assetPlan: assetPlan }));
  }

  function report(progress, message, current, total, detail) {
    if (typeof progress !== 'function') return;
    progress({
      message: message,
      current: current,
      total: total,
      detail: detail || '',
      indeterminate: !(total > 0),
    });
  }

  function yieldUI() {
    if (window.GDE && GDE.loading && GDE.loading.nextFrame) return GDE.loading.nextFrame();
    return Promise.resolve();
  }

  window.ProjectIO = window.ProjectIO || {};
  window.ProjectIO.fsWorkspace = {
    supported: supported,
    openFolder: openFolder,
    loadFromHandle: loadFromHandle,
    save: save,
    saveSelected: saveSelected,
    saveAs: saveAs,
    previewSavePlan: previewSavePlan,
    workspace: workspace,
    setWorkspace: setWorkspace,
  };
})();
