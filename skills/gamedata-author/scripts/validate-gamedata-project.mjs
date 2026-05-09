#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const builtin = new Set([
  'int','float','string','struct','array','var',
  'bool','percent','color','date','img','snd',
  'id','ref_id','enum_int','enum_string',
  'range_int','range_float',
  'id_num','id_string','string_num','img_num','snd_num','img_string','snd_string',
]);

const errors = [];
const warnings = [];
const tables = new Map();
const ids = new Map();
const refs = [];
const assets = [];

const builtinConfig = {
  int: { base_type: 'int', type_render: 'input_int' },
  float: { base_type: 'float', type_render: 'input_float' },
  string: { base_type: 'string', type_render: 'input_string' },
  struct: { base_type: 'struct', type_render: 'struct' },
  array: { base_type: 'array', type_render: 'array' },
  var: { base_type: 'var', type_render: 'json' },
  bool: { base_type: 'int', type_render: 'toggle' },
  percent: { base_type: 'float', type_render: 'input_float' },
  color: { base_type: 'int', type_render: 'color' },
  date: { base_type: 'string', type_render: 'date' },
  img: { base_type: 'string', type_render: 'img' },
  snd: { base_type: 'string', type_render: 'snd' },
  id: { base_type: 'int', type_render: 'id' },
  ref_id: { base_type: 'int', type_render: 'ref_id' },
  enum_int: { base_type: 'int', type_render: 'enum' },
  enum_string: { base_type: 'string', type_render: 'enum' },
  range_int: { base_type: 'int', type_render: 'range' },
  range_float: { base_type: 'float', type_render: 'range' },
  id_num: { base_type: 'struct', type_render: 'struct', struct_def: { id_num: { id: 'ref_id', num: 'int' } } },
  id_string: { base_type: 'struct', type_render: 'struct', struct_def: { id_string: { id: 'ref_id', str: 'string' } } },
  string_num: { base_type: 'struct', type_render: 'struct', struct_def: { string_num: { str: 'string', num: 'int' } } },
  img_num: { base_type: 'struct', type_render: 'struct', struct_def: { img_num: { img: 'img', num: 'int' } } },
  snd_num: { base_type: 'struct', type_render: 'struct', struct_def: { snd_num: { snd: 'snd', num: 'int' } } },
  img_string: { base_type: 'struct', type_render: 'struct', struct_def: { img_string: { img: 'img', str: 'string' } } },
  snd_string: { base_type: 'struct', type_render: 'struct', struct_def: { snd_string: { snd: 'snd', str: 'string' } } },
};

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    fail(`${rel(abs)}: invalid JSON: ${err.message}`);
    return null;
  }
}

function rel(abs) {
  return path.relative(root, abs).replace(/\\/g, '/');
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(abs, out);
    else out.push(abs);
  }
  return out;
}

const metaPath = path.join(root, 'gamedata.json');
const meta = fs.existsSync(metaPath) ? (readJson(metaPath) || {}) : {};
const projectTC = meta.type_config || {};
const knownTypes = new Set([...builtin, ...Object.keys(projectTC)]);

for (const abs of walk(root).filter((p) => p.toLowerCase().endsWith('.json'))) {
  if (rel(abs) === 'gamedata.json') continue;
  if (rel(abs).startsWith('asset/')) continue;
  const raw = readJson(abs);
  if (!raw) continue;
  if (!raw._table || typeof raw._table !== 'object') {
    fail(`${rel(abs)}: JSON outside asset/ must be a table with top-level _table`);
    continue;
  }
  const tablePath = rel(abs).replace(/\.json$/i, '');
  const table = raw._table || {};
  const struct = table.struct_def || {};
  if (!table.struct_def || typeof table.struct_def !== 'object' || Array.isArray(table.struct_def)) {
    fail(`${rel(abs)}: _table.struct_def must be an object`);
  }
  tables.set(tablePath, { abs, raw, struct });

  for (const [field, def] of Object.entries(struct)) {
    const type = typeof def === 'string' ? def : def && def.type;
    if (!type) fail(`${rel(abs)}: struct_def.${field} missing type`);
    else if (!knownTypes.has(type)) fail(`${rel(abs)}: struct_def.${field} uses unknown type "${type}"`);
    if (!projectTC[field] && !builtin.has(field)) {
      warn(`${rel(abs)}: field "${field}" has no matching project type_config entry`);
    }
  }

  for (const [id, entity] of Object.entries(raw)) {
    if (id === '_table') continue;
    if (ids.has(id)) fail(`${rel(abs)}: duplicate id "${id}" also in ${ids.get(id)}`);
    ids.set(id, rel(abs));
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      fail(`${rel(abs)}: entity "${id}" is not an object`);
      continue;
    }
    for (const field of Object.keys(entity)) {
      if (!Object.prototype.hasOwnProperty.call(struct, field)) {
        warn(`${rel(abs)}: entity "${id}" has field "${field}" not in struct_def`);
        collectLooseAssets(entity[field], `${rel(abs)}:${id}.${field}`);
        continue;
      }
      inspectValue(entity[field], struct[field], `${rel(abs)}:${id}.${field}`);
    }
  }
}

