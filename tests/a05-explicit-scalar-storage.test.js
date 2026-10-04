import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {codedIndex} from '@sharpforge/cil';
import {boxValue, unboxValue} from '../packages/runtime/src/execution/boxing.js';
import {byteLayout} from '../packages/runtime/src/execution/explicit-layout.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const union = {name: 'Union', base: 'System.ValueType', flags: 0x100111, methods: [],
  fields: [{name: 'Bits', type: 'int', offset: 0}, {name: 'Real', type: 'float', offset: 0},
    {name: 'Byte', type: 'byte', offset: 1}, {name: 'Word', type: 'ushort', offset: 2}]};
const wide = {name: 'Wide', base: 'System.ValueType', flags: 0x100111, methods: [],
  fields: [{name: 'Bits', type: 'long', offset: 0}, {name: 'Real', type: 'double', offset: 0},
    {name: 'Native', type: 'nint', offset: 0}]};
const pair = {name: 'Pair', base: 'System.ValueType', flags: 0x100109, methods: [],
  fields: [{name: 'Tag', type: 'byte'}, {name: 'Number', type: 'int'}]};
const nested = {name: 'Nested', base: 'System.ValueType', flags: 0x100111, methods: [],
  fields: [{name: 'Pair', type: 'valuetype Pair', offset: 0}, {name: 'Bits', type: 'long', offset: 0}]};
const outer = {name: 'Outer', base: 'System.ValueType', flags: 0x100109, methods: [],
  fields: [{name: 'Inner', type: 'valuetype Union'}, {name: 'Tag', type: 'byte'}]};

function fixture(body = writer => writer.op('ret'), options = {}) {
  const types = options.types ?? [union, wide, pair, nested, outer];
  return genericCallFixture([...types, {name: 'Program', methods: [{name: 'Main', body,
    locals: options.locals ?? ['valuetype Union', 'valuetype Union', 'valuetype Wide',
      'valuetype Pair', 'valuetype Nested', 'valuetype Outer', 'object', 'valuetype Union[]']}]}], {
    decorate(context) {
      for (const type of types) {
        if (type.size) context.md.add(15, [type.packing ?? 0, type.size, context.types.get(type.name) & 0xffffff]);
        for (const field of type.fields) if (field.offset !== undefined) {
          context.md.add(16, [field.offset, context.fields.get(type.name + '.' + field.name) & 0xffffff]);
        }
      }
      options.decorate?.(context);
    }
  });
}

const field = (vm, local, index) => vm.address('field', index, vm.address('local', local));

test('small integers, Boolean, Char and enum aliases retain their declared storage widths', () => {
  const small = {name: 'Small', base: 'System.Enum', fields: [{name: 'value__', type: 'ushort'}], methods: []};
  for (const [type, input, expected] of [
    ['sbyte', -1, 0xffn], ['byte', 300, 44n], ['short', -2, 0xfffen], ['ushort', -1, 0xffffn],
    ['char', 0xabcd, 0xabcdn], ['bool', 255, 0xffn], ['int', -1, 0xffffffffn], ['uint', -1, 0xffffffffn],
    ['long', -1n, -1n], ['ulong', -1n, -1n], ['valuetype Small', -2, 0xfffen]
  ]) {
    const shape = {...union, fields: [{name: 'Value', type, offset: 0}, {name: 'Raw', type: 'long', offset: 0}]};
    const vm = new CilVirtualMachine(fixture(undefined, {types: [small, shape], locals: ['valuetype Union']}));
    try {
      vm.dereference(field(vm, 0, 0), true, input);
      assert.equal(vm.dereference(field(vm, 0, 1)), expected, type);
      assert.equal(vm.storage(vm.top.locals[0], 'Union').fields[1], expected, type);
    } finally { vm.stop(); }
  }
});

