/**
 * ProjectIO.recent — stores FileSystemDirectoryHandle entries in IndexedDB.
 */
(function () {
  'use strict';

  var DB = 'gde-recent-workspaces';
  var STORE = 'workspaces';

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function put(workspace) {
    if (!workspace || !workspace.handle) return;
    var db = await openDb();
    var item = { id: workspace.name, name: workspace.name, handle: workspace.handle, time: Date.now() };
    await tx(db, 'readwrite', function (store) { store.put(item); });
  }

  async function list() {
    var db = await openDb();
    var items = await tx(db, 'readonly', function (store) { return store.getAll(); });
    return (items || []).sort(function (a, b) { return b.time - a.time; }).slice(0, 8);
  }

  function tx(db, mode, fn) {
    return new Promise(function (resolve, reject) {
      var t = db.transaction(STORE, mode);
      var req = fn(t.objectStore(STORE));
      var result = null;
      if (req) {
        req.onsuccess = function () { result = req.result; };
        req.onerror = function () { reject(req.error); };
      }
      t.oncomplete = function () { resolve(result); };
      t.onerror = function () { reject(t.error); };
    });
  }

  window.ProjectIO = window.ProjectIO || {};
  window.ProjectIO.recent = { put: put, list: list };
})();
