// Copy this identical runner to baseline 3efe802235cfbb3d3c3c655f0831f5fbd32bd18c; run serially.
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
  {name: 'releasedStringInsert', segments: ['axa'], index: 1, text: 'A'},
  {name: 'newEmpty', segments: [], index: 0, unit: 0},
  {name: 'newStart', segments: ['axa'], index: 0, unit: 65},
  {name: 'newMiddle', segments: ['axa'], index: 1, unit: 0},
  {name: 'newEnd', segments: ['axa'], index: 3, unit: 0xffff},
  {name: 'newSurrogateCut', segments: ['\ud801', '\udc28z'], index: 1, unit: 0xd800},
  {name: 'newManyChunks', segments: Array(32).fill('ab'), index: 31, unit: 65, long: true},
  {name: 'releasedStringManyChunks', segments: Array(32).fill('ab'), index: 31, text: 'A', long: true}
];
function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}
function prepare(platform, row, count) {
  const text = row.text ?? String.fromCharCode(row.unit ?? 0);
  let value = row.unit;
  if (row.text !== undefined) {
    value = platform.heap.string(row.text);
    platform.heap.pins.push(value);
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
function measure(platform, row) {
  const parameters = row.lengthOnly ? [] : ['int', row.text === undefined ? 'char' : 'string'];
  const descriptor = findContracts(builderType, row.lengthOnly ? 'get_Length' : 'Insert')
    .find(item => item.parameters.join(',') === parameters.join(','));
  if (!descriptor) return {skipped: true, reason: 'Insert(Int32,Char) is absent on baseline'};
  const count = row.long ? stressCalls : calls;
  const {args, expected} = prepare(platform, row, count);
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
      results[row.name] = runner.platform.heap.withRoots([], () => measure(runner.platform, row));
      runner.platform.heap.collect();
    }
    return results;
  } finally {runner.stop();}
}
const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  notes: 'Each call uses a prepared fresh builder; snapshot reset, setup, host GC and assertions are outside timing.',
  engines}, null, 2));
