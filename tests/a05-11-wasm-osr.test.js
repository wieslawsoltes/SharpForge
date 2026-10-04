import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering, RuntimeEventName, invalidateExecutionCode,
  prepareWasmMethod, runWasmSlice, disposeWasmMethod} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const settings = extra => ({wasmTiering: {callThreshold: 10000, backedgeThreshold: 2, osr: true, ...extra}});
const loopFixture = () => managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
  .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
  .op('ldloc.0').op('ldc.i4.6').op('blt.s', 'loop').op('ldloc.0').op('ret')} ]});

async function readyAtSecondEdge(vm) {
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: () => wasmTieringStatistics(vm).methods[0]?.backedges === 2});
  assert.equal(vm.state, 'paused');
  for (let attempt = 0; attempt < 2000 && wasmTieringStatistics(vm).methods[0]?.status !== 'ready'; attempt++) await delay(1);
  assert.equal(wasmTieringStatistics(vm).methods[0].status, 'ready');
  assert.equal(wasmTieringStatistics(vm).osrTransitions, 0, 'readiness alone cannot select the paused frame');
}

function pauseAfterOsr(vm) {
  vm.state = 'running';
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: () => wasmTieringStatistics(vm).osrTransitions === 1});
  assert.equal(vm.state, 'paused');
}

test('OSR selects the same canonical frame at the next hot edge and preserves debugger/event boundaries', async () => {
  const bytes = loopFixture(), baseline = new CilVirtualMachine(bytes);
  const vm = new CilVirtualMachine(bytes, {...settings(), runtimeEvents: true});
  const frame = vm.top, frameKeys = Object.keys(frame), locals = frame.locals, stack = frame.stack;
  let additions = 0;
  const binary = vm.binary.bind(vm);
  vm.binary = (...args) => { additions++; return binary(...args); };
  const received = [];
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name !== RuntimeEventName.TierUp) return;
    assert.equal(vm.state, 'paused', 'observer runs only at the existing host flush boundary');
    received.push(event);
  });
  try {
    await readyAtSecondEdge(vm);
    pauseAfterOsr(vm);
    assert.equal(additions, 3);
    assert.equal(vm.top, frame);
    assert.equal(vm.top.locals, locals);
    assert.equal(vm.top.stack, stack);
    assert.deepEqual(Object.keys(vm.top), frameKeys);
    assert.deepEqual(vm.top.locals, [3]);
    assert.deepEqual(vm.top.stack, []);
    assert.equal(vm.top.pc, 2);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0].payload, {kind: 'osr', method: frame.method.token, frame: frame.id,
      fromOffset: frame.method.instructions[8].offset, toOffset: frame.method.instructions[2].offset,
      epoch: wasmTieringStatistics(vm).epoch});
    assert.equal(received[0].instruction, vm.instructions);
    vm.state = 'running';
    vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    assert.equal(vm.top.pc, 3, 'a debugger-visible step still executes exactly one CIL instruction');
    assert.deepEqual(vm.top.stack, [3]);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 1);
    assert.equal(vm.run().returnValue, baseline.run().returnValue);
    assert.equal(vm.instructions, baseline.instructions);
    assert.equal(additions, 3, 'the remaining arithmetic executes in actual Wasm');
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 1);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
  } finally { unsubscribe(); vm.stop(); baseline.stop(); }
});

test('a different cold edge cannot borrow the first loop hotness', async () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int', 'int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').mark('first').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4.3').op('blt.s', 'first')
    .op('ldc.i4.0').op('stloc.1').mark('second').op('ldloc.1').op('ldc.i4.1').op('add').op('stloc.1')
    .op('ldloc.1').op('ldc.i4.6').op('blt.s', 'second').op('ldloc.1').op('ret')} ]});
  const vm = new CilVirtualMachine(bytes, settings());
  try {
    await readyAtSecondEdge(vm);
    pauseAfterOsr(vm);
    assert.deepEqual(vm.top.locals, [3, 2]);
    assert.deepEqual(wasmTieringStatistics(vm).methods[0].backedgeSites.map(site => site.count), [2, 2]);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 6);
  } finally { vm.stop(); }
});

test('target entry depth rejects without consuming or replacing operands', async () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.5').op('ldc.i4.0').op('stloc.0').mark('loop').op('ldc.i4.1').op('add')
    .op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4.6').op('blt.s', 'loop').op('ret')} ]});
  const vm = new CilVirtualMachine(bytes, settings());
  try {
    await readyAtSecondEdge(vm);
    let removed;
    vm.state = 'running';
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: (instruction, frame) => {
      if (wasmTieringStatistics(vm).osrRejectedEntries) return true;
      if (instruction.name === 'blt.s' && frame.locals[0] === 3) removed = frame.stack.shift();
      return false;
    }});
    assert.equal(vm.state, 'paused');
    assert.equal(removed, 8);
    assert.deepEqual(vm.top.stack, []);
    assert.equal(vm.top.pc, 3);
    assert.equal(wasmTieringStatistics(vm).osrRejectedEntries, 1);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 0);
    vm.top.stack.push(removed);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 11);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 1);
  } finally { vm.stop(); }
});

