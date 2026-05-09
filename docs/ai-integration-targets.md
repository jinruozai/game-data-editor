# GameDataEditor AI Integration

GameDataEditor uses EditorFrame AI Targets to expose precise editable data to agents. The editor does not send vague screen text; it sends stable `gde://...` references that the AI can resolve and modify through approved tools.

## Target Kinds

- `gde.table`: a table definition and paged/sample rows.
- `gde.entity`: one concrete row/card in a table.
- `gde.field`: one field on one entity.
- `gde.asset`: one asset URL under `asset://`.
- `gde.card_style`: a card style scene.
- `gde.selection`: fallback for the current editor selection.

## Current UI Integration

- Table cards and table-list rows are draggable AI targets.
- Table card context menu includes `Ask AI`.
- Table empty-area context menu includes `Ask AI about Table`.
- Asset context menu includes `Ask AI`.
- AI Chat accepts target drops and converts them into agent context resources.

## Tool Flow

AI should inspect data with read/query tools first:

- `gde.getProjectSummary`
- `gde.getTypeConfig`
- `gde.getTableSchema`
- `gde.queryRows`
- `gde.getEntity`
- `gde.getField`
- `gde.findReferences`
- `gde.findAssetReferences`
- `gde.getCardStyle`

Any mutation must go through patch preview:

1. Build a `gde.patch`.
2. Call `gde.validatePatch` or `gde.proposePatch`.
3. Wait for user approval when the runtime marks it as preview-only.
4. Call/apply via `gde.applyPatch` only after approval.

## Data Safety Rules

- Every `struct_def` field must exist in project `type_config`; import/normalization merges missing field definitions into the project config.
- ID references must use IDs, not display names.
- Bulk updates should use `queryRows` to select exact IDs, then `setFieldMany` or `setFieldsMany`.
- Cross-table paste/patch must only write fields that exist in the target table schema.
- Asset changes should use `asset://...` URLs and check references before deletion.

## Extension Points

Project plugins can register more targets, tools, and skills:

```js
EF.ai.registerTargetProvider('my-game', {
  match(source) { return source && source.myKind },
  capture(source) {
    return {
      resolver: 'gde',
      uri: 'gde://entity/data/items/' + source.id,
      kind: 'gde.entity',
      title: source.name
    }
  }
})
```

For custom editors such as animation or VFX panels, prefer project-specific URI schemes and tools, but keep the same Target shape so AI Chat, permissions, resources, and tools remain interoperable.

