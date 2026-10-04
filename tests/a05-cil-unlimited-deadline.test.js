import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareExecution} from '@sharpforge/runtime';
import {qualificationAssembly} from '../bench/vm/qualification-assembly.js';

function machine(options = {}) {
  const vm = new CilVirtualMachine(qualificationAssembly({result: 'void', maxStack: 1, body(writer) {
    writer.mark('loop').integer(1).op('pop').op('br.s', 'loop');
  }}), options);
  prepareExecution(vm);
  return vm;
}

function withClock(action) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let calls = 0;
  Object.defineProperty(globalThis, 'performance', {configurable: true, value: {now: () => calls++}});
  try { action(() => calls); }
  finally { Object.defineProperty(globalThis, 'performance', descriptor); }
}

test('explicit unlimited slices retain elapsed accounting without impossible periodic deadlines', () => {
  const vm = machine();
  try {
    withClock(calls => {
      vm.runSlice({instructionBudget: 1024, timeBudgetMs: Infinity});
      assert.equal(vm.instructions, 1024);
      assert.equal(vm.state, 'running');
      assert.equal(calls(), 2, 'only the fixed start and end clock reads remain');
      assert.equal(vm.elapsedMs, 1);
    });
  } finally { vm.stop(); }
});

test('finite deadlines still poll every256 instructions and stop at the first expired boundary', () => {
  const vm = machine();
  try {
    withClock(calls => {
      vm.runSlice({instructionBudget: 1024, timeBudgetMs: 1.5});
      assert.equal(vm.instructions, 256);
      assert.equal(vm.state, 'running');
      assert.equal(calls(), 4, 'start, first boundary, expired boundary, end');
      assert.equal(vm.elapsedMs, 3);
    });
  } finally { vm.stop(); }
});

test('other nonfinite and coercible budgets preserve their existing comparison semantics', () => {
  for (const [timeBudgetMs, instructions, clockCalls] of [[NaN, 512, 4], ['Infinity', 512, 4], [-Infinity, 0, 3]]) {
    const vm = machine();
    try {
      withClock(calls => {
        vm.runSlice({instructionBudget: 512, timeBudgetMs});
        assert.equal(vm.instructions, instructions);
        assert.equal(calls(), clockCalls);
      });
    } finally { vm.stop(); }
  }
});

test('unlimited time preserves debugger pauses, scheduler boundaries and instruction stress collection', () => {
  const vm = machine({gcStress: 'instruction'});
  let callbacks = 0;
  let scheduling = 0;
  const beforeInstruction = vm.scheduler.beforeInstruction;
  vm.scheduler.beforeInstruction = function() { scheduling++; return beforeInstruction.call(this); };
  try {
    const collections = vm.heap.stats.collections;
    vm.runSlice({instructionBudget: 512, timeBudgetMs: Infinity, onInstruction: () => ++callbacks === 258});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.instructions, 257);
    assert.equal(scheduling, 258);
    assert.equal(vm.heap.stats.collections - collections, 257);
    vm.stop();
    vm.runSlice({instructionBudget: 512, timeBudgetMs: Infinity});
    assert.equal(vm.instructions, 257, 'a stopped VM never enters another instruction');
  } finally { vm.stop(); }
});
