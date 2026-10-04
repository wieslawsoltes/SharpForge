import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function assembly() {
  return managedFixture({methods: [{name: 'Main', result: 'int', body: writer => writer.op('ldc.i4', 42).op('ret')}]});
}

test('direct CIL heap quota does not limit the PE bytes and remains enforced from construction', () => {
  const bytes = assembly();
  assert(bytes.length > 256);
  const vm = new CilVirtualMachine(bytes, {maxBytes: 256});
  try {
    assert.equal(vm.heap.maxBytes, 256);
    assert.equal(vm.inspector.options.maxBytes, undefined);
    const array = vm.heap.array('int', 56);
    const root = vm.heap.createHandle(array);
    try {
      assert.equal(vm.heap.get(array).size, 256);
      assert.throws(() => vm.heap.array('int', 0), {name: 'OutOfMemoryException'});
      assert.equal(vm.run().returnValue, 42);
      assert.equal(vm.heap.getHandle(root), array);
    } finally { vm.heap.releaseHandle(root); }
  } finally { vm.stop(); }
});

test('explicit assembly byte limits are exact and independent of the smaller heap quota', () => {
  const bytes = assembly();
  const vm = new CilVirtualMachine(bytes, {maxBytes: 256, assemblyLimits: {maxBytes: bytes.length}});
  try {
    assert.equal(vm.inspector.options.maxBytes, bytes.length);
    assert.equal(vm.heap.maxBytes, 256);
    assert.equal(vm.run().returnValue, 42);
  } finally { vm.stop(); }
  assert.throws(() => new CilVirtualMachine(bytes, {maxBytes: 256, assemblyLimits: {maxBytes: bytes.length - 1}}),
    {name: 'CilError', message: 'Invalid PE input or assembly exceeds size limit'});
});

test('nested structural decode limits remain independent from executed instruction limits', () => {
  const bytes = assembly();
  assert.throws(() => new CilVirtualMachine(bytes, {maxInstructions: 1000, assemblyLimits: {maxInstructions: 1}}),
    /instruction limit/i);
  const vm = new CilVirtualMachine(bytes, {maxInstructions: 1, assemblyLimits: {maxInstructions: 10}});
  try {
    assert.equal(vm.inspector.options.maxInstructions, 10);
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'InstructionLimitException');
  } finally { vm.stop(); }
});

test('a pre-admitted inspector retains its own decoding limits', () => {
  const inspector = new AssemblyInspector(assembly(), {maxInstructions: 1});
  assert.throws(() => new CilVirtualMachine(inspector, {maxBytes: 256, assemblyLimits: {maxInstructions: 10}}),
    /instruction limit/i);
});
