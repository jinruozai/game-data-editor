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

    var savePlanBtn = document.createElement('button');
    savePlanBtn.type = 'button';
    savePlanBtn.className = 'gde-save-plan-btn';
    savePlanBtn.addEventListener('click', showSavePlan);
    host.appendChild(savePlanBtn);

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
      var plan = ProjectIO.fsWorkspace.previewSavePlan ? ProjectIO.fsWorkspace.previewSavePlan() : [];
      savePlanBtn.textContent = 'Save Plan ' + plan.length;
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

  function showSavePlan() {
    var plan = ProjectIO.fsWorkspace.previewSavePlan ? ProjectIO.fsWorkspace.previewSavePlan() : [];
    var selected = {};
    plan.forEach(function (item, i) { selected[planKey(item, i)] = true; });
    var counts = { added: 0, modified: 0, deleted: 0 };
    plan.forEach(function (item) { if (counts[item.status] != null) counts[item.status]++; });

    var root = document.createElement('div');
    root.className = 'gde-save-plan';

    var controls = document.createElement('div');
    controls.className = 'gde-save-plan-controls';
    var selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'gde-save-plan-select-all';
    var selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.checked = true;
    selectAllLabel.appendChild(selectAll);
    selectAllLabel.appendChild(document.createTextNode('Select all'));
    controls.appendChild(selectAllLabel);
    root.appendChild(controls);

    var summary = document.createElement('div');
    summary.className = 'gde-save-plan-summary';
    summary.appendChild(savePlanChip('added', counts.added));
    summary.appendChild(savePlanChip('modified', counts.modified));
    summary.appendChild(savePlanChip('deleted', counts.deleted));
    root.appendChild(summary);

    var list = document.createElement('div');
    list.className = 'gde-save-plan-list';
    if (!plan.length) {
      var empty = document.createElement('div');
      empty.className = 'gde-save-plan-empty';
      empty.textContent = 'No file changes to save.';
      list.appendChild(empty);
    } else {
      plan.forEach(function (item, i) {
        var key = planKey(item, i);
        var row = document.createElement('div');
        row.className = 'gde-save-plan-row is-' + item.status;
        var check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'gde-save-plan-check';
        check.checked = true;
        check.addEventListener('change', function () {
          selected[key] = check.checked;
          updateButtons();
        });
        var badge = document.createElement('span');
        badge.className = 'gde-save-plan-status';
        badge.textContent = item.status;
        var path = document.createElement('span');
        path.className = 'gde-save-plan-path';
        path.textContent = item.path;
        var meta = document.createElement('span');
        meta.className = 'gde-save-plan-meta';
        meta.textContent = item.kind + (item.bytes ? ' · ' + formatBytes(item.bytes) : '');
        row.appendChild(check);
        row.appendChild(badge);
        row.appendChild(path);
        row.appendChild(meta);
        list.appendChild(row);
      });
    }
    root.appendChild(list);

    var foot = document.createElement('div');
    foot.className = 'gde-save-plan-foot';
    var saveBtn = EF.ui.button({
      text: 'Save Selected',
      kind: 'primary',
      onClick: function () {
        var picked = plan.filter(function (item, i) { return !!selected[planKey(item, i)]; });
        if (!picked.length) return;
        modal.close();
        run('Save selected', async function (progress) {
          if (window.GDE && GDE.history) GDE.history.flush();
          var ws = await ProjectIO.fsWorkspace.saveSelected(picked, { progress: progress });
          State.setWorkspaceInfo({ kind: 'folder', name: ws.name });
          if (!ProjectIO.fsWorkspace.previewSavePlan().length) {
            State.clearDirty();
            if (window.GDE && GDE.history) GDE.history.markSaved();
          }
          await ProjectIO.recent.put(ws);
          State.log('info', 'Saved selected files: ' + picked.length);
        });
      },
    });
    var closeBtn = EF.ui.button({ text: 'Close', kind: 'default', onClick: function () { modal.close(); } });
    foot.appendChild(saveBtn);
    foot.appendChild(closeBtn);
    var modal = EF.ui.modal({
      title: 'Save Plan',
      content: root,
      footer: foot,
    });
    modal.el.classList.add('gde-save-plan-modal');

    selectAll.addEventListener('change', function () {
      var checks = list.querySelectorAll('.gde-save-plan-check');
      checks.forEach(function (input) { input.checked = selectAll.checked; });
      plan.forEach(function (item, i) { selected[planKey(item, i)] = selectAll.checked; });
      updateButtons();
    });
    updateButtons();

    function updateButtons() {
      var total = plan.filter(function (item, i) { return !!selected[planKey(item, i)]; }).length;
      saveBtn.disabled = total === 0;
      saveBtn.textContent = total ? 'Save Selected (' + total + ')' : 'Save Selected';
      var checks = list.querySelectorAll('.gde-save-plan-check');
      var checked = list.querySelectorAll('.gde-save-plan-check:checked');
      selectAll.checked = checks.length > 0 && checked.length === checks.length;
      selectAll.indeterminate = checked.length > 0 && checked.length < checks.length;
    }
  }

  function planKey(item, index) {
    return [index, item.kind, item.status, item.path].join('|');
  }

  function savePlanChip(status, count) {
    var chip = document.createElement('span');
    chip.className = 'gde-save-plan-chip is-' + status;
    chip.textContent = status + ' ' + count;
    return chip;
  }

  function formatBytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
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
