import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, wasmTierStatistics, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function loopFixture(limit, output = false) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body(writer, context) {
    writer.op('ldc.i4.0').op('stloc.0').mark('loop').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
      .op('ldloc.0').op('ldc.i4', limit).op('blt.s', 'loop').op('ldloc.0');
    if (output) writer.op('dup').op('call', context.member('System.Console', 'WriteLine', 'void', ['int']));
    writer.op('ret');
  }}]});
}

function twoLoops(limit = 4, second = limit) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int', 'int'], body(writer) {
    for (const slot of [0, 1]) {
      writer.op('ldc.i4.0').op('stloc.s', slot).mark('loop' + slot)
        .op('ldloc.s', slot).op('ldc.i4.1').op('add').op('stloc.s', slot)
        .op('ldloc.s', slot).op('ldc.i4', slot ? second : limit).op('blt.s', 'loop' + slot);
    }
    writer.op('ldloc.0').op('ldloc.1').op('add').op('ret');
  }}]});
}

function create(bytes, options = {}) {
  return new CilVirtualMachine(bytes, {wasmTiering: {callThreshold: 100, backedgeThreshold: 4, ...options}});
}

test('T11.3 unrelated loops retain separate counters and do not pool their threshold', () => {
  const vm = create(twoLoops());
  try {
    assert.equal(vm.run().returnValue, 8);
    const [method] = wasmTierStatistics(vm).methods;
    assert.equal(method.status, 'cold');
    assert.equal(method.backedges, 6);
    assert.equal(method.backedgeOverflow, 0);
    assert.deepEqual(method.backedgeSites.map(site => site.count), [3, 3]);
    assert(method.backedgeSites.every(site => site.fromOffset > site.toOffset));
    assert(method.backedgeSites[0].fromOffset < method.backedgeSites[1].fromOffset);
    assert(Object.isFrozen(method.backedgeSites));
    assert(Object.isFrozen(method.backedgeSites[0]));
    assert.throws(() => { method.backedgeSites[0].count = 0; }, TypeError);
    assert.equal(wasmTierStatistics(vm).methods[0].backedges, 6);
  } finally { vm.stop(); }
});

test('T11.3 one taken edge queues compilation exactly at its configured threshold', () => {
  const vm = create(loopFixture(10), {backedgeThreshold: 2});
  try {
    vm.runSlice({instructionBudget: 100, timeBudgetMs: 1000,
      onInstruction: (_instruction, frame) => frame.pc === 2 && frame.locals[0] === 2});
    const statistics = wasmTierStatistics(vm), [method] = statistics.methods;
    assert.equal(vm.state, 'paused');
    assert.equal(method.status, 'compiling');
    assert.equal(statistics.pending, 1);
    assert.equal(method.backedges, 2);
    assert.deepEqual(method.backedgeSites.map(site => site.count), [2]);
    assert.equal(statistics.osrTransitions, 0);
    assert.equal(statistics.nativeInstructions, 0);
  } finally { vm.stop(); }
});

test('T11.3 a switch keeps distinct backward destinations at the same instruction', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'], body: writer => writer
    .op('br.s', 'dispatch')
    .mark('even').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0').op('br.s', 'dispatch')
    .mark('odd').op('ldloc.0').op('ldc.i4.1').op('add').op('stloc.0')
    .mark('dispatch').op('ldloc.0').op('ldc.i4.6').op('bge.s', 'end')
    .op('ldloc.0').op('ldc.i4.2').op('rem').op('switch', ['even', 'odd'])
    .mark('end').op('ldloc.0').op('ret')}]});
  const vm = create(bytes);
  try {
    assert.equal(vm.run().returnValue, 6);
    const [method] = wasmTierStatistics(vm).methods;
    assert.equal(method.status, 'cold');
    assert.equal(method.backedges, 6);
    assert.deepEqual(method.backedgeSites.map(site => site.count), [3, 3]);
    assert.equal(method.backedgeSites[0].fromOffset, method.backedgeSites[1].fromOffset);
    assert.notEqual(method.backedgeSites[0].toOffset, method.backedgeSites[1].toOffset);
  } finally { vm.stop(); }
});

test('T11.3 untaken backward branches have no site and self-edges are counted', () => {
  const vm = create(loopFixture(1));
  try {
    assert.equal(vm.run().returnValue, 1);
    const [method] = wasmTierStatistics(vm).methods;
    assert.equal(method.backedges, 0);
    assert.deepEqual(method.backedgeSites, []);
  } finally { vm.stop(); }
  const self = create(managedFixture({methods: [{name: 'Main', body: writer => writer.mark('loop').op('br.s', 'loop')}]}),
    {backedgeThreshold: 100});
  try {
    self.runSlice({instructionBudget: 8, timeBudgetMs: 1000});
    const [method] = wasmTierStatistics(self).methods;
    assert.equal(self.state, 'running');
    assert.deepEqual(method.backedgeSites, [{fromOffset: 0, toOffset: 0, count: 8}]);
  } finally { self.stop(); }
});

