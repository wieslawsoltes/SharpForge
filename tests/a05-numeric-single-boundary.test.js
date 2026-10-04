import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {floatAllocationAssembly, floatLoopInstructions, floatLoopSetupInstructions} from '../bench/vm/float-allocation-fixture.js';

function machine(specializeNumericHandlers) {
  const vm = new CilVirtualMachine(floatAllocationAssembly(512, true), {typedNumericStack: true, specializeNumericHandlers});
  prepareExecution(vm);
  const original = vm.address;
  let addresses = 0;
  vm.address = function(kind, index) { addresses++; return original.call(this, kind, index); };
  return {vm, addresses: () => addresses};
}

test('mixed double loops do not materialize i4 store addresses at256-instruction budget boundaries', () => {
  for (const specialize of [false, true]) {
    const {vm, addresses} = machine(specialize);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.returnValue, 128);
      assert.equal(vm.instructions, floatLoopSetupInstructions + 512 * floatLoopInstructions + 2);
      assert.equal(addresses(), specialize ? 0 : 513, 'the generic control observes every actual counter store');
    } finally { vm.stop(); }
  }
});

test('one-instruction slices preserve each original PC and result without temporary i4 addresses', () => {
  const optimized = machine(true);
  const reference = machine(false);
  try {
    while (reference.vm.state === 'ready' || reference.vm.state === 'running') {
      reference.vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      optimized.vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      assert.equal(optimized.vm.instructions, reference.vm.instructions);
      assert.equal(optimized.vm.state, reference.vm.state);
      assert.equal(optimized.vm.top?.pc, reference.vm.top?.pc);
      assert.deepEqual(optimized.vm.top?.stack, reference.vm.top?.stack);
      assert.deepEqual(optimized.vm.top?.locals, reference.vm.top?.locals);
    }
    assert.deepEqual(optimized.vm.returnValue, float(128));
    assert.deepEqual(optimized.vm.returnValue, reference.vm.returnValue);
    assert.equal(optimized.addresses(), 0);
    assert.equal(reference.addresses(), 513);
  } finally { optimized.vm.stop(); reference.vm.stop(); }
});

test('one-instruction debugger observation retains ordinary handler and write boundaries', () => {
  const {vm, addresses} = machine(true);
  let observations = 0;
  let writes = 0;
  vm.onWrite = () => writes++;
  try {
    while (vm.state === 'ready' || vm.state === 'running') {
      vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity, onInstruction: () => { observations++; }});
    }
    assert.deepEqual(vm.returnValue, float(128));
    assert.equal(observations, vm.instructions);
    assert.equal(writes, 1026);
    assert.equal(addresses(), 1026, 'onWrite keeps both float and i4 stores on the observable path');
  } finally { vm.stop(); }
});
