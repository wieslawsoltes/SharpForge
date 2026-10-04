import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function createVM(initLocals = true) {
  return new CilVirtualMachine(managedFixture({methods: [{
    name: 'Main', locals: ['byte'], initLocals, body: writer => writer.op('ret'),
  }]}));
}

test('Managed address writes report normalized local values and publish the root slot', () => {
  const vm = createVM();
  try {
    const address = vm.address('local', 0);
    const writes = [];
    vm.onWrite = event => writes.push(event);
    const revision = vm.writeRevision;
    const heapRevision = vm.heap.mutationRevision;
    assert.equal(vm.dereference(address, true, 300), 44);
    assert.equal(vm.dereference(address), 44);
    assert.equal(vm.writeRevision, revision + 1);
    // A06 root publication invalidates graph diagnostics even when a local stores a scalar.
    assert.equal(vm.heap.mutationRevision, heapRevision + 1);
    assert.deepEqual(writes, [{kind: 'local', index: 0, frameId: address.frameId, oldValue: 0, value: 44}]);
  } finally { vm.stop(); }
});

test('Managed array address writes retain owner identity and normalized notification values', () => {
  const vm = createVM();
  try {
    const owner = vm.heap.array('byte', 1);
    const address = vm.address('array', 0, owner);
    const writes = [];
    vm.onWrite = event => writes.push(event);
    const revision = vm.writeRevision;
    const heapRevision = vm.heap.mutationRevision;
    assert.equal(vm.dereference(address, true, -1), 255);
    assert.equal(vm.dereference(address), 255);
    assert.equal(vm.writeRevision, revision + 1);
    assert.equal(vm.heap.mutationRevision, heapRevision + 1);
    assert.deepEqual(writes, [{
      kind: 'array', index: 0, frameId: address.frameId,
      handle: owner.h, generation: owner.g, oldValue: 0, value: 255,
    }]);
  } finally { vm.stop(); }
});

test('Rejected covariant array writes leave storage, revisions and notifications unchanged', () => {
  const vm = createVM();
  try {
    const owner = vm.heap.array('string', 1);
    const value = vm.heap.object('System.Object', []);
    const address = vm.address('array', 0, owner);
    const writes = [];
    vm.onWrite = event => writes.push(event);
    const revision = vm.writeRevision;
    const heapRevision = vm.heap.mutationRevision;
    assert.throws(() => vm.dereference(address, true, value), {name: 'ArrayTypeMismatchException'});
    assert.equal(vm.dereference(address), null);
    assert.equal(vm.writeRevision, revision);
    assert.equal(vm.heap.mutationRevision, heapRevision);
    assert.deepEqual(writes, []);
  } finally { vm.stop(); }
});

test('Managed address reads preserve uninitialized, invalid-slot and frame-lifetime faults', () => {
  const vm = createVM(false);
  try {
    const address = vm.address('local', 0);
    assert.throws(() => vm.dereference(address), {
      name: 'InvalidProgramException', message: 'Uninitialized address',
    });
    assert.throws(() => vm.dereference({...address, index: 1}), {
      name: 'InvalidProgramException', message: 'Invalid managed address slot',
    });
    assert.throws(() => vm.dereference(null), {
      name: 'InvalidProgramException', message: 'A managed address is required',
    });
    vm.stop();
    assert.throws(() => vm.dereference(address), {
      name: 'InvalidProgramException', message: 'Managed address outlived its frame',
    });
  } finally { vm.stop(); }
});
