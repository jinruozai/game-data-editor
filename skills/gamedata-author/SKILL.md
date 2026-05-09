---
name: gamedata-author
description: Use when designing, generating, editing, validating, or refactoring GameDataEditor JSON tables, TypeConfig entries, entity ids, ref_id links, asset references, or card style bindings for AI-authored game data projects.
metadata:
  short-description: Author GameDataEditor game data safely
---

# GameDataEditor Data Author

Use this skill whenever the task touches a GameDataEditor project: `gamedata.json`, table JSON files, `type_config`, `_table.struct_def`, entity ids, `ref_id` references, `asset://` resources, or card style bindings.

## First Read

Before editing data, inspect:

1. `gamedata.json` for project `type_config` and `card_styles`.
2. The target table file(s) for `_table.struct_def`.
3. Any referenced tables whose ids are used by `ref_id`, `id_num`, or arrays of refs.
4. Existing `asset/` paths before changing image or sound fields.

Load `references/data-contract.md` for the full schema and invariants. Load `references/examples.md` when creating new table families, id catalogs, custom types, or ref-heavy data.

## Core Rules

- The only special project directory is `asset/`; all other JSON files are data candidates.
- Any `.json` outside `gamedata.json` and `asset/` is a table file and must contain `_table`.
- Every entity lives at a top-level id key beside `_table`.
- Entity ids are strings in JSON object keys and should be globally unique across the whole project.
- Prefer 15-digit decimal ids that are safe in JavaScript number/string conversions.
- Entity fields must come from that table's `_table.struct_def`.
- Every `struct_def[field].type` must resolve to a builtin type, a project `type_config` entry, or a known compound type.
- When adding a domain field such as `currency`, `tag`, `rarity`, `attribute`, or `damage_type`, add or reuse a project `type_config` entry with the same field/type name so future tables converge on one dictionary.
- Use `ref_id` for links to other entities; use `id_num` for `{ "id": refId, "num": quantity }`; use arrays for lists.
- Do not duplicate referenced entity data inside another entity. Store the target id and resolve by id.
- Use `asset://relative/path.ext` for project assets. The disk file must live under `asset/relative/path.ext`.
- Project-specific editor behavior belongs in a separate editor extension project, not inside the data directory.
- Never write absolute paths, `..`, comments, trailing commas, `NaN`, or `Infinity`.

## Editing Workflow

1. Map the domain concept to tables first: catalogs such as attributes, currencies, factions, tags, skills, items, recipes, characters, levels.
2. Decide ids and references. Shared concepts get their own row and are referenced by id.
3. Reuse existing `type_config` entries. If a field name appears in `struct_def` but not in `type_config`, create a matching `type_config` entry unless it is only a truly local temporary field.
4. Add or update `_table.struct_def` before writing entity values.
5. Fill every entity with values matching the resolved base type and renderer constraints.
6. Add required assets under `asset/` and write matching `asset://` URLs.
7. Run the validation script if available:

```bash
node temp/GameDataEditor/skills/gamedata-author/scripts/validate-gamedata-project.mjs <project-root>
```

## Output Discipline

When asked to modify data:

- Return the files changed and the semantic change, not a long restatement of the rules.
- Mention any unresolved reference, missing asset, or schema ambiguity.
- If adding data from imagination, use stable names and ids, but keep values internally consistent.
- If asked to generate images or sounds, create/copy the asset file and update the JSON reference in the same change.
