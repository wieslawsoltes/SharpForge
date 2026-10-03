import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {Writer, codedIndex} from '@sharpforge/cil';
import {controlFixture} from './support/control-fixture.js';
import {createValue, copyValue, replaceValueField, boxValue, unboxValue} from '../packages/runtime/src/execution/value-types.js';
import {address, dereference} from '../packages/runtime/src/execution/managed-pointers.js';
import {reinterpretPointer, pointerOffset, readMemory, writeMemory} from '../packages/runtime/src/execution/raw-memory.js';

const field = (name, type) => ({name, type, flags: 6});
const valueField = (name, row) => ({name, flags: 6, signature: Uint8Array.from([6, 0x11, row << 2])});
const explicit = (name, fields, offsets, size) => ({name, fields, offsets, size,
  base: 'System.ValueType', flags: 0x100111, methods: []});

function fixture(extra = [], body = writer => writer.op('ret')) {
  const types = [
    explicit('Union', [field('Bits', 'int'), field('Real', 'float'), field('Byte', 'byte')], [0, 0, 1], 12),
    {name: 'Pair', flags: 0x100109, base: 'System.ValueType',
      fields: [field('Low', 'short'), field('High', 'short')], methods: []},
    explicit('Nested', [valueField('Pair', 3), field('Bits', 'int')], [0, 0], 4),
    explicit('References', [field('First', 'object'), field('Second', 'object'), field('Tag', 'int')], [0, 0, 8], 16),
    {name: 'InnerReference', flags: 0x100109, base: 'System.ValueType',
      fields: [field('Text', 'object'), field('Number', 'int')], methods: []},
    explicit('NestedReference', [valueField('Inner', 6), field('Alias', 'object')], [0, 0], 16),
    ...extra
  ];
  const localTypes = ['Union', 'Union', 'References', 'NestedReference'];
  return controlFixture([...types, {name: 'Program', methods: [{
    name: 'Main', localBytes(context) {
      const writer = new Writer().u8(7).u8(5);
      for (const name of localTypes) writer.u8(0x11).compressed(codedIndex('TypeDefOrRef', context.resolve(name)));
      return writer.u8(0x1c).finish();
    }, body
  }]}], {decorate(context) {
    for (const type of types.filter(type => type.offsets)) {
      context.md.add(15, [0, type.size, context.types.get(type.name) & 0xffffff]);
      type.fields.forEach((field, index) => context.md.add(16, [type.offsets[index],
        context.fields.get(type.name + '.' + field.name) & 0xffffff]));
    }
  }});
}

const local = (vm, index, type) => address(vm, 'local', index, null, {type});
const member = (vm, owner, index) => address(vm, 'field', index, owner);

for (const nativeIntBits of [32, 64]) test(`explicit scalar, nested and reference aliases use ABI${nativeIntBits}`, () => {
  const vm = new CilVirtualMachine(fixture(), {nativeIntBits});
  const union = local(vm, 0, 'Union');
  dereference(vm, member(vm, union, 0), true, 0x3f800000);
  assert.equal(dereference(vm, member(vm, union, 1)).value, 1);
  const copy = copyValue(vm, dereference(vm, union));
  dereference(vm, member(vm, union, 2), true, 0x80);
  assert.equal(dereference(vm, member(vm, union, 0)), 0x3f808000);
  assert.equal(copy.fields[0], 0x3f800000);
  const nested = replaceValueField(vm, createValue(vm, 'Nested'), 1, 0x12345678);
  assert.deepEqual(nested.fields[0].fields, [0x5678, 0x1234]);
  const changed = replaceValueField(vm, nested.fields[0], 0, 5);
  assert.equal(replaceValueField(vm, nested, 0, changed).fields[1], 0x12340005);
  const reference = vm.heap.string('shared');
  const refs = local(vm, 2, 'References');
  dereference(vm, member(vm, refs, 0), true, reference);
  assert.equal(dereference(vm, member(vm, refs, 1)), reference);
  const nestedRefs = local(vm, 3, 'NestedReference');
  dereference(vm, member(vm, nestedRefs, 1), true, reference);
  assert.equal(dereference(vm, member(vm, member(vm, nestedRefs, 0), 0)), reference);
  vm.heap.collect();
  assert.equal(vm.heap.get(reference).data, 'shared');
  dereference(vm, member(vm, refs, 1), true, null);
  assert.equal(dereference(vm, member(vm, refs, 0)), null);
  dereference(vm, member(vm, member(vm, nestedRefs, 0), 0), true, null);
  vm.heap.collect();
  assert.throws(() => vm.heap.get(reference), {name: 'InvalidReferenceException'});
});