test('actual CIL overlays alias scalar writes while ldobj/stobj/cpobj and box/array copies stay independent', () => {
  const bytes = fixture((writer, context) => {
    const type = context.resolve('Union'), bits = context.fields.get('Union.Bits'), byte = context.fields.get('Union.Byte');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    writer.op('ldloca.s', 0).op('ldc.i4', 0x11223344).op('stfld', bits);
    writer.op('ldloca.s', 1).op('ldloca.s', 0).op('ldobj', type).op('stobj', type);
    writer.op('ldloca.s', 0).op('ldflda', byte).op('ldc.i4', 0xaa).op('stind.i1');
    for (const index of [0, 1]) writer.op('ldloc.s', index).op('ldfld', bits).op('call', print);
    writer.op('ldloca.s', 1).op('ldloca.s', 0).op('cpobj', type);
    writer.op('ldloca.s', 0).op('initobj', type);
    writer.op('ldloc.0').op('ldfld', bits).op('call', print);
    writer.op('ldloc.1').op('box', type).op('stloc.s', 6);
    writer.op('ldloc.s', 6).op('unbox', type).op('ldflda', byte).op('ldc.i4.1').op('stind.i1');
    writer.op('ldloc.s', 6).op('unbox.any', type).op('ldfld', bits).op('call', print);
    writer.op('ldc.i4.1').op('newarr', type).op('stloc.s', 7);
    writer.op('ldloc.s', 7).op('ldc.i4.0').op('ldloc.1').op('stelem', type);
    writer.op('ldloc.s', 7).op('ldc.i4.0').op('ldelema', type).op('ldflda', byte).op('ldc.i4.2').op('stind.i1');
    writer.op('ldloc.s', 7).op('ldc.i4.0').op('ldelem', type).op('ldfld', bits).op('call', print);
    writer.op('ldloc.1').op('ldfld', bits).op('call', print).op('ret');
  });
  const vm = new CilVirtualMachine(bytes);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, [0x1122aa44, 0x11223344, 0, 0x11220144, 0x11220244, 0x1122aa44].join('\n') + '\n');
  } finally { vm.stop(); }
});

for (const nativeIntBits of [32, 64]) {
  test(`ABI${nativeIntBits} native writes preserve the remaining overlay bytes and exact floating bits`, () => {
    const vm = new CilVirtualMachine(fixture(), {nativeIntBits});
    try {
      vm.dereference(field(vm, 2, 0), true, 0x1122334455667788n);
      vm.dereference(field(vm, 2, 2), true, vm.storage(-1, 'nint'));
      assert.equal(vm.dereference(field(vm, 2, 0)), nativeIntBits === 32 ? 0x11223344ffffffffn : -1n);
      vm.dereference(field(vm, 2, 1), true, vm.storage(-0, 'double'));
      assert.equal(vm.dereference(field(vm, 2, 0)), -0x8000000000000000n);
      assert(Object.is(vm.dereference(field(vm, 2, 1)).value, -0));
      for (const pattern of [0x7ff8000012345678n, 0xfff80000abcdef01n]) {
        vm.dereference(field(vm, 2, 0), true, BigInt.asIntN(64, pattern));
        const copy = vm.storage(vm.top.locals[2], 'Wide');
        assert(Number.isNaN(copy.fields[1].value));
        assert.equal(BigInt.asUintN(64, copy.fields[0]), pattern);
        assert.deepEqual(copy.explicitBytes, vm.top.locals[2].explicitBytes);
      }
      vm.dereference(field(vm, 0, 0), true, 0x3f800000);
      assert.equal(vm.dereference(field(vm, 0, 1)).value, 1);
      vm.dereference(field(vm, 0, 1), true, vm.storage(-0, 'float'));
      assert.equal(vm.dereference(field(vm, 0, 0)), -2147483648);
    } finally { vm.stop(); }
  });
}

test('nested sequential views preserve padding, rebuild all aliases, and remain independent when copied out', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    vm.dereference(field(vm, 4, 1), true, 0x1122334455667788n);
    const pairAddress = field(vm, 4, 0), numberAddress = vm.address('field', 1, pairAddress);
    const copiedPair = vm.storage(vm.dereference(pairAddress), 'Pair');
    assert.equal(copiedPair.fields[0], 0x88);
    assert.equal(copiedPair.fields[1], 0x11223344);
    vm.dereference(numberAddress, true, 0x01020304);
    assert.equal(vm.dereference(field(vm, 4, 1)), 0x0102030455667788n);
    assert.equal(copiedPair.fields[1], 0x11223344);
    vm.dereference(pairAddress, true, copiedPair);
    assert.equal(vm.dereference(field(vm, 4, 1)), 0x1122334455667788n);
    vm.dereference(pairAddress, true, vm.top.locals[3]);
    assert.equal(vm.dereference(field(vm, 4, 1)), 0n);
    const inner = field(vm, 5, 0);
    vm.dereference(vm.address('field', 0, inner), true, 0x10203040);
    vm.dereference(vm.address('field', 2, inner), true, 0x99);
    assert.equal(vm.dereference(inner).fields[0], 0x10209940);
  } finally { vm.stop(); }
});

