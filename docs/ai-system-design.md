# GameDataEditor AI System Design

Status: adapter contract for the final session-free `EF.ai` model
Scope: GameDataEditor adapter for framework AI

## 1. Goal

GameDataEditor uses the framework AI system as a data-design assistant.

The project layer must not reimplement chat, sessions, agents, providers, transcripts, group trees, or attachment UI. Those belong to `EF.ai`.

GameDataEditor owns:

- game-data resource resolvers
- schema/type_config context
- asset context
- cardStyle context
- data patch tools
- validation
- approve/apply integration with `State`
- project-local skills
- project templates

## 2. Framework Model Used By GDE

Expected framework pieces:

- `EF.ai.groups`
- `EF.ai.agents`
- `EF.ai.resources`
- `EF.ai.activeAgentId`
- AI Agents panel
- AI Chat panel
- AI Transcript panel
- provider/model config
- resource refs and resolvers
- context chips
- attachment support
- tool call preview/approval UI
- skill registry
- agent template registry
- plugin contribution points

There are no sessions. Groups are UI folders only. Agents are the only runnable entities and own messages, context refs, memory, state, provider, model, mode, and status.

## 3. GDE AI Namespace

Project namespace:

```js
GDE.ai
```

Responsibilities:

```js
GDE.ai.install()
GDE.ai.registerResourceResolvers()
GDE.ai.registerContextProviders()
GDE.ai.registerTools()
GDE.ai.registerSkills()
GDE.ai.registerAgentTemplates()
GDE.ai.projectSummary()
GDE.ai.selectionContext()
GDE.ai.validatePatch()
GDE.ai.applyPatch()
```

## 4. Resource References

AI should receive structured references, not raw copied text.

### Project Summary

```js
{
  resolver: "gde",
  uri: "gde://project",
  kind: "gde.project",
  title: "Project summary"
}
```

Resolved payload:

```js
{
  projectName,
  version,
  tableCount,
  entityCount,
  typeCount,
  assetCount,
  cardStyleCount
}
```

### TypeConfig

```js
{
  resolver: "gde",
  uri: "gde://type-config",
  kind: "gde.type_config",
  title: "TypeConfig"
}
```

By default, include summaries for all types and full definitions only for selected/used types.

### Table

```js
{
  resolver: "gde",
  uri: "gde://table/data/items",
  kind: "gde.table",
  title: "data/items"
}
```

Resolved payload:

```js
{
  pathKey,
  struct_def,
  card_style,
  ids,
  sampleEntities,
  selectedEntities
}
```

### Entity

```js
{
  resolver: "gde",
  uri: "gde://entity/data/items/589108884011822",
  kind: "gde.entity",
  title: "Dragon Fang"
}
```

Resolved payload:

```js
{
  id,
  table,
  struct_def,
  entity
}
```

### Field

```js
{
  resolver: "gde",
  uri: "gde://field/data/items/589108884011822/icon",
  kind: "gde.field",
  title: "data/items.589108884011822 icon"
}
```

Resolved payload:

```js
{
  value,
  fieldDef,
  resolvedType,
  typeConfigEntry
}
```

### Asset

```js
{
  resolver: "gde",
  uri: "gde://asset/items/icon.png",
  kind: "gde.asset",
  title: "items/icon.png"
}
```

Do not send asset blobs by default. Send URL/path/reference metadata unless the user explicitly attaches the file.

### CardStyle

```js
{
  resolver: "gde",
  uri: "gde://card-style/default",
  kind: "gde.card_style",
  title: "CardStyle default"
}
```

Resolved payload:

```js
{
  styleKey,
  root,
  selectedNodes,
  bindings,
  size
}
```

## 5. Context Capture UX

Recommended project interactions:

- right-click menu item: "Ask AI"
- drag a table/entity/asset/cardStyle node into AI Chat context chips
- inspector row action: "Send field to AI"
- search result action: "Ask AI about this"

Each panel registers context providers:

```js
GDE.ai.registerContextProviders()
```

Providers:

- tables panel: table, entity
- table data panel: selected entities, card order, table view
- inspector: selected field or table meta
- typeconfig panel: type entry and usages
- asset panel: asset/folder and references
- cardstyle tree/editor: scene or selected nodes
- log panel: selected error/log entry

Captured persistent context becomes `ResourceRef` entries attached to `agent.contextRefs`.

## 6. Data Patch Protocol

AI must not mutate `State` directly.

AI proposes a patch:

```js
{
  type: "gde.patch",
  title: "Balance item prices",
  ops: [
    {
      op: "setField",
      table: "data/items",
      id: "589108884011822",
      field: "price",
      value: 200
    }
  ]
}
```

The project layer validates and previews it. Only approved patches apply.

## 7. Patch Operations

Initial operation set:

```js
setField
setFields
addEntity
updateEntity
deleteEntity
duplicateEntity
reorderEntities
addTable
renameTable
deleteTable
updateStructDef
upsertType
deleteType
setTableCardStyle
upsertCardStyle
setAssetReference
clearAssetReference
```

All operations must be JSON serializable.

## 8. Validation Rules

Before preview/apply:

- target table exists
- target entity exists unless adding
- field exists in table `struct_def`
- field type exists in project/builtin TypeConfig
- value conforms to resolved type
- `ref_id` points to existing id unless allowed empty
- asset URL exists for asset fields unless allowed external URL
- operation does not create duplicate id
- operation does not break `table.id` order
- cardStyle JSON is a valid UI tree

Validation returns structured errors:

```js
{
  ok: false,
  errors: [
    { path: "ops[0].value", message: "Expected int" }
  ]
}
```

