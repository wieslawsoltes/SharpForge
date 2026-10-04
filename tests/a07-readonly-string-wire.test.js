import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, verifyImage, serializeImage, deserializeImage} from '@sharpforge/bytecode';
import {createRegistry} from '@sharpforge/framework';
import {emitAssembly, loadAssembly} from '@sharpforge/cil';
import {VirtualMachine} from '@sharpforge/runtime';
import {sourceConstant, sourceInitialValue} from '../packages/runtime/src/execution/source-numbers.js';
import {fieldMarker} from './fixtures/a07/boolean-string-fields.js';

function imageWith(value, statics = []) {
  return {formatVersion: FORMAT_VERSION, name: 'ReadonlyStringImage', entryPoint: 0, sources: [], sequencePoints: [],
    constants: [value], types: [], statics, methods: [{id: 0, name: 'Main', qualifiedName: 'Program.Main', owner: null,
      parameters: [], isStatic: true, returnType: 'string', locals: [], handlers: [],
      code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])}]};
}

function rejectMarker(value) {
  const image = imageWith(value);
  assert(verifyImage(image).some(error => error.includes('Invalid scalar constant')));
  assert.throws(() => new VirtualMachine(image), /Invalid scalar constant/);
  assert.throws(() => emitAssembly(image), /Invalid scalar constant/);
}

test('Readonly string marker: JSON roundtrip retains a closed identity and genuine canonical field loads', () => {
  const image = imageWith(fieldMarker('TrueString'));
  assert.deepEqual(verifyImage(image), []);
  const decoded = deserializeImage(serializeImage(image));
  assert.deepEqual(decoded.constants, [fieldMarker('TrueString')]);
  const assembly = emitAssembly(decoded);
  const loaded = loadAssembly(assembly);
  assert.deepEqual(loaded.constants, decoded.constants);
  for (const candidate of [image, decoded, loaded]) {
    const vm = new VirtualMachine(candidate, {weakStringInterning: true});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(vm.value(vm.returnValue), 'True');
    } finally { vm.stop(); }
  }
});

test('Readonly string marker: malformed, missing, aliased and non-string identities are rejected before execution', () => {
  for (const value of [null, false, 0, '', [], {}, {owner: 'System.Boolean'}, {name: 'TrueString'},
    {owner: 'Boolean', name: 'TrueString'}, {owner: 'System.Boolean', name: 'Missing'},
    {owner: 'System.Diagnostics.Stopwatch', name: 'Frequency'}, {owner: 'System.Boolean', name: 'TrueString', extra: true},
    {owner: 'X'.repeat(1025), name: 'TrueString'}, {owner: 'System.Boolean', name: 'X'.repeat(513)}]) {
    rejectMarker({readonlyField: value});
  }
  rejectMarker({...fieldMarker('TrueString'), extra: true});
  rejectMarker({...fieldMarker('TrueString'), scalar: 'long', value: '1'});
  rejectMarker({...fieldMarker('TrueString'), [Symbol('host')]: true});
  rejectMarker(Object.create(fieldMarker('TrueString')));
  rejectMarker(Object.assign(() => {}, fieldMarker('TrueString')));
  rejectMarker(Object.defineProperty({}, 'readonlyField', {value: fieldMarker('TrueString').readonlyField}));
  const name = Object.defineProperty({owner: 'System.Boolean'}, 'name', {value: 'TrueString'});
  rejectMarker({readonlyField: name});
});

test('Readonly string marker: field-tag and identity accessors are rejected without invoking host code', () => {
  let calls = 0;
  const accessor = {enumerable: true, get() { calls++; return 'TrueString'; }};
  rejectMarker(Object.defineProperty({}, 'readonlyField', accessor));
  for (const key of ['owner', 'name']) {
    const marker = fieldMarker('TrueString');
    Object.defineProperty(marker.readonlyField, key, accessor);
    rejectMarker(marker);
  }
  assert.equal(calls, 0);
});

test('Readonly string marker: static-default placement is rejected by construction and source-profile emission', () => {
  const slot = {name: 'Program.Value', type: 'string', value: fieldMarker('TrueString')};
  const image = imageWith(null, [slot]);
  // Shape validation is shared with constants; placement is deliberately enforced at the two construction boundaries.
  assert.deepEqual(verifyImage(image), []);
  assert.throws(() => sourceInitialValue({}, slot), /Readonly field loads cannot be static default values/);
  assert.throws(() => new VirtualMachine(image), /Readonly field loads cannot be static default values/);
  assert.throws(() => emitAssembly(image), /Readonly field loads cannot be static default values/);
});

test('Readonly string marker: unsupported legacy emission fails before producing a mismatched framework identity', () => {
  assert.throws(() => emitAssembly(imageWith(fieldMarker('TrueString')), {framework: 'mscorlib4'}),
    /Readonly string field loads require the System.Runtime source emission profile/);
});

test('Readonly string marker: direct source adapters never return malformed tag payloads as guest values', () => {
  for (const value of [null, false, 0, '', {}, {owner: 'System.Boolean', name: 'Missing'}]) {
    const vm = {image: {constants: [{readonlyField: value}]}, constantValues: new Map()};
    assert.throws(() => sourceConstant(vm, 0), {name: 'InvalidProgramException'});
    assert.equal(vm.constantValues.size, 0);
  }
});

function registryWithString() {
  const registry = createRegistry({reservations: [{name: 'fixture', start: 100, size: 4}]});
  registry.define('Fixture.StringFields', {fields: {Text: {type: 'string', isStatic: true, readOnly: true, value: 'stable'}}});
  return registry;
}

test('Readonly string descriptors: the exact one-million-code-unit bound accepts UTF-16 and rejects oversized or host values', () => {
  const registry = registryWithString();
  registry.define('Fixture.MaximumString', {fields: {Text: {
    type: 'string', isStatic: true, readOnly: true, value: '\ud800'.repeat(1_000_000)
  }}});
  assert.equal(registry.frameworkType('Fixture.MaximumString').fields.Text.value.length, 1_000_000);
  for (const value of [null, undefined, true, 1, {}, new String('True'), {scalar: 'string', value: 'True'}, 'a'.repeat(1_000_001)]) {
    const before = JSON.stringify([...registry.types.values()]);
    assert.throws(() => registry.register({name: 'fixture', register(target) {
      target.frameworkType('Fixture.StringFields').fields = {Text: {type: 'string', isStatic: true, readOnly: true, value}};
      target.define('Fixture.Temporary');
    }}), /string of at most 1000000 UTF-16 code units/);
    assert.equal(JSON.stringify([...registry.types.values()]), before);
    assert.equal(registry.frameworkType('Fixture.Temporary'), null);
  }
  registry.register({name: 'fixture', register(target) {
    target.frameworkType('Fixture.StringFields').fields = {Text: {type: 'string', isStatic: true, readOnly: true, value: 'retry'}};
  }});
  assert.equal(registry.frameworkType('Fixture.StringFields').fields.Text.value, 'retry');
});

test('Readonly string descriptors: replacement accessors roll back without reading the proposed value', () => {
  const registry = registryWithString();
  const before = JSON.stringify([...registry.types.values()]);
  let reads = 0;
  const descriptor = {type: 'string', isStatic: true, readOnly: true};
  Object.defineProperty(descriptor, 'value', {enumerable: true, get() { reads++; return 'unstable'; }});
  assert.throws(() => registry.register({name: 'fixture', register(target) {
    target.frameworkType('Fixture.StringFields').fields = {Text: descriptor};
  }}), /readonly field/);
  assert.equal(reads, 0);
  assert.equal(JSON.stringify([...registry.types.values()]), before);
});
