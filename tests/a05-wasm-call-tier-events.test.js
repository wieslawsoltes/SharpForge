import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {CilVirtualMachine, RuntimeEventName, wasmTieringStatistics, disposeWasmTiering} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function fixture() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4.2').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.3').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.4').op('call', context.methods.Twice).op('ret')},
    {name: 'Twice', result: 'int', parameters: ['int'], body: writer => writer
      .op('ldarg.0').op('ldc.i4.2').op('mul').op('ret')}
  ]});
}

function pauseAtCall(vm, count) {
  vm.state = 'running';
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: (_, frame) =>
    frame.method.name === 'Twice' && frame.pc === 0 &&
    wasmTieringStatistics(vm).methods.find(method => method.name.endsWith('::Twice'))?.calls === count});
  assert.equal(vm.state, 'paused');
}

async function ready(vm) {
  pauseAtCall(vm, 2);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const rows = wasmTieringStatistics(vm).methods;
    if (!rows.some(method => ['queued', 'compiling'].includes(method.status))) return;
    await delay(1);
  }
  assert.fail('Compilation did not settle');
}

const tierEvents = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.TierUp);

test('call TierUp records only the selected invocation and flushes before its first instruction', async () => {
  const vm = new CilVirtualMachine(fixture(), {wasmTiering: {callThreshold: 2}, runtimeEvents: true});
  const received = [];
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name !== RuntimeEventName.TierUp) return;
    assert.equal(vm.state, 'paused');
    assert.equal(vm.top.pc, 0);
    received.push(event);
  });
  try {
    await ready(vm);
    assert.deepEqual(tierEvents(vm), [], 'readiness does not tier up an already entered call');
    pauseAtCall(vm, 3);
    assert.equal(received.length, 1);
    const event = received[0];
    assert.deepEqual(event.payload, {kind: 'call', method: vm.top.method.token,
      frame: vm.top.id, epoch: wasmTieringStatistics(vm).epoch});
    assert.equal(event.instruction, vm.instructions);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 0);
    const entered = vm.runtimeEvents.read().find(entry => entry.name === RuntimeEventName.MethodEnter &&
      entry.payload.frame === event.payload.frame);
    assert(entered.sequence > event.sequence);
    assert(Object.isFrozen(event.payload));
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 4);
    assert.equal(tierEvents(vm).length, 1);
  } finally { unsubscribe(); vm.stop(); }
});

test('call TierUp subscriber failures stay outside guest faults and restore does not duplicate selection', async () => {
  const vm = new CilVirtualMachine(fixture(), {wasmTiering: {callThreshold: 2}, runtimeEvents: true});
  const failure = new Error('call selection observer');
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.TierUp) throw failure;
  });
  try {
    await ready(vm);
    assert.throws(() => pauseAtCall(vm, 3), error => error === failure);
    assert.equal(vm.fault, null);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.top.pc, 0);
    assert.deepEqual(vm.top.args, [4]);
    unsubscribe();
    const selectedCalls = wasmTieringStatistics(vm).selectedCalls;
    const snapshot = vm.snapshot();
    vm.restore(snapshot);
    assert.equal(tierEvents(vm).length, 1);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, selectedCalls, 'restore does not observe another call');
    assert.equal(wasmTieringStatistics(vm).compiledBytes, 0);
    assert.deepEqual(wasmTieringStatistics(vm).methods, []);
    disposeWasmTiering(vm);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(tierEvents(vm).length, 1);
  } finally { unsubscribe(); vm.stop(); }
});

test('call selection keeps events disabled when only Wasm tiering is enabled', async () => {
  const vm = new CilVirtualMachine(fixture(), {wasmTiering: {callThreshold: 2}});
  try {
    await ready(vm);
    pauseAtCall(vm, 3);
    assert.equal(vm.runtimeEvents, null);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 1);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
  } finally { vm.stop(); }
});

test('failed compilation emits no call TierUp even on later invocations', async t => {
  t.mock.method(WebAssembly, 'instantiate', async () => { throw new Error('unavailable backend'); });
  const vm = new CilVirtualMachine(fixture(), {wasmTiering: {callThreshold: 2}, runtimeEvents: true});
  try {
    await ready(vm);
    assert.equal(wasmTieringStatistics(vm).methods.find(method => method.name.endsWith('::Twice')).status, 'fallback');
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
    assert.deepEqual(tierEvents(vm), []);
  } finally { vm.stop(); }
});
