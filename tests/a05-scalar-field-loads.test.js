import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {float, nativeInteger, decimalParse} from '@sharpforge/bytecode';
import {loadFieldValue} from '../packages/runtime/src/execution/field-storage.js';
import {storage} from '../packages/runtime/src/execution/numeric-ops.js';
import {handlers} from '../packages/runtime/src/execution/handlers/object-model.js';
import {managedFixture} from './managed-fixtures.js';
import {enumFixture} from './a05-enum-fixtures.js';
import {tokenCacheFixture} from './support/token-cache-fixture.js';

function context(options = {}) {
  const calls = [];
  return {options, calls, storage(value, type) {
    calls.push(type);
    return storage(value, type, options);
  }};
}
const field = type => Object.freeze({signature: Object.freeze({type})});

test('scalar field loads retain canonical values while guarding live payloads and opt-out', () => {
  for (const [type, value, changed, expected] of [
    ['byte', 255, 511, 255],
    ['uint', -1, 4294967295, -1],
    ['ulong', -1n, 18446744073709551615n, -1n],
    ['float', float(-0, 'r4'), float(16777217), float(16777216, 'r4')],
    ['double', float(NaN), {float: 'r8', value: -0}, float(-0)],
  ]) {
    const vm = context(), descriptor = field(type);
    assert.ok(Object.is(loadFieldValue(vm, descriptor, value), value));
    assert.deepEqual(vm.calls, []);
    assert.deepEqual(loadFieldValue(vm, descriptor, changed), expected);
    assert.deepEqual(vm.calls, [type]);
    vm.options.scalarFieldLoads = false;
    assert.deepEqual(loadFieldValue(vm, descriptor, value), storage(value, type));
    assert.deepEqual(vm.calls, [type, type]);
  }
});

test('native fields require matching ABI width and Decimal retains its exact immutable carrier', () => {
  for (const nativeIntBits of [32, 64]) {
    const vm = context({nativeIntBits}), value = nativeInteger(-1, nativeIntBits);
    assert.equal(loadFieldValue(vm, field('System.UIntPtr'), value), value);
    assert.deepEqual(vm.calls, []);
    const foreign = nativeInteger(4294967297n, nativeIntBits === 32 ? 64 : 32);
    assert.deepEqual(loadFieldValue(vm, field('nuint'), foreign), storage(foreign, 'nuint', vm.options));
    assert.deepEqual(vm.calls, ['nuint']);
  }
  const vm = context(), value = decimalParse('1.2300');
  assert.equal(loadFieldValue(vm, field('System.Decimal'), value), value);
  assert.deepEqual(vm.calls, []);
});

test('references, aggregates, pointers, modifiers and unresolved signatures keep their storage adapter', () => {
  const value = Object.freeze({byref: true, kind: 'field', index: 0});
  for (const type of ['object', 'Fixture.Aggregate', 'int&', '!0', '!!0', 'int modreq(Unknown)', 'float pinned']) {
    const vm = context();
    assert.equal(loadFieldValue(vm, field(type), value), value);
    assert.deepEqual(vm.calls, [type]);
  }
  const vm = new CilVirtualMachine(enumFixture({underlying: 'byte', result: 'int', body: writer => writer.integer(0).op('ret')}));
  assert.equal(loadFieldValue(vm, field('Fixture.Choice'), 511), 255);
});

function fieldFixture(body, type = 'byte', result = 'int', extraMethods = []) {
  return managedFixture({fields: [
    {name: 'Instance', type, static: false}, {name: 'Shared', type},
  ], methods: [
    {name: 'Main', result, locals: ['Fixture.Program'], body},
    {name: '.ctor', static: false, flags: 0x1886, body(writer, metadata) {
      writer.op('ldarg.0').op('call', metadata.member('System.Object', '.ctor', 'void', [], false)).op('ret');
    }},
    ...extraMethods,
  ]});
}

