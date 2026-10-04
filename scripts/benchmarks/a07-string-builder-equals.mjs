// Copy this identical runner to baseline d8a303f77149386d3805724e44efd1c2cff40c83; run serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {findContracts} from '@sharpforge/framework';
import {builderPlatform, builderContract, builderType} from '../../tests/fixtures/string-builder/append-char.js';

const calls = Number(process.argv[2] ?? 5000);
const stressCalls = Number(process.argv[3] ?? 100);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
assert(Number.isInteger(stressCalls) && stressCalls >= 20 && stressCalls <= 1000, 'Stress calls must be within 20..1000');
const cases = [
  {name: 'fresh-empty', first: [], second: [], expected: true},
  {name: 'null-other', first: ['abc'], second: null, expected: false},
  {name: 'self', first: ['a', '\uD801', '\uDC28', 'z'], self: true, expected: true},
  {name: 'same-text', first: ['abc'], second: ['abc'], expected: true},
  {name: 'different-capacities', first: ['abc'], second: ['abc'], capacity: 4096, expected: true},
  {name: 'different-length', first: ['abc'], second: ['ab'], expected: false},
  {name: 'segmented-surrogates', first: ['a\uD801', '\uDC28z'], second: ['a', '\uD801\uDC28', 'z'], expected: true},
  {name: 'long-equal', first: Array(256).fill('abcd'), second: ['abcd'.repeat(256)], expected: true, long: true},
  {name: 'long-first-difference', first: Array(256).fill('abcd'), second: ['xbcd' + 'abcd'.repeat(255)], expected: false, long: true},
  {name: 'long-last-difference', first: Array(256).fill('abcd'), second: ['abcd'.repeat(255) + 'abcx'], expected: false, long: true}
];

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, count) {
  if (!descriptor) return {skipped: true, reason: 'Equals(StringBuilder) is absent on the baseline'};
  const output = Array(count);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) output[index] = platform.invoke(descriptor, cases[index % cases.length].args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < count; index++) assert.equal(output[index], cases[index % cases.length].expected);
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls: count, elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}

function run(engine) {
  const builder = builderPlatform(engine, '');
  const {platform} = builder;
  try {
    return platform.heap.withRoots([], () => {
      const create = (segments, capacity = 1) => {
        if (segments === null) return null;
        const value = platform.invoke(builderContract('.ctor', ['int']), [capacity]);
        platform.heap.pins.push(value);
        for (const segment of segments) {
          platform.invoke(builderContract('Append', ['string']), [value, platform.heap.string(segment)]);
        }
        return value;
      };
      const managed = cases.map(row => {
        const first = create(row.first);
        return {...row, args: [first, row.self ? first : create(row.second, row.capacity)]};
      });
      const equals = findContracts(builderType, 'Equals', false).find(row => row.parameters.join(',') === builderType);
      const ordinary = managed.filter(row => !row.long);
      const controls = name => managed.map(row => ({args: [row.args[0]], expected: platform.get(row.args[0], name)}));
      const result = {
        releasedLength: measure(platform, builderContract('get_Length'), controls('$length'), calls),
        releasedCapacity: measure(platform, builderContract('get_Capacity'), controls('$capacity'), calls),
        newOrdinaryEquals: measure(platform, equals, ordinary, calls)
      };
      for (const row of managed.filter(row => row.long)) result[row.name] = measure(platform, equals, [row], stressCalls);
      return result;
    });
  } finally {builder.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL StringBuilder equality: null/self, capacities, surrogate chunks and 256 chunks versus one flat chunk',
  notes: 'Setup, host GC and checks excluded. Existing Length/Capacity controls and new equality costs are separate.',
  engines}, null, 2));
