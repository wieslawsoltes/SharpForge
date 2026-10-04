import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSchema} from '../scripts/conformance/oracle/store.js';
import {validateCompiledBindingDescriptor} from '@sharpforge/winui-properties';

const schema = JSON.parse(await readFile(new URL('../packages/winui-properties/src/binding/compiled/descriptor.schema.json', import.meta.url)));

// Resolve only branches touched by input; the repository's existing schema engine performs all assertions.
function materialize(rule, value) {
  if (rule.$ref) return materialize(schema.$defs[rule.$ref.split('/').at(-1)], value);
  const result = {};
  for (const [key, item] of Object.entries(rule)) {
    if (key === '$defs') continue;
    if (key === 'maxLength') result.pattern = `^[\\s\\S]{0,${item}}$`;
    else if (key === 'properties') {
      result.properties = Object.fromEntries(Object.entries(item).map(([name, definition]) => [name,
        value && Object.hasOwn(value, name) ? materialize(definition, value[name]) : {}
      ]));
    } else if (key === 'items') {
      result.items = {};
      if (Array.isArray(value)) for (const child of value) validateSchema(child, materialize(item, child));
    } else if (key === 'oneOf' || key === 'anyOf') result[key] = item.map(definition => materialize(definition, value));
    else result[key] = item;
  }
  return result;
}

test('A15 compiler descriptor JSON schema and runtime validator accept the same token fixture', () => {
  const fixture = {version: 1, kind: 'property', target: {id: 'caption', token: 0x17000001}, expression: {
    kind: 'path', steps: [{token: 0x17000002}, {token: 0x17000003, nullConditional: true}]
  }};
  assert.equal(validateSchema(fixture, materialize(schema, fixture)), true);
  assert.equal(validateCompiledBindingDescriptor(fixture).target.token, 0x17000001);
  for (const invalid of [{...fixture, version: 2}, {...fixture, target: {id: 'caption', token: 0}}]) {
    assert.throws(() => validateSchema(invalid, materialize(schema, invalid)));
    assert.throws(() => validateCompiledBindingDescriptor(invalid));
  }
});
