/**
 * Asset panel — GameDataEditor adapter around EF.ui.assetBrowser.
 */
(function () {
  'use strict';

  function createPanel(propsSig, ctx) {
    var browser = EF.ui.assetBrowser({
      storageKey: 'gde.assets.v2',
      rootLabel: I18N.text('assets.root'),
      version: ProjectIO.assets.version,
      children: function (dir, query) {
        return ProjectIO.assets.children(dir, query);
      },
      existsDir: function (dir) {
        return ProjectIO.assets.dirs().indexOf(dir) >= 0;
      },
      resolveUrl: function (item) {
        return item && item.url ? ProjectIO.assets.urlFor(item.url) : '';
      },
      importFiles: importFiles,
      createFolder: function (dir, name) {
        ProjectIO.assets.createFolder(dir, name);
        State.log('info', t('assets.log.created_folder', { path: 'asset://' + joinPath(dir, name) }));
      },
      moveEntries: function (entries, targetDir) {
        var moved = ProjectIO.assets.moveMany(entries, targetDir);
        if (moved.length) State.log('info', t('assets.log.moved', { n: moved.length, path: 'asset://' + targetDir }));
      },
      rename: renameEntry,
      remove: removeEntries,
      actions: assetActions,
      aiTargets: assetAiTargets,
    });
    return browser;
  }

  async function importFiles(files, dir) {
    var list = Array.prototype.slice.call(files || []);
    var replaceAll = false;
    var keepAll = false;
    for (var i = 0; i < list.length; i++) {
      var file = list[i];
      var target = ProjectIO.assets.makeUrl((dir ? dir + '/' : '') + file.name);
      var replace = false;
      if (ProjectIO.assets.exists(target) && !replaceAll && !keepAll) {
        var ok = await EF.ui.confirm({
          title: t('assets.exists.title'),
          message: t('assets.exists.message', { path: target }),
          okLabel: t('assets.exists.replace'),
        });
        replace = !!ok;
        if (list.length > 1) {
          if (replace) replaceAll = true;
          else keepAll = true;
        }
      } else if (ProjectIO.assets.exists(target)) {
        replace = replaceAll;
      }
      await ProjectIO.assets.importFile(file, null, { dir: dir, replace: replace });
    }
    State.log('info', t('assets.log.imported', { n: list.length, path: 'asset://' + (dir || '') }));
  }

  async function renameEntry(entry) {
    if (!entry) return;
    if (entry.kind === 'folder') {
      var folderName = await EF.ui.prompt({
        title: t('assets.rename_folder'),
        message: t('assets.rename_name'),
        default: entry.name,
      });
      if (!folderName || folderName === entry.name) return;
      var nextDir = ProjectIO.assets.renameFolder(entry.path, folderName);
      State.log('info', t('assets.log.renamed_folder', { from: 'asset://' + entry.path, to: 'asset://' + nextDir }));
      return;
    }
    var info = ProjectIO.assets.get(entry.url);
    if (!info) return;
    var name = await EF.ui.prompt({
      title: t('assets.rename_asset'),
      message: t('assets.rename_name'),
      default: info.name,
    });
    if (!name || name === info.name) return;
    var next = ProjectIO.assets.rename(entry.url, name);
    State.log('info', t('assets.log.renamed_asset', { from: entry.url, to: next }));
  }

  async function removeEntries(entries) {
    var rows = entries || [];
    if (!rows.length) return;
    var urls = urlsForEntries(rows);
    var refs = State.findAssetReferences(urls);
    var ok = await EF.ui.confirm({
      title: t('assets.delete.title'),
      message: deleteMessage(rows.length, refs),
      danger: true,
      okLabel: t('common.delete'),
    });
    if (!ok) return;
    var clearedEntities = refs.length ? State.clearAssetReferences(urls) : 0;
    rows.forEach(function (entry) {
      if (entry.kind === 'folder') ProjectIO.assets.removeFolder(entry.path);
    });
    if (urls.length) ProjectIO.assets.remove(urls);
    State.log('warn', refs.length
      ? t('assets.log.deleted_refs', { n: rows.length, refs: refs.length, entities: clearedEntities })
      : t('assets.log.deleted', { n: rows.length }));
  }

  function assetActions(rows) {
    if (!urlsForEntries(rows).length) return [];
    return [{
      label: t('common.add_to_chat'),
      icon: 'message-circle',
      onSelect: function () {
        if (!GDE.ai || !GDE.ai.sendTargetsToAI) return;
        GDE.ai.sendTargetsToAI(urlsForEntries(rows).map(function (url) {
          return GDE.ai.assetTarget(url);
        }), t('assets.ask_ai_prompt'));
      },
    }, {
      label: t('assets.add_to_chat_res'),
      icon: 'image',
      onSelect: function () {
        if (!GDE.ai || !GDE.ai.sendTargetsToAI) return;
        assetResourceTargets(rows).then(function (targets) {
          if (targets.length) GDE.ai.sendTargetsToAI(targets, t('assets.ask_ai_prompt'));
        });
      },
    }, {
      label: t('assets.view_refs'),
      icon: 'search',
      onSelect: function () {
        var query = referenceQuery(rows);
        if (!query) return;
        State.showSearchPanel(query);
      },
    }];
  }

  function assetAiTargets(rows) {
    if (!GDE.ai || !GDE.ai.assetTarget) return [];
    return urlsForEntries(rows).map(function (url) {
      return GDE.ai.assetTarget(url);
    });
  }

  function assetResourceTargets(rows) {
    if (!EF.ai || !EF.ai.fileToTarget) return Promise.resolve([]);
    return Promise.all(urlsForEntries(rows).map(assetResourceTarget)).then(function (items) {
      return items.filter(Boolean);
    });
  }

  async function assetResourceTarget(url) {
    var info = ProjectIO.assets.get(url);
    if (!info) return null;
    var blob = ProjectIO.assets.blobFor ? ProjectIO.assets.blobFor(url) : null;
    if (!blob) {
      var objectUrl = ProjectIO.assets.urlFor(url);
      if (!objectUrl) return null;
      var res = await fetch(objectUrl);
      blob = await res.blob();
    }
    var file = typeof File === 'function'
      ? new File([blob], info.name || url, { type: blob.type || mimeFromName(info.name), lastModified: info.mtime || Date.now() })
      : Object.assign(blob, { name: info.name || url, lastModified: info.mtime || Date.now(), type: blob.type || mimeFromName(info.name) });
    var target = await EF.ai.fileToTarget(file);
    if (!target) return null;
    target.uri = url;
    target.title = url;
    target.summary = (target.summary ? target.summary + ' · ' : '') + 'project asset';
    target.meta = Object.assign({}, target.meta || {}, {
      url: url,
      assetUrl: url,
      assetPath: ProjectIO.assets.urlToPath(url),
      projectAsset: true,
    });
    return target;
  }

  function mimeFromName(name) {
    name = String(name || '').toLowerCase();
    if (/\.(png)$/.test(name)) return 'image/png';
    if (/\.(jpe?g)$/.test(name)) return 'image/jpeg';
    if (/\.(webp)$/.test(name)) return 'image/webp';
    if (/\.(gif)$/.test(name)) return 'image/gif';
    if (/\.(svg)$/.test(name)) return 'image/svg+xml';
    if (/\.(json)$/.test(name)) return 'application/json';
    if (/\.(txt|md|csv|js|css|html|xml|yml|yaml)$/.test(name)) return 'text/plain';
    return 'application/octet-stream';
  }

  function referenceQuery(rows) {
    rows = rows || [];
    if (rows.length === 1 && rows[0] && rows[0].kind === 'folder') {
      return 'asset://' + (rows[0].path ? rows[0].path + '/' : '');
    }
    var urls = urlsForEntries(rows);
    return urls[0] || '';
  }

  function urlsForEntries(rows) {
    var out = [];
    (rows || []).forEach(function (entry) {
      if (!entry) return;
      if (entry.kind === 'folder') {
        var prefix = entry.path ? entry.path + '/' : '';
        ProjectIO.assets.list().forEach(function (item) {
          if (item.path && item.path.indexOf(prefix) === 0) out.push(item.url);
        });
      } else if (entry.url) {
        out.push(entry.url);
      }
    });
    return unique(out);
  }

  function deleteMessage(count, refs) {
    var msg = t('assets.delete.message', { n: count });
    if (!refs.length) return msg + '\n\n' + t('assets.delete.no_refs');
    return msg + '\n\n' + t('assets.delete.refs', { n: refs.length });
  }

  function unique(list) {
    var seen = {};
    var out = [];
    list.forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out;
  }

  function joinPath(a, b) {
    a = String(a || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    b = String(b || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return a && b ? a + '/' + b : (a || b);
  }

  EF.registerComponent('gde-assets', {
    category: 'panel',
    label: 'Assets',
    icon: 'folder',
    factory: createPanel,
    defaults: function () { return { title: 'Assets', props: {} }; },
  });
})();