## 9. Apply Flow

```txt
AI proposes patch
GDE validates
GDE creates preview diff
User approves
GDE applies through State/ProjectIO APIs
History captures change
UI refreshes
```

Never bypass existing mutators. All writes should go through `State.*` or `ProjectIO.assets.*` so history, dirty state, validation, and UI updates stay consistent.

## 10. Tools

GDE registers domain tools into `EF.ai`.

### Read Tools

```js
gde.getProjectSummary
gde.getTypeConfig
gde.getTableSchema
gde.getTableEntities
gde.queryRows
gde.getEntity
gde.getField
gde.findReferences
gde.findAssetReferences
gde.searchData
gde.getCardStyle
```

Read tools can usually run automatically.

Large table reads should prefer `gde.queryRows` or `gde.getTableEntities`
with pagination and projection:

```js
{
  table: "data/items",
  ids: ["589108884011822"],
  fields: ["name", "price", "icon"],
  offset: 0,
  limit: 200
}
```

Supported read selectors:

- `table` / `pathKey`: target table.
- `ids`: optional exact entity ids.
- `fields`: optional projection. Omit it only for small result sets.
- `field` + `value`: exact field filter.
- `field` + `query`: substring field filter.
- `query`: substring search across table, id, and top-level values.
- `offset` / `limit`: page cursor. `limit` is capped by the adapter.

Use `gde.getField` for precise table/id/field reads when modifying one
field based on its resolved `FieldDef`.

### Write Tools

```js
gde.proposePatch
gde.validatePatch
gde.previewPatch
gde.applyPatch
gde.importAsset
gde.replaceAssetReferences
```

Write tools default to approval mode.

All write tools route through `GDE.ai.patch(patch, options)`.

- `GDE.ai.patch(patch, { dryRun: true })` validates and returns a preview only.
- `GDE.ai.patch(patch, { apply: true })` applies through `State.*`, pauses
  coalesced history while mutating, then captures one history entry.
- AI agents must not call `State.*` mutators directly.

Bulk patch operations:

```js
{
  type: "gde.patch",
  title: "Bulk price tuning",
  ops: [
    { op: "setFieldMany", table: "data/items", ids: ["1", "2"], field: "price", value: 100 },
    { op: "setFieldsMany", table: "data/items", ids: ["3", "4"], fields: { rarity: 2, stackable: true } },
    { op: "deleteEntities", table: "data/items", ids: ["5", "6"] }
  ]
}
```

Patch validation checks table/id/field existence, `struct_def` type keys,
`type_config` shape for upserted types, primitive value shape, `ref_id`
targets, and `asset://` references for image/audio fields.

## 11. Skill Design

GameDataEditor should ship a default skill:

```js
{
  id: "gde.game-data-designer",
  title: "Game Data Designer",
  version: 1,
  systemPrompt,
  rules,
  examples,
  tools: [
    "gde.getProjectSummary",
    "gde.getTypeConfig",
    "gde.getTableSchema",
    "gde.proposePatch"
  ],
  outputSchemas: [
    "gde.patch"
  ]
}
```

Core rules:

- every table field must exist in TypeConfig
- table `struct_def` references type keys
- ids are stable references
- references use `ref_id` or project compound id structs
- do not invent fields without adding/updating TypeConfig
- prefer patch operations over prose for actual edits
- keep changes minimal and reviewable
- explain balance/design reasoning separately from patch data

## 12. Agent Templates

GDE may register templates:

```js
EF.ai.registerAgentTemplate("gde.table-designer", {
  title: "Table Designer",
  defaults: {
    mode: "chat",
    provider: "default",
    model: "fast",
    contextRefs: [
      { resolver: "gde", uri: "gde://project" },
      { resolver: "gde", uri: "gde://type-config" }
    ]
  },
  skills: ["gde.game-data-designer"]
})
```

Templates create agents. They do not create sessions.

## 13. Agent Usage Pattern

Recommended UI groups:

```txt
Items
Characters
Shops
Card Styles
QA
```

Example agents:

```txt
Item Balance
Item Icon Pass
Character Progression
Shop Economy
Broken Reference Audit
```

Groups are only folders. An agent can be moved between groups without changing messages, memory, resources, provider, model, mode, or status.

Use `goal` mode for longer tasks:

- generate 50 items
- balance shop economy
- audit broken refs
- build card styles for all tables

Use `chat` mode for direct questions.

## 14. GDE Panels

GameDataEditor can use framework panels directly:

- `ai-agents`
- `ai-chat`
- `ai-transcript`

Default layout suggestion:

- left dock: Agents
- bottom dock: Chat
- center dock: Transcript

GDE may add toolbar buttons or menu entries, but should not fork the generic AI panel implementations unless a domain-specific view is required.

## 15. AI Settings

GDE should expose an AI tab in settings that writes framework config:

- providers
- API key or local bridge URL
- default model
- fast model
- reasoning model
- tool permission mode
- context limits
- privacy options

Project defaults:

```js
{
  includeTypeConfig: true,
  includeCurrentTableSchema: true,
  maxEntitiesPerContext: 20,
  sendAssetBlobs: false,
  requireApprovalForPatch: true
}
```

## 16. Minimal Project Work

Most implementation is framework-level.

GameDataEditor needs only:

1. register resource resolvers
2. register context providers
3. register read/write tools
4. implement `gde.patch` validation and apply
5. ship the Game Data Designer skill
6. register project agent templates
7. add AI settings defaults

This keeps GameDataEditor a domain adapter rather than a custom AI app.
