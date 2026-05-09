# GameDataEditor Data Contract

This reference is the source of truth for AI agents editing GameDataEditor data projects.

## Project Layout

```text
project-root/
  gamedata.json
  asset/
  Items.json
  Characters/Heroes.json
  asset/Items/100000000000001.png
  asset/shared/icons/coin.png
```

Rules:

- `gamedata.json` is optional but strongly recommended.
- The only special directory is `asset/`.
- `asset/` contains game resources referenced by `asset://...`.
- Every table is one `.json` file with a top-level `_table` object.
- Table path equals file path without `.json`, using `/`.
- Any `.json` outside `gamedata.json` and `asset/` is a data table and must contain top-level `_table`.
- Project-specific editor behavior belongs in a separate editor extension project, not inside the data directory.

## gamedata.json

```json
{
  "project": { "name": "MyGame", "version": 0 },
  "type_config": {},
  "card_styles": {}
}
```

Rules:

- `project.name` is display metadata.
- `project.version` may be preserved by AI edits unless explicitly versioning.
- `type_config` contains project types and overrides. Do not duplicate builtin primitive types.
- `card_styles.default` should exist when the project uses card views.
- On import, the editor can promote table `struct_def` fields missing from `type_config` into `type_config` if their field definitions can be resolved.

## Table File

```json
{
  "_table": {
    "struct_def": {
      "name": { "type": "string", "mem": "Display name" },
      "icon": { "type": "img", "mem": "Icon" },
      "price": { "type": "int", "mem": "Shop price" }
    },
    "card_style": "default"
  },
  "100000000000001": {
    "name": "Iron Sword",
    "icon": "asset://Items/100000000000001.png",
    "price": 120
  }
}
```

Rules:

- `_table` is schema, not data.
- Top-level keys other than `_table` are entity ids.
- Keep ids globally unique across all table files.
- Entity fields should be defined by `_table.struct_def`.
- Missing fields are normalized by the editor from defaults, but AI should write complete rows.
- Extra fields can survive JSON parsing, but they are not schema-owned and should be removed unless intentionally reserved.

## Field Definitions

Preferred object form:

```json
{
  "field_name": {
    "type": "string",
    "mem": "Human description",
    "default": ""
  }
}
```

Allowed shorthand:

```json
{ "name": "string" }
```

Common properties:

- `type`: type name. Must resolve.
- `mem`: short field description for humans and AI.
- `default`: value used for new or backfilled rows.
- `type_agv`: renderer/type arguments, such as enum options, range limits, or array element type.
- `group`: optional property panel group.
- `desc`: optional longer description.
- `ref_name`: optional field used as display text when this table is referenced.
- `ref_icon`: optional image field shown before `ref_name` when this table is referenced.

## TypeConfig

Project type entries use this shape:

```json
{
  "quality": {
    "name": "Quality",
    "base_type": "int",
    "type_render": "enum",
    "default": 1,
    "mem": "Item quality",
    "type_agv": {
      "options": {
        "1": "Common",
        "2": "Rare"
      }
    }
  }
}
```

Rules:

- Key is the canonical type/field name used by `struct_def`.
- `base_type` controls JSON value shape.
- `type_render` controls editor UI.
- Common renderers are `input_string`, `textarea`, `input_int`, `input_float`, `range`, `enum`, `toggle`, `color`, `date`, `img`, `snd`, `id`, `ref_id`, `struct`, and `array`.
- `default` must match `base_type`.
- `type_agv.options` keys are stored values for enum types.
- Prefer one canonical project type per repeated domain concept.

## Builtin And Known Types

Builtin types:

```text
int, float, string, struct, array, var
bool, percent, color, date
img, snd
id, ref_id
enum_int, enum_string
range_int, range_float
```

Known compound types:

```text
id_num, id_string, string_num, img_num, snd_num, img_string, snd_string
```

Value conventions:

- `int`: JSON number, integer.
- `float`: JSON number.
- `string`: JSON string.
- `bool`: `0` or `1`, not JSON `true`/`false`.
- `percent`: JSON number, usually `0..1`.
- `color`: integer color value such as `16711680`.
- `date`: string, prefer `YYYY-MM-DD`.
- `img`: string, prefer `asset://...`.
- `snd`: string, prefer `asset://...`.
- `id` / `ref_id`: entity reference value. Prefer numeric JSON value when possible; entity object keys remain strings.
- `array`: JSON array.
- `struct`: JSON object. Shortcut compound types also use named fields, such as `id_num` = `{ "id": 123, "num": 10 }`.

## References And Catalog Tables

Most reusable game concepts should be rows in catalog tables:

- attributes
- currencies
- tags
- factions
- damage types
- item types
- rarity tiers
- status effects
- skills
- resources

Use ids to reference them:

```json
{
  "_table": {
    "struct_def": {
      "name": { "type": "string", "mem": "Name" },
      "cost": { "type": "array", "mem": "Currency costs", "type_agv": { "elem_type": "id_num" } },
      "tags": { "type": "array", "mem": "Tag refs", "type_agv": { "elem_type": "ref_id" } }
    }
  }
}
```

Reference discipline:

- Store only the target id where a link is needed.
- Do not copy target names, icons, or stats unless denormalization is explicitly requested.
- If using `ref_id`, ensure the id exists in exactly one table.
- Use `id_num` for quantity pairs such as `{ "id": currencyId, "num": amount }` or `{ "id": itemId, "num": count }`.
- Use arrays of ids for many-to-many links.

## Assets

Use:

```text
asset://relative/path.ext
```

Disk path:

```text
asset/relative/path.ext
```

Rules:

- `asset://` paths are always relative to project `asset/`.
- Use `/` separators.
- Never use absolute paths.
- Never use `..`.
- Multiple entities may reference the same asset.
- When deleting or moving an asset, update every JSON reference.

Recommended generated asset names:

```text
asset://<table-path>/<entity-id>.<ext>
asset://<table-path>/<entity-id>_<field>.<ext>
asset://<table-path>/<entity-id>_<field>_2.<ext>
```

## Card Styles

Card styles live in `gamedata.json.card_styles`. Tables reference them through `_table.card_style`.

Minimum:

```json
{
  "default": {
    "name": "Default",
    "root": {
      "id": "root",
      "component": "absolute",
      "props": { "width": 140, "height": 140 },
      "bindings": {},
      "children": []
    }
  }
}
```

Binding example:

```json
{
  "bindings": {
    "src": { "source": "field", "field": "icon" },
    "value": { "source": "field", "field": "name" }
  }
}
```

Rules:

- Node ids should be unique within a style.
- `component` must be a registered card component.
- Bindings must reference real table fields.
- If a field is renamed, update card style bindings.

## Preflight Checklist

- All JSON parses with a standard parser.
- Every table file has `_table.struct_def`.
- Every entity id is globally unique.
- Every entity field is defined in its table `struct_def`.
- Every `struct_def` type resolves.
- Repeated domain fields have project `type_config` entries.
- Enum values exist in `type_agv.options`.
- Range values respect `min` and `max`.
- `img` and `snd` values use valid `asset://...` URLs or deliberate external URLs.
- Every `asset://...` has a matching file under `asset/`.
- Every `ref_id` or id inside an `id_num`/reference array resolves to an existing entity.
