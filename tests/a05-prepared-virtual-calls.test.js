import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';
import {isReference} from '../packages/runtime/src/heap.js';

const bytes = inlineCacheFixture([0, 1, 0, 1, 0, 1]);

function observed(options) {
  const {maxStackBytes, ...launch} = options;
  const vm = new CilVirtualMachine(bytes, {runtimeEvents: true, ...launch});
  try {
    if (maxStackBytes !== undefined) {
      vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: instruction => instruction.name === 'callvirt'});
      assert.equal(vm.state, 'paused');
      assert.equal(vm.top.method.name, 'Invoke');
      // Main (80 bytes) and Invoke (88) fit; the new Value frame (88) must fail admission.
      vm.options.maxStackBytes = maxStackBytes;
      vm.state = 'running';
    }
    const result = vm.run();
    return {state: result.state, value: result.returnValue, instructions: vm.instructions,
      fault: result.fault?.name, frames: vm.frames.map(frame => frame.method.name),
      events: vm.runtimeEvents.read().map(event => [event.name, event.instruction, event.payload?.method])};
  } finally { vm.stop(); }
}

test('prepared virtual calls preserve managed events, exact instruction counts and GC boundaries', () => {
  const baseline = observed({inlineCaches: false, gcStress: 'instruction'});
  const candidate = observed({inlineCaches: true, gcStress: 'instruction'});
  assert.equal(candidate.state, 'terminated');
  assert.equal(candidate.value, 9);
  assert.deepEqual(candidate, baseline);
});

for (const options of [{maxFrames: 2}, {maxStackBytes: 192}, {maxInstructions: 24}]) {
  test(`prepared call failure keeps ordinary quota and frame behavior ${JSON.stringify(options)}`, () => {
    const baseline = observed({...options, inlineCaches: false});
    const candidate = observed({...options, inlineCaches: true});
    assert.deepEqual(candidate, baseline);
    assert.equal(candidate.state, 'faulted');
  });
}

test('one-instruction slices expose the prepared callee and restored execution rebuilds the call setup', () => {
  const vm = new CilVirtualMachine(bytes, {inlineCaches: true});
  try {
    let entries = 0;
    for (let count = 0; count < 200 && entries < 3; count++) {
      const before = vm.instructions;
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      assert.equal(vm.instructions, before + 1);
      if (vm.top?.method.name === 'Value' && vm.top.pc === 0) entries++;
    }
    assert.equal(entries, 3);
    assert.equal(vm.top.method.owner, 'Receiver0');
    const snapshot = vm.snapshot();
    const expected = vm.run();
    vm.restore(snapshot);
    vm.heap.collect();
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, expected.returnValue);
    assert.equal(result.stats.instructions, expected.stats.instructions);
  } finally { vm.stop(); }
});

test('prepared direct frame entry normalizes arguments while the caller stack retains receiver roots', () => {
  const assembly = inlineCacheFixture([0, 1, 0, 1], {byteArgument: 511});
  for (const typedNumericStack of [false, true]) {
    const outputs = [];
    for (const inlineCaches of [false, true]) {
      const vm = new CilVirtualMachine(assembly, {inlineCaches, typedNumericStack});
      const storage = vm.storage;
      let normalized = 0;
      vm.storage = function(value, type) {
        if (type === 'byte') {
          normalized++;
          const caller = this.top;
          const receiver = caller.args.find(isReference);
          assert(receiver);
          caller.args[0] = null;
          this.heap.collect();
          assert.equal(this.heap.get(receiver).methodTable.name.startsWith('Receiver'), true);
        }
        return storage.call(this, value, type);
      };
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.message);
        assert.equal(result.returnValue, 1020);
        assert.equal(normalized, 4);
        outputs.push([result.returnValue, vm.instructions]);
      } finally { vm.stop(); }
    }
    assert.deepEqual(outputs[0], outputs[1]);
  }
});

for (const hook of ['own', 'subclass', 'prototype']) test(`a ${hook} host call hook continues to observe every prepared virtual target`, () => {
  const outputs = [];
  for (const inlineCaches of [false, true]) {
    const calls = [];
    class ObservedVM extends CilVirtualMachine {
      call(token, args, extra) { calls.push([token, args.length]); return super.call(token, args, extra); }
    }
    const original = CilVirtualMachine.prototype.call;
    if (hook === 'prototype') CilVirtualMachine.prototype.call = function(token, args, extra) {
      calls.push([token, args.length]);
      return original.call(this, token, args, extra);
    };
    const VM = hook === 'subclass' ? ObservedVM : CilVirtualMachine;
    const vm = new VM(bytes, {inlineCaches});
    if (hook === 'own') {
      const call = vm.call;
      vm.call = function(token, args, extra) {
        calls.push([token, args.length]);
        return call.call(this, token, args, extra);
      };
    }
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      outputs.push({value: result.returnValue, instructions: vm.instructions, calls});
    } finally { vm.stop(); CilVirtualMachine.prototype.call = original; }
  }
  assert.deepEqual(outputs[0], outputs[1]);
});