test('T11.3 site capacity preserves totals and exposes untracked edge executions', () => {
  const vm = create(twoLoops(2, 7), {maxBackedgesPerMethod: 1});
  try {
    assert.equal(vm.run().returnValue, 9);
    const [method] = wasmTierStatistics(vm).methods;
    assert.equal(method.status, 'cold');
    assert.equal(method.backedgeSites.length, 1);
    assert.equal(method.backedgeSites[0].count, 1);
    assert.equal(method.backedgeOverflow, 6);
    assert.equal(method.backedges, 7);
  } finally { vm.stop(); }
  for (const maxBackedgesPerMethod of [0, -1, 1.5, 65537, Infinity]) {
    const invalid = create(loopFixture(1), {maxBackedgesPerMethod});
    try { assert.throws(() => wasmTierStatistics(invalid), /Invalid Wasm tiering maxBackedgesPerMethod/); }
    finally { invalid.stop(); }
  }
});

test('T11.3 runAsync automatically compiles and enters a live loop without prewarming', async () => {
  const bytes = loopFixture(100000, true);
  const baseline = new CilVirtualMachine(bytes);
  const vm = new CilVirtualMachine(bytes, {profile: true,
    wasmTiering: {callThreshold: 100, backedgeThreshold: 2}});
  let sawPending = false, sawNativeWhileRunning = false, slices = 0;
  try {
    const expected = baseline.run();
    assert.equal(expected.state, 'terminated', expected.fault?.message);
    assert.deepEqual(wasmTierStatistics(vm).methods, []);
    const result = await vm.runAsync({onSlice(current) {
      slices++;
      const statistics = wasmTierStatistics(current);
      sawPending ||= statistics.pending > 0;
      sawNativeWhileRunning ||= current.state === 'running' && statistics.osrTransitions > 0;
    }});
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 100000);
    assert.equal(result.output, '100000\n');
    assert.equal(result.output, expected.output);
    assert.equal(result.returnValue, expected.returnValue);
    assert.equal(result.stats.instructions, expected.stats.instructions);
    const statistics = wasmTierStatistics(vm), [method] = statistics.methods;
    assert(slices > 1);
    assert(sawPending);
    assert(sawNativeWhileRunning, JSON.stringify(statistics));
    assert.equal(statistics.compilations, 1);
    assert.equal(statistics.entryTransitions, 0);
    assert.equal(statistics.osrTransitions, 1);
    assert(statistics.nativeInstructions > 0);
    assert.equal(method.backedges, 99999);
    assert.deepEqual(method.backedgeSites.map(site => site.count), [99999]);
    const events = vm.profiler.events.read().filter(event => event.name === RuntimeEventName.TierUp);
    assert.deepEqual(events.map(event => event.payload.kind), ['osr']);
  } finally { baseline.stop(); vm.stop(); }
});

test('T11.3 disabled asynchronous tiering remains interpreted', async () => {
  const vm = new CilVirtualMachine(loopFixture(3000), {profile: true, wasmTiering: false});
  try {
    assert.equal((await vm.runAsync()).returnValue, 3000);
    const statistics = wasmTierStatistics(vm);
    assert.equal(statistics.enabled, false);
    assert.equal(statistics.compilations, 0);
    assert.equal(statistics.osrTransitions, 0);
    assert.deepEqual(statistics.methods, []);
    assert.equal(vm.profiler.events.read().some(event => event.name === RuntimeEventName.TierUp), false);
  } finally { vm.stop(); }
});

test('T11.3 cancellation during automatic compilation discards the code epoch and counters', async () => {
  const vm = create(loopFixture(100000), {backedgeThreshold: 2}), abort = new AbortController();
  let sawPending = false;
  try {
    await assert.rejects(vm.runAsync({signal: abort.signal, onSlice(current) {
      if (wasmTierStatistics(current).pending > 0) {
        sawPending = true;
        abort.abort();
      }
    }}), {name: 'OperationCanceledException'});
    assert(sawPending);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.frames.length, 0);
    assert.deepEqual(wasmTierStatistics(vm).methods, []);
  } finally { vm.stop(); }
});

test('T11.3 snapshot restore resets derived edge counts without changing execution values', () => {
  const vm = create(loopFixture(10), {backedgeThreshold: 100});
  try {
    vm.runSlice({instructionBudget: 30, timeBudgetMs: 1000});
    const snapshot = vm.snapshot(), previous = wasmTierStatistics(vm);
    assert(previous.methods[0].backedges > 0);
    assert.equal(vm.run().returnValue, 10);
    const instructions = vm.instructions;
    vm.restore(snapshot);
    const restored = wasmTierStatistics(vm);
    assert(restored.epoch > previous.epoch);
    assert.deepEqual(restored.methods, []);
    assert.equal(vm.run().returnValue, 10);
    assert.equal(vm.instructions, instructions);
  } finally { vm.stop(); }
});
