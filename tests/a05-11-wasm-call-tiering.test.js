import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering, invalidateExecutionCode,
  prepareWasmMethod, disposeWasmMethod, runWasmSlice, instructionProfile, framePoolStatistics} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function callsFixture() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4.2').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.3').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.4').op('call', context.methods.Twice).op('ret')},
    {name: 'Twice', result: 'int', parameters: ['int'], body: writer => writer
      .op('ldarg.0').op('ldc.i4.2').op('mul').op('ret')}
  ]});
}

const row = (vm, name) => wasmTieringStatistics(vm)?.methods.find(method => method.name.endsWith('::' + name));

async function settled(vm) {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const stats = wasmTieringStatistics(vm);
    if (!stats.activeCompilations && !stats.methods.some(method => ['queued', 'compiling'].includes(method.status))) return stats;
    await delay(1);
  }
  assert.fail('Bounded compilation queue did not settle');
}

function pauseAtCall(vm, name, calls) {
  vm.state = 'running';
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000, onInstruction: (_, frame) =>
    frame.method.name === name && frame.pc === 0 && row(vm, name)?.calls === calls});
  assert.equal(vm.state, 'paused');
}

test('only calls after readiness use Wasm; the current frame stays interpreted with exact accounting', async () => {
  const bytes = callsFixture(), baseline = new CilVirtualMachine(bytes, {profile: true});
  const vm = new CilVirtualMachine(bytes, {wasmTiering: {callThreshold: 2}, profile: true});
  const keys = Object.keys(vm), snapshotKeys = Object.keys(vm.snapshot());
  let multiplications = 0, steps = 0;
  const binary = vm.binary.bind(vm), step = vm.step.bind(vm);
  vm.binary = (...args) => { multiplications++; return binary(...args); };
  vm.step = () => { steps++; return step(); };
  try {
    pauseAtCall(vm, 'Twice', 2);
    assert.equal(multiplications, 1);
    assert.equal(row(vm, 'Twice').status, 'queued');
    await settled(vm);
    assert.equal(row(vm, 'Twice').status, 'ready');
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(baseline.run().returnValue, 8);
    assert.equal(multiplications, 2, 'the third call alone executes the multiply in actual Wasm');
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 1);
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, 4);
    assert.equal(steps, vm.instructions, 'ordinary slices retain the custom vm.step seam');
    assert.equal(vm.instructions, baseline.instructions);
    assert.deepEqual(instructionProfile(vm), instructionProfile(baseline));
    assert(framePoolStatistics(vm).reused >= 2);
    delete vm.binary;
    delete vm.step;
    assert.deepEqual(Object.keys(vm), keys);
    assert.deepEqual(Object.keys(vm.snapshot()), snapshotKeys);
  } finally { vm.stop(); baseline.stop(); }
});

test('disabled mode never compiles; method and call-counter storage is bounded', async t => {
  t.mock.method(WebAssembly, 'instantiate', () => { assert.fail('No compilation should be attempted'); });
  for (const option of [undefined, false]) {
    const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: option});
    try {
      assert.equal(vm.run().returnValue, 8);
      assert.equal(wasmTieringStatistics(vm), null);
      assert.equal(disposeWasmTiering(vm), false);
    } finally { vm.stop(); }
  }
  const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 2, maxMethods: 1}});
  try {
    assert.equal(vm.run().returnValue, 8);
    const stats = await settled(vm);
    assert.equal(stats.methods.length, 1);
    assert.equal(stats.overflowCalls, 3);
    assert.equal(stats.compilationAttempts, 0);
    assert(Object.isFrozen(stats) && Object.isFrozen(stats.methods) && Object.isFrozen(stats.methods[0]));
  } finally { vm.stop(); }
});

test('unsupported bodies and unavailable backends report a stable fallback without retrying every call', async t => {
  const unsupported = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', locals: ['int'],
    body: writer => writer.op('ldloca.s', 0).op('pop').op('ret')}]}), {wasmTiering: {callThreshold: 1}});
  try {
    await settled(unsupported);
    assert.equal(row(unsupported, 'Main').reason.code, 'WASM_OPCODE');
    assert.equal(unsupported.run().state, 'terminated');
    assert.equal(unsupported.fault, null);
  } finally { unsupported.stop(); }
  t.mock.method(WebAssembly, 'instantiate', async () => { throw new Error('platform declined compilation'); });
  const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 2}});
  try {
    pauseAtCall(vm, 'Twice', 2);
    await settled(vm);
    assert.equal(row(vm, 'Twice').reason.code, 'WASM_COMPILE');
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(wasmTieringStatistics(vm).compilationAttempts, 1);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
  } finally { vm.stop(); }
});

test('retained byte capacity rejects another ready candidate without changing guest output', async () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4.2').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.3').op('call', context.methods.Twice).op('pop')
      .op('ldc.i4.2').op('call', context.methods.Thrice).op('pop')
      .op('ldc.i4.3').op('call', context.methods.Thrice).op('ret')},
    ...[['Twice', 2], ['Thrice', 3]].map(([name, multiplier]) => ({name, result: 'int', parameters: ['int'],
      body: writer => writer.op('ldarg.0').op('ldc.i4.s', multiplier).op('mul').op('ret')}))
  ]});
  const probe = new CilVirtualMachine(bytes);
  const method = [...probe.inspector.methods.values()].find(item => item.name === 'Twice');
  const handle = await prepareWasmMethod(probe, probe.inspector.getMethod(method.token));
  const budget = handle.byteLength;
  disposeWasmMethod(handle);
  probe.stop();
  const vm = new CilVirtualMachine(bytes, {wasmTiering: {callThreshold: 2, maxCompiledBytes: budget}});
  try {
    pauseAtCall(vm, 'Twice', 2);
    await settled(vm);
    assert.equal(row(vm, 'Twice').status, 'ready');
    pauseAtCall(vm, 'Thrice', 2);
    await settled(vm);
    assert.equal(row(vm, 'Thrice').reason.code, 'WASM_CODE_BUDGET');
    assert.equal(wasmTieringStatistics(vm).compiledBytes, budget);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 9);
  } finally { vm.stop(); }
});

