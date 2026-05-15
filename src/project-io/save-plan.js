/**
 * ProjectIO.savePlan — file-level save diff for folder workspaces.
 *
 * The baseline is canonical serialized project text captured after open/save.
 * Save preview and save execution compare the current serialized project
 * against that baseline, so callers do not need to maintain per-action dirty
 * flags.
 */
(function () {
  'use strict';

  var baseline = {};
  var hasBaseline = false;
  var dirtyFiles = {};

  function cloneFiles(files) {
    return Object.assign({}, files || {});
  }

  function setBaseline(files) {
    baseline = cloneFiles(files);
    hasBaseline = true;
    dirtyFiles = {};
  }

  function clearBaseline() {
    baseline = {};
    hasBaseline = false;
    dirtyFiles = {};
  }

  function markSaved(files, plan) {
    files = cloneFiles(files || {});
    if (!hasBaseline) baseline = {};
    (plan || []).forEach(function (item) {
      delete dirtyFiles[item.path];
      if (item.status === 'deleted') delete baseline[item.path];
      else if (Object.prototype.hasOwnProperty.call(files, item.path)) baseline[item.path] = files[item.path];
    });
    hasBaseline = true;
  }

  function recordEvent(ev, payload) {
    if (ev === 'typeconfig:changed' || ev === 'cardstyles:changed') {
      dirtyFiles['gamedata.json'] = true;
      return;
    }
    if (ev === 'data:changed' && payload && payload.pathKey) {
      markTable(payload.pathKey);
      return;
    }
    var m = String(ev || '').match(/^data:changed:(.+)$/);
    if (m) markTable(m[1]);
  }

  function markTable(pathKey) {
    if (!pathKey || !window.ProjectIO || !ProjectIO.codec) return;
    dirtyFiles[ProjectIO.codec.tablePathToFile(pathKey)] = true;
  }

  function currentFiles() {
    if (!window.ProjectIO || !ProjectIO.codec || !window.State) return {};
    return ProjectIO.codec.snapshotToFiles(ProjectIO.codec.exportSnapshot());
  }

  function diff(files, options) {
    options = options || {};
    var current = cloneFiles(files || currentFiles());
    var base = hasBaseline && !options.allAdded ? baseline : {};
    var out = [];
    var seen = {};

    Object.keys(current).sort().forEach(function (path) {
      seen[path] = true;
      if (!Object.prototype.hasOwnProperty.call(base, path)) {
        out.push(entry('added', path, current[path]));
      } else if (base[path] !== current[path]) {
        out.push(entry('modified', path, current[path], base[path]));
      }
    });

    Object.keys(base).sort().forEach(function (path) {
      if (!seen[path]) out.push(entry('deleted', path, '', base[path]));
    });

    var included = {};
    out.forEach(function (item) { included[item.path] = true; });
    Object.keys(dirtyFiles).sort().forEach(function (path) {
      if (included[path]) return;
      if (Object.prototype.hasOwnProperty.call(current, path)) {
        out.push(entry(Object.prototype.hasOwnProperty.call(base, path) ? 'modified' : 'added', path, current[path], base[path]));
      } else if (Object.prototype.hasOwnProperty.call(base, path)) {
        out.push(entry('deleted', path, '', base[path]));
      }
    });

    return out;
  }

  function entry(status, path, text, previousText) {
    return {
      status: status,
      path: path,
      text: text || '',
      previousText: previousText || '',
      bytes: byteLength(text || ''),
      previousBytes: byteLength(previousText || ''),
    };
  }

  function byteLength(text) {
    if (window.TextEncoder) return new TextEncoder().encode(text || '').length;
    return String(text || '').length;
  }

  function summary(plan) {
    var counts = { added: 0, modified: 0, deleted: 0, total: 0 };
    (plan || []).forEach(function (item) {
      if (counts[item.status] != null) counts[item.status]++;
      counts.total++;
    });
    return counts;
  }

  window.ProjectIO = window.ProjectIO || {};
  window.ProjectIO.savePlan = {
    setBaseline: setBaseline,
    clearBaseline: clearBaseline,
    markSaved: markSaved,
    recordEvent: recordEvent,
    currentFiles: currentFiles,
    diff: diff,
    summary: summary,
    hasBaseline: function () { return hasBaseline; },
  };
})();
