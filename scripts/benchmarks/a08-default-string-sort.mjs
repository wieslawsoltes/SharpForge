import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

// Copy this identical runner to each revision; label the selected backend explicitly.
const count = Number(process.argv[2] ?? 8192);
assert(Number.isInteger(count) && count >= 32 && count <= 32768, 'Count must be within 32..32768');
const backend = process.argv[3] ?? 'unspecified';
assert(['unspecified', 'released-ordinal', 'invariant-host'].includes(backend), 'Unknown backend label');
const warmupCount = 1;
const sampleCount = 5;
const input = Array.from({length: count}, (_, index) => index % 17 === 0 ? null :
  String((Math.imul(index, 2654435761) >>> 0) % 2048).padStart(4, '0'));
const expected = input.toSorted((left, right) =>
  left === right ? 0 : left === null ? -1 : right === null ? 1 : left < right ? -1 : 1);

function sample(engine) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
  const heap = platform.heap;
  try {
    return heap.withRoots([reference], () => {
      const values = input.map(value => {
        const managed = value === null ? null : heap.string(value);
        heap.pins.push(managed);
        return managed;
      });
      const array = heap.allocate('array', 'string[]', values);
      heap.pins.push(array);
      // Initialize the per-platform provider before timing without sorting the measured input.
      call('Add', values[1]);
      call('Add', values[2]);
      call('Sort');
      call('Clear');
      call('AddRange', array);
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const allocatedBytes = heap.stats.allocatedBytes;
      const started = performance.now();
      call('Sort');
      const elapsedMs = performance.now() - started;
      const managedAllocations = heap.stats.allocations - allocations;
      const managedAllocatedBytes = heap.stats.allocatedBytes - allocatedBytes;

      // Inspection may allocate; it is deliberately outside the measured region.
      const sorted = call('ToArray');
      heap.pins.push(sorted);
      assert.deepEqual(heap.get(sorted).data.map(value => platform.native(value)), expected);
      assert.equal(call('get_Count'), count);
      return {elapsedMs, managedAllocations, managedAllocatedBytes};
    });
  } finally {
    vm.stop();
  }
}

function summarize(values) {
  const ordered = values.toSorted((left, right) => left - right);
  return {median: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.ceil(ordered.length * 0.95) - 1]};
}

const engines = {};
for (const engine of ['source', 'cil']) {
  for (let warmup = 0; warmup < warmupCount; warmup++) sample(engine);
  const samples = Array.from({length: sampleCount}, () => sample(engine));
  engines[engine] = {
    elapsedMs: summarize(samples.map(row => row.elapsedMs)),
    managedAllocations: summarize(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summarize(samples.map(row => row.managedAllocatedBytes)),
    samples
  };
}

console.log(JSON.stringify({
  node: process.version,
  v8: process.versions.v8,
  icu: process.versions.icu ?? null,
  cldr: process.versions.cldr ?? null,
  unicode: process.versions.unicode ?? null,
  platform: process.platform,
  arch: process.arch,
  cpu: cpus()[0]?.model,
  count,
  warmupCount,
  sampleCount,
  gcAvailable: typeof globalThis.gc === 'function',
  backend,
  workload: 'Default List<string>.Sort through each real VM platform on deterministic nullable strings',
  notes: 'Timing excludes provider setup, compilation, input allocation, host GC and output checks. Managed allocation counters only.',
  qualification: 'Digit strings have the same order in both profiles; the backends differ on general text semantics.',
  engines
}, null, 2));