test('restore drops selections and never treats an already running restored frame as a new call', async () => {
  const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 2}});
  let multiplications = 0;
  const binary = vm.binary.bind(vm);
  vm.binary = (...args) => { multiplications++; return binary(...args); };
  try {
    pauseAtCall(vm, 'Twice', 2);
    await settled(vm);
    pauseAtCall(vm, 'Twice', 3);
    const observedBinary = vm.binary;
    delete vm.binary; // Test instrumentation is not part of the registered snapshot schema.
    const snapshot = vm.snapshot(), attempts = wasmTieringStatistics(vm).compilationAttempts;
    vm.restore(snapshot);
    vm.binary = observedBinary;
    assert.equal(wasmTieringStatistics(vm).compiledBytes, 0);
    assert.equal(wasmTieringStatistics(vm).methods.length, 0);
    const before = multiplications;
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 8);
    assert.equal(multiplications, before + 1);
    assert.equal(wasmTieringStatistics(vm).compilationAttempts, attempts);
  } finally { vm.stop(); }
});

test('canceled platform jobs retain their concurrency slot across a code generation change', async t => {
  const instantiate = WebAssembly.instantiate.bind(WebAssembly);
  const pending = [];
  t.mock.method(WebAssembly, 'instantiate', (...args) => new Promise((resolve, reject) => {
    pending.push(() => instantiate(...args).then(resolve, reject));
  }));
  const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 1, maxConcurrentCompilations: 1}});
  try {
    await Promise.resolve();
    assert.equal(pending.length, 1);
    invalidateExecutionCode(vm, 'test edit');
    vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
    assert.equal(vm.top.method.name, 'Twice');
    await Promise.resolve();
    assert.equal(pending.length, 1, 'the previous native job still owns the only slot');
    assert.equal(wasmTieringStatistics(vm).activeCompilations, 1);
    vm.stop();
    await pending[0]();
    const stats = await settled(vm);
    assert.equal(pending.length, 1);
    assert.equal(stats.methods.length, 0);
    assert.equal(stats.compiledBytes, 0);
    assert.equal(stats.selectedCalls, 0);
  } finally { vm.stop(); }
});

test('disposal cancels queued work before analysis and remains safe inside a compiled host callback', async () => {
  const cold = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 1}});
  assert.equal(disposeWasmTiering(cold), true);
  assert.equal(disposeWasmTiering(cold), false);
  assert.equal(cold.run().returnValue, 8);
  assert.equal(wasmTieringStatistics(cold).compilationAttempts, 0);
  cold.stop();
  const bytes = managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('call', context.methods.Write).op('call', context.methods.Write).op('ret')},
    {name: 'Write', body: (writer, context) => writer.op('ldc.i4.2').op('ldc.i4.3').op('mul')
      .op('call', context.member('System.Console', 'Write', 'void', ['int'])).op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes, {wasmTiering: {callThreshold: 1}});
  try {
    pauseAtCall(vm, 'Write', 1);
    await settled(vm);
    pauseAtCall(vm, 'Write', 2);
    vm.onOutput = () => { assert.equal(disposeWasmTiering(vm), true); };
    vm.state = 'running';
    assert.equal(vm.run().output, '66');
    assert.equal(vm.fault, null);
    assert.equal(wasmTieringStatistics(vm).compiledBytes, 0);
  } finally { vm.stop(); }
});

test('manual selection takes precedence over automatic selection and live quotas still apply', async () => {
  const vm = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 2}});
  const main = await prepareWasmMethod(vm);
  try {
    pauseAtCall(vm, 'Twice', 2);
    await settled(vm);
    pauseAtCall(vm, 'Twice', 3);
    const before = wasmTieringStatistics(vm).selectedInstructions;
    let multiplications = 0;
    const binary = vm.binary.bind(vm);
    vm.binary = (...args) => { multiplications++; return binary(...args); };
    vm.state = 'running';
    runWasmSlice(vm, main, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.returnValue, 8);
    assert.equal(multiplications, 1, 'manual selection of Main leaves the callee interpreted');
    assert.equal(wasmTieringStatistics(vm).selectedInstructions, before);
  } finally { disposeWasmMethod(main); vm.stop(); }
  const limited = new CilVirtualMachine(callsFixture(), {wasmTiering: {callThreshold: 2}});
  try {
    pauseAtCall(limited, 'Twice', 2);
    await settled(limited);
    pauseAtCall(limited, 'Twice', 3);
    limited.options.maxStackValues = 1;
    limited.state = 'running';
    assert.equal(limited.run().state, 'faulted');
    assert.equal(limited.fault.name, 'ExecutionLimitException');
  } finally { limited.stop(); }
});

test('invalid host tiering limits reject deliberately', () => {
  for (const option of [null, 1, {callThreshold: 0}, {callThreshold: 1.5}, {maxMethods: 1025},
    {maxConcurrentCompilations: 0}, {maxCompiledBytes: -1}, {maxBytes: Infinity}, {osrThreshold: 1}]) {
    assert.throws(() => new CilVirtualMachine(callsFixture(), {wasmTiering: option}), /wasm|Wasm/);
  }
});
