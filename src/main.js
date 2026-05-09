/**
 * Main entry �?mounts the EditorFrame layout and the top toolbar.
 *
 *   ┌────────────────────────────────────────────────────────────�?
 *   �?                      top toolbar (DOM)                     �?
 *   ├────────┬───────────────────────────────────┬───────────────�?
 *   �?left   �?       center (tab-standard)      �? right        �?
 *   �?tab-   �?       table data × N             �? inspector    �?
 *   �?side-  ├───────────────────────────────────�? (no tabs)    �?
 *   �?bar    �?        log (tab-collapsible)     �?              �?
 *   └────────┴───────────────────────────────────┴───────────────�?
 *
 * Tab management is delegated to the framework:
 *   - left  : tab-sidebar     (icon rail, click-again collapses)
 *   - center: tab-standard    (open tables appear as tabs)
 *   - log   : tab-collapsible (bottom dock, starts collapsed)
 *   - right : no toolbar      (single inspector panel)
 *
 * State.openTable() / closeTab() / pinTab() delegate to layout.addPanel /
 * removePanel / promotePanel. activeTable signal syncs from the layout tree.
 */
(function () {
  'use strict';

  var appCleanups = [];
  var destroyed = false;

  function track(cleanup) {
    appCleanups.push(cleanup);
    return cleanup;
  }

  function onBus(topic, handler) {
    return track(EF.bus.on(topic, handler));
  }

  function onDocument(type, handler, opts) {
    document.addEventListener(type, handler, opts);
    return track(function () { document.removeEventListener(type, handler, opts); });
  }

  function appEffect(fn) {
    return track(EF.effect(fn));
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = function () { resolve(); };
      el.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(el);
    });
  }

  function installAIAdapter() {
    var files = [
      'src/ai/core.js',
      'src/ai/resources.js',
      'src/ai/patch-ops.js',
      'src/ai/patch.js',
      'src/ai/change-set.js',
      'src/ai/tools.js',
      'src/ai/skills.js',
    ];
    var chain = Promise.resolve();
    files.forEach(function (file) {
      chain = chain.then(function () { return loadScript(file + '?v=2'); });
    });
    chain.then(function () {
      if (window.GDE && GDE.ai && GDE.ai.install) GDE.ai.install();
    }, function (err) {
      State.log('warn', err.message);
    });
  }

  // 1. Start with an empty in-memory project. Templates are explicit menu actions.
  Seed.newProject({ name: 'Untitled', dirty: false });

  // 2. Build the initial layout tree.
  var leftDock = EF.dock({
    name: 'left',
    toolbar: {
      direction: 'left',
      items: [{ component: 'tab-sidebar' }],
    },
    // Icons here are framework registered names (see EF.ui icon set) �?they
    // render as flat monochrome SVG, not emoji. Fallback to the glyph
    // rendering path kicks in automatically if a name isn't registered.
    panels: [
      EF.panel({ component: 'gde-tables',          title: I18N.t('panel.tablemap'),   icon: 'table'    }),
      EF.panel({ component: 'gde-typeconfig',      title: I18N.t('panel.typeconfig'), icon: 'settings' }),
      EF.panel({ component: 'gde-cardstyle-tree',  title: 'Object Tree',              icon: 'list'     }),
      EF.panel({ component: 'ai-agents-list',      title: I18N.t('panel.ai_agents'),  icon: 'user'     }),
      EF.panel({ component: 'gde-search',          title: I18N.t('panel.search'),     icon: 'search'   }),
    ],
  });

  var centerDock = EF.dock({
    name:   'center',
    accept: ['gde-table-data', 'gde-cardstyle-editor', 'settings'],
    toolbar: {
      direction: 'top',
      items: [{ component: 'tab-standard', props: { addable: false } }],
    },
  });

  var assetDock = EF.dock({
    name: 'assets',
    toolbar: {
      direction: 'top',
      items: [{ component: 'tab-compact' }],
    },
    panels: [
      EF.panel({ component: 'gde-assets', title: I18N.t('panel.assets'), icon: 'folder' }),
    ],
  });

  var logDock = EF.dock({
    name:      'log',
    collapsed: false,
    // Bottom-aligned toolbar: when the dock is collapsed only the tab strip
    // remains visible, anchored to the very bottom of the center column �?
    // exactly how VS Code's status/output panel behaves.
    toolbar: {
      direction: 'bottom',
      items: [{ component: 'tab-collapsible', props: { closable: false } }],
    },
    // Use the built-in 'log' component (EF.log signal). Project writes go
    // through State.log �?EF.log.push, so framework + app messages share
    // one stream.
    panels: [
      EF.panel({ component: 'ai-chatinput',           title: I18N.t('panel.ai_send'), icon: 'message-circle' }),
      EF.panel({ component: 'gde-cardstyle-list',     title: I18N.t('panel.cardstyles'), icon: 'columns' }),
      EF.panel({ component: 'gde-history',            title: I18N.t('panel.history'),    icon: 'clock'   }),
      EF.panel({ component: 'log',                    title: I18N.t('panel.log'),        icon: 'list'    }),
    ],
  });

  var rightDock = EF.dock({
    name: 'right',
    toolbar: {
      direction: 'top',
      items: [{ component: 'tab-compact' }],
    },
    panels: [
      EF.panel({ component: 'gde-inspector', title: I18N.t('panel.inspector') }),
      EF.panel({ component: 'ai-messages', title: I18N.t('panel.ai_messages'), icon: 'message-circle' }),
    ],
  });

  var tree = EF.split('horizontal', [
    EF.split('vertical', [leftDock, assetDock], [0.62, 0.38]),
    EF.split('vertical', [centerDock, logDock], [0.72, 0.28]),
    rightDock,
  ], [0.2, 0.56, 0.24]);

  // 3. Mount.
  var handle = EF.createDockLayout(document.getElementById('app'), { tree: tree });
  if (window.GDE && GDE.history) track(GDE.history.installShortcuts());
  track(EF.effect(function () {
    I18N.locale();
    relocalizePanelTitles();
  }));

  function relocalizePanelTitles() {
    var titleKeys = {
      'gde-tables': 'panel.tablemap',
      'gde-typeconfig': 'panel.typeconfig',
      'ai-agents-list': 'panel.ai_agents',
      'ai-chatinput': 'panel.ai_send',
      'ai-messages': 'panel.ai_messages',
      'settings': 'panel.settings',
      'gde-cardstyle-tree': 'panel.object_tree',
      'gde-search': 'panel.search',
      'gde-assets': 'panel.assets',
      'gde-cardstyle-list': 'panel.cardstyles',
      'gde-history': 'panel.history',
      'log': 'panel.log',
      'gde-inspector': 'panel.inspector',
    };
    var changed = false;
    function walk(node) {
      if (!node) return node;
      if (node.type === 'dock') {
        var panels = node.panels.map(function (p) {
          var key = titleKeys[p.component];
          if (!key) return p;
          var title = t(key);
          if (p.title === title) return p;
          changed = true;
          return Object.assign({}, p, { title: title });
        });
        return changed ? Object.assign({}, node, { panels: panels }) : node;
      }
      if (node.type === 'split') {
        var any = false;
        var children = node.children.map(function (child) {
          var next = walk(child);
          if (next !== child) any = true;
          return next;
        });
        return any ? Object.assign({}, node, { children: children }) : node;
      }
      return node;
    }
    var next = walk(handle.tree());
    if (changed) handle.setTree(next);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    for (var i = appCleanups.length - 1; i >= 0; i--) appCleanups[i]();
    appCleanups = [];
    if (window.GDE && GDE.clear) GDE.clear(document.getElementById('gde-topbar'));
    if (State.destroy) State.destroy();
    handle.destroy();
    window.__gde.handle = null;
  }

  window.__gde = { handle: handle, destroy: destroy };   // kept for top-bar debugging only

  // 4. Wire State �?Layout.
  State._setLayout(handle, 'center');

  // 5. Seed one pinned table panel so the center doesn't start empty.
  State.selectFirstTable();

  // 6. Sync State.activeTable FROM the center dock's activeId. This is the
  //    single source of truth for "which table is being edited" �?every
  //    component subscribes to State.activeTable, not to the layout tree.
  //    handle.subscribe re-fires whenever the layout tree changes; peek on
  //    activeTable so this callback never subscribes to its own writes.
  track(handle.subscribe(function (t) {
    var found = null;
    (function walk(n) {
      if (!n || found) return;
      if (n.type === 'dock' && n.name === 'center') {
        var p = n.panels.find(function (pp) { return pp.id === n.activeId; });
        if (p && p.props) found = p.props.pathKey || null;
      } else if (n.type === 'split') {
        n.children.forEach(walk);
      }
    })(t);
    if (State.activeTable.peek() !== found) State.activeTable.set(found);
  }));

  // 7. Navigation events from search / log / gamedata panels.
  onBus('nav:goto', function (payload) {
    if (!payload || !payload.pathKey) return;
    State.openTable(payload.pathKey, { transient: false });
    if (payload.id) {
      State.setSelection({ kind: 'card_data', pathKey: payload.pathKey, id: payload.id, field: payload.field });
    }
  });

  // 8. Struct editing entry �?forwarded to global hook (if any).
  onBus('ui:editStruct', function (payload) {
    if (payload && payload.pathKey && typeof window.openStructEditor === 'function') {
      window.openStructEditor(payload.pathKey);
    }
  });

  // 9. Top toolbar (plain DOM, lives above the frame).
  TopBar.mount(document.getElementById('gde-topbar'));

  // 9.5. Project-level AI adapter registrations. EF.ai owns the generic
  // panels/runtime; GDE.ai only contributes domain resources, tools, skills.
  installAIAdapter();

  // 10. Document title tracks project name.
  appEffect(function () {
    document.title = State.projectName() + ' · GameDataEditor';
  });

  // 11. Esc clears selection (but not while a context menu is open).
  onDocument('keydown', function (ev) {
    if (ev.key === 'Escape') {
      if (document.querySelector('.gde-ctx-menu, .ef-ui-menu')) return;
      State.setSelection(null);
    }
  });
})();
