import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {float, nativeInteger, decimalParse} from '@sharpforge/bytecode';
import {loadSlot} from '../packages/runtime/src/execution/slot-storage.js';
import {storage} from '../packages/runtime/src/execution/numeric-ops.js';
import {managedFixture} from './managed-fixtures.js';
import {enumFixture} from './a05-enum-fixtures.js';

function slot(type, value, options = {}) {
  const method = {locals: [type], signature: {parameters: [type], isStatic: true}};
  const frame = {method, args: [value], locals: [value]};
  const calls = [];
  const vm = {options, slotType: (current, argument, index) =>
    (argument ? current.method.signature.parameters : current.method.locals)[index],
  storage(input, declared) { calls.push({input, declared}); return storage(input, declared, options); }};
  return {vm, frame, calls};
}

for (const [type, value] of [
  ['sbyte', -128], ['byte', 255], ['short', -32768], ['ushort', 65535], ['char', 65535], ['bool', 255],
  ['int', -2147483648], ['uint', -1], ['long', -(1n << 63n)], ['ulong', -1n],
  ['float', float(-0, 'r4')], ['double', float(NaN)], ['System.Decimal', decimalParse('1.2300')]
]) test(`canonical ${type} slots retain immutable values and exact boundaries`, () => {
  const {vm, frame, calls} = slot(type, value);
  assert.ok(Object.is(loadSlot(vm, frame, false, 0), value));
  assert.ok(Object.is(loadSlot(vm, frame, true, 0), value));
  assert.equal(calls.length, 0);
  vm.options.scalarSlotLoads = false;
  assert.deepEqual(loadSlot(vm, frame, false, 0), storage(value, type));
  assert.equal(calls.length, 1);
});

for (const [type, input, expected] of [
  ['byte', 256, 0], ['sbyte', 255, -1], ['short', 65535, -1], ['bool', 511, 255],
  ['int', -0, 0], ['uint', 4294967295, -1], ['ulong', 18446744073709551615n, -1n],
  ['float', float(1.1), float(1.1, 'r4')], ['double', float(1.1, 'r4'), float(Math.fround(1.1))]
]) test(`noncanonical ${type} values retain the existing normalization fallback`, () => {
  const {vm, frame, calls} = slot(type, input);
  assert.deepEqual(loadSlot(vm, frame, false, 0), expected);
  assert.equal(calls.length, 1);
});

test('native slot guards require the configured width and frozen signed payload', () => {
  for (const nativeIntBits of [32, 64]) {
    const value = nativeInteger(-1, nativeIntBits), {vm, frame, calls} = slot('nuint', value, {nativeIntBits});
    assert.equal(loadSlot(vm, frame, false, 0), value);
    assert.equal(calls.length, 0);
    frame.locals[0] = nativeInteger(4294967297n, nativeIntBits === 32 ? 64 : 32);
    assert.deepEqual(loadSlot(vm, frame, false, 0), storage(frame.locals[0], 'nuint', {nativeIntBits}));
    assert.equal(calls.length, 1);
  }
});

test('live signatures are reclassified for in-place edits, replacements and closed instantiations', () => {
  const {vm, frame, calls} = slot('int', 255);
  assert.equal(loadSlot(vm, frame, false, 0), 255);
  frame.method.locals[0] = 'sbyte';
  assert.equal(loadSlot(vm, frame, false, 0), -1);
  frame.method.locals = ['byte'];
  frame.locals[0] = 256;
  assert.equal(loadSlot(vm, frame, false, 0), 0);
  frame.method.signature.parameters[0] = 'sbyte';
  assert.equal(loadSlot(vm, frame, true, 0), -1);
  frame.method.signature = {isStatic: true, parameters: ['byte']};
  assert.equal(loadSlot(vm, frame, true, 0), 255);
  assert.equal(calls.length, 3);
});

