import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, RuntimeEventLog, RuntimeEventName,
  exportSpeedscope, exportRuntimeTrace} from '@sharpforge/runtime';

const source = `using System;class Program {
  static int Bump(int value) { return value + 1; }
  static void Main() {
    int value = 0;
    for(int i=0;i<12;i++) value = Bump(value);
    Console.WriteLine(value);
    try { throw new Exception("caught"); } catch(Exception error) { Console.WriteLine(error.Message); }
    GC.Collect();
  }
}`;
function artifact() {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}
const engines = {
  source: (image, options) => new VirtualMachine(image.image, options),
  reload: (image, options) => new VirtualMachine(loadAssembly(image.assembly), options),
  cil: (image, options) => new CilVirtualMachine(image.assembly, options)
};
const sum = values => values.reduce((total, value) => total + value, 0);

for (const [engine, create] of Object.entries(engines)) {
  test('T10 profiler ' + engine + ': counts and export preserve execution', () => {
    const image = artifact();
    const plain = create(image, {}), observed = create(image, {profile: true});
    assert.equal(plain.profiler, null);
    const events = [];
    observed.profiler.events.subscribe(event => events.push(event), {replay: true});
    const expected = plain.run(), actual = observed.run();
    assert.equal(actual.state, 'terminated', actual.fault?.stack);
    assert.equal(actual.output, expected.output);
    assert.equal(actual.stats.instructions, expected.stats.instructions);
    const profile = observed.profiler.export();
    assert.equal(profile.instructions, actual.stats.instructions);
    assert.equal(sum(profile.methods.map(method => method.instructions)), profile.instructions);
    assert.equal(sum(profile.samples.map(sample => sample.weight)), profile.instructions);
    assert.equal(profile.methods.find(method => method.name.includes('Bump')).calls, 12);
    assert.equal(profile.allocations, observed.heap.stats.allocations);
    assert(events.some(event => event.name === RuntimeEventName.ExceptionThrown));
    const start = events.findIndex(event => event.name === RuntimeEventName.GCStart);
    assert(start >= 0 && events.slice(start + 1).some(event => event.name === RuntimeEventName.GCEnd));
    assert(events.every((event, index) => !index || event.sequence > events[index - 1].sequence));
    const speedscope = exportSpeedscope(profile), sampled = speedscope.profiles[0];
    assert.equal(sampled.endValue, profile.instructions);
    assert.equal(sum(sampled.weights), profile.instructions);
    assert(sampled.samples.every(stack => stack.every(id => speedscope.shared.frames[id])));
    assert.equal(exportRuntimeTrace(profile).format, 'SharpForge.RuntimeTrace/1');
  });

  test('T10 profiler ' + engine + ': capacity overflow retains total instruction weight', () => {
    const vm = create(artifact(), {profile: {maxMethods: 2, maxStacks: 2, maxSites: 2, events: {capacity: 4}}});
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    const profile = vm.profiler.export();
    assert(profile.methods.length <= 2 && profile.samples.length <= 2 && profile.allocationSites.length <= 2);
    assert(profile.overflow.methods > 0);
    assert(profile.events.dropped > 0);
    assert.equal(sum(profile.samples.map(sample => sample.weight)), profile.instructions);
  });

  test('T10 profiler ' + engine + ': snapshot restore keeps host counters cumulative', () => {
    const vm = create(artifact(), {profile: true});
    vm.runSlice({instructionBudget: 5, timeBudgetMs: 1000});
    const snapshot = vm.snapshot(), before = vm.profiler.instructions;
    vm.run();
    const first = vm.profiler.instructions;
    vm.restore(snapshot);
    vm.run();
    assert.equal(vm.profiler.instructions, first + first - before);
    assert.equal(sum(vm.profiler.export().samples.map(sample => sample.weight)), vm.profiler.instructions);
  });
}

test('T10 event ring: chronological replay, overflow, unsubscribe and subscriber failures', () => {
  const events = new RuntimeEventLog({capacity: 2}), received = [];
  const unsubscribe = events.subscribe(event => received.push(event.sequence), {replay: true});
  for (let i = 0; i < 3; i++) events.emit(RuntimeEventName.MethodEnter, {method: i}, i);
  events.flush();
  assert.deepEqual(received, [2, 3]);
  assert.equal(events.dropped, 1);
  unsubscribe();
  events.emit(RuntimeEventName.MethodLeave, {method: 2}, 4);
  events.flush();
  assert.deepEqual(received, [2, 3]);
  const failure = new Error('host observer');
  events.subscribe(() => { throw failure; }, {replay: true});
  assert.throws(() => events.flush(), error => error === failure);
  assert.throws(() => new RuntimeEventLog({capacity: 0}), RangeError);
  assert.throws(() => events.emit('unknown', {}, 0), TypeError);
});
