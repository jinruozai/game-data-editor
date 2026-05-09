/**
 * GDE.ai core - project adapter entry for EF.ai.
 */
(function () {
  'use strict';

  function clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  function fieldTypeName(def) {
    if (typeof def === 'string') return def;
    return def && typeof def === 'object' ? def.type || '' : '';
  }

  function aiError(code, path, message, extra) {
    return Object.assign({
      code: code || 'ERROR',
      path: path || '',
      message: message || code || 'Error',
    }, extra || {});
  }

  function errorResult(code, path, message, extra) {
    return { ok: false, errors: [aiError(code, path, message, extra)] };
  }

  function tableOfEntity(id) {
    var sid = String(id);
    var tm = State.tableMap();
    var keys = Object.keys(tm);
    for (var i = 0; i < keys.length; i++) {
      if ((tm[keys[i]].id || []).indexOf(sid) >= 0) return keys[i];
    }
    return null;
  }

  function entityTitle(id, entity) {
    var info = State.resolveEntityDisplay(id);
    if (info && info.name) return info.name;
    if (entity && entity.name != null) return String(entity.name);
    return String(id);
  }

  function selectedEntityRefs(sel) {
    if (!sel) return [];
    if (sel.items && sel.items.length) {
      return sel.items.map(function (it) { return { table: it.pathKey, id: String(it.id) }; });
    }
    var ids = sel.ids && sel.ids.length ? sel.ids : (sel.id != null ? [sel.id] : []);
    return ids.map(function (id) { return { table: sel.pathKey || tableOfEntity(id), id: String(id) }; });
  }

  function ensureAI() {
    if (!window.EF || !EF.ai) {
      if (window.State && State.log) State.log('warn', 'GDE.ai skipped: EF.ai is not available');
      return null;
    }
    return EF.ai;
  }

  function projectSummary() {
    var tm = State.tableMap();
    var assets = window.ProjectIO && ProjectIO.assets ? ProjectIO.assets.list() : [];
    return {
      projectName: State.projectName(),
      version: State.version(),
      tableCount: Object.keys(tm).length,
      entityCount: Object.keys(State.gameData()).length,
      typeCount: Object.keys(State.builtinTypeConfig()).length + Object.keys(State.projectTypeConfig()).length,
      assetCount: assets.length,
      cardStyleCount: Object.keys(State.projectCardStyles()).length,
    };
  }

  function selectionContext() {
    var sel = State.selection();
    if (!sel) return { kind: 'none', refs: [] };
    var refs = [];
    if (sel.kind === 'card_data') {
      refs = selectedEntityRefs(sel).map(function (ref) {
        return {
          resolver: 'gde',
          uri: 'gde://entity/' + ref.table + '/' + ref.id,
          kind: 'gde.entity',
          title: ref.table + ' / ' + ref.id,
        };
      });
    } else if (sel.kind === 'card_style') {
      refs.push({ resolver: 'gde', uri: 'gde://card-style/' + sel.key, kind: 'gde.card_style', title: sel.key });
    } else if (sel.kind === 'card_component') {
      refs.push({ resolver: 'gde', uri: 'gde://card-style/' + sel.styleKey, kind: 'gde.card_style', title: sel.styleKey });
    } else if (sel.pathKey) {
      refs.push({ resolver: 'gde', uri: 'gde://table/' + sel.pathKey, kind: 'gde.table', title: sel.pathKey });
    }
    return { kind: sel.kind || 'selection', selection: clone(sel), refs: refs };
  }

  function tableTarget(pathKey) {
    return {
      resolver: 'gde',
      uri: 'gde://table/' + pathKey,
      kind: 'gde.table',
      title: pathKey,
      meta: { table: pathKey },
      capabilities: ['read', 'patch', 'query'],
      tools: ['gde.getTableSchema', 'gde.queryRows', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function entityTarget(pathKey, id) {
    var data = State.gameData()[String(id)] || {};
    return {
      resolver: 'gde',
      uri: 'gde://entity/' + pathKey + '/' + String(id),
      kind: 'gde.entity',
      title: pathKey + ' / ' + entityTitle(id, data),
      summary: data.name != null ? String(data.name) : '',
      meta: { table: pathKey, id: String(id) },
      capabilities: ['read', 'patch', 'references'],
      tools: ['gde.getEntity', 'gde.findReferences', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function fieldTarget(pathKey, id, field) {
    return {
      resolver: 'gde',
      uri: 'gde://field/' + pathKey + '/' + String(id) + '/' + String(field),
      kind: 'gde.field',
      title: pathKey + ' / ' + String(id) + ' / ' + String(field),
      meta: { table: pathKey, id: String(id), field: String(field) },
      capabilities: ['read', 'patch'],
      tools: ['gde.getField', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function assetTarget(url) {
    return {
      resolver: 'gde',
      uri: 'gde://asset/' + String(url || '').replace(/^asset:\/\//, ''),
      kind: 'gde.asset',
      title: String(url || ''),
      meta: { url: String(url || '') },
      capabilities: ['read', 'references'],
      tools: ['gde.findAssetReferences'],
    };
  }

  function cardStyleTarget(key) {
    return {
      resolver: 'gde',
      uri: 'gde://card-style/' + String(key),
      kind: 'gde.card_style',
      title: String(key),
      meta: { cardStyle: String(key) },
      capabilities: ['read', 'patch'],
      tools: ['gde.getCardStyle', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function typeTarget(name) {
    return {
      resolver: 'gde',
      uri: 'gde://type/' + String(name),
      kind: 'gde.type',
      title: String(name),
      meta: { type: String(name) },
      capabilities: ['read', 'patch', 'references'],
      tools: ['gde.getTypeConfig', 'gde.findUnknownStructFields', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function cardNodeTarget(styleKey, nodeId) {
    return {
      resolver: 'gde',
      uri: 'gde://card-style/' + String(styleKey) + '/node/' + String(nodeId),
      kind: 'gde.card_node',
      title: String(styleKey) + ' / ' + String(nodeId),
      meta: { cardStyle: String(styleKey), nodeId: String(nodeId) },
      capabilities: ['read', 'patch'],
      tools: ['gde.getCardStyleNode', 'gde.previewPatch', 'gde.applyPatch'],
    };
  }

  function selectionTargets() {
    var ctx = selectionContext();
    return (ctx.refs || []).map(function (ref) {
      if (ref.kind === 'gde.entity' && ref.uri) {
        var parts = ref.uri.replace('gde://entity/', '').split('/');
        var id = parts.pop();
        return entityTarget(parts.join('/'), id);
      }
      return ref;
    });
  }

  function registerTargetProviders() {
    var ai = ensureAI();
    if (!ai || !ai.registerTargetProvider) return;
    ai.registerTargetProvider('gde', {
      match: function (source) {
        return source === 'selection' || (source && (source.gdeTarget || source.pathKey || source.assetUrl || source.cardStyle));
      },
      capture: function (source) {
        if (source === 'selection' || (source && source.gdeTarget === 'selection')) return selectionTargets();
        if (source && source.gdeTarget === 'table') return tableTarget(source.pathKey);
        if (source && source.gdeTarget === 'entity') return entityTarget(source.pathKey, source.id);
        if (source && source.gdeTarget === 'field') return fieldTarget(source.pathKey, source.id, source.field);
        if (source && source.gdeTarget === 'asset') return assetTarget(source.assetUrl || source.url);
        if (source && source.gdeTarget === 'card_style') return cardStyleTarget(source.cardStyle || source.key);
        if (source && source.gdeTarget === 'type') return typeTarget(source.type || source.name || source.key);
        if (source && source.gdeTarget === 'card_node') return cardNodeTarget(source.cardStyle || source.key || source.styleKey, source.nodeId || source.id);
        return null;
      },
    });
  }

  function bindTarget(el, targetOrFn, opts) {
    var ai = ensureAI();
    if (!ai || !ai.bindTarget) return el;
    return ai.bindTarget(el, targetOrFn, opts);
  }

  function addResourceRef(ref) {
    var ai = ensureAI();
    if (!ai || !ref || !ref.uri) return null;
    return ai.addTarget ? ai.addTarget(ref) : ai.addResource(ref);
  }

  function attachRefsToAgent(agentId, refs) {
    var ai = ensureAI();
    var agent = ai && (agentId ? ai.findAgent(agentId) : ai.getActiveAgent());
    if (!agent) return null;
    return ai.attachTargetsToAgent ? ai.attachTargetsToAgent(agent.id, refs || []) : agent;
  }

  function attachSelectionToAgent(agentId) {
    var ctx = selectionContext();
    return attachRefsToAgent(agentId, ctx.refs || []);
  }

  function askAboutSelection(message, agentId) {
    var ai = ensureAI();
    if (!ai) return null;
    var agent = attachSelectionToAgent(agentId) || ai.getActiveAgent();
    if (!agent) return null;
    return ai.message.send(agent.id, {
      content: message || 'Inspect the attached GameDataEditor selection.',
      from: 'user',
    });
  }

  function sendTargetsToAI(targets, message, agentId) {
    var ai = ensureAI();
    var agent = ai && (agentId ? ai.findAgent(agentId) : ai.getActiveAgent());
    if (!agent) return null;
    if (ai.addTargetsToChat) return ai.addTargetsToChat(targets || []);
    return ai.attachTargetsToAgent ? ai.attachTargetsToAgent(agent.id, targets || []) : agent;
  }

  function persistenceKey() {
    var name = State.projectName ? State.projectName() : 'Untitled';
    return 'gamedataeditor.ai.project.' + encodeURIComponent(String(name || 'Untitled'));
  }

  function configureProjectPersistence(ai) {
    if (!ai || !ai.configurePersistence) return;
    var key = persistenceKey();
    if (GDE.ai._persistenceKey === key) return;
    GDE.ai._persistenceKey = key;
    ai.configurePersistence({ key: key });
    ensureDefaultAgent(ai);
  }

  function install() {
    if (GDE.ai._installed) return true;
    var ai = ensureAI();
    if (!ai) return false;
    configureProjectPersistence(ai);
    if (GDE.ai.registerResourceResolvers) GDE.ai.registerResourceResolvers();
    if (GDE.ai.registerChangeSetAdapter) GDE.ai.registerChangeSetAdapter();
    registerTargetProviders();
    if (GDE.ai.registerContextProviders) GDE.ai.registerContextProviders();
    if (GDE.ai.registerTools) GDE.ai.registerTools();
    if (GDE.ai.registerSkills) GDE.ai.registerSkills();
    if (GDE.ai.registerAgentTemplates) GDE.ai.registerAgentTemplates();
    if (EF.effect) {
      GDE.ai._projectEffect = EF.effect(function () {
        State.projectName();
        configureProjectPersistence(ai);
      });
    }
    GDE.ai._installed = true;
    State.log('info', 'GDE AI adapter installed');
    return true;
  }

  function ensureDefaultAgent(ai) {
    if (!ai || !ai.createAgent || (ai.agents && ai.agents().length)) return;
    ai.createAgent({
      id: 'gde-main',
      name: 'main',
      connection: ai.defaultConnection || 'mock',
      permissionMode: 'full',
      skillRefs: ['gde.game-data-designer'],
      contextRefs: [
        { resolver: 'gde', uri: 'gde://project', kind: 'gde.project', title: 'Project summary' },
        { resolver: 'gde', uri: 'gde://type-config', kind: 'gde.type_config', title: 'TypeConfig' },
      ],
      permissions: { paths: [{ path: 'gde', mode: 'readwrite' }] },
    });
  }

  window.GDE = window.GDE || {};
  window.GDE.ai = Object.assign(window.GDE.ai || {}, {
    install: install,
    projectSummary: projectSummary,
    selectionContext: selectionContext,
    registerTargetProviders: registerTargetProviders,
    tableTarget: tableTarget,
    entityTarget: entityTarget,
    fieldTarget: fieldTarget,
    assetTarget: assetTarget,
    cardStyleTarget: cardStyleTarget,
    typeTarget: typeTarget,
    cardNodeTarget: cardNodeTarget,
    selectionTargets: selectionTargets,
    bindTarget: bindTarget,
    sendTargetsToAI: sendTargetsToAI,
    addResourceRef: addResourceRef,
    attachRefsToAgent: attachRefsToAgent,
    attachSelectionToAgent: attachSelectionToAgent,
    askAboutSelection: askAboutSelection,
    clone: clone,
    error: aiError,
    errorResult: errorResult,
    fieldTypeName: fieldTypeName,
    tableOfEntity: tableOfEntity,
    entityTitle: entityTitle,
    selectedEntityRefs: selectedEntityRefs,
  });
})();
