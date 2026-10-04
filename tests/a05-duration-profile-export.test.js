import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, exportSpeedscope} from '@sharpforge/runtime';
import {matchesSpeedscopeSchema} from './support/speedscope-schema.js';

function profile() {
  return {
    format: 'SharpForge.InstructionProfile/1', clock: 'instructions', instructions: 7,
    methods: [{id: 0, name: '[runtime]'}, {id: 1, name: '[profile capacity]'}, {id: 19, name: 'Program::Recur'}],
    samples: [{stack: [19, 19], weight: 5, milliseconds: 0.1}, {stack: [1], weight: 2, milliseconds: 0.2}],
    duration: {enabled: true, clock: 'monotonic', unit: 'milliseconds', totalMilliseconds: 0.3, intervals: 3}
  };
}

const durationExport = input => exportSpeedscope(input, {name: 'Captured duration', metric: 'duration'});

test('duration export follows the official schema and retains captured weights, names and recursive frames', () => {
  const input = profile();
  const result = durationExport(input);
  matchesSpeedscopeSchema(result);
  assert.equal(result.exporter, 'SharpForge.InstructionProfile/1');
  assert.equal(result.name, 'Captured duration');
  assert.deepEqual(result.shared.frames.map(frame => frame.name), ['[runtime]', '[profile capacity]', 'Program::Recur']);
  assert.deepEqual(result.profiles[0], {
    type: 'sampled', name: 'Captured duration', unit: 'milliseconds', startValue: 0, endValue: 0.3,
    samples: [[2, 2], [1]], weights: [0.1, 0.2]
  });
  assert.notEqual(0.1 + 0.2, input.duration.totalMilliseconds, 'Grouping roundoff does not rewrite captured values');
});

test('default and explicitly selected instruction export are unchanged even with unused malformed timing data', () => {
  const input = profile();
  const plain = profile();
  delete plain.duration;
  for (const sample of plain.samples) delete sample.milliseconds;
  const expected = exportSpeedscope(plain);
  assert.deepEqual(exportSpeedscope(input), expected);
  assert.deepEqual(exportSpeedscope(input, {metric: 'instructions'}), expected);
  input.duration = {enabled: true, totalMilliseconds: Infinity};
  input.samples[0].milliseconds = NaN;
  assert.deepEqual(exportSpeedscope(input), expected);
  assert.equal(expected.profiles[0].unit, 'none');
  assert.equal(expected.profiles[0].endValue, 7);
  assert.deepEqual(expected.profiles[0].weights, [5, 2]);
});

test('an enabled empty capture and observed zero-duration intervals export as zero without invented timing', () => {
  const input = profile();
  input.duration.totalMilliseconds = 0;
  for (const sample of input.samples) sample.milliseconds = 0;
  assert.deepEqual(durationExport(input).profiles[0].weights, [0, 0]);
  input.instructions = 0;
  input.methods = [];
  input.samples = [];
  input.duration.intervals = 0;
  const result = durationExport(input);
  matchesSpeedscopeSchema(result);
  assert.equal(result.profiles[0].endValue, 0);
  assert.deepEqual(result.profiles[0].weights, []);
});

test('finite extreme totals remain exact while relative mismatch and exact-zero mismatch are rejected', () => {
  const input = profile();
  for (const total of [Number.MIN_VALUE, Number.MAX_VALUE]) {
    input.duration.totalMilliseconds = total;
    input.samples[0].milliseconds = total;
    input.samples[1].milliseconds = 0;
    assert.equal(durationExport(input).profiles[0].endValue, total);
  }
  input.duration.intervals = Number.MAX_SAFE_INTEGER;
  for (const [total, first, second] of [[1e308, 6e307, 5e307], [1e-200, 6e-201, 5e-201]]) {
    input.duration.totalMilliseconds = total;
    input.samples[0].milliseconds = first;
    input.samples[1].milliseconds = second;
    assert.throws(() => durationExport(input), /do not equal/);
  }
  input.duration.totalMilliseconds = 0;
  input.samples[0].milliseconds = Number.MIN_VALUE;
  input.samples[1].milliseconds = 0;
  assert.throws(() => durationExport(input), /do not equal/);
  input.duration.totalMilliseconds = Number.MIN_VALUE;
  input.samples[0].milliseconds = 0;
  assert.throws(() => durationExport(input), /do not equal/);
});

