import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {CilVirtualMachine, wasmTieringStatistics, disposeWasmTiering, invalidateExecutionCode,
  prepareWasmMethod, runWasmSlice, disposeWasmMethod, ManagedFault} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const options = extra => ({wasmTiering: {callThreshold: 10000, backedgeThreshold: 10000, ...extra}});
const row = (vm, name = 'Main') => wasmTieringStatistics(vm).methods.find(method => method.name.endsWith('::' + name));

function loop(writer) {
  return writer.op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1')
    .op('add').op('stloc.0').op('ldloc.0').op('ldc.i4.5').op('blt.s', 'loop').op('ldloc.0').op('ret');
}

const loopFixture = () => managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: loop}]});

test('a taken back-edge threshold prepares the loop and selects only its next invocation', async () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('call', context.methods.Loop).op('pop').op('call', context.methods.Loop).op('ret')},
    {name: 'Loop', result: 'int', locals: ['int'], body: loop}
  ]});
  const vm = new CilVirtualMachine(bytes, options({backedgeThreshold: 3}));
  const baseline = new CilVirtualMachine(bytes);
  let additions = 0;
  const binary = vm.binary.bind(vm);
  vm.binary = (...args) => { additions++; return binary(...args); };
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: () => row(vm, 'Loop')?.hottestBackedge === 3});
    assert.equal(vm.state, 'paused');
    assert.equal(additions, 3);
    assert.equal(row(vm, 'Loop').status, 'queued');
    for (let attempt = 0; attempt < 2000 && row(vm, 'Loop').status !== 'ready'; attempt++) await delay(1);
    assert.equal(row(vm, 'Loop').status, 'ready');
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, baseline.run().returnValue);
    assert.equal(vm.returnValue, 5);
    assert.equal(additions, 5, 'readiness does not upgrade the first invocation');
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 1);
    const stats = row(vm, 'Loop');
    assert.equal(stats.calls, 2);
    assert.equal(stats.backedges, 8, 'each invocation takes four backward branches');
    assert.equal(stats.hottestBackedge, 8);
    assert.equal(stats.backedgeSites.length, 1);
    assert.equal(stats.backedgeSites[0].count, 8);
    assert.equal(vm.instructions, baseline.instructions);
  } finally { vm.stop(); baseline.stop(); }
});

test('a self-edge counts, fall-through does not, and instruction-limit faults add no phantom transfer', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main',
    body: writer => writer.mark('again').op('br.s', 'again')}]}), {...options(), maxInstructions: 3});
  try {
    assert.equal(vm.run().state, 'faulted');
    assert.equal(vm.fault.name, 'InstructionLimitException');
    const stats = row(vm);
    assert.equal(stats.backedges, 3);
    assert.deepEqual(stats.backedgeSites, [{fromOffset: 0, toOffset: 0, count: 3}]);
    assert.equal(stats.status, 'cold');
  } finally { vm.stop(); }
});

test('switch source/target pairs have distinct bounded counters and explicit overflow', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('ldc.i4.0').op('stloc.0').op('br.s', 'dispatch')
    .mark('zero').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0').op('br.s', 'dispatch')
    .mark('one').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0').op('br.s', 'dispatch')
    .mark('dispatch').op('ldloc.0').op('switch', ['zero', 'one']).op('ldloc.0').op('ret')} ]});
  for (const capacity of [1, 2]) {
    const vm = new CilVirtualMachine(bytes, options({maxBackedgesPerMethod: capacity, backedgeThreshold: 2}));
    try {
      assert.equal(vm.run().returnValue, 2);
      const stats = row(vm);
      assert.equal(stats.backedges, 2);
      assert.equal(stats.backedgeOverflow, 2 - capacity);
      assert.equal(stats.backedgeSites.length, capacity);
      assert.equal(stats.hottestBackedge, 1);
      assert.equal(stats.status, 'cold', 'different sites do not add into one hot-loop threshold');
      assert(stats.backedgeSites.every(site => site.fromOffset > site.toOffset && site.count === 1));
      assert(Object.isFrozen(stats.backedgeSites) && Object.isFrozen(stats.backedgeSites[0]));
      if (capacity === 2) assert(stats.backedgeSites[0].toOffset < stats.backedgeSites[1].toOffset);
    } finally { vm.stop(); }
  }
});

