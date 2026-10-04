import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function fixture({type = 'int', value = 9, constant = 'ldc.i4', argument = false} = {}) {
  return managedFixture({methods: [{name: 'Main', result: type,
    ...(argument ? {parameters: [type]} : {locals: [type]}), body(writer) {
      writer.op(constant, value);
      if (argument) writer.op('starg.s', 0).op('ldarg.0');
      else writer.op('stloc.0').op('ldloc.0');
      writer.op('ret');
    }}]});
}

for (const argument of [false, true]) for (const [type, value, expected, constant] of [
  ['int', -2147483648, -2147483648, 'ldc.i4'], ['uint', -1, 4294967295, 'ldc.i4'],
  ['byte', 255, 255, 'ldc.i4'], ['byte', 511, 255, 'ldc.i4'], ['sbyte', 255, -1, 'ldc.i4'],
  ['long', -(1n << 63n), -(1n << 63n), 'ldc.i8'], ['ulong', -1n, (1n << 64n) - 1n, 'ldc.i8'],
  ['float', 16777217, 16777216, 'ldc.r8']
]) {
  test(`scalar ${argument ? 'argument' : 'local'} store ${type} ${value} preserves normalization`, () => {
    const bytes = fixture({type, value, constant, argument}), results = [];
    for (const scalarSlotLoads of [false, true]) {
      const vm = new CilVirtualMachine(bytes, {scalarSlotLoads, typedNumericStack: false, arguments: argument ? [0] : []});
      try {
        vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
        const stored = (argument ? vm.top.args : vm.top.locals)[0], revision = vm.writeRevision;
        const result = vm.run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        results.push({stored, revision, value: result.returnValue, instructions: vm.instructions});
      } finally { vm.stop(); }
    }
    assert.deepEqual(results[1], results[0]);
    assert.equal(results[1].value, expected);
  });
}

test('scalar store observers receive the same old/new values, revision and frame identity', () => {
  const results = [];
  for (const scalarSlotLoads of [false, true]) {
    const vm = new CilVirtualMachine(fixture(), {scalarSlotLoads}), writes = [];
    vm.onWrite = change => writes.push({...change, revision: vm.writeRevision});
    try { results.push({result: vm.run().returnValue, writes}); }
    finally { vm.stop(); }
  }
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[1].writes, [{kind: 'local', index: 0, frameId: 1, oldValue: 0, value: 9, revision: 1}]);
});

for (const edit of ['local-accessor', 'stack-accessor', 'stack-pop', 'stack-pop-accessor', 'missing-slot', 'readonly-slot']) {
  test(`host ${edit} edits retain the scalar store's generic behavior`, () => {
    const observations = [];
    for (const scalarSlotLoads of [false, true]) {
      const vm = new CilVirtualMachine(fixture(), {scalarSlotLoads}), operations = [];
      try {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
        const frame = vm.top;
        if (edit === 'local-accessor') {
          let value = 0;
          Object.defineProperty(frame.locals, 0, {configurable: true, enumerable: true,
            get() { operations.push('get'); return value; }, set(input) { operations.push('set:' + input); value = input; }});
        } else if (edit === 'stack-accessor') {
          Object.defineProperty(frame.stack, 0, {configurable: true, enumerable: true,
            get() { operations.push('stack-get'); return 9; }});
        } else if (edit === 'stack-pop') {
          frame.stack.pop = function() { operations.push('stack-pop'); Array.prototype.pop.call(this); return 7; };
        } else if (edit === 'stack-pop-accessor') {
          Object.defineProperty(frame.stack, 'pop', {configurable: true, get() {
            operations.push('pop-get'); return Array.prototype.pop;
          }});
        } else if (edit === 'missing-slot') frame.locals.length = 0;
        else Object.defineProperty(frame.locals, 0, {value: 0, configurable: true, writable: false});
        const result = vm.run();
        observations.push({operations: [...operations], state: result.state, value: result.returnValue,
          fault: result.fault && {name: result.fault.name, message: result.fault.message}, revision: vm.writeRevision});
        // Return/stop must be able to scrub deliberately non-writable host fixtures.
        if (edit === 'readonly-slot') Object.defineProperty(frame.locals, 0, {value: 0, configurable: true, writable: true});
      } finally { vm.stop(); }
    }
    assert.deepEqual(observations[1], observations[0]);
  });
}

test('scalar stores keep instance, subclass and preconstruction prototype adapter hooks', () => {
  const original = CilVirtualMachine.prototype.storage;
  class CustomVM extends CilVirtualMachine {
    storage(value, type) { return super.storage(value, type) + 1; }
  }
  for (const kind of ['instance', 'subclass', 'prototype']) {
    let vm;
    try {
      if (kind === 'prototype') CilVirtualMachine.prototype.storage = function(value, type) {
        return original.call(this, value, type) + 1;
      };
      vm = kind === 'subclass' ? new CustomVM(fixture()) : new CilVirtualMachine(fixture());
      if (kind === 'instance') vm.storage = function(value, type) { return original.call(this, value, type) + 1; };
      vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
      assert.equal(vm.top.locals[0], 10, kind);
      assert.equal(vm.writeRevision, 1);
    } finally { CilVirtualMachine.prototype.storage = original; vm?.stop(); }
  }
});

test('scalar stores recheck edited declared types before skipping normalization', () => {
  const vm = new CilVirtualMachine(fixture({value: 255}));
  try {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    vm.top.method.locals[0] = 'sbyte';
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.equal(vm.top.locals[0], -1);
    assert.equal(vm.run().returnValue, -1);
  } finally { vm.stop(); }
});

test('scalar store snapshot replay and pooled calls preserve stored state', () => {
  const vm = new CilVirtualMachine(fixture({value: 255})), entry = vm.top.method.token;
  try {
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    const saved = vm.snapshot();
    assert.equal(vm.top.locals[0], 255);
    assert.equal(vm.run().returnValue, 255);
    vm.restore(saved);
    assert.equal(vm.run().returnValue, 255);
    vm.state = 'running';
    vm.call(entry, []);
    assert.equal(vm.run().returnValue, 255);
  } finally { vm.stop(); }
});
