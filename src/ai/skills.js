/**
 * GDE.ai project skills and agent templates.
 */
(function () {
  'use strict';

  function registerSkills() {
    EF.ai.registerSkill('gde.game-data-designer', {
      title: 'Game Data Designer',
      version: 1,
      description: 'Designs and audits GameDataEditor tables, entities, schemas, assets, and card styles.',
      systemPrompt: [
        'You are a GameDataEditor project assistant.',
        'Use structured GDE resources and tools before making claims about project data.',
        'For every edit, produce the final gde.patch format only, call gde.previewPatch before apply, and wait for approval.',
        'For bulk edits, query or read the affected rows first, then preview the exact patch.',
      ].join('\n'),
      rules: [
        'Use only final AI component ids: ai-agents-list, ai-chatinput, and ai-messages.',
        'Use only final GDE patch tools for mutation flow: gde.validatePatch, gde.previewPatch, and gde.applyPatch.',
        'Do not use legacy ids, alias ids, alternate patch envelopes, or compatibility formats.',
        'Read current data before writing: use attached targets, gde.get* tools, or gde.queryRows.',
        'Bulk modifications must first call gde.queryRows or a narrower read tool to enumerate affected ids.',
        'Bulk modifications must call gde.previewPatch before apply, even when the requested change sounds simple.',
        'Every entity field you write must exist in the table struct_def or be added to struct_def in the same patch.',
        'Every struct_def field type must resolve through builtin/project type_config or be added with upsertType in the same patch.',
        'Do not invent fields, table paths, type names, asset URLs, card style keys, card node ids, or entity ids.',
        'Keep ids stable unless the user explicitly asks to rename or duplicate an entity.',
        'ref_id values must reference existing entity ids unless the field is intentionally empty.',
        'Use gde.findReferences or gde.findInvalidRefs when changing ids or auditing references.',
        'Use asset:// URLs only when the asset exists in the project.',
        'For card style scene edits, read the node first and use updateCardNode, addCardNode, or deleteCardNode; never rewrite an entire cardStyle for a node-level change.',
        'Do not send asset blobs unless explicitly attached by the user.',
        'Separate design reasoning from patch data and keep patches minimal.',
        'A child agent must not create a deeper child agent unless the user explicitly asks for nested delegation.',
      ],
      tools: [
        'gde.getProjectSummary',
        'gde.getTypeConfig',
        'gde.getType',
        'gde.getTableSchema',
        'gde.getTableEntities',
        'gde.queryRows',
        'gde.getEntity',
        'gde.getField',
        'gde.getAsset',
        'gde.findReferences',
        'gde.findAssetReferences',
        'gde.searchData',
        'gde.getCardStyle',
        'gde.getCardStyleNode',
        'gde.summarizeTable',
        'gde.findInvalidRefs',
        'gde.findUnknownStructFields',
        'gde.planTypeConfigMerge',
        'gde.replaceAssetReferences',
        'gde.planBatchSetFields',
        'gde.planBatchCreateEntities',
        'gde.planBatchDeleteEntities',
        'gde.planBalanceNumericField',
        'gde.validatePatch',
        'gde.previewPatch',
        'gde.applyPatch',
      ],
      outputSchemas: ['gde.patch'],
    });
  }

  function registerAgentTemplates() {
    EF.ai.registerAgentTemplate('gde.table-designer', {
      title: 'GDE Table Designer',
      defaults: {
        connection: 'mock',
        model: '',
        contextRefs: [
          { resolver: 'gde', uri: 'gde://project', kind: 'gde.project', title: 'Project summary' },
          { resolver: 'gde', uri: 'gde://type-config', kind: 'gde.type_config', title: 'TypeConfig' },
        ],
        permissions: { paths: [{ path: 'gde', mode: 'readwrite' }] },
      },
      skills: ['gde.game-data-designer'],
    });
    EF.ai.registerAgentTemplate('gde.reference-auditor', {
      title: 'GDE Reference Auditor',
      defaults: {
        connection: 'mock',
        model: '',
        permissions: { paths: [{ path: 'gde', mode: 'read' }] },
      },
      skills: ['gde.game-data-designer'],
    });
  }

  GDE.ai.registerSkills = registerSkills;
  GDE.ai.registerAgentTemplates = registerAgentTemplates;
})();
