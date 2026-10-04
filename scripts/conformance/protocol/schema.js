import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
function requireValue(condition, path, reason) { if (!condition) throw new Error(`${path}: ${reason}`); }
export async function loadModels() {
  const directory = new URL('../../../planning/qualification/protocol/schema/', import.meta.url);
  const provenance = JSON.parse(await readFile(new URL('provenance.json', directory), 'utf8')), models = {};
  for (const row of provenance.sources) {
    const bytes = await readFile(new URL(row.protocol + '.json', directory));
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Pinned protocol schema changed: ' + row.protocol);
    models[row.protocol] = JSON.parse(bytes);
  }
  return models;
}
export function lspValidator(model) {
  const references = new Map([...model.structures, ...model.enumerations, ...model.typeAliases].map(row => [row.name, row]));
  function properties(value, rows, path, depth) {
    requireValue(object(value), path, 'expected object');
    for (const property of rows ?? []) {
      if (!(property.name in value) && property.optional) continue;
      requireValue(property.name in value, path + '.' + property.name, 'missing required property');
      check(value[property.name], property.type, path + '.' + property.name, depth + 1);
    }
  }
  function check(value, type, path = '$', depth = 0) {
    requireValue(depth < 100, path, 'type nesting limit');
    switch (type.kind) {
      case 'base': {
        const valid = {string: () => typeof value === 'string', URI: () => typeof value === 'string', DocumentUri: () => typeof value === 'string',
          integer: () => integer(value), uinteger: () => integer(value) && value >= 0, decimal: () => typeof value === 'number' && Number.isFinite(value),
          boolean: () => typeof value === 'boolean', null: () => value === null}[type.name];
        requireValue(valid && valid(), path, 'expected ' + type.name); return;
      }
      case 'reference': {
        const row = references.get(type.name); requireValue(row, path, 'unknown type ' + type.name);
        if (row.values) {
          check(value, row.type, path, depth + 1);
          requireValue(row.supportsCustomValues || row.values.some(item => isDeepStrictEqual(item.value, value)), path, 'invalid enum ' + row.name);
        } else if (row.properties) {
          for (const parent of [...(row.extends ?? []), ...(row.mixins ?? [])]) check(value, parent, path, depth + 1);
          properties(value, row.properties, path, depth);
        } else check(value, row.type, path, depth + 1);
        return;
      }
      case 'array': requireValue(Array.isArray(value), path, 'expected array'); value.forEach((item, i) => check(item, type.element, path + '[' + i + ']', depth + 1)); return;
      case 'map': requireValue(object(value), path, 'expected map'); for (const [key, item] of Object.entries(value)) { check(key, type.key, path, depth + 1); check(item, type.value, path + '.' + key, depth + 1); } return;
      case 'literal': properties(value, type.value.properties, path, depth); return;
      case 'stringLiteral': requireValue(value === type.value, path, 'wrong literal'); return;
      case 'tuple': requireValue(Array.isArray(value) && value.length === type.items.length, path, 'tuple length'); type.items.forEach((item, i) => check(value[i], item, path + '[' + i + ']', depth + 1)); return;
      case 'and': type.items.forEach(item => check(value, item, path, depth + 1)); return;
      case 'or': for (const item of type.items) { try { check(value, item, path, depth + 1); return; } catch {} } throw new Error(path + ': no union alternative matched');
      default: throw new Error('Unsupported LSP metamodel kind: ' + type.kind);
    }
  }
  return {check, request: method => model.requests.find(row => row.method === method), notification: method => model.notifications.find(row => row.method === method)};
}
export function dapValidator(model) {
  function check(value, schema, path = '$', depth = 0) {
    requireValue(depth < 100, path, 'schema nesting limit');
    if (schema.$ref) { requireValue(schema.$ref.startsWith('#/definitions/'), path, 'external schema reference'); const name = schema.$ref.slice(14); requireValue(model.definitions[name], path, 'unknown definition'); return check(value, model.definitions[name], path, depth + 1); }
    if (schema.allOf) schema.allOf.forEach(row => check(value, row, path, depth + 1));
    if (schema.oneOf) { let matches = 0; for (const row of schema.oneOf) try { check(value, row, path, depth + 1); matches++; } catch {} requireValue(matches === 1, path, 'expected one schema alternative'); }
    if (schema.type) {
      const kinds = Array.isArray(schema.type) ? schema.type : [schema.type];
      requireValue(kinds.some(kind => kind === 'object' ? object(value) : kind === 'array' ? Array.isArray(value) : kind === 'null' ? value === null
        : kind === 'integer' ? Number.isSafeInteger(value) : kind === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === kind), path, 'wrong type');
    }
    if (schema.enum) requireValue(schema.enum.some(item => isDeepStrictEqual(item, value)), path, 'invalid enum');
    if (schema.format === 'int32') requireValue(integer(value), path, 'outside int32');
    if (schema.minimum !== undefined) requireValue(value >= schema.minimum, path, 'below minimum');
    if (schema.maximum !== undefined) requireValue(value <= schema.maximum, path, 'above maximum');
    if (Array.isArray(value) && schema.items) value.forEach((item, i) => check(item, schema.items, path + '[' + i + ']', depth + 1));
    if (object(value)) {
      for (const key of schema.required ?? []) requireValue(key in value, path + '.' + key, 'missing required property');
      for (const [key, item] of Object.entries(value)) {
        if (schema.properties?.[key]) check(item, schema.properties[key], path + '.' + key, depth + 1);
        else if (schema.additionalProperties === false) throw new Error(path + ': additional property ' + key);
        else if (object(schema.additionalProperties)) check(item, schema.additionalProperties, path + '.' + key, depth + 1);
      }
    }
  }
  const named = (value, name) => { requireValue(model.definitions[name], '$', 'unknown DAP definition ' + name); check(value, model.definitions[name]); };
  const name = (method, suffix) => method[0].toUpperCase() + method.slice(1) + suffix;
  return {check: named, definition: (method, suffix) => model.definitions[name(method, suffix)] ? name(method, suffix) : null};
}
