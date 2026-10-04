import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, instructionProfile, framePoolStatistics} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

const source = `class Program {
  static int Bump(int value) { int[] pair = new int[2]; pair[0] = value; return pair[0] + 1; }
  static void Main() { int value = 0; for (int i = 0; i < 12; i++) value = Bump(value); Console.WriteLine(value); }
}`;
function make(engine, options = {}, text = source) {
  const result = compileToIL(text);
  assert.equal(result.success, true, JSON.stringify(result.diagnostics));
  return engine === 'cil' ? new CilVirtualMachine(result.assembly, options)
    : new VirtualMachine(engine === 'source' ? result.image : result.assembly, options);
}
const sum = values => values.reduce((total, value) => total + value, 0);
const named = (profile, name) => profile.methods.find(method => method.name.endsWith('.' + name) || method.name.endsWith('::' + name));
function totals(profile) {
  assert.equal(sum(profile.methods.map(method => method.instructions)), profile.instructions);
  assert.equal(sum(profile.samples.map(sample => sample.weight)), profile.instructions);
  assert.equal(sum(profile.methods.map(method => method.allocations)), profile.allocations);
  assert.equal(sum(profile.methods.map(method => method.allocatedBytes)), profile.allocatedBytes);
  assert.equal(sum(profile.allocationSites.map(site => site.bytes)) + profile.overflow.allocationBytes, profile.allocatedBytes);
  assert.equal(sum(profile.allocationSites.map(site => site.allocations)) + profile.overflow.allocationCount, profile.allocations);
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: profiling preserves execution, counts calls and attributes allocations without retaining frames`, () => {
    const plain = make(engine), vm = make(engine, {profile: {sampleBudget: 3}});
    try {
      assert.equal(plain.profiler, null);
      assert.equal(instructionProfile(plain), null);
      assert.equal(Object.hasOwn(plain.heap, 'allocationObserver'), false);
      const expected = plain.run(), actual = vm.run();
      assert.equal(actual.state, 'terminated', actual.fault?.message);
      assert.equal(actual.output, '12\n');
      assert.equal(actual.output, expected.output);
      assert.equal(actual.stats.instructions, expected.stats.instructions);
      const profile = instructionProfile(vm);
      assert.equal(profile.format, 'SharpForge.InstructionProfile/1');
      assert.equal(profile.instructions, vm.instructions);
      assert.equal(profile.allocations, vm.heap.stats.allocations);
      assert.equal(profile.allocatedBytes, vm.heap.stats.allocatedBytes);
      assert.equal(named(profile, 'Bump').calls, 12);
      assert.equal(named(profile, 'Bump').allocations, 12);
      assert(named(profile, 'Main').inclusiveInstructions > named(profile, 'Main').instructions);
      assert(framePoolStatistics(vm).reused > 0);
      assert(profile.samples.every(sample => sample.stack.every(id => Number.isInteger(id))));
      totals(profile);
      profile.methods[0].calls = -1;
      profile.samples[0].stack.push(999);
      assert.notDeepEqual(instructionProfile(vm), profile, 'Counter views must not expose mutable observer storage');
    } finally { plain.stop(); vm.stop(); }
  });

  test(`${engine}: limits preserve totals and report discarded method, stack and allocation-site detail`, () => {
    const vm = make(engine, {profile: {maxMethods: 2, maxStacks: 2, maxSites: 1, maxStackDepth: 1, sampleBudget: 1}});
    try {
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      const profile = instructionProfile(vm);
      assert.equal(profile.methods.length, 2);
      assert(profile.samples.length <= 2 && profile.samples.every(sample => sample.stack.length <= 1));
      assert(profile.allocationSites.length <= 1);
      assert(profile.overflow.methods > 0);
      assert(profile.overflow.stackDepthInstructions > 0);
      totals(profile);
    } finally { vm.stop(); }
  });

  test(`${engine}: snapshot replay keeps host counters cumulative and does not invent restored calls`, () => {
    const vm = make(engine, {profile: true});
    try {
      let entered = false;
      for (let step = 0; step < 200; step++) {
        const method = vm.top?.method ?? vm.image?.methods[vm.top?.methodId];
        if (method?.name === 'Bump') { entered = true; break; }
        vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
      }
      assert(entered, 'Capture an actual live callee, not an empty or completed execution');
      const snapshot = vm.snapshot(), before = instructionProfile(vm), observer = vm.profiler;
      assert.equal(Object.hasOwn(snapshot, 'profiler'), false);
      assert.equal(Object.hasOwn(snapshot, 'options'), false);
      assert.equal(vm.run().output, '12\n');
      const first = instructionProfile(vm);
      vm.restore(snapshot);
      assert.equal(vm.profiler, observer);
      assert.deepEqual(instructionProfile(vm), first);
      assert.equal(vm.run().output, '12\n');
      const replay = instructionProfile(vm);
      assert.equal(replay.instructions, first.instructions * 2 - before.instructions);
      assert.equal(named(replay, 'Bump').calls, 23);
      totals(replay);
      vm.stop();
      const stopped = instructionProfile(vm);
      vm.stop();
      assert.deepEqual(instructionProfile(vm), stopped);
      assert.equal(vm.frames.length, 0);
    } finally { vm.stop(); }
  });

  test(`${engine}: rejected options do not silently enable a different profiler capability`, () => {
    for (const profile of [null, 1, 'yes', [], {maxMethods: 1}, {maxStacks: 1}, {maxSites: 0},
      {maxStackDepth: 0}, {sampleBudget: 1.5}, {maxSites: 1_000_001}, {durationClock: () => 0}]) {
      assert.throws(() => make(engine, {profile}), /profil/i);
    }
  });
}

test('CIL: manual stepping observes entered handlers and a faulting opcode exactly once', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body: writer => writer.op('ldnull').op('throw')}]});
  const vm = new CilVirtualMachine(assembly, {profile: true});
  try {
    vm.step();
    assert.equal(instructionProfile(vm).instructions, 1);
    assert.throws(() => vm.step(), /null/i);
    assert.equal(instructionProfile(vm).instructions, 2);
    assert.equal(vm.instructions, 0, 'The existing slice budget counter does not count manual step calls');
    totals(instructionProfile(vm));
  } finally { vm.stop(); }
});

test('CIL: stack capacity overflow preserves weights in the reserved stack row', () => {
  const vm = make('cil', {profile: {maxStacks: 2}});
  try {
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    const profile = instructionProfile(vm);
    assert.equal(profile.samples.length, 2);
    assert(profile.overflow.stackInstructions > 0);
    assert.deepEqual(profile.samples[1].stack, [1]);
    totals(profile);
  } finally { vm.stop(); }
});

test('CIL: generic method rows survive snapshot cache invalidation without merging different closed contexts', () => {
  const assembly = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      const method = context.methods.get('Program.Identity');
      writer.op('ldc.i4.1').op('call', context.methodSpec(method, ['int'])).op('pop');
      writer.op('ldnull').op('call', context.methodSpec(method, ['string'])).op('pop');
      writer.op('ldc.i4', 42).op('call', context.methodSpec(method, ['int'])).op('ret');
    }},
    {name: 'Identity', result: '!!0', parameters: ['!!0'], genericParameters: [{}],
      body: writer => writer.op('ldarg.0').op('ret')}
  ]}]);
  const vm = new CilVirtualMachine(assembly, {profile: {maxMethods: 5}});
  try {
    const saved = vm.snapshot();
    for (let iteration = 1; iteration <= 4; iteration++) {
      if (iteration > 1) vm.restore(saved);
      assert.equal(vm.run().returnValue, 42);
      const profile = instructionProfile(vm), identities = profile.methods.filter(method => method.name.includes('::Identity<'));
      assert.equal(identities.length, 2);
      assert.deepEqual(identities.map(method => method.calls).sort((left, right) => left - right), [iteration, iteration * 2]);
      assert.equal(profile.overflow.methods, 0);
      totals(profile);
    }
  } finally { vm.stop(); }
});

test('CIL: allocations before the first opcode are attributed to the method entry boundary', () => {
  const assembly = managedFixture({methods: [{name: 'Main', body: writer => writer.op('ret')}]});
  const vm = new CilVirtualMachine(assembly, {profile: true});
  try {
    vm.heap.array('int', 1);
    const profile = instructionProfile(vm), method = named(profile, 'Main');
    assert(profile.allocationSites.some(site => site.method === method.id && site.offset === -1 && site.allocations === 1));
    assert.equal(profile.instructions, 0);
  } finally { vm.stop(); }
});

test('CIL: profiler and method event observers remain independent through parked child cancellation', () => {
  const assembly = managedFixture({methods: [
    {name: 'Main', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker)
        .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
        .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
        .op('pop').op('ret');
    }},
    {name: 'Worker', body: (writer, context) => writer.op('ldc.i4', 60000)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret')}
  ]});
  const vm = new CilVirtualMachine(assembly, {profile: true, runtimeEvents: true, virtualTime: true});
  try {
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
    assert.equal(child.status, 'waiting');
    assert.equal(named(instructionProfile(vm), 'Worker').calls, 1);
    const parked = instructionProfile(vm);
    vm.scheduler.cancelAll();
    vm.runSlice();
    vm.stop();
    assert.deepEqual(instructionProfile(vm), parked);
    assert.equal(child.frames.length, 0);
    const events = vm.runtimeEvents.read();
    assert.equal(events.filter(event => event.name === 'MethodEnter').length, 2);
    assert.equal(events.filter(event => event.name === 'MethodLeave').length, 2);
    totals(instructionProfile(vm));
  } finally { vm.stop(); }
});

test('allocation growth adds managed bytes without inventing allocations; failed reserve adds neither', () => {
  const vm = make('source', {profile: true});
  try {
    const array = vm.heap.array('int', 1), initial = instructionProfile(vm);
    vm.heap.replaceData(array, [1, 2, 3]);
    const grown = instructionProfile(vm);
    assert.equal(grown.allocations, initial.allocations);
    assert.equal(grown.allocatedBytes, initial.allocatedBytes + 16);
    vm.heap.replaceData(array, [1]);
    assert.deepEqual(instructionProfile(vm), grown);
    assert.throws(() => vm.heap.array('int', 1_000_001), /limit/);
    vm.heap.maxBytes = 1;
    assert.throws(() => vm.heap.array('int', 1), /heap budget/);
    assert.deepEqual(instructionProfile(vm), grown);
  } finally { vm.stop(); }
});