test('manual dispatch suppresses automatic OSR until ordinary execution takes another hot edge', async () => {
  const vm = new CilVirtualMachine(loopFixture(), settings());
  const handle = await prepareWasmMethod(vm);
  try {
    await readyAtSecondEdge(vm);
    vm.state = 'running';
    runWasmSlice(vm, handle, {instructionBudget: 7, timeBudgetMs: 1000});
    assert.deepEqual(vm.top.locals, [3]);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 0);
    vm.runSlice({instructionBudget: 7, timeBudgetMs: 1000});
    assert.deepEqual(vm.top.locals, [4]);
    assert.equal(wasmTieringStatistics(vm).osrTransitions, 1);
    assert.equal(vm.run().returnValue, 6);
  } finally { disposeWasmMethod(handle); vm.stop(); }
});

test('restore cancels OSR membership; host stack quotas still run before a selected target executes', async () => {
  const vm = new CilVirtualMachine(loopFixture(), settings());
  try {
    await readyAtSecondEdge(vm);
    pauseAfterOsr(vm);
    const snapshot = vm.snapshot(), pc = vm.top.pc;
    vm.restore(snapshot);
    assert.equal(vm.top.pc, pc);
    assert.equal(wasmTieringStatistics(vm).compiledBytes, 0);
    assert.equal(wasmTieringStatistics(vm).methods.length, 0);
    disposeWasmTiering(vm);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 6);
  } finally { vm.stop(); }
  const limited = new CilVirtualMachine(loopFixture(), settings());
  try {
    await readyAtSecondEdge(limited);
    pauseAfterOsr(limited);
    const pc = limited.top.pc;
    limited.options.maxStackValues = 1;
    limited.state = 'running';
    assert.equal(limited.run().state, 'faulted');
    assert.equal(limited.fault.name, 'ExecutionLimitException');
    assert.equal(limited.fault.frames[0].ilOffset, limited.inspector.getMethod(limited.report.entryPoint).instructions[8].offset);
    assert.equal(wasmTieringStatistics(limited).selectedInstructions, 0);
    assert.equal(pc, 2);
  } finally { limited.stop(); }
});

test('a target callback invalidates a selection before any compiled operand is consumed', async () => {
  const vm = new CilVirtualMachine(loopFixture(), settings());
  try {
    await readyAtSecondEdge(vm);
    vm.state = 'running';
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: () => {
      if (wasmTieringStatistics(vm).osrTransitions !== 1) return false;
      invalidateExecutionCode(vm, 'debugger edit');
      return true;
    }});
    assert.equal(vm.state, 'paused');
    assert.deepEqual(vm.top.locals, [3]);
    assert.deepEqual(vm.top.stack, []);
    assert.equal(vm.top.pc, 2);
    assert.equal(wasmTieringStatistics(vm).compiledBytes, 0);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    disposeWasmTiering(vm);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 6);
  } finally { vm.stop(); }
});

test('deferred TierUp subscriber failures remain host failures after the boundary transition', async () => {
  const vm = new CilVirtualMachine(loopFixture(), {...settings(), runtimeEvents: true});
  const error = new Error('OSR host observer');
  const unsubscribe = vm.runtimeEvents.subscribe(event => { if (event.name === RuntimeEventName.TierUp) throw error; });
  try {
    await readyAtSecondEdge(vm);
    assert.throws(() => pauseAfterOsr(vm), failure => failure === error);
    assert.equal(vm.fault, null);
    assert.equal(vm.top.pc, 2);
    assert.deepEqual(vm.top.locals, [3]);
    unsubscribe();
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 6);
  } finally { unsubscribe(); vm.stop(); }
});

test('OSR defaults off and accepts only a boolean option', async () => {
  for (const osr of [undefined, false]) {
    const vm = new CilVirtualMachine(loopFixture(), settings({osr}));
    try {
      await readyAtSecondEdge(vm);
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 6);
      assert.equal(wasmTieringStatistics(vm).osrTransitions, 0);
      assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    } finally { vm.stop(); }
  }
  for (const osr of [null, 0, 1, 'true', {}]) {
    assert.throws(() => new CilVirtualMachine(loopFixture(), settings({osr})), /osr must be a boolean/);
  }
});