test('explicit array and boxed interior stores preserve copy boundaries and heap COW', () => {
  const vm = new CilVirtualMachine(fixture());
  const original = replaceValueField(vm, createValue(vm, 'Union'), 0, 0x3f800000);
  const array = vm.heap.array('Union', 2);
  vm.heap.writeData(array, 0, original);
  vm.heap.writeData(array, 1, copyValue(vm, original));
  vm.top.locals[4] = array;
  const pointer = member(vm, address(vm, 'array', 0, array), 2);
  const captured = vm.heap.snapshot();
  dereference(vm, pointer, true, 0x80);
  assert.equal(vm.heap.get(array).data[0].fields[0], 0x3f808000);
  assert.equal(vm.heap.get(array).data[1].fields[1].value, 1);
  assert.equal(captured.records[array.h].data[0].fields[0], 0x3f800000);
  const box = boxValue(vm, original, 'Union');
  vm.top.locals[4] = box;
  dereference(vm, member(vm, address(vm, 'box', 0, box), 0), true, 0x40000000);
  assert.equal(unboxValue(vm, box, 'Union').fields[1].value, 2);
  assert.equal(original.fields[1].value, 1);
});

for (const nativeIntBits of [32, 64]) test(`wide scalar aliases retain ABI${nativeIntBits} native storage width`, () => {
  const wide = explicit('Wide', [field('Bits', 'long'), field('Real', 'double'), field('Native', 'nint')], [0, 0, 0], 8);
  const vm = new CilVirtualMachine(fixture([wide]), {nativeIntBits});
  const value = replaceValueField(vm, createValue(vm, 'Wide'), 0, 0x3ff0000000000000n);
  assert.equal(value.fields[1].value, 1);
  const changed = replaceValueField(vm, value, 2, 2);
  assert.equal(changed.fields[0], nativeIntBits === 64 ? 2n : 0x3ff0000000000002n);
  assert.equal(copyValue(vm, value).fields[0], 0x3ff0000000000000n);
});

test('raw reinterpretation, copies and boxes retain NaN payloads and otherwise hidden padding', () => {
  const vm = new CilVirtualMachine(fixture());
  const union = local(vm, 0, 'Union');
  const pointer = reinterpretPointer(vm, union, 'Union', 'int');
  writeMemory(vm, pointer, 0x7fc12345);
  writeMemory(vm, pointerOffset(vm, pointer, 4), 0x12345678);
  assert(Number.isNaN(dereference(vm, union).fields[1].value));
  const copied = copyValue(vm, dereference(vm, union));
  assert.equal(Object.isFrozen(copied.explicitBytes), true);
  assert.deepEqual(copied.explicitBytes.slice(0, 8), [0x45, 0x23, 0xc1, 0x7f, 0x78, 0x56, 0x34, 0x12]);
  const boxed = boxValue(vm, copied, 'Union');
  const boxedPointer = reinterpretPointer(vm, address(vm, 'box', 0, boxed), 'Union', 'int');
  assert.equal(readMemory(vm, boxedPointer), 0x7fc12345);
  assert.equal(readMemory(vm, pointerOffset(vm, boxedPointer, 4)), 0x12345678);
  assert.throws(() => reinterpretPointer(vm, local(vm, 2, 'References'), 'References', 'int'), {name: 'NotSupportedException'});
});

test('actual stfld/ldfld, ldflda, cpobj and initobj use one explicit storage value', () => {
  const assembly = fixture([], (writer, context) => {
    const union = context.resolve('Union');
    const bits = context.fields.get('Union.Bits');
    const byte = context.fields.get('Union.Byte');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldloca.s', 0).op('ldc.i4', 0x3f800000).op('stfld', bits);
    writer.op('ldloca.s', 1).op('ldloca.s', 0).op('cpobj', union);
    writer.op('ldloca.s', 0).op('ldflda', byte).op('ldc.i4', 0x80).op('stind.i1');
    writer.op('ldloc.0').op('ldfld', bits).op('call', print);
    writer.op('ldloc.1').op('ldfld', bits).op('call', print);
    writer.op('ldloca.s', 0).op('initobj', union).op('ldloc.0').op('ldfld', bits).op('call', print).op('ret');
  });
  const result = new CilVirtualMachine(assembly).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, '1065385984\n1065353216\n0\n');
});

