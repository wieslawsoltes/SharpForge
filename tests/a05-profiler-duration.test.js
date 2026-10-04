import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {ExecutionProfiler, VirtualMachine, CilVirtualMachine, exportSpeedscope, exportRuntimeTrace,
  serializeSnapshot} from '@sharpforge/runtime';
import {createExecutionProfiler} from '../packages/runtime/src/execution/profiler.js';

function fixture(options = {}) {
  let now = 0;
  const parent = {id: 1, method: {owner: 'Fixture', name: 'Parent'}};
  const child = {id: 2, method: {owner: 'Fixture', name: 'Child'}};
  const vm = {frames: [parent], state: 'running', scheduler: {contexts: new Map(), currentId: 1}};
  const profiler = new ExecutionProfiler(vm, {sampleBudget: 2, clock: () => now, ...options});
  return {vm, profiler, parent, child, advance: milliseconds => { now += milliseconds; }};
}
const sum = values => values.reduce((total, value) => total + value, 0);

test('Duration samples preserve instruction weights and charge the final budgeted instruction', () => {
  const {vm, profiler, parent, child, advance} = fixture();
  profiler.enter(parent);
  profiler.instruction(parent);
  advance(2);
  profiler.instruction(parent); // Budget flush occurs before this instruction executes.
  advance(3);
  vm.frames.push(child);
  profiler.enter(child);
  profiler.instruction(child);
  advance(7);
  vm.frames.pop();
  profiler.leave(child);
  profiler.instruction(parent);
  advance(11);
  profiler.boundary();
  const profile = profiler.export();
  const parentRecord = profile.methods.find(method => method.name.endsWith('Parent'));
  const childRecord = profile.methods.find(method => method.name.endsWith('Child'));
  assert.equal(parentRecord.exclusiveMilliseconds, 16);
  assert.equal(parentRecord.inclusiveMilliseconds, 23);
  assert.equal(childRecord.exclusiveMilliseconds, 7);
  assert.equal(childRecord.inclusiveMilliseconds, 7);
  assert.equal(profile.duration.totalMilliseconds, 23);
  assert.equal(sum(profile.samples.map(sample => sample.milliseconds)), 23);
  assert.equal(profile.instructions, 4);
  assert.equal(sum(profile.samples.map(sample => sample.weight)), 4);
  const timed = exportSpeedscope(profile, {metric: 'duration'}).profiles[0];
  assert.equal(timed.unit, 'milliseconds');
  assert.equal(timed.endValue, 23);
  assert.equal(sum(timed.weights), 23);
  assert.equal(exportSpeedscope(profile).profiles[0].endValue, 4);
  assert.equal(exportRuntimeTrace(profile).clock, 'instructions');
});

test('Duration sampling excludes host slice gaps and suspended contexts', () => {
  const {profiler, parent, advance} = fixture();
  profiler.instruction(parent);
  advance(4);
  profiler.boundary();
  advance(1000);
  profiler.instruction(parent);
  advance(3);
  profiler.suspend(1, 'task');
  advance(2000);
  profiler.resume(1);
  profiler.instruction(parent);
  advance(2);
  profiler.boundary();
  advance(3000);
  assert.equal(profiler.export().duration.totalMilliseconds, 9);
  advance(4000);
  assert.equal(profiler.export().duration.totalMilliseconds, 9, 'Export with no active interval adds no idle time');
});

test('Recursive inclusive duration counts each frame and stack overflow retains all elapsed time', () => {
  const {vm, profiler, parent, child, advance} = fixture({maxStacks: 2});
  child.method = parent.method;
  profiler.instruction(parent);
  advance(2);
  profiler.boundary();
  vm.frames.push(child);
  profiler.instruction(child);
  advance(3);
  profiler.boundary();
  vm.frames.push({id: 3, method: parent.method});
  profiler.instruction(vm.frames.at(-1));
  advance(5);
  profiler.boundary();
  const profile = profiler.export();
  const method = profile.methods.find(item => item.name.endsWith('Parent'));
  assert.equal(method.exclusiveMilliseconds, 10);
  assert.equal(method.inclusiveMilliseconds, 23);
  assert.equal(profile.samples.length, 2);
  assert.equal(profile.overflow.stackMilliseconds, 8);
  assert.equal(sum(profile.samples.map(sample => sample.milliseconds)), 10);
  assert.equal(sum(profile.samples.map(sample => sample.weight)), 3);
});