for (const scalarFieldLoads of [true, false]) {
  test(`field loads=${scalarFieldLoads}: direct and byref writes retain narrowing, notifications and volatile cleanup`, () => {
    const bytes = fieldFixture((writer, metadata) => {
      writer.op('newobj', metadata.methods['.ctor']).op('stloc.0');
      writer.op('ldloc.0').integer(256).op('stfld', metadata.fields.Instance);
      writer.op('ldloc.0').op('ldflda', metadata.fields.Instance).integer(510).op('stind.i4');
      writer.integer(256).op('stsfld', metadata.fields.Shared);
      writer.op('ldsflda', metadata.fields.Shared).integer(511).op('stind.i4');
      writer.op('ldloc.0').op('volatile.').op('ldfld', metadata.fields.Instance);
      writer.op('volatile.').op('ldsfld', metadata.fields.Shared).op('add').op('ret');
    });
    const vm = new CilVirtualMachine(bytes, {scalarFieldLoads}), writes = [];
    vm.onWrite = change => { if (change.kind === 'field' || change.kind === 'static') writes.push(change.value); };
    const frame = vm.top, result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 509);
    assert.deepEqual(writes, [0, 254, 0, 255]);
    assert.notEqual(frame.volatileAccess, true);
  });

  test(`field loads=${scalarFieldLoads}: initialized defaults and Single storage keep their values`, () => {
    const bytes = fieldFixture((writer, metadata) => {
      writer.op('newobj', metadata.methods['.ctor']).op('stloc.0');
      writer.op('ldloc.0').op('ldfld', metadata.fields.Instance);
      writer.op('ldsfld', metadata.fields.Shared).op('add');
      writer.op('ldloc.0').op('ldc.r8', 16777217).op('stfld', metadata.fields.Instance);
      writer.op('ldloc.0').op('ldfld', metadata.fields.Instance).op('add').op('ret');
    }, 'float', 'float');
    assert.equal(new CilVirtualMachine(bytes, {scalarFieldLoads}).run().returnValue, 16777216);
  });

  test(`field loads=${scalarFieldLoads}: type initialization finishes before static reads`, () => {
    const bytes = fieldFixture((writer, metadata) => writer.op('ldsfld', metadata.fields.Shared)
      .op('ldsfld', metadata.fields.Shared).op('add').op('ret'), 'byte', 'int', [{
      name: '.cctor', flags: 0x1891, body: (writer, metadata) =>
        writer.integer(7).op('stsfld', metadata.fields.Shared).op('ret'),
    }]);
    const vm = new CilVirtualMachine(bytes, {scalarFieldLoads}), writes = [];
    vm.onWrite = change => writes.push(change.value);
    assert.equal(vm.run().returnValue, 14);
    assert.deepEqual(writes, [7]);
  });

  test(`field loads=${scalarFieldLoads}: closed signatures and receiver validation remain authoritative`, () => {
    const fixture = tokenCacheFixture('int'), vm = new CilVirtualMachine(fixture.bytes, {scalarFieldLoads});
    const integer = vm.heap.object('Box`1<int>', [42]), text = vm.heap.object('Box`1<string>', [null]);
    for (const [member, receiver, expected] of [[fixture.members[0], integer, 42], [fixture.members[1], text, null]]) {
      vm.push(receiver);
      handlers.get('ldfld')(vm, vm.top, {operand: member});
      assert.equal(vm.pop(), expected);
    }
    vm.push(text);
    assert.throws(() => handlers.get('ldfld')(vm, vm.top, {operand: fixture.members[0]}), {name: 'InvalidProgramException'});
    assert.equal(vm.top.stack.length, 0);
  });

  test(`field loads=${scalarFieldLoads}: closed static owners retain independent values and signatures`, () => {
    const fixture = tokenCacheFixture('int'), vm = new CilVirtualMachine(fixture.bytes, {scalarFieldLoads});
    const value = vm.heap.string('retained');
    for (const [owner, input] of [['Box`1<int>', 42], ['Box`1<string>', value]]) {
      vm.top.genericIdentity = owner;
      vm.push(input);
      handlers.get('stsfld')(vm, vm.top, {operand: fixture.staticField});
    }
    for (const [owner, expected] of [['Box`1<int>', 42], ['Box`1<string>', value]]) {
      vm.top.genericIdentity = owner;
      handlers.get('ldsfld')(vm, vm.top, {operand: fixture.staticField});
      assert.equal(vm.pop(), expected);
    }
  });

  for (const nativeIntBits of [32, 64]) test(`field loads=${scalarFieldLoads}: native${nativeIntBits} and snapshot replay`, () => {
    const bytes = fieldFixture((writer, metadata) => writer.op('ldc.i8', 4294967297n).op('conv.i')
      .op('stsfld', metadata.fields.Shared).op('ldsfld', metadata.fields.Shared).op('conv.i8').op('ret'), 'nint', 'long');
    const vm = new CilVirtualMachine(bytes, {scalarFieldLoads, nativeIntBits});
    vm.runSlice({instructionBudget: 3, timeBudgetMs: 1000});
    const saved = vm.snapshot(), expected = nativeIntBits === 64 ? 4294967297n : 1n;
    assert.equal(vm.run().returnValue, expected);
    vm.restore(saved);
    assert.equal(vm.run().returnValue, expected);
  });
}

test('warm scalar field reads use canonical storage without concealing host edits', () => {
  const fixture = tokenCacheFixture('int'), vm = new CilVirtualMachine(fixture.bytes);
  const receiver = vm.heap.object('Box`1<int>', [42]), original = vm.storage.bind(vm);
  let conversions = 0;
  vm.storage = (value, type) => { conversions++; return original(value, type); };
  const read = () => {
    vm.push(receiver);
    handlers.get('ldfld')(vm, vm.top, {operand: fixture.members[0]});
    return vm.pop();
  };
  assert.equal(read(), 42);
  assert.equal(read(), 42);
  assert.equal(conversions, 0);
  vm.heap.get(receiver).data[0] = 4294967297;
  // A host Number outside Int32 uses the existing floating conversion policy.
  assert.equal(read(), 2147483647);
  assert.equal(conversions, 1);
  vm.heap.get(receiver).data[0] = 3.75;
  assert.equal(read(), 3);
  assert.equal(conversions, 2);
  vm.options.scalarFieldLoads = false;
  vm.heap.get(receiver).data[0] = 42;
  assert.equal(read(), 42);
  assert.equal(conversions, 3);
});