test('bounded proof admission refuses replaced bodies, copied reports, and excessive metadata work', () => {
  for (const [change, reason, configuration] of [
    [vm => { vm.top.method.instructions = [...vm.top.method.instructions]; }, 'WASM_UNVERIFIED', {}],
    [vm => { vm.report = {...vm.report}; }, 'WASM_UNVERIFIED', {}],
    [() => {}, 'WASM_SIZE', {maxMethodInstructions: 4}],
    [() => {}, 'WASM_ANALYSIS_LIMIT', {maxAnalysisSlots: 1}]
  ]) {
    const vm = new CilVirtualMachine(loopFixture(), options(configuration));
    try {
      change(vm);
      assert.equal(vm.run().returnValue, 5);
      const stats = row(vm);
      assert.equal(stats.backedgeReason, reason);
      assert.equal(stats.backedges, 0);
      assert.equal(stats.backedgeSites.length, 0);
      assert.equal(wasmTieringStatistics(vm).compilationAttempts, 0);
    } finally { vm.stop(); }
  }
});

test('restore starts fresh loop counters without inventing a method call or selecting its live frame', () => {
  const vm = new CilVirtualMachine(loopFixture(), options());
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: () => row(vm)?.backedges === 2});
    assert.equal(vm.state, 'paused');
    const snapshot = vm.snapshot();
    vm.restore(snapshot);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 5);
    const stats = row(vm);
    assert.equal(stats.calls, 0);
    assert.equal(stats.backedges, 2);
    assert.equal(wasmTieringStatistics(vm).selectedCalls, 0);
    invalidateExecutionCode(vm, 'test edit');
    assert.equal(wasmTieringStatistics(vm).methods.length, 0);
  } finally { vm.stop(); }
});

test('manual dispatch uses the same successful-transfer observation and failed handlers are excluded', async () => {
  const vm = new CilVirtualMachine(loopFixture(), options());
  const handle = await prepareWasmMethod(vm);
  try {
    runWasmSlice(vm, handle, {instructionBudget: 1000, timeBudgetMs: 1000});
    assert.equal(vm.returnValue, 5);
    assert.equal(row(vm).backedges, 4);
  } finally { disposeWasmMethod(handle); vm.stop(); }
  const failing = new CilVirtualMachine(loopFixture(), options());
  failing.compare = () => { throw new ManagedFault('ArithmeticException', 'branch comparison failed'); };
  try {
    assert.equal(failing.run().state, 'faulted');
    assert.equal(failing.fault.name, 'ArithmeticException');
    assert.equal(row(failing).backedges, 0);
  } finally { failing.stop(); }
});

test('canceling queued loop preparation disables counter mutation and does not publish code', async () => {
  const vm = new CilVirtualMachine(loopFixture(), options({backedgeThreshold: 1}));
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
      onInstruction: () => row(vm)?.backedges === 1});
    assert.equal(row(vm).status, 'queued');
    assert.equal(disposeWasmTiering(vm), true);
    await Promise.resolve();
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 5);
    const stats = wasmTieringStatistics(vm);
    assert.equal(stats.compilationAttempts, 0);
    assert.equal(stats.methods.length, 0);
    assert.equal(stats.compiledBytes, 0);
  } finally { vm.stop(); }
});

test('invalid loop counter limits reject and explicit disabled tiering remains uninstrumented', () => {
  for (const limits of [{backedgeThreshold: 0}, {backedgeThreshold: 1.5},
    {maxBackedgesPerMethod: 0}, {maxBackedgesPerMethod: 1025}]) {
    assert.throws(() => new CilVirtualMachine(loopFixture(), options(limits)), /Invalid Wasm tiering/);
  }
  const vm = new CilVirtualMachine(loopFixture(), {wasmTiering: false});
  try {
    assert.equal(vm.run().returnValue, 5);
    assert.equal(wasmTieringStatistics(vm), null);
  } finally { vm.stop(); }
});
