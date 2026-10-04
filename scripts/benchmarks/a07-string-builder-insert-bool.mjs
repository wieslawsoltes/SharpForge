// Copy this identical runner to integrated repro 170259473c74f40a6af041a0da19cf04f8a36252; run serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {findContracts} from '@sharpforge/framework';
import {builderPlatform, builderContract, builderType} from '../../tests/fixtures/string-builder/append-char.js';

const calls = Number(process.argv[2] ?? 500);
const stressCalls = Number(process.argv[3] ?? 50);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 2000);
assert(Number.isInteger(stressCalls) && stressCalls >= 20 && stressCalls <= 200);
const workloads = [
  {name: 'releasedLength', segments: ['axa'], index: 1, lengthOnly: true},
  {name: 'releasedStringTrue', segments: ['axa'], index: 1, type: 'string', value: 'True'},
  {name: 'releasedStringFalse', segments: ['axa'], index: 1, type: 'string', value: 'False'},
  {name: 'releasedChar', segments: ['axa'], index: 1, type: 'char', value: 65},
  {name: 'newTrueEmpty', segments: [], index: 0, type: 'bool', value: true},
  {name: 'newFalseMiddle', segments: ['axa'], index: 1, type: 'bool', value: false},
  {name: 'newTrueEnd', segments: ['axa'], index: 3, type: 'bool', value: true},
  {name: 'newFalseSurrogateCut', segments: ['\ud801', '\udc28z'], index: 1, type: 'bool', value: false},
  {name: 'newTrueManyChunks', segments: Array(32).fill('ab'), index: 31, type: 'bool', value: true, long: true},
  {name: 'releasedStringManyChunks', segments: Array(32).fill('ab'), index: 31, type: 'string', value: 'True', long: true}
];
function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}
function prepare(platform, row, count, engine) {
  let value = row.value;
  let text = row.type === 'char' ? String.fromCharCode(value) : value;
  if (row.type === 'string') {
    value = platform.heap.string(value);
    platform.heap.pins.push(value);
  } else if (row.type === 'bool') {
    text = value ? 'True' : 'False';
    if (engine === 'cil') value = Number(value);
  }
  const args = [];
  for (let index = 0; index < count; index++) {
    const reference = platform.invoke(builderContract('.ctor', ['int']), [16]);
    platform.heap.pins.push(reference);
    for (const segment of row.segments) {
      platform.invoke(builderContract('Append', ['string']), [reference, platform.heap.string(segment)]);
    }
    args.push(row.lengthOnly ? [reference] : [reference, row.index, value]);
  }
  const original = row.segments.join('');
  const expected = row.lengthOnly ? original.length : original.slice(0, row.index) + text + original.slice(row.index);
  return {args, expected};
}
function measure(platform, row, engine) {
  const parameters = row.lengthOnly ? [] : ['int', row.type];
  const descriptor = findContracts(builderType, row.lengthOnly ? 'get_Length' : 'Insert')
    .find(item => item.parameters.join(',') === parameters.join(','));
  if (!descriptor && row.type === 'bool') return {skipped: true, reason: 'Insert(Int32,Boolean) is absent on baseline'};
  assert(descriptor, 'Released control is available');
  const count = row.long ? stressCalls : calls;
  const {args, expected} = prepare(platform, row, count, engine);
  const snapshot = platform.heap.snapshot();
  const output = Array(count);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    platform.heap.restore(snapshot);
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) output[index] = platform.invoke(descriptor, args[index]);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < count; index++) {
      if (row.lengthOnly) assert.equal(output[index], expected);
      else {
        assert.deepEqual(output[index], args[index][0]);
        assert.equal(platform.native(platform.invoke(builderContract('ToString'), [args[index][0]])), expected);
      }
    }
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls: count, elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}
function run(engine) {
  const runner = builderPlatform(engine, '');
  const results = {};
  try {
    for (const row of workloads) {
      results[row.name] = runner.platform.heap.withRoots([], () => measure(runner.platform, row, engine));
      runner.platform.heap.collect();
    }
    return results;
  } finally {runner.stop();}
}
const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  notes: 'Fresh prepared builders per call; snapshot reset, setup, host GC and output checks are outside timing.',
  engines}, null, 2));
