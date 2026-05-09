# GameDataEditor Examples

## Catalog-First Design

Use small catalog tables for reusable concepts, then reference ids.

`Currency.json`:

```json
{
  "_table": {
    "struct_def": {
      "name": { "type": "string", "mem": "Display name" },
      "icon": { "type": "img", "mem": "Icon asset" },
      "code": { "type": "string", "mem": "Stable code" }
    },
    "card_style": "default"
  },
  "100000000000101": {
    "name": "Gold",
    "icon": "asset://Currency/100000000000101.png",
    "code": "gold"
  }
}
```

`Item.json`:

```json
{
  "_table": {
    "struct_def": {
      "name": { "type": "string", "mem": "Display name" },
      "icon": { "type": "img", "mem": "Icon asset" },
      "price": { "type": "id_num", "mem": "Currency id + amount" },
      "tags": { "type": "array", "mem": "Tag refs", "type_agv": { "elem_type": "ref_id" } }
    },
    "card_style": "default"
  },
  "100000000000201": {
    "name": "Iron Sword",
    "icon": "asset://Item/100000000000201.png",
    "price": [100000000000101, 120],
    "tags": []
  }
}
```

## Project TypeConfig For Shared Fields

When a field appears across tables, define it once:

```json
{
  "type_config": {
    "rarity": {
      "name": "Rarity",
      "base_type": "int",
      "type_render": "enum",
      "default": 1,
      "mem": "Rarity tier",
      "type_agv": {
        "options": {
          "1": "Common",
          "2": "Uncommon",
          "3": "Rare",
          "4": "Epic",
          "5": "Legendary"
        }
      }
    },
    "currency": {
      "name": "Currency",
      "base_type": "int",
      "type_render": "ref_id",
      "default": 0,
      "mem": "Currency entity id"
    }
  }
}
```

Then tables use:

```json
{
  "_table": {
    "struct_def": {
      "rarity": { "type": "rarity", "mem": "Rarity" },
      "main_currency": { "type": "currency", "mem": "Main currency" }
    }
  }
}
```

## Custom Struct Type

Use custom structs for repeated value groups.

```json
{
  "type_config": {
    "stat_value": {
      "name": "StatValue",
      "base_type": "struct",
      "type_render": "struct",
      "default": { "attribute": 0, "value": 0 },
      "mem": "Attribute id + numeric value",
      "struct_def": {
        "stat_value": {
          "attribute": "ref_id",
          "value": "float"
        }
      }
    }
  }
}
```

Use it:

```json
{
  "attributes": {
    "type": "array",
    "mem": "Attribute bonuses",
    "type_agv": { "elem_type": "stat_value" }
  }
}
```

Value:

```json
{
  "attributes": [[100000000000301, 15], [100000000000302, 0.12]]
}
```

## Safe Entity Addition

When adding one row:

1. Pick a globally unique id.
2. Add exactly one top-level object under that id.
3. Populate every `struct_def` field.
4. Resolve every reference id.
5. Add assets and write `asset://...` paths.

Example:

```json
"100000000000202": {
  "name": "Mana Potion",
  "icon": "asset://Item/100000000000202.png",
  "price": [100000000000101, 75],
  "tags": [100000000000401, 100000000000402]
}
```

## Refactoring A Field Into TypeConfig

Before:

```json
{
  "_table": {
    "struct_def": {
      "quality": { "type": "enum_int", "mem": "Quality", "type_agv": { "options": { "1": "Low", "2": "High" } } }
    }
  }
}
```

After:

`gamedata.json`:

```json
{
  "type_config": {
    "quality": {
      "name": "Quality",
      "base_type": "int",
      "type_render": "enum",
      "default": 1,
      "mem": "Quality",
      "type_agv": { "options": { "1": "Low", "2": "High" } }
    }
  }
}
```

Table:

```json
{
  "_table": {
    "struct_def": {
      "quality": { "type": "quality", "mem": "Quality" }
    }
  }
}
```

This keeps future tables aligned on one canonical type.
