/**
 * ProjectIO.zipWorkspace — import/export zip via fflate.
 */
(function () {
  'use strict';

  function ensureZip() {
    if (!window.fflate) throw new Error('Zip library is not loaded.');
    return window.fflate;
  }

  async function importZip(file, options) {
    options = options || {};
    var progress = options.progress;
    var zip = ensureZip();
    report(progress, 'Reading zip file...');
    var bytes = new Uint8Array(await file.arrayBuffer());
    report(progress, 'Unpacking zip...');
    var entries = zip.unzipSync(bytes);
    var dec = new TextDecoder();
    var files = {};
    var paths = Object.keys(entries);
    paths.forEach(function (rawPath, index) {
      report(progress, 'Scanning zip entries...', index, paths.length, rawPath);
      var path = cleanZipPath(rawPath);
      if (!path) return;
      if (path.indexOf('asset/') === 0) return;
      if (/\.json$/i.test(path)) files[path] = dec.decode(entries[rawPath]);
    });
    report(progress, 'Scanning zip entries...', paths.length, paths.length);
    ProjectIO.assets.loadFromZip(entries, { progress: progress });
    report(progress, 'Applying project data...');
    ProjectIO.codec.applySnapshot(ProjectIO.codec.filesToSnapshot(files), file.name.replace(/\.zip$/i, ''));
    if (window.GDE && GDE.history) GDE.history.reset(t('history.import_project', { name: file.name }), { saved: true });
    report(progress, 'Zip imported', 1, 1);
  }

  async function exportZip(options) {
    options = options || {};
    var progress = options.progress;
    var zip = ensureZip();
    var enc = new TextEncoder();
    report(progress, 'Serializing project...');
    var snapshot = ProjectIO.codec.exportSnapshot();
    var files = ProjectIO.codec.snapshotToFiles(snapshot);
    var entries = {};
    var jsonPaths = Object.keys(files);
    jsonPaths.forEach(function (path, index) {
      report(progress, 'Packing JSON files...', index, jsonPaths.length, path);
      entries[path] = enc.encode(files[path]);
    });
    report(progress, 'Packing JSON files...', jsonPaths.length, jsonPaths.length);
    var assets = await ProjectIO.assets.zipEntries({ progress: progress });
    Object.keys(assets).forEach(function (path) { entries[path] = assets[path]; });
    report(progress, 'Compressing zip...');
    var out = zip.zipSync(entries, { level: 6 });
    var blob = new Blob([out], { type: 'application/zip' });
    var name = (State.projectName() || 'gamedata').replace(/[\\/:*?"<>|]+/g, '_') + '.zip';
    downloadBlob(name, blob);
    report(progress, 'Zip exported', 1, 1);
  }

  function cleanZipPath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .split('/')
      .filter(function (p) { return p && p !== '.' && p !== '..'; })
      .join('/');
  }

  function downloadBlob(name, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 500);
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

  window.ProjectIO = window.ProjectIO || {};
  window.ProjectIO.zipWorkspace = {
    importZip: importZip,
    exportZip: exportZip,
  };
})();
