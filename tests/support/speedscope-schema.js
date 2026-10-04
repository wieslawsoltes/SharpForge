import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../fixtures/speedscope/file-format-schema.json', import.meta.url), 'utf8'));
const schemaKeys = new Set(['$ref', '$schema', 'definitions', 'title', 'type', 'properties', 'required', 'items', 'anyOf', 'const', 'enum']);

// The official pinned schema uses only these assertions. Fail closed if it grows.
export function matchesSpeedscopeSchema(value, rule = schema) {
  for (const key of Object.keys(rule)) assert(schemaKeys.has(key), `Unsupported schema keyword ${key}`);
  if (rule.$ref) {
    assert(rule.$ref.startsWith('#/definitions/'));
    matchesSpeedscopeSchema(value, schema.definitions[rule.$ref.slice('#/definitions/'.length)]);
  }
  if (rule.anyOf) {
    assert(rule.anyOf.some(candidate => {
      try { matchesSpeedscopeSchema(value, candidate); return true; } catch { return false; }
    }), 'No schema alternative matched');
  }
  if (Object.hasOwn(rule, 'const')) assert.equal(value, rule.const);
  if (rule.enum) assert(rule.enum.includes(value));
  if (rule.type) {
    assert.equal(Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, rule.type);
    if (rule.type === 'number') assert(Number.isFinite(value));
  }
  for (const key of rule.required ?? []) assert(Object.hasOwn(value, key), `Missing ${key}`);
  for (const [key, child] of Object.entries(rule.properties ?? {})) {
    if (Object.hasOwn(value, key)) matchesSpeedscopeSchema(value[key], child);
  }
  if (rule.items) for (const item of value) matchesSpeedscopeSchema(item, rule.items);
}
