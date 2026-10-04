import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {executionCodeStatistics} from '../packages/runtime/src/execution/code-version.js';
import {floatSlots} from '../packages/runtime/src/execution/typed-stack.js';

function loop(type = 'int', limit = 1000) {
  const constant = (writer, value) => type === 'long' ? writer.op('ldc.i8', BigInt(value)) : writer.integer(value);
  return managedFixture({methods: [{name: 'Main', result: type, maxStack: 2, locals: [type, 'int'], body(writer) {
    constant(writer, 0).op('stloc.0').integer(0).op('stloc.1').mark('loop');
    writer.op('ldloc.0');
    constant(writer, 3).op('add').op('stloc.0');
    writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
    writer.op('ldloc.1').integer(limit).op('blt', 'loop').op('ldloc.0').op('ret');
  }}]});
}

function state(vm) {
  return {state: vm.state, instructions: vm.instructions, output: vm.output.join(''), returnValue: vm.returnValue,
    fault: vm.fault?.name ?? null, pc: vm.top?.pc, lastOffset: vm.top?.lastOffset,
    stack: vm.top ? [...vm.top.stack] : null, locals: vm.top ? [...vm.top.locals] : null};
}

for (const [type, option] of [['int', 'specializeNumericHandlers'], ['long', 'smallLongs']]) {
  test(`${option} numeric blocks preserve complete instruction accounting and return categories`, () => {
    const bytes = loop(type), baseline = new CilVirtualMachine(bytes), candidate = new CilVirtualMachine(bytes, {[option]: true});
    try {
      baseline.run();
      candidate.run();
      assert.deepEqual(state(candidate), state(baseline));
      assert.equal(candidate.returnValue, type === 'long' ? 3000n : 3000);
      assert.ok(executionCodeStatistics(candidate).numericBlockInstructions > 10000);
      assert.equal(executionCodeStatistics(baseline).numericBlockInstructions ?? 0, 0);
    } finally { baseline.stop(); candidate.stop(); }
  });

  test(`${option} every slice and global quota boundary retains original PCs and stack values`, () => {
    const bytes = loop(type, 20);
    for (const budget of [1, 2, 3, 7, 13, 63, 255, 256, 257]) {
      const baseline = new CilVirtualMachine(bytes), candidate = new CilVirtualMachine(bytes, {[option]: true});
      try {
        while (baseline.state === 'ready' || baseline.state === 'running') {
          baseline.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
          candidate.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
          assert.deepEqual(state(candidate), state(baseline), 'slice ' + budget);
        }
      } finally { baseline.stop(); candidate.stop(); }
    }
    for (const maximum of [1, 2, 5, 12, 13, 62, 64, 65]) {
      const baseline = new CilVirtualMachine(bytes);
      const candidate = new CilVirtualMachine(bytes, {[option]: true});
      try {
        // Verification shares the admission limit; change only the execution quota after admission.
        baseline.options.maxInstructions = candidate.options.maxInstructions = maximum;
        baseline.run(); candidate.run();
        assert.deepEqual(state(candidate), state(baseline), 'global quota ' + maximum);
      } finally { baseline.stop(); candidate.stop(); }
    }
  });
}

test('numeric block arithmetic faults consume operands and retain the original fault offset', () => {
  for (const [left, right, name] of [[7, 0, 'div'], [-2147483648, -1, 'rem'], [2147483647, 1, 'add.ovf']]) {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 2,
      body: writer => writer.integer(left).integer(right).op(name).op('ret')}]});
    const baseline = new CilVirtualMachine(bytes), candidate = new CilVirtualMachine(bytes, {specializeNumericHandlers: true});
    try {
      baseline.run(); candidate.run();
      assert.equal(candidate.state, 'faulted');
      assert.deepEqual(state(candidate), state(baseline));
    } finally { baseline.stop(); candidate.stop(); }
  }
});