test('Duration clock configuration is explicit and rejects malformed or regressing readings', () => {
  for (const duration of [null, 1, 'true']) assert.throws(() => fixture({duration}), TypeError);
  for (const clock of [null, 1, 'clock', {}]) assert.throws(() => fixture({clock}), TypeError);
  for (const value of [NaN, Infinity, -1, '1']) {
    const {profiler, parent} = fixture({clock: () => value});
    assert.throws(() => profiler.instruction(parent), RangeError);
  }
  const {profiler, parent, advance} = fixture();
  advance(10);
  profiler.instruction(parent);
  advance(-1);
  assert.throws(() => profiler.boundary(), /monotonic/);
});

test('Disabled duration sampling never reads the host clock and preserves instruction-only exports', () => {
  const {profiler, parent} = fixture({duration: false, clock: () => { throw new Error('clock should be unused'); }});
  profiler.instruction(parent, 2);
  const profile = profiler.export();
  assert.equal(profile.instructions, 2);
  assert.equal(profile.duration.enabled, false);
  assert.equal(profile.duration.totalMilliseconds, 0);
  assert.throws(() => exportSpeedscope(profile, {metric: 'duration'}), /disabled/);
  assert.throws(() => exportSpeedscope(profile, {metric: 'cpu'}), /metric/);
  assert.equal(createExecutionProfiler({}, false), null);
  assert.equal(createExecutionProfiler({}, undefined), null);
});

const source = 'class Program { static int Twice(int value) { return value * 2; } ' +
  'static void Main() { System.Console.WriteLine(Twice(21)); } }';
const engines = {
  source: (artifact, options) => new VirtualMachine(artifact.image, options),
  reload: (artifact, options) => new VirtualMachine(loadAssembly(artifact.assembly), options),
  cil: (artifact, options) => new CilVirtualMachine(artifact.assembly, options),
};

for (const [engine, create] of Object.entries(engines)) {
  test(`Duration profiler ${engine}: real execution, host-owned snapshot clock and stop preserve semantics`, async () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    let now = 0;
    const clock = () => ++now;
    const plain = create(artifact, {});
    const vm = create(artifact, {profile: {clock, sampleBudget: 2}});
    try {
      const expected = plain.run();
      vm.runSlice({instructionBudget: 2, timeBudgetMs: 1000});
      const snapshot = vm.snapshot();
      assert.equal(Object.hasOwn(snapshot, 'profiler'), false);
      assert.equal(Object.hasOwn(snapshot, 'options'), false);
      const wire = await serializeSnapshot(vm, snapshot);
      assert.doesNotThrow(() => structuredClone(wire), 'The injected clock cannot enter the portable snapshot graph');
      const before = vm.profiler.export().duration.totalMilliseconds;
      const first = vm.run();
      assert.equal(first.state, 'terminated', first.fault?.message);
      assert.equal(first.output, expected.output);
      assert.equal(first.stats.instructions, expected.stats.instructions);
      const after = vm.profiler.export().duration.totalMilliseconds;
      assert(after > before);
      const profiler = vm.profiler;
      now += 10000;
      vm.restore(snapshot);
      assert.equal(vm.profiler, profiler);
      assert.equal(vm.profiler.durationClock.clock, clock);
      assert.equal(vm.profiler.export().duration.totalMilliseconds, after);
      vm.state = 'running';
      const replay = vm.run();
      assert.equal(replay.state, 'terminated', replay.fault?.message);
      assert.equal(replay.output, first.output);
      assert.equal(vm.profiler.export().duration.totalMilliseconds, after + after - before);
      vm.restore(snapshot);
      vm.profiler.instruction(vm.top);
      now += 5;
      vm.stop();
      const stopped = vm.profiler.export().duration.totalMilliseconds;
      now += 10000;
      assert.equal(vm.profiler.export().duration.totalMilliseconds, stopped);
    } finally { plain.stop(); vm.stop(); }
  });
}
