import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareWasmTier, wasmTierStatistics, deoptWasmTier,
  disposeWasmTier, wasmSafepoint, invalidateExecutionCode} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function loopFixture(limit = 100) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .op('ldloc.0').op('ldc.i4', limit).op('blt.s', 'loop').op('ldloc.0').op('ret')}]});
}

test('T11.3 opt-in prewarming selects native method entry without executing CIL', async () => {
  const bytes = loopFixture();
  const baseline = new CilVirtualMachine(bytes);
  assert.equal((await prepareWasmTier(baseline)).status, 'disabled');
  const vm = new CilVirtualMachine(bytes, {wasmTiering: true});
  const prepared = await prepareWasmTier(vm);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  assert.equal(vm.instructions, 0);
  assert.equal(vm.run().returnValue, baseline.run().returnValue);
  assert.equal(vm.instructions, baseline.instructions);
  const stats = wasmTierStatistics(vm);
  assert.equal(stats.entryTransitions, 1);
  assert.ok(stats.nativeInstructions > 100);
  assert.ok(stats.bridgeInstructions > 100);
});

test('T11.3 a currently executing long loop enters Wasm at a backward target', async () => {
  const vm = new CilVirtualMachine(loopFixture(), {wasmTiering: {callThreshold: 100, backedgeThreshold: 2}});
  vm.runSlice({instructionBudget: 20, timeBudgetMs: 1000});
  const id = vm.top.id;
  assert.ok(vm.top.pc > 0);
  assert.equal(wasmTierStatistics(vm).methods[0].status, 'compiling');
  assert.equal((await prepareWasmTier(vm)).status, 'ready');
  vm.runSlice({instructionBudget: 20, timeBudgetMs: 1000});
  assert.equal(vm.top.id, id);
  assert.ok(wasmTierStatistics(vm).osrTransitions >= 1);
  assert.equal(wasmTierStatistics(vm).entryTransitions, 0);
  assert.equal(vm.run().returnValue, 100);
});

test('T11.4 debugger boundaries expose exact locals and snapshot replay', async () => {
  const bytes = loopFixture(10);
  const vm = new CilVirtualMachine(bytes, {wasmTiering: true, typedNumericStack: true});
  await prepareWasmTier(vm);
  const breakpoint = (instruction, frame) => instruction.name === 'ldloc.0' && frame.locals[0] === 3;
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: breakpoint});
  assert.equal(vm.state, 'paused');
  const point = wasmSafepoint(vm);
  assert.deepEqual(point.locals, [3]);
  assert.deepEqual(point.stack, []);
  assert.equal(point.pc, 6);
  const snapshot = vm.snapshot();
  deoptWasmTier(vm, 'debugger');
  assert.deepEqual(wasmSafepoint(vm), point);
  vm.state = 'running';
  const first = vm.run();
  vm.restore(snapshot);
  vm.state = 'running';
  const second = vm.run();
  assert.equal(first.returnValue, 10);
  assert.equal(second.returnValue, first.returnValue);
  assert.equal(second.stats.instructions, first.stats.instructions);
});

test('T11.4 instruction budgets and arithmetic faults match interpreter frames', async () => {
  for (const bytes of [loopFixture(), managedFixture({methods: [{name: 'Main', result: 'int', body: writer =>
    writer.op('ldc.i4.1').op('ldc.i4.0').op('div').op('ret')} ]})]) {
    const baseline = new CilVirtualMachine(bytes, {maxInstructions: 19});
    const vm = new CilVirtualMachine(bytes, {maxInstructions: 19, wasmTiering: true});
    await prepareWasmTier(vm);
    const expected = baseline.run();
    const actual = vm.run();
    assert.equal(actual.state, expected.state);
    assert.equal(actual.fault.name, expected.fault.name);
    assert.equal(actual.fault.message, expected.fault.message);
    assert.deepEqual(actual.fault.frames, expected.fault.frames);
    assert.equal(vm.instructions, baseline.instructions);
  }
});

test('T11.3 disposal and code epochs cancel pending publication', async () => {
  const vm = new CilVirtualMachine(loopFixture(), {wasmTiering: true});
  const pending = prepareWasmTier(vm);
  disposeWasmTier(vm);
  assert.equal((await pending).status, 'fallback');
  assert.equal(wasmTierStatistics(vm).enabled, false);
  invalidateExecutionCode(vm, 'edit');
  assert.equal((await prepareWasmTier(vm)).status, 'ready');
  const epoch = wasmTierStatistics(vm).epoch;
  vm.stop();
  assert.ok(wasmTierStatistics(vm).epoch > epoch);
  assert.equal(wasmTierStatistics(vm).nativeInstructions, 0);
});

test('T11.3 unsupported byrefs use explicit interpreter fallback', async () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer =>
    writer.op('ldloca.s', 0).op('pop').op('ldc.i4.7').op('ret')}]}), {wasmTiering: true});
  const prepared = await prepareWasmTier(vm);
  assert.equal(prepared.status, 'fallback');
  assert.equal(prepared.reason.code, 'WASM_OPCODE');
  assert.equal(vm.run().returnValue, 7);
  assert.equal(wasmTierStatistics(vm).nativeInstructions, 0);
});