for (const [typeName, cfg] of Object.entries(projectTC)) {
  if (!cfg || typeof cfg !== 'object') {
    fail(`gamedata.json: type_config.${typeName} is not an object`);
    continue;
  }
  if (!cfg.base_type) fail(`gamedata.json: type_config.${typeName} missing base_type`);
  if (!cfg.type_render) fail(`gamedata.json: type_config.${typeName} missing type_render`);
  if (cfg.base_type && !builtin.has(cfg.base_type)) {
    fail(`gamedata.json: type_config.${typeName} base_type "${cfg.base_type}" is not builtin`);
  }
}

for (const ref of refs) {
  if (ref.value === 0 || ref.value === '0' || ref.value == null || ref.value === '') continue;
  if (!ids.has(String(ref.value))) warn(`${ref.where}: reference id "${ref.value}" does not resolve`);
}

for (const asset of assets) {
  const tail = asset.value.slice('asset://'.length);
  if (path.isAbsolute(tail) || tail.includes('..') || tail.includes('\\')) {
    fail(`${asset.where}: invalid asset URL "${asset.value}"`);
    continue;
  }
  const disk = path.join(root, 'asset', ...tail.split('/'));
  if (!fs.existsSync(disk)) warn(`${asset.where}: missing asset file ${rel(disk)}`);
}

for (const [tablePath, table] of tables) {
  const cardStyle = (table.raw._table && table.raw._table.card_style) || 'default';
  if (meta.card_styles && Object.keys(meta.card_styles).length && !meta.card_styles[cardStyle]) {
    warn(`${rel(table.abs)}: card_style "${cardStyle}" is not in gamedata.json.card_styles`);
  }
}

function inspectValue(value, fieldDef, where) {
  const resolved = resolveFieldDef(fieldDef);
  if (!resolved) return;
  const base = resolved.base_type || 'string';
  const render = resolved.type_render || '';
  const agv = resolved.type_agv || {};

  if (render === 'img' || fieldTypeName(fieldDef) === 'img') {
    if (typeof value === 'string' && value.startsWith('asset://')) assets.push({ value, where });
  }
  if (render === 'snd' || fieldTypeName(fieldDef) === 'snd') {
    if (typeof value === 'string' && value.startsWith('asset://')) assets.push({ value, where });
  }
  if (render === 'ref_id' || fieldTypeName(fieldDef) === 'ref_id') {
    refs.push({ value, where });
  }
  if (render === 'enum' && agv.options && value !== undefined && value !== null) {
    const keys = Array.isArray(agv.options) ? agv.options.map((o) => String(o.value)) : Object.keys(agv.options);
    if (!keys.includes(String(value))) warn(`${where}: enum value "${value}" is not in options`);
  }
  if (render === 'range' && typeof value === 'number') {
    if (agv.min != null && value < agv.min) warn(`${where}: value ${value} < min ${agv.min}`);
    if (agv.max != null && value > agv.max) warn(`${where}: value ${value} > max ${agv.max}`);
  }
  if (base === 'array') {
    if (!Array.isArray(value)) {
      warn(`${where}: expected array`);
      return;
    }
    const elemType = agv.elem_type;
    if (elemType) {
      value.forEach((item, i) => inspectValue(item, { type: elemType }, `${where}[${i}]`));
    } else {
      value.forEach((item, i) => collectLooseAssets(item, `${where}[${i}]`));
    }
    return;
  }
  if (base === 'struct') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      warn(`${where}: expected object`);
      return;
    }
    const fields = normalizeStructDef(resolved.struct_def);
    Object.keys(fields).forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(value, field)) {
        inspectValue(value[field], fields[field], `${where}.${field}`);
      }
    });
    return;
  }
  collectLooseAssets(value, where);
}

function collectLooseAssets(value, where) {
  if (typeof value === 'string') {
    if (value.startsWith('asset://')) assets.push({ value, where });
    return;
  }
  if (typeof value === 'number') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectLooseAssets(v, `${where}[${i}]`));
  }
  if (value && typeof value === 'object') {
    Object.keys(value).forEach((k) => collectLooseAssets(value[k], `${where}.${k}`));
  }
}

function normalizeStructDef(def) {
  if (!def || typeof def !== 'object') return {};
  const keys = Object.keys(def);
  if (keys.length === 1 && def[keys[0]] && typeof def[keys[0]] === 'object') return def[keys[0]];
  return def;
}

function resolveFieldDef(fieldDef) {
  const typeName = fieldTypeName(fieldDef);
  if (!typeName) return null;
  const base = projectTC[typeName] || builtinConfig[typeName];
  if (!base) return null;
  if (typeof fieldDef === 'string') return base;
  return { ...base, ...(fieldDef || {}) };
}

function fieldTypeName(def) {
  if (typeof def === 'string') return def;
  return def && def.type;
}

for (const w of warnings) console.warn(`WARN ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`Checked ${tables.size} tables, ${ids.size} ids, ${assets.length} asset refs, ${refs.length} probable refs.`);
if (errors.length) process.exit(1);
