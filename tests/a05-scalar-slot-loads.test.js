import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {smallStorageFixture, smallStorageTypes} from './support/numeric-storage-fixtures.js';

function counted(vm) {
  let calls = 0;
  const original = vm.storage;
  vm.storage = function(value, type) {
    calls++;
    return original.call(this, value, type);
  };
  return {vm, calls: () => calls};
}

for (const type of ['float', 'double']) {
  for (const value of [-0, NaN, Infinity, 1 / 3]) {
    test(`T08.4 ${type} slot loads reuse normalized immutable values: ${String(value)}`, () => {
      const bytes = managedFixture({methods: [{name: 'Main', result: type, locals: [type],
        body: writer => writer.op(type === 'float' ? 'ldc.r4' : 'ldc.r8', value).op('stloc.0').op('ldloc.0').op('ret')}]});
      const optimized = counted(new CilVirtualMachine(bytes));
      optimized.vm.step();
      optimized.vm.step();
      const stored = optimized.vm.top.locals[0];
      optimized.vm.step();
      assert.strictEqual(optimized.vm.top.stack.at(-1), stored);
      assert.equal(optimized.calls(), 0, 'No storage normalization on stloc before its authoritative write or on ldloc');
      const expected = type === 'float' ? Math.fround(value) : value;
      assert(Object.is(stored.value, expected));
      const generic = counted(new CilVirtualMachine(bytes, {scalarSlotLoads: false}));
      generic.vm.step(); generic.vm.step(); generic.vm.step();
      assert.equal(generic.calls(), 1);
      assert.deepEqual(generic.vm.top.stack.at(-1), stored);
    });
  }
}

for (const {type, suffix} of smallStorageTypes) {
  for (const location of ['local', 'arg', 'byref']) {
    test(`T08.4 ${type} normalization remains on ${location} writes`, () => {
      const bytes = smallStorageFixture(type, suffix, location, 0x12345);
      const options = {arguments: location === 'arg' ? [type === 'bool' ? false : 0] : []};
      const baseline = new CilVirtualMachine(bytes, {...options, scalarSlotLoads: false}).run();
      const optimized = new CilVirtualMachine(bytes, options).run();
      assert.equal(optimized.state, 'terminated', optimized.fault?.stack);
      assert.equal(optimized.returnValue, baseline.returnValue);
    });
  }
}

test('T08.4 local writes still notify observers with the normalized stored value', () => {
  const vm = new CilVirtualMachine(smallStorageFixture('byte', 'u1', 'local', 257));
  const writes = [];
  vm.onWrite = write => writes.push(write);
  assert.equal(vm.run().returnValue, 1);
  assert.equal(writes.find(write => write.kind === 'local' && write.index === 0).value, 1);
});

test('T08.4 an uninitialized scalar load still faults', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.op('ldloc.0').op('ret')}]}));
  vm.top.locals[0] = undefined;
  assert.throws(() => vm.step(), {name: 'InvalidProgramException', message: 'Read of uninitialized local'});
});

test('T08.4 method metadata replacement invalidates a slot classification', () => {
  const vm = counted(new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.op('ldloc.0').op('pop').op('ldloc.0').op('pop').op('ldc.i4.0').op('ret')}]})));
  vm.vm.step(); vm.vm.step();
  assert.equal(vm.calls(), 0);
  vm.vm.top.method.locals = ['object'];
  vm.vm.top.locals[0] = null;
  vm.vm.step();
  assert.equal(vm.calls(), 1, 'Reference loads retain the generic storage adapter');
  assert.equal(vm.vm.top.stack.at(-1), null);
});
