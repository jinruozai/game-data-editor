/**
 * GDE.ai ChangeSet adapter - maps domain patch previews to EF.changeSet.
 */
(function () {
  'use strict';

  var clone = GDE.ai.clone;

  function patchPreviewToChangeSet(preview) {
    var resources = groupResources(preview);
    return EF.changeSet.normalize({
      title: preview.title || 'GDE patch',
      description: 'Review and apply a GameDataEditor patch.',
      source: { kind: 'tool', toolId: 'gde.previewPatch' },
      status: preview.ok === false ? 'failed' : 'pending',
      resources: resources,
      apply: { mode: 'atomic', adapter: 'gde.patch', payload: clone(preview.patch) },
      validation: preview.validation || { ok: preview.ok !== false, warnings: [], errors: [] },
      meta: { domain: 'gde', preview: clone(preview) },
    });
  }

  function groupResources(preview) {
    var map = {};
    (preview.changes || []).forEach(function (change, index) {
      var resource = resourceFor(change);
      if (!map[resource.id]) map[resource.id] = resource;
      map[resource.id].changes.push(changeFor(change, index));
    });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function resourceFor(change) {
    if (change.table && change.id) {
      return {
        id: 'gde.entity:' + change.table + ':' + change.id,
        uri: 'gde://entity/' + encodeURIComponent(change.table) + '/' + encodeURIComponent(change.id),
        kind: 'gde.entity',
        title: entityTitle(change.table, change.id),
        subtitle: change.table + ' / ' + change.id,
        changes: [],
      };
    }
    if (change.table) {
      return {
        id: 'gde.table:' + change.table,
        uri: 'gde://table/' + encodeURIComponent(change.table),
        kind: 'gde.table',
        title: change.table,
        subtitle: 'Table',
        changes: [],
      };
    }
    if (change.raw && change.raw.name) {
      return {
        id: 'gde.type:' + change.raw.name,
        uri: 'gde://type/' + encodeURIComponent(change.raw.name),
        kind: 'gde.type',
        title: change.raw.name,
        subtitle: 'TypeConfig',
        changes: [],
      };
    }
    if (change.raw && change.raw.styleKey) {
      return {
        id: 'gde.cardstyle:' + change.raw.styleKey,
        uri: 'gde://card-style/' + encodeURIComponent(change.raw.styleKey),
        kind: 'gde.cardStyle',
        title: change.raw.styleKey,
        subtitle: 'CardStyle',
        changes: [],
      };
    }
    return {
      id: 'gde.project',
      uri: 'gde://project',
      kind: 'gde.project',
      title: 'Project',
      subtitle: 'GameDataEditor',
      changes: [],
    };
  }

  function entityTitle(table, id) {
    var entity = State.gameData()[String(id)] || {};
    return String(entity.name || entity.title || id) + ' · ' + table;
  }

  function changeFor(change, index) {
    return {
      id: 'op_' + String(change.index != null ? change.index : index),
      kind: changeKind(change),
      operation: operationFor(change),
      title: change.summary || change.op,
      path: changePath(change),
      op: change.op,
      before: clone(change.before),
      after: clone(change.after),
      summary: change.summary || '',
      meta: {
        table: change.table || null,
        id: change.id || null,
        field: change.field || null,
        raw: clone(change.raw || {}),
      },
    };
  }

  function changeKind(change) {
    if (change.field) return 'gde.field'
    if (change.raw && change.raw.nodeId) return 'gde.cardNode'
    if (change.raw && change.raw.name) return 'gde.type'
    if (change.table && change.id) return 'gde.entity'
    if (change.table) return 'gde.table'
    return 'gde.project'
  }

  function operationFor(change) {
    return GDE.ai.patchOps ? GDE.ai.patchOps.operation(change.op) : 'update';
  }

  function changePath(change) {
    if (change.field) return change.field;
    if (change.raw && change.raw.nodeId) return change.raw.nodeId;
    if (change.raw && change.raw.name) return change.raw.name;
    return change.op || 'change';
  }

  function patchFromResult(result) {
    if (!result) return null;
    if (result.type === 'gde.patch') return result;
    if (result.type === 'ef.changeSet' && result.apply) return result.apply.payload;
    if (result.patch) return result.patch;
    if (result.meta && result.meta.preview && result.meta.preview.patch) return result.meta.preview.patch;
    return result;
  }

  function registerChangeSetAdapter() {
    if (!window.EF || !EF.changeSet) return;
    EF.changeSet.registerAdapter('gde.patch', {
      canApply: function (changeSet, scope) {
        return scope.type === 'all' && (!changeSet.validation || changeSet.validation.ok !== false);
      },
      apply: function (changeSet) {
        return GDE.ai.patch(patchFromResult(changeSet), { apply: true });
      },
      reject: function () {
        return { rejected: true };
      },
    });
  }

  function previewPatch(args) {
    var preview = GDE.ai.patch(args.patch || args, { dryRun: true });
    return patchPreviewToChangeSet(preview);
  }

  function applyPatchResult(result) {
    return GDE.ai.patch(patchFromResult(result), { apply: true });
  }

  GDE.ai.patchPreviewToChangeSet = patchPreviewToChangeSet;
  GDE.ai.registerChangeSetAdapter = registerChangeSetAdapter;
  GDE.ai.previewPatchChangeSet = previewPatch;
  GDE.ai.applyPatchChangeSet = applyPatchResult;
})();
