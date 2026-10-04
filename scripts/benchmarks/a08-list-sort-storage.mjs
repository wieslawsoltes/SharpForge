import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {findContracts} from '@sharpforge/framework';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

// Copy this identical runner into the ordinal parent; execute both revisions serially.
const count = Number(process.argv[2] ?? 1024);
const capacity = Number(process.argv[3] ?? 65536);
assert(Number.isInteger(count) && count >= 2 && count <= 32768, 'Count must be within 2..32768');
assert(Number.isInteger(capacity) && capacity >= count && capacity <= 131072, 'Capacity must be within count..131072');
const input = Array.from({length: count}, (_, index) => index % 17 === 0 ? null :
  String((Math.imul(index, 2654435761) >>> 0) % 2048).padStart(4, '0'));
const expected = input.toSorted((left, right) =>
  left === right ? 0 : left === null ? -1 : right === null ? 1 : left < right ? -1 : 1);

function sample(engine, explicit) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'string');
  const heap = platform.heap;
  try {
    return heap.withRoots([reference], () => {
      call('set_Capacity', capacity);
      const values = input.map(value => {
        const managed = platform.managed(value, 'string');
        heap.pins.push(managed);
        return managed;
      });
      const array = heap.allocate('array', 'string[]', values);
      heap.pins.push(array);
      call('AddRange', array);
      const comparer = platform.invoke(findContracts('System.StringComparer', 'get_Ordinal')[0], []);
      const storage = platform.get(reference, '$data');
      const backing = heap.get(storage).data;
      let slotWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
      globalThis.gc?.();
      const hostBytes = process.memoryUsage().heapUsed;
      const allocations = heap.stats.allocations;
      const started = performance.now();
      explicit ? call('Sort', comparer) : call('Sort');
      const elapsedMs = performance.now() - started;
      const heapUsedDeltaBytes = process.memoryUsage().heapUsed - hostBytes;
      const managedAllocations = heap.stats.allocations - allocations;
      const after = heap.get(storage).data;
      assert.deepEqual(after.slice(0, count).map(value => platform.native(value)), expected);
      assert.equal(call('get_Count'), count);
      assert.equal(call('get_Capacity'), capacity);
      return {elapsedMs, heapUsedDeltaBytes, managedAllocations, slotWrites, backingReplacements: Number(after !== backing)};
    });
  } finally { vm.stop(); }
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[2], p95: sorted[4]};
}

const results = [];
for (const engine of ['source', 'cil']) {
  for (const explicit of [false, true]) {
    sample(engine, explicit);
    const samples = Array.from({length: 5}, () => sample(engine, explicit));
    results.push({engine, comparer: explicit ? 'ordinal' : 'default',
      elapsedMs: summarize(samples.map(row => row.elapsedMs)),
      heapUsedDeltaBytes: summarize(samples.map(row => row.heapUsedDeltaBytes)), samples});
  }
}

console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  count, capacity, warmupCount: 1, sampleCount: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'List<string>.Sort through real platform dispatch with spare capacity and write observation',
  notes: 'Setup, optional host GC and output checks excluded. Host heap deltas are uncollected observations, not total allocation counts.',
  results
}, null, 2));
