/**
 * App layout bridge.
 *
 * This module owns EditorFrame dock/panel operations for GameDataEditor.
 * State remains the public project API, but panel lookup, tab reuse, and
 * dock activation belong here instead of the data store.
 */
(function () {
  'use strict';

  window.GDE = window.GDE || {};

  var handle = null;
  var centerDockName = 'center';

  function setLayout(nextHandle, nextCenterDockName) {
    handle = nextHandle || null;
    if (nextCenterDockName) centerDockName = nextCenterDockName;
  }

  function destroy() {
    handle = null;
  }

  function stableStringify(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(function (key) {
        return JSON.stringify(key) + ':' + stableStringify(value[key]);
      }).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  function samePanelIntent(a, b) {
    if (!a || !b || a.component !== b.component) return false;
    if (a.name && b.name) return a.name === b.name;
    return stableStringify(a.props || {}) === stableStringify(b.props || {});
  }

  function walkTree(fn) {
    if (!handle) return null;
    var out = null;
    (function walk(node) {
      if (!node || out) return;
      out = fn(node) || null;
      if (!out && node.type === 'split') node.children.forEach(walk);
    })(handle.tree());
    return out;
  }

  function centerDockId() {
    var hit = walkTree(function (node) {
      return node.type === 'dock' && node.name === centerDockName ? node.id : null;
    });
    return hit || null;
  }

  function findMainPanel(panel) {
    return walkTree(function (node) {
      if (node.type !== 'dock' || node.name !== centerDockName) return null;
      for (var i = 0; i < node.panels.length; i++) {
        if (samePanelIntent(node.panels[i], panel)) {
          return { panel: node.panels[i], dockId: node.id };
        }
      }
      return null;
    });
  }

  function findPanelByComponent(component) {
    return walkTree(function (node) {
      if (node.type !== 'dock') return null;
      for (var i = 0; i < node.panels.length; i++) {
        if (node.panels[i].component === component) {
          return { panel: node.panels[i], dockId: node.id, dockName: node.name };
        }
      }
      return null;
    });
  }

  function findTablePanel(pathKey) {
    return walkTree(function (node) {
      if (node.type !== 'dock' || node.name !== centerDockName) return null;
      for (var i = 0; i < node.panels.length; i++) {
        var panel = node.panels[i];
        if (panel.component === 'gde-table-data' && panel.props && panel.props.pathKey === pathKey) {
          return { panel: panel, dockId: node.id };
        }
      }
      return null;
    });
  }

  function findCardStylePanel(styleKey) {
    return walkTree(function (node) {
      if (node.type !== 'dock' || node.name !== centerDockName) return null;
      for (var i = 0; i < node.panels.length; i++) {
        var panel = node.panels[i];
        if (panel.component === 'gde-cardstyle-editor' && panel.props && panel.props.styleKey === styleKey) {
          return { panel: panel, dockId: node.id };
        }
      }
      return null;
    });
  }

  function allCenterPanels() {
    if (!handle) return [];
    var out = [];
    (function walk(node) {
      if (!node) return;
      if (node.type === 'dock' && node.name === centerDockName) {
        node.panels.forEach(function (panel) { out.push(panel); });
      } else if (node.type === 'split') {
        node.children.forEach(walk);
      }
    })(handle.tree());
    return out;
  }

  function shortName(pathKey) {
    var parts = String(pathKey || '').split('/');
    return parts[parts.length - 1] || pathKey;
  }

  function openMainPanel(panel, opts) {
    if (!panel || !handle) return null;
    opts = opts || {};
    var transient = opts.transient != null ? !!opts.transient : true;
    var hit = findMainPanel(panel);
    if (hit) {
      handle.activatePanel(hit.panel.id);
      if (!transient && hit.panel.transient) handle.promotePanel(hit.panel.id);
      return { panelId: hit.panel.id, created: false };
    }
    var dockId = centerDockId();
    if (!dockId) return null;
    var ret = handle.addPanel(dockId, panel, { transient: transient });
    return { panelId: ret && ret.panelId, created: true };
  }

  function openTable(pathKey, opts) {
    if (!pathKey) return null;
    return openMainPanel({
      name: 'table:' + pathKey,
      component: 'gde-table-data',
      title: shortName(pathKey),
      props: { pathKey: pathKey },
    }, opts);
  }

  function openCardStyle(styleKey, opts) {
    if (!styleKey) return null;
    var def = window.State ? (State.projectCardStyles()[styleKey] || {}) : {};
    return openMainPanel({
      name: 'cardstyle:' + styleKey,
      component: 'gde-cardstyle-editor',
      title: def.name || styleKey,
      icon: 'columns',
      props: { styleKey: styleKey },
    }, opts);
  }

  function openSettings() {
    return openMainPanel({
      name: 'settings',
      component: 'settings',
      title: t('panel.settings') || 'Settings',
      icon: 'settings',
      props: {},
    }, { transient: false });
  }

  function setActiveTable(pathKey) {
    if (!handle || !pathKey) return false;
    var hit = findTablePanel(pathKey);
    if (!hit) return false;
    handle.activatePanel(hit.panel.id);
    return true;
  }

  function closeTable(pathKey) {
    var hit = findTablePanel(pathKey);
    if (hit) handle.removePanel(hit.panel.id);
  }

  function pinTable(pathKey) {
    var hit = findTablePanel(pathKey);
    if (hit) handle.promotePanel(hit.panel.id);
  }

  function closeCardStyle(styleKey) {
    var hit = findCardStylePanel(styleKey);
    if (hit) handle.removePanel(hit.panel.id);
  }

  function closeAllTabs() {
    allCenterPanels().forEach(function (panel) { handle.removePanel(panel.id); });
  }

  function renameTable(oldKey, newKey) {
    var hit = findTablePanel(oldKey);
    if (!hit) return;
    var tree = EF.updatePanel(handle.tree(), hit.panel.id, {
      title: shortName(newKey),
      props: Object.assign({}, hit.panel.props, { pathKey: newKey }),
    });
    handle.setTree(tree);
  }

  function renameCardStyle(oldKey, newKey, title) {
    var hit = findCardStylePanel(oldKey);
    if (!hit) return;
    var tree = EF.updatePanel(handle.tree(), hit.panel.id, {
      title: title || newKey,
      props: Object.assign({}, hit.panel.props, { styleKey: newKey }),
    });
    handle.setTree(tree);
  }

  function showPanel(component) {
    var hit = findPanelByComponent(component);
    if (hit) handle.activatePanel(hit.panel.id);
    return !!hit;
  }

  function showSearchPanel(query) {
    showPanel('gde-search');
    if (query != null) {
      setTimeout(function () {
        EF.bus.emit('search:set', { query: String(query || '') });
      }, 0);
    }
  }

  function showLogPanel() {
    if (!handle || !handle.setDockCollapsed) return;
    handle.setDockCollapsed('log', false);
    showPanel('log');
  }

  function activeTableFromTree(tree) {
    var found = null;
    (function walk(node) {
      if (!node || found) return;
      if (node.type === 'dock' && node.name === centerDockName) {
        var panel = node.panels.find(function (p) { return p.id === node.activeId; });
        if (panel && panel.props) found = panel.props.pathKey || null;
      } else if (node.type === 'split') {
        node.children.forEach(walk);
      }
    })(tree);
    return found;
  }

  GDE.layout = {
    setLayout: setLayout,
    destroy: destroy,
    activeTableFromTree: activeTableFromTree,
    openMainPanel: openMainPanel,
    openTable: openTable,
    openCardStyle: openCardStyle,
    openSettings: openSettings,
    setActiveTable: setActiveTable,
    closeTable: closeTable,
    pinTable: pinTable,
    closeCardStyle: closeCardStyle,
    closeAllTabs: closeAllTabs,
    renameTable: renameTable,
    renameCardStyle: renameCardStyle,
    showCardStyleTree: function () { return showPanel('gde-cardstyle-tree'); },
    showSearchPanel: showSearchPanel,
    showLogPanel: showLogPanel,
  };
})();
