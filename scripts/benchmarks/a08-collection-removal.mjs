// Run serially on a quiet machine: node scripts/benchmarks/a08-collection-removal.mjs [count=100000]
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 100000);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
const samples = [];
for (const engine of ['source', 'cil']) {
  for (let sample = 0; sample < 3; sample++) {
    const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'int, int');
    try {
      for (let key = 0; key < count; key++) call('Add', key, key);
      const record = platform.record(reference);
      const initialIndex = platform.bclIndexes.get(record).index;
      const initialData = platform.heap.get(platform.get(reference, '$data')).data;
      const allocations = platform.heap.stats.allocations;
      let removed = 0;
      let rebuilds = 0;
      const started = performance.now();
      for (let key = 0; key < count; key++) {
        if (platform.native(call('Remove', key))) removed++;
        if (platform.bclIndexes.get(record).index !== initialIndex) rebuilds++;
      }
      const elapsedMs = performance.now() - started;
      assert.equal(removed, count);
      assert.equal(call('get_Count'), 0);
      assert.equal(rebuilds, 0);
      assert.strictEqual(platform.heap.get(platform.get(reference, '$data')).data, initialData);
      assert.equal(platform.heap.stats.allocations, allocations);
      samples.push({engine, sample, count, elapsedMs, indexRebuilds: rebuilds, managedAllocations: 0});
    } finally { vm.stop(); }
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'Dictionary<int,int>.Remove via each VM platform; construction and compilation excluded',
  thresholdMs: 1000, samples
}, null, 2));
assert(samples.every(sample => sample.elapsedMs < 1000), 'Removal exceeded the one-second acceptance threshold');
