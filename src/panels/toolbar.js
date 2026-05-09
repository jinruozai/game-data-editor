/**
 * Top toolbar — project menu, status, language switcher.
 * Mounts into the #gde-topbar host element directly; not an EF panel.
 */
(function () {
  'use strict';

  function buildMenu(anchor, items) {
    return EF.ui.menu({ anchor: anchor, side: 'bottom', align: 'start', items: items.map(function map(it) {
      if (it.separator) return { type: 'divider' };
      if (it.items)     return { label: it.label, items: it.items.map(map) };
      return { label: it.label, danger: it.danger, disabled: it.disabled, onSelect: it.onClick };
    })});
  }

  var THEME_KEY = 'gde.theme';
  function currentTheme() { return document.documentElement.getAttribute('data-ef-theme') || 'dark'; }
  function setTheme(name) {
    if (name && name !== 'dark') document.documentElement.setAttribute('data-ef-theme', name);
    else document.documentElement.removeAttribute('data-ef-theme');
    try { localStorage.setItem(THEME_KEY, name || 'dark'); } catch (_) {}
  }
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dracula' || saved === 'light') setTheme(saved);
  } catch (_) {}
  function themeItem(name, label) {
    return { label: label + (currentTheme() === name ? '  ✓' : ''),
             onClick: function () { setTheme(name); } };
  }

  function mount(host) {
    GDE.clear(host);

    var brand = document.createElement('div'); brand.className = 'gde-brand';
    var bicon = document.createElement('div'); bicon.className = 'gde-brand-icon';
    var btitle = document.createElement('span');
    brand.appendChild(bicon); brand.appendChild(btitle);

    brand.addEventListener('click', function () {
      showProjectMenu();
    });
    host.appendChild(brand);

    async function showProjectMenu() {
      var recent = await ProjectIO.recent.list();
      var recentItems = recent.length ? recent.map(function (item) {
        return { label: item.name, onClick: function () { openRecent(item); } };
      }) : [{ label: t('toolbar.recent.empty'), disabled: true, onClick: function () {} }];
      buildMenu(brand, [
        { label: t('toolbar.new'), onClick: doNew },
        { label: t('toolbar.open_folder'), disabled: !ProjectIO.fsWorkspace.supported(), onClick: doOpenFolder },
        { label: t('toolbar.recent'), items: recentItems },
        { label: t('toolbar.template'), items: [
          { label: t('toolbar.template.demo'), onClick: function () { doOpenTemplate('demo'); } },
        ]},
        { separator: true },
        { label: t('toolbar.save'), onClick: doSave },
        { label: t('toolbar.save_as'), disabled: !ProjectIO.fsWorkspace.supported(), onClick: doSaveAs },
        { separator: true },
        { label: t('toolbar.import_zip'), onClick: doImportZip },
        { label: t('toolbar.export_zip'), onClick: doExportZip },
        { separator: true },
        { label: t('toolbar.theme'), items: [
          themeItem('dark',    'Dark'),
          themeItem('dracula', 'Dracula'),
          themeItem('light',   'Light'),
        ]},
        { label: t('toolbar.settings'), onClick: function () { State.openSettings(); } },
      ]);
    }

    var spacer = document.createElement('div'); spacer.className = 'gde-sep';
    host.appendChild(spacer);
    var status = document.createElement('div'); status.className = 'gde-status';
    host.appendChild(status);

    var langBtn = document.createElement('div');
    langBtn.className = 'gde-brand';
    langBtn.style.marginLeft = '6px';
    var langLabel = document.createElement('span');
    langBtn.appendChild(langLabel);
    langBtn.addEventListener('click', function () {
      buildMenu(langBtn, [
        { label: t('toolbar.lang.en') + (I18N.getLocale() === 'en' ? '  ✓' : ''),
          onClick: function () { I18N.setLocale('en'); } },
        { label: t('toolbar.lang.zh') + (I18N.getLocale() === 'zh' ? '  ✓' : ''),
          onClick: function () { I18N.setLocale('zh'); } },
      ]);
    });
    host.appendChild(langBtn);

    function refresh() {
      var name = State.projectName();
      btitle.textContent = t('app.title') + ' · ' + name + (State.dirty() ? '*' : '');
      langLabel.textContent = I18N.getLocale() === 'zh' ? '中' : 'EN';

      var tm = State.tableMap();
      var gd = State.gameData();
      var ws = State.workspaceInfo();
      var wsName = ws ? ws.name : t('toolbar.workspace.memory');
      GDE.clear(status);
      status.appendChild(statusItem(t('toolbar.status.workspace') + ' ', wsName));
      status.appendChild(statusItem(t('toolbar.status.tables') + ' ', Object.keys(tm).length));
      status.appendChild(statusItem(t('toolbar.status.entities') + ' ', Object.keys(gd).length));
      status.appendChild(statusItem(t('toolbar.status.version'), State.version()));
    }

    function statusItem(label, value) {
      var span = document.createElement('span');
      var b = document.createElement('b');
      span.appendChild(document.createTextNode(label));
      b.textContent = String(value);
      span.appendChild(b);
      return span;
    }

    brand.__efCleanups = brand.__efCleanups || [];
    brand.__efCleanups.push(I18N.onChange(refresh));
    GDE.effect(brand, refresh);
  }

  function doNew() {
    EF.ui.confirm({
      title:   t('toolbar.new.title'),
      message: t('toolbar.new.message'),
      danger:  true,
      okLabel: t('toolbar.new.discard'),
    }).then(function (ok) {
      if (!ok) return;
      ProjectIO.fsWorkspace.setWorkspace(null);
      Seed.newProject({ name: 'Untitled', dirty: true });
      State.log('info', 'New project created');
    });
  }

  function doOpenTemplate(key) {
    EF.ui.confirm({
      title:   t('toolbar.template.title'),
      message: t('toolbar.template.message'),
      danger:  true,
      okLabel: t('toolbar.template.open'),
    }).then(function (ok) {
      if (!ok) return;
      ProjectIO.fsWorkspace.setWorkspace(null);
      Seed.loadTemplate(key);
      State.log('info', 'Opened template: ' + key);
    });
  }

  async function doOpenFolder() {
    await run('Open folder', async function (progress) {
      var ws = await ProjectIO.fsWorkspace.openFolder({ progress: progress });
      State.setWorkspaceInfo({ kind: 'folder', name: ws.name });
      State.clearDirty();
      await ProjectIO.recent.put(ws);
      State.log('info', 'Opened folder: ' + ws.name);
    });
  }

  async function doSave() {
    await run('Save', async function (progress) {
      if (window.GDE && GDE.history) GDE.history.flush();
      var ws = await ProjectIO.fsWorkspace.save({ progress: progress });
      State.setWorkspaceInfo({ kind: 'folder', name: ws.name });
      State.clearDirty();
      if (window.GDE && GDE.history) GDE.history.markSaved();
      await ProjectIO.recent.put(ws);
      State.log('info', 'Saved project: ' + ws.name);
    });
  }

  async function doSaveAs() {
    await run('Save as', async function (progress) {
      var ws = await ProjectIO.fsWorkspace.saveAs({ progress: progress });
      State.setWorkspaceInfo({ kind: 'folder', name: ws.name });
      State.clearDirty();
      await ProjectIO.recent.put(ws);
      State.log('info', 'Saved project as: ' + ws.name);
    });
  }

  function doImportZip() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      run('Import zip', async function (progress) {
        await ProjectIO.zipWorkspace.importZip(file, { progress: progress });
        ProjectIO.fsWorkspace.setWorkspace(null);
        State.setWorkspaceInfo({ kind: 'zip', name: file.name });
        State.clearDirty();
        State.log('info', 'Imported zip: ' + file.name);
      });
    };
    input.click();
  }

  async function doExportZip() {
    await run('Export zip', async function (progress) {
      await ProjectIO.zipWorkspace.exportZip({ progress: progress });
      State.log('info', 'Exported zip');
    });
  }

  async function openRecent(item) {
    await run('Open recent', async function (progress) {
      await ProjectIO.fsWorkspace.loadFromHandle(item.handle, { progress: progress });
      ProjectIO.fsWorkspace.setWorkspace({ kind: 'folder', name: item.name, handle: item.handle });
      State.setWorkspaceInfo({ kind: 'folder', name: item.name });
      State.clearDirty();
      await ProjectIO.recent.put({ name: item.name, handle: item.handle });
      State.log('info', 'Opened recent folder: ' + item.name);
    });
  }

  async function run(label, fn) {
    try {
      if (window.GDE && GDE.loading) {
        await GDE.loading.run({ title: label, message: 'Starting...' }, fn);
      } else {
        await fn(function () {});
      }
    }
    catch (e) { State.log('error', label + ': ' + e.message); State.showLogPanel(); }
  }

  window.TopBar = { mount: mount };
})();