for (const json of [false, true]) test(`explicit bytes and GC reference aliases survive ${json ? 'JSON' : 'structured'} replay`, async () => {
  const assembly = fixture();
  const vm = new CilVirtualMachine(assembly);
  vm.top.locals[0] = replaceValueField(vm, vm.top.locals[0], 0, 0x7fc12345);
  const reference = vm.heap.string('snapshot');
  vm.top.locals[2] = replaceValueField(vm, vm.top.locals[2], 0, reference);
  const snapshot = vm.snapshot();
  const wire = await serializeSnapshot(vm, snapshot, {json});
  vm.top.locals[0] = createValue(vm, 'Union');
  vm.restore(snapshot);
  assert.equal(vm.top.locals[0].fields[0], 0x7fc12345);
  const fresh = new CilVirtualMachine(assembly);
  await restoreSerializedSnapshot(fresh, json ? wire : structuredClone(wire));
  assert.equal(fresh.top.locals[0].fields[0], 0x7fc12345);
  assert.equal(fresh.top.locals[2].fields[0], fresh.top.locals[2].fields[1]);
  fresh.heap.collect();
  assert.equal(fresh.heap.get(fresh.top.locals[2].fields[0]).data, 'snapshot');
  dereference(fresh, member(fresh, local(fresh, 0, 'Union'), 0), true, 0x40000000);
  assert.equal(fresh.top.locals[0].fields[1].value, 2);
  assert.equal(snapshot.frames[0].locals[0].fields[0], 0x7fc12345);
});

test('snapshot preflight rejects malformed bytes or stale field views before changing live state', () => {
  const vm = new CilVirtualMachine(fixture());
  vm.top.locals[0] = replaceValueField(vm, vm.top.locals[0], 0, 0x3f800000);
  const snapshot = vm.snapshot();
  const value = snapshot.frames[0].locals[0];
  const malformed = [
    {...value, explicitBytes: [0]},
    {...value, explicitBytes: Object.freeze(value.explicitBytes.map((byte, index) => index === 0 ? 256 : byte))},
    {...value, explicitBytes: Object.freeze(value.explicitBytes.map((byte, index) => index === 0 ? 1 : byte))},
    {valueType: value.valueType, fields: value.fields}
  ];
  for (const item of malformed) {
    const frames = snapshot.frames.map((frame, index) => index ? frame : {...frame,
      locals: [Object.freeze(item), ...frame.locals.slice(1)]});
    const live = vm.top.locals[0];
    assert.throws(() => vm.restore({...snapshot, frames}), /explicit/);
    assert.equal(vm.top.locals[0], live);
  }
});

test('snapshot preflight rejects conflicting managed aliases', () => {
  const vm = new CilVirtualMachine(fixture());
  const reference = vm.heap.string('alias');
  vm.top.locals[2] = replaceValueField(vm, vm.top.locals[2], 0, reference);
  const snapshot = vm.snapshot();
  const value = snapshot.frames[0].locals[2];
  const invalid = Object.freeze({...value, fields: Object.freeze([reference, null, 0])});
  const locals = [...snapshot.frames[0].locals];
  locals[2] = invalid;
  assert.throws(() => vm.restore({...snapshot, frames: [{...snapshot.frames[0], locals}]}), /reference aliases/);
  assert.equal(vm.top.locals[2], value);
});

for (const [name, fields, offsets] of [
  ['Mixed', [field('Reference', 'object'), field('Bits', 'int')], [0, 0]],
  ['Unaligned', [field('Reference', 'object')], [1]],
  ['PartialReferences', [field('First', 'object'), field('Second', 'object')], [0, 4]]
]) test(`invalid ${name} explicit layout raises TypeLoadException before storing a value`, () => {
  const vm = new CilVirtualMachine(fixture([explicit(name, fields, offsets, 16)]), {nativeIntBits: 64});
  assert.throws(() => createValue(vm, name), {name: 'TypeLoadException'});
});

test('opaque CLR layouts stay explicitly unsupported and per-value allocation is bounded', () => {
  const vm = new CilVirtualMachine(fixture([explicit('DecimalUnion', [field('Value', 'System.Decimal')], [0], 16)]));
  assert.throws(() => createValue(vm, 'DecimalUnion'), {name: 'NotSupportedException'});
  assert.throws(() => new CilVirtualMachine(fixture(), {maxValueTypeBytes: 4}), {name: 'OutOfMemoryException'});
});