test('immutable byte views survive box and local snapshot replay without redirecting interior addresses', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    vm.dereference(field(vm, 0, 0), true, 0x12345678);
    const original = vm.top.locals[0], boxed = boxValue(vm, original, 'Union');
    vm.top.locals[6] = boxed;
    const boxAddress = unboxValue(vm, boxed, 'Union', true), byte = vm.address('field', 2, boxAddress);
    const snapshot = vm.snapshot();
    vm.dereference(byte, true, 0);
    vm.dereference(field(vm, 0, 0), true, 0);
    assert.equal(original.fields[0], 0x12345678);
    assert(Object.isFrozen(original.explicitBytes));
    vm.restore(snapshot);
    assert.equal(vm.dereference(byte), 0x56);
    vm.dereference(byte, true, 0xab);
    assert.equal(unboxValue(vm, boxed, 'Union').fields[0], 0x1234ab78);
    assert.equal(snapshot.heap.records[boxed.h].data[0].fields[0], 0x12345678);
    assert.equal(vm.top.locals[0].fields[0], 0x12345678);
  } finally { vm.stop(); }
});

test('malformed byte payloads or mismatched field views reject before a destination changes', () => {
  const vm = new CilVirtualMachine(fixture()), other = new CilVirtualMachine(fixture());
  try {
    const original = vm.top.locals[0], destination = vm.address('local', 0);
    const malformed = [
      {...original, explicitBytes: [0, 0, 0, 0]}, {...original, explicitBytes: Object.freeze([0, 0, 0, 256])},
      {...original, explicitBytes: Object.freeze([0, 0])}, {...original, explicitBytes: Object.freeze(Array(4))},
      {...original, fields: Object.freeze([1, ...original.fields.slice(1)])},
      {valueType: original.valueType, fields: original.fields}, other.top.locals[0]
    ];
    for (const value of malformed) {
      assert.throws(() => vm.dereference(destination, true, Object.freeze(value)), {name: 'InvalidProgramException'});
      assert.equal(vm.top.locals[0], original);
    }
    const pointer = field(vm, 0, 0);
    assert.throws(() => other.dereference(pointer), /another VM/);
    assert.throws(() => vm.dereference(Object.freeze({...pointer, readonly: true}), true, 2), /readonly/);
    vm.run();
    assert.throws(() => vm.dereference(pointer), /outlived/);
  } finally { vm.stop(); other.stop(); }
});

test('explicit layout plans respect committed code invalidation and current host copy limits', () => {
  const vm = new CilVirtualMachine(fixture());
  try {
    const table = vm.top.locals[0].valueType, first = byteLayout(vm, table);
    assert.equal(byteLayout(vm, table), first);
    invalidateExecutionCode(vm, 'explicit-layout-edit');
    const next = byteLayout(vm, table);
    assert.notEqual(next, first);
    assert.deepEqual(next, first);
    vm.options.maxValueTypeBytes = 3;
    assert.throws(() => vm.storage(vm.top.locals[0], 'Union'), {name: 'OutOfMemoryException'});
    vm.options.maxValueTypeBytes = 4;
    assert.equal(vm.storage(vm.top.locals[0], 'Union').explicitBytes.length, 4);
    for (const limit of [0, -1, 1.5, Infinity, 16 * 1024 * 1024 + 1]) {
      vm.options.maxValueTypeBytes = limit;
      assert.throws(() => vm.storage(vm.top.locals[0], 'Union'), {name: 'RangeError'});
    }
  } finally { vm.stop(); }
});

test('declared explicit tail sizes are bounded before allocating a byte payload', () => {
  const bytes = fixture(undefined, {types: [{...union, size: 1024}], locals: ['valuetype Union']});
  assert.throws(() => new CilVirtualMachine(bytes, {maxValueTypeBytes: 128}), {name: 'OutOfMemoryException'});
});

for (const type of ['decimal', 'System.Nullable`1<int>']) {
  test(`explicit overlays containing ${type} remain explicitly unsupported`, () => {
    const bytes = fixture(undefined, {types: [{...union, fields: [{name: 'Value', type, offset: 0}]}], locals: ['valuetype Union']});
    assert.throws(() => new CilVirtualMachine(bytes), {name: 'NotSupportedException'});
  });
}

for (const attribute of ['IsReadOnlyAttribute', 'IsByRefLikeAttribute']) {
  test(`explicit ${attribute} storage retains its admission boundary`, () => {
    const bytes = fixture(undefined, {types: [union], locals: ['valuetype Union'], decorate(context) {
      context.md.add(12, [codedIndex('HasCustomAttribute', context.types.get('Union')),
        codedIndex('CustomAttributeType', context.member('System.Runtime.CompilerServices.' + attribute, '.ctor', 'void', [], false)),
        context.md.blob(Uint8Array.from([1, 0, 0, 0]))]);
    }});
    assert.throws(() => new CilVirtualMachine(bytes), {name: 'NotSupportedException'});
  });
}

test('missing field offsets still produce a TypeLoadException rather than independent slot storage', () => {
  const bytes = fixture(undefined, {types: [{...union, fields: [{name: 'Bits', type: 'int'}]}], locals: ['valuetype Union']});
  assert.throws(() => new CilVirtualMachine(bytes), {name: 'TypeLoadException'});
});
