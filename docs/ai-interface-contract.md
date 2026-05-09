# GameDataEditor AI Interface Contract

Status: active design contract

This document defines the shape that GDE exposes to AI. The goal is high
accuracy: tools should be easy for a model to call correctly, and incorrect
calls should return enough structure for the model to repair the next call.

## 1. Layering

```text
EF.ai
  generic agents / tools / targets / resources / ChangeSet / permissions

GDE.ai
  GDE resource resolver
  GDE target constructors
  GDE tool registrations
  GDE patch validation / preview / apply
  GDE patch op registry
  GDE skills and agent templates

Project plugins
  project-specific skills and optional high-level tools
```

Framework code must not know GDE table, asset, or card-style semantics.
GDE code must not bypass the framework AI lifecycle for tool calls, approvals,
or ChangeSet rendering.

## 2. Mutation Rule

Every GDE mutation goes through this pipeline:

```text
tool args
  -> GDE patch
  -> validatePatch
  -> previewPatch
  -> ef.changeSet
  -> approval
  -> applyPatch
  -> State + History
```

No AI tool should directly mutate `State` unless it is the approved apply phase
of a `gde.patch`.

## 3. Tool Result Shape

Tools should return one of these shapes.

Successful read:

```js
{
  ok: true,
  data: any
}
```

Successful preview:

```js
{
  type: "ef.changeSet",
  status: "pending",
  resources: [],
  apply: { mode: "atomic", adapter: "gde.patch", payload: {} },
  validation: { ok: true, warnings: [], errors: [] }
}
```

Recoverable failure:

```js
{
  ok: false,
  errors: [{
    code: "FIELD_NOT_FOUND",
    path: "ops[0].field",
    message: "Field not in struct_def: rarity",
    expected: "field declared in table struct_def",
    received: "rarity",
    allowedValues: ["name", "icon", "price"],
    suggestedFix: "Call gde.getTableSchema and use one of the declared fields.",
    retryWith: {
      tool: "gde.getTableSchema",
      args: { pathKey: "data/items" }
    }
  }]
}
```

`message` is for humans. `code`, `path`, `allowedValues`, `suggestedFix`, and
`retryWith` are for AI repair.

GDE exposes `GDE.ai.error(code, path, message, extra)` and
`GDE.ai.errorResult(code, path, message, extra)` so tools and validators return
the same error shape.

## 4. Patch Op Registry

Every patch operation is registered once with metadata:

```js
{
  op: "setField",
  title: "Set field",
  operation: "update",
  target: "entity",
  requiresTable: true,
  requiresEntity: true,
  schema: {}
}
```

The registry is the single source for:

- known operation names
- table/entity requirements
- operation category used by review UI
- generated schema shown to AI tools

Validation, preview, apply, and ChangeSet rendering should use this registry
instead of duplicating operation lists.

`gde.previewPatch`, `gde.applyPatch`, and `gde.validatePatch` expose the
registry-generated patch schema. Batch planning tools expose narrow schemas so
models choose a small parameter surface before the generated patch reaches the
canonical mutation pipeline.

## 5. Batch Planning Tools

Low-level `gde.patch` stays as the canonical write format. High-level batch
tools produce patch previews, not direct mutations.

Current tools:

```text
gde.planBatchSetFields
gde.planBatchCreateEntities
gde.planBatchDeleteEntities
gde.planBalanceNumericField
gde.planTypeConfigMerge
```

These tools should:

- read or require the affected table schema
- enumerate target ids before editing
- return structured validation errors
- produce a minimal `gde.patch`
- route through `gde.previewPatch`

## 6. Stability Rules

- No compatibility aliases.
- No silent repair during apply. Repair suggestions are returned to AI.
- Bulk edits must enumerate ids before preview.
- New fields must be added to `struct_def` in the same patch.
- New field types must be introduced with `upsertType` in the same patch.
- Asset URLs must be `asset://...` and must exist for `img` / `snd` fields.
- `ref_id` values must resolve unless intentionally empty.

## 7. Current Implementation Snapshot

Implemented:

- Patch op registry: `GDE.ai.patchOps`
- Registry-generated `gde.patch` schema
- `gde.validatePatch`, `gde.previewPatch`, and `gde.applyPatch` use the patch schema
- Batch planning tools:
  - `gde.planBatchSetFields`
  - `gde.planBatchCreateEntities`
  - `gde.planBatchDeleteEntities`
  - `gde.planBalanceNumericField`
- Unified GDE AI error helpers:
  - `GDE.ai.error`
  - `GDE.ai.errorResult`
- Structured validation errors for common repair cases:
  - missing table
  - missing entity
  - missing field
  - unsupported patch op

Verified:

- `npm run check`
- `npm run check:gde`
- `npm run check:dist`

Next work:

- Add richer `retryWith` guidance to patch validation errors.
- Add semantic ChangeSet renderers for common GDE changes.
- Add dedicated batch generation helpers for style-guided content generation.
- Browser-smoke the full AI flow: attach target, ask, preview patch, approve, undo.