test('unsafe small-long results preserve exact operands for BigInt fallback', () => {
  for (const initial of [BigInt(Number.MAX_SAFE_INTEGER), 1n << 62n]) {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2,
      body: writer => writer.op('ldc.i8', initial).op('ldc.i8', 2n).op('add').op('ret')}]});
    const vm = new CilVirtualMachine(bytes, {smallLongs: true});
    try {
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.returnValue, initial + 2n);
    } finally { vm.stop(); }
  }
});

test('debugger, scheduler hooks, write observers and instruction GC stress retain one-instruction dispatch', () => {
  for (const mode of ['debugger', 'scheduler', 'write', 'gcStress', 'step']) {
    const vm = new CilVirtualMachine(loop('int', 20), {specializeNumericHandlers: true,
      ...(mode === 'gcStress' ? {gcStress: 'instruction'} : {})});
    let observed = 0;
    try {
      if (mode === 'scheduler') vm.scheduler.afterInstruction = () => { observed++; };
      if (mode === 'write') vm.onWrite = () => { observed++; };
      if (mode === 'step') {
        const step = vm.step.bind(vm);
        vm.step = () => { observed++; step(); };
      }
      vm.runSlice({instructionBudget: 10000, timeBudgetMs: Infinity,
        onInstruction: mode === 'debugger' ? () => { observed++; return false; } : null});
      assert.equal(vm.state, 'terminated', vm.fault?.message);
      assert.equal(vm.returnValue, 60);
      assert.equal(executionCodeStatistics(vm).numericBlockInstructions ?? 0, 0, mode);
      if (mode !== 'gcStress') assert.ok(observed > 0, mode);
      if (['debugger', 'scheduler', 'step'].includes(mode)) assert.equal(observed, vm.instructions);
    } finally { vm.stop(); }
  }
});

test('host customized slot descriptors disable private numeric access', () => {
  const vm = new CilVirtualMachine(loop('long', 10), {smallLongs: true});
  try {
    Object.defineProperty(vm.top.locals, '3', {value: 9, enumerable: false, configurable: true});
    assert.equal(floatSlots(vm.top.locals), null);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 30n);
    assert.equal(executionCodeStatistics(vm).numericBlockInstructions ?? 0, 0);
  } finally { vm.stop(); }
});

test('host-written negative zero keeps Int32 storage normalization at numeric block boundaries', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 1, locals: ['int', 'int'],
    body: writer => writer.op('ldloc.0').op('stloc.1').op('ldloc.1').op('ret')}]});
  const baseline = new CilVirtualMachine(bytes), candidate = new CilVirtualMachine(bytes, {specializeNumericHandlers: true});
  try {
    baseline.top.locals[0] = candidate.top.locals[0] = -0;
    baseline.runSlice({instructionBudget: 2, timeBudgetMs: Infinity});
    candidate.runSlice({instructionBudget: 2, timeBudgetMs: Infinity});
    assert.deepEqual(state(candidate), state(baseline));
    assert.equal(Object.is(candidate.top.locals[1], -0), false);
    baseline.run(); candidate.run();
    assert.deepEqual(state(candidate), state(baseline));
  } finally { baseline.stop(); candidate.stop(); }
});

test('numeric block restore reacquires the current private planes and option changes retain exact carriers', () => {
  const vm = new CilVirtualMachine(loop('long', 30), {smallLongs: true});
  try {
    vm.runSlice({instructionBudget: 100, timeBudgetMs: Infinity});
    const saved = vm.snapshot(), before = state(vm);
    const originalLocals = vm.top.locals;
    vm.run();
    assert.equal(vm.returnValue, 90n);
    vm.restore(saved);
    assert.notEqual(vm.top.locals, originalLocals);
    assert.deepEqual(state(vm), before);
    vm.options.smallLongs = false;
    vm.run();
    assert.equal(vm.returnValue, 90n);
    assert.equal(typeof vm.returnValue, 'bigint');
  } finally { vm.stop(); }
});
