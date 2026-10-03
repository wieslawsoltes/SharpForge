// Run serially: node scripts/benchmarks/a08-collection-removal.mjs [count=100000] [Dictionary|HashSet]
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 100000);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
const families = process.argv[3] ? [process.argv[3]] : ['Dictionary', 'HashSet'];
assert(families.every(family => ['Dictionary', 'HashSet'].includes(family)), 'Unknown collection family');
const samples = [];

function run(engine, family, sample) {
  const types = family === 'Dictionary' ? 'int, int' : 'int';
  const {vm, platform, reference, call} = createClosedCollection(engine, family, types);
  try {
    for (let key = 0; key < count; key++) {
      if (family === 'Dictionary') call('Add', key, key);
      else call('Add', key);
    }
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
    samples.push({engine, family, sample, count, elapsedMs, indexRebuilds: rebuilds, managedAllocations: 0});
  } finally { vm.stop(); }
}

for (const engine of ['source', 'cil']) {
  for (const family of families) {
    for (let sample = 0; sample < 3; sample++) run(engine, family, sample);
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'Dictionary<int,int>/HashSet<int>.Remove via each VM platform; construction and compilation excluded',
  thresholdMs: 1000, samples
}, null, 2));
assert(samples.every(sample => sample.elapsedMs < 1000), 'Removal exceeded the one-second acceptance threshold');
