/**
 * Project-local clipboard payloads.
 *
 * Browser clipboard is intentionally not used: editor copy/paste needs rich
 * structured objects and must work under file:// without permissions.
 */
(function () {
  'use strict';

  var value = null;

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function set(kind, data) {
    value = { kind: kind, data: clone(data), time: Date.now() };
    EF.bus.emit('clipboard:changed', value);
  }

  function get(kind) {
    if (!value) return null;
    if (kind && value.kind !== kind) return null;
    return clone(value);
  }

  function has(kind) {
    return !!get(kind);
  }

  window.GDE = window.GDE || {};
  GDE.clipboard = {
    set: set,
    get: get,
    has: has,
  };
})();
