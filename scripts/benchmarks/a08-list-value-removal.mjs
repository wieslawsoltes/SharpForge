// node scripts/benchmarks/a08-list-value-removal.mjs [count=2000]
// Copy this same runner into the baseline checkout; run both serially on a quiet machine.
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 2000);
assert(Number.isInteger(count) && count > 0 && count <= 10000, 'Count must be within 1..10000');
const samples = [];

function run(engine, workload, sample) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
  try {
    for (let value = 0; value < count; value++) call('Add', value);
    const storage = platform.get(reference, '$data');
    let backing = platform.heap.get(storage).data;
    const allocations = platform.heap.stats.allocations;
    let replacements = 0;
    let writes = 0;
    vm.onWrite = event => { if (event.kind === 'array') writes++; };
    const started = performance.now();
    if (workload === 'clear') {
      call('Clear');
      if (platform.heap.get(storage).data !== backing) replacements++;
    } else {
      for (let value = count - 1; value >= 0; value--) {
        assert(platform.native(call('Remove', value)));
        const next = platform.heap.get(storage).data;
        if (next !== backing) replacements++;
        backing = next;
      }
    }
    const elapsedMs = performance.now() - started;
    assert.equal(call('get_Count'), 0);
    assert(platform.heap.get(storage).data.every(value => value === null));
    if (sample >= 0) samples.push({
      engine, workload, sample, count, elapsedMs, backingReplacements: replacements, slotWrites: writes,
      managedAllocations: platform.heap.stats.allocations - allocations
    });
  } finally { vm.stop(); }
}

for (const engine of ['source', 'cil']) {
  for (const workload of ['remove-tail-value', 'clear']) {
    for (let sample = -1; sample < 5; sample++) run(engine, workload, sample);
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'List<int>.Remove(last value) and Clear via VM platform; setup excluded',
  note: 'Remove(value) retains linear lookup; repeated value removals can remain quadratic.',
  warmupsPerWorkload: 1, samplesPerWorkload: 5, samples
}, null, 2));
