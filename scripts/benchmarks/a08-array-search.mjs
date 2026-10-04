// node --expose-gc scripts/benchmarks/a08-array-search.mjs [count=2048] [queries=512]
// Copy this identical runner to Ordinal baseline 640b96d3; execute the two checkouts serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const count = Number(process.argv[2] ?? 2048);
const queryCount = Number(process.argv[3] ?? 512);
assert(Number.isInteger(count) && count >= 32 && count <= 8192, 'Count must be within 32..8192');
assert(Number.isInteger(queryCount) && queryCount >= 4 && queryCount <= 4096, 'Queries must be within 4..4096');
const text = value => value.toString(16).padStart(6, '0');
const input = Array.from({length: count}, (_, index) => index === 0 ? null : text(index * 2));
const queries = Array.from({length: queryCount}, (_, index) => {
  const position = 1 + ((Math.imul(index, 2654435761) >>> 0) % (count - 1));
  switch (index % 4) {
    case 0: return {value: null, expected: 0};
    case 1: return {value: input[position], expected: position};
    case 2: return {value: text(position * 2 + 1), expected: ~(position + 1)};
    default: return {value: 'zzzzzz', expected: ~count};
  }
});
const compiled = compileToIL('class Program { static void Main() {} }');
assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
const member = parameters => findContracts('System.Array', 'BinarySearch', true).find(candidate =>
  JSON.stringify(candidate.parameters) === JSON.stringify(parameters));
const typed = member(['string[]', 'string']);
const explicit = member(['System.Array', 'object', 'System.Collections.IComparer']);
assert(typed, 'The released typed BinarySearch contract is required');

function summarize(values) {
  const ordered = values.toSorted((left, right) => left - right);
  return {median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.ceil(ordered.length * 0.95) - 1]};
}

function measure(platform, descriptor, args) {
  const results = new Int32Array(queryCount);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < queryCount; index++) results[index] = platform.invoke(descriptor, args[index]);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < queryCount; index++) assert.equal(results[index], queries[index].expected);
    if (sample >= 0) samples.push({sample, elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {
    contractId: descriptor.id,
    elapsedMs: summarize(samples.map(sample => sample.elapsedMs)),
    managedAllocations: summarize(samples.map(sample => sample.managedAllocations)),
    managedAllocatedBytes: summarize(samples.map(sample => sample.managedAllocatedBytes)), samples
  };
}

function run(engine) {
  const vm = engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  const platform = vm.platform;
  try {
    return platform.heap.withRoots([], () => {
      const managed = value => {
        const reference = value === null ? null : platform.heap.string(value);
        platform.heap.pins.push(reference);
        return reference;
      };
      const values = input.map(managed);
      const array = platform.heap.allocate('array', 'string[]', values);
      platform.heap.pins.push(array);
      const keys = queries.map(query => managed(query.value));
      const typedDefault = measure(platform, typed, keys.map(key => [array, key]));
      let explicitOrdinal = {skipped: true, reason: 'Explicit comparer overload is absent in this baseline'};
      if (explicit) {
        const ordinal = findContracts('System.StringComparer', 'get_Ordinal', true)[0];
        const comparer = platform.invoke(ordinal, []);
        platform.heap.pins.push(comparer);
        explicitOrdinal = measure(platform, explicit, keys.map(key => [array, key, comparer]));
      }
      assert.deepEqual(platform.heap.get(array).data, values, 'Search must preserve input storage');
      return {typedDefault, explicitOrdinal};
    });
  } finally { vm.stop(); }
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  count, queryCount, warmupsPerWorkload: 1, samplesPerWorkload: 5,
  workload: 'Array.BinarySearch through real source/CIL platform dispatch on sorted nullable strings; hits and misses',
  notes: 'Setup and checks excluded. Typed/default timing includes its unchanged O(n) comparability scan. '
    + 'Explicit ordinal cost is separate and unavailable on baseline. Counters describe managed allocations only.',
  engines
}, null, 2));
