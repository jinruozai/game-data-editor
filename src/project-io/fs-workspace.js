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
    await save(options);
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
    await writeProjectFiles(current.handle, files, progress);
    await ProjectIO.assets.writeToDirectory(current.handle, { progress: progress });
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

  async function writeProjectFiles(dir, files, progress) {
    report(progress, 'Scanning old project files...');
    var existing = await listProjectJsonFiles(dir);
    var wanted = {};
    Object.keys(files).forEach(function (path) { wanted[path] = true; });

    for (var i = 0; i < existing.length; i++) {
      var path = existing[i];
      if (path === 'gamedata.json') continue;
      if (!wanted[path]) await removePath(dir, path);
    }
    var paths = Object.keys(files).sort();
    for (var j = 0; j < paths.length; j++) {
      report(progress, 'Writing JSON files...', j, paths.length, paths[j]);
      await writeTextFile(dir, paths[j], files[paths[j]]);
      await yieldUI();
    }
    report(progress, 'Writing JSON files...', paths.length, paths.length);
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
    for (var i = 0; i < parts.length; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: false });
    }
    await dir.removeEntry(name);
  }

  function workspace() { return current; }
  function setWorkspace(ws) { current = ws || null; }

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
    saveAs: saveAs,
    workspace: workspace,
    setWorkspace: setWorkspace,
  };
})();