const invalid = [
  ['missing duration', input => { delete input.duration; }],
  ['disabled duration', input => { input.duration.enabled = false; }],
  ['non-boolean enabled flag', input => { input.duration.enabled = 1; }],
  ['missing clock', input => { delete input.duration.clock; }],
  ['wrong clock', input => { input.duration.clock = 'instructions'; }],
  ['wrong unit', input => { input.duration.unit = 'seconds'; }],
  ['missing intervals', input => { delete input.duration.intervals; }],
  ['negative intervals', input => { input.duration.intervals = -1; }],
  ['fractional intervals', input => { input.duration.intervals = 1.5; }],
  ['unsafe intervals', input => { input.duration.intervals = Number.MAX_SAFE_INTEGER + 1; }],
  ['unmeasured samples', input => { input.duration.intervals = 0; }],
  ['missing total', input => { delete input.duration.totalMilliseconds; }],
  ['negative total', input => { input.duration.totalMilliseconds = -0.1; }],
  ['non-finite total', input => { input.duration.totalMilliseconds = Infinity; }],
  ['missing duration weight', input => { delete input.samples[0].milliseconds; }],
  ['negative duration weight', input => { input.samples[0].milliseconds = -0.1; }],
  ['string duration weight', input => { input.samples[0].milliseconds = '0.1'; }],
  ['NaN duration weight', input => { input.samples[0].milliseconds = NaN; }],
  ['non-finite duration weight', input => { input.samples[0].milliseconds = Infinity; }],
  ['materially different total', input => { input.duration.totalMilliseconds = 0.3001; }],
  ['overflowing sample total', input => {
    input.duration.totalMilliseconds = Number.MAX_VALUE;
    for (const sample of input.samples) sample.milliseconds = 1e308;
  }],
  ['wrong instruction total', input => { input.instructions = 8; }],
  ['fractional instruction weight', input => { input.samples[0].weight = 5.5; }],
  ['unknown method ID', input => { input.samples[0].stack[0] = 999; }]
];
for (const [name, mutate] of invalid) {
  test(`duration export rejects ${name}`, () => {
    const input = profile();
    mutate(input);
    assert.throws(() => durationExport(input), TypeError);
  });
}

test('duration export reads once, owns arrays, reports reader failures and rejects unknown metrics', () => {
  const input = profile();
  const before = JSON.stringify(input);
  let reads = 0;
  const result = durationExport({read() { reads++; return input; }});
  assert.equal(reads, 1);
  result.shared.frames[2].name = 'Changed';
  result.profiles[0].weights[0] = 99;
  result.profiles[0].samples[0][0] = 0;
  assert.equal(JSON.stringify(input), before);
  const failure = new Error('captured clock failed');
  assert.throws(() => durationExport({read() { throw failure; }}), error => error === failure);
  for (const metric of [null, false, 'milliseconds', 'cpu']) {
    assert.throws(() => exportSpeedscope(input, {metric}), /Unknown profile metric/);
  }
});

const source = `class Program {
  static void Recur(int n) { if (n > 1) Recur(n - 1); Console.Write("tick"); }
  static void Main() { Recur(3); }
}`;

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: captured recursive and capacity-overflow durations export without adding host idle time`, () => {
    const artifact = compileToIL(source);
    assert.equal(artifact.success, true, JSON.stringify(artifact.diagnostics));
    let now = 0;
    const options = {
      profile: {duration: true, sampleBudget: 1, maxStacks: 2, clock: () => now},
      onOutput: () => { now += 0.25; }
    };
    const vm = engine === 'cil' ? new CilVirtualMachine(artifact.assembly, options)
      : new VirtualMachine(engine === 'source' ? artifact.image : artifact.assembly, options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, 'tickticktick');
      const captured = vm.profiler.read();
      assert.equal(captured.duration.totalMilliseconds, 0.75);
      assert(captured.overflow.stackMilliseconds > 0);
      const exported = durationExport(vm.profiler);
      matchesSpeedscopeSchema(exported);
      assert.equal(exported.profiles[0].endValue, captured.duration.totalMilliseconds);
      assert.deepEqual(exported.profiles[0].weights, captured.samples.map(sample => sample.milliseconds));
      assert.equal(exported.profiles[0].weights.reduce((sum, value) => sum + value, 0), 0.75);
      assert(exported.shared.frames.some(frame => frame.name.includes('Recur')));
      assert.equal(exportSpeedscope(vm.profiler).profiles[0].endValue, captured.instructions);
      vm.stop();
      now += 10000;
      assert.deepEqual(durationExport(vm.profiler), exported);
    } finally { vm.stop(); }
  });
}