test('unassigned, byref, enum, reference, modified and unresolved signatures retain their behavior', () => {
  const pointer = Object.freeze({byref: true, kind: 'local', index: 0, frameId: 1});
  for (const [type, value] of [['int&', pointer], ['Fixture.Choice', 1], ['object', null], ['!!0', 1],
    ['int modreq(System.Runtime.CompilerServices.IsVolatile)', 1], ['float pinned', float(1, 'r4')]]) {
    const {vm, frame, calls} = slot(type, value);
    assert.equal(loadSlot(vm, frame, false, 0), value);
    assert.equal(calls.length, 1, type);
  }
  const {vm, frame} = slot('int', undefined);
  assert.throws(() => loadSlot(vm, frame, false, 0), {name: 'InvalidProgramException'});
});

for (const scalarSlotLoads of [true, false]) {
  test(`CIL slot loads=${scalarSlotLoads}: narrow direct and byref writes normalize exactly once`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', parameters: ['byte'], result: 'int', locals: ['byte'], body(w) {
      w.op('ldarga.s', 0).op('ldc.i4', 510).op('stind.i4');
      w.op('ldarg.0').op('stloc.0').op('ldloca.s', 0).op('ldc.i4', 511).op('stind.i4');
      w.op('ldloc.0').op('ldarg.0').op('add').op('ret');
    }}]});
    const vm = new CilVirtualMachine(bytes, {arguments: [0], scalarSlotLoads});
    const writes = [];
    vm.onWrite = change => writes.push(change.value);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 509);
    assert.deepEqual(writes, [254, 254, 255]);
  });

  test(`CIL slot loads=${scalarSlotLoads}: Single storage rounds and native64 retains width`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', locals: ['float', 'nint'], body(w) {
      w.op('ldc.r8', 16777217).op('stloc.0').op('ldloc.0').op('conv.i8');
      w.op('ldc.i8', 4294967297n).op('conv.i').op('stloc.1').op('ldloc.1').op('conv.i8').op('add').op('ret');
    }}]});
    const vm = new CilVirtualMachine(bytes, {scalarSlotLoads, nativeIntBits: 64});
    assert.equal(vm.run().returnValue, 4311744513n);
  });

  test(`CIL slot loads=${scalarSlotLoads}: enum storage and uninitialized local faults remain generic`, () => {
    const bytes = enumFixture({underlying: 'byte', locals: ['Fixture.Choice'], result: 'int', body: w =>
      w.op('ldc.i4', 511).op('stloc.0').op('ldloc.0').op('ret')});
    assert.equal(new CilVirtualMachine(bytes, {scalarSlotLoads}).run().returnValue, 255);
    const invalid = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], initLocals: false,
      body: w => w.op('ldloc.0').op('ret')}]});
    assert.equal(new CilVirtualMachine(invalid, {scalarSlotLoads}).run().fault?.name, 'InvalidProgramException');
  });
}

test('CIL stores use one destination normalizer and scalar loads need no repeated conversion', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['byte'], body: w =>
    w.op('ldc.i4', 511).op('stloc.0').op('ldloc.0').op('ldloc.0').op('add').op('ret')}]});
  const vm = new CilVirtualMachine(bytes), original = vm.storage.bind(vm);
  let conversions = 0;
  vm.storage = (value, type) => { conversions++; return original(value, type); };
  assert.equal(vm.run().returnValue, 510);
  assert.equal(conversions, 1);
});

test('CIL snapshot replay and pooled frame reuse preserve normalized slot state', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'float', locals: ['float'], body: w =>
    w.op('ldc.r8', 1.1).op('stloc.0').op('ldloc.0').op('ret')}]});
  const vm = new CilVirtualMachine(bytes), method = vm.top.method.token;
  vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
  const value = vm.top.locals[0], saved = vm.snapshot();
  assert.equal(vm.run().returnValue, Math.fround(1.1));
  vm.restore(saved);
  assert.equal(vm.top.locals[0], value);
  assert.equal(vm.run().returnValue, Math.fround(1.1));
  vm.state = 'running';
  vm.call(method, []);
  assert.equal(vm.run().returnValue, Math.fround(1.1));
});
