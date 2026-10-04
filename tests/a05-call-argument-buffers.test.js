import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {framePool} from '../packages/runtime/src/execution/frame-pool.js';
import {managedFixture} from './managed-fixtures.js';

function arithmeticCalls(count) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body(writer, context) {
    writer.op('ldc.i4.0').op('stloc.0');
    for (let index = 1; index <= count; index++) {
      writer.op('ldloc.0').op('ldc.i4', -index);
      writer.op('call', context.member('System.Math', 'Abs', 'int', ['int']));
      writer.op('add').op('stloc.0');
    }
    writer.op('ldloc.0').op('ret');
  }}]});
}

for (const framePooling of [true, false]) {
  test(`intrinsic argument scratch respects framePooling=${framePooling}`, () => {
    const vm = new CilVirtualMachine(arithmeticCalls(20), {framePooling});
    const before = framePoolStatistics(vm);
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 210);
    const after = framePoolStatistics(vm);
    assert.equal(after.arraysAllocated - before.arraysAllocated, framePooling ? 1 : 20);
    if (!framePooling) assert.equal(after.retainedBytes, 0);
    vm.stop();
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
  });
}

test('mixed intrinsic arities share scratch without retaining arguments beyond their call', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op('ldc.i4.7').op('ldc.i4.2');
    writer.op('call', context.member('System.Math', 'Max', 'int', ['int', 'int']));
    writer.op('call', context.member('System.Math', 'Abs', 'int', ['int'])).op('pop');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldc.i4', 42).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes);
  const before = framePoolStatistics(vm).arraysAllocated;
  assert.equal(vm.run().returnValue, 42);
  assert.equal(framePoolStatistics(vm).arraysAllocated, before + 1);
  const pool = framePool(vm);
  const buffer = pool.arguments([], 0);
  assert.deepEqual(buffer, []);
  assert.equal(framePoolStatistics(vm).arraysAllocated, before + 1);
  pool.releaseArguments(buffer);
});

test('throwing intrinsics return and clear scratch through the exceptional path', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op('ldc.i4', -2147483648);
    writer.op('call', context.member('System.Math', 'Abs', 'int', ['int'])).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes);
  const before = framePoolStatistics(vm).arraysAllocated;
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'OverflowException');
  assert.equal(framePoolStatistics(vm).arraysAllocated, before + 1);
  const pool = framePool(vm);
  const buffer = pool.arguments([], 0);
  assert.deepEqual(buffer, []);
  assert.equal(framePoolStatistics(vm).arraysAllocated, before + 1);
  pool.releaseArguments(buffer);
});

test('delegate arguments remain owned by the callee after its invoke scratch is reused', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Target);
      writer.op('newobj', context.member('System.Func`2<int,int>', '.ctor', 'void', ['object', 'nint'], false));
      writer.op('ldc.i4', 42);
      writer.op('callvirt', context.member('System.Func`2<int,int>', 'Invoke', 'int', ['int'], false)).op('ret');
    }},
    {name: 'Target', parameters: ['int'], result: 'int', body: writer => writer.op('ldarg.0').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes);
  for (let step = 0; step < 20 && vm.top.method.name !== 'Target'; step++) vm.step();
  assert.equal(vm.top.method.name, 'Target');
  assert.deepEqual(vm.top.args, [42]);
  const pool = framePool(vm);
  const before = framePoolStatistics(vm).arraysAllocated;
  const buffer = pool.arguments([99], 1);
  assert.notEqual(buffer, vm.top.args);
  assert.equal(framePoolStatistics(vm).arraysAllocated, before, 'delegate invocation returned its scratch');
  assert.deepEqual(vm.top.args, [42]);
  pool.releaseArguments(buffer);
  assert.equal(vm.run().returnValue, 42);
});

test('suspending platform contracts retain owned argument arrays', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op('ldc.i4', 1000);
    writer.op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int']));
    writer.op('ldc.i4', 42).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {virtualTime: true});
  const original = vm.platform.invoke.bind(vm.platform);
  let retained;
  vm.platform.invoke = (descriptor, args) => {
    retained = args;
    return original(descriptor, args);
  };
  assert.equal(vm.run().state, 'waiting');
  assert.deepEqual(retained, [1000]);
  const pool = framePool(vm);
  const scratch = pool.arguments([7], 1);
  assert.notEqual(scratch, retained);
  pool.releaseArguments(scratch);
  assert.deepEqual(retained, [1000]);
  vm.scheduler.advance(1000);
  assert.equal(vm.run().returnValue, 42);
});
