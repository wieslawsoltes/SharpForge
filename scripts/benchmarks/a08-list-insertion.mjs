// node scripts/benchmarks/a08-list-insertion.mjs [count=2000]
// Copy this same runner into the baseline checkout; run both serially on a quiet machine.
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 2000);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
const samples = [];

function run(engine, workload, sample) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
  const ownerRoot = platform.heap.createHandle(reference);
  let inputRoot;
  try {
    call('set_Capacity', count);
    const extra = platform.heap.allocate('array', 'int[]', [1]);
    inputRoot = platform.heap.createHandle(extra);
    const storage = platform.get(reference, '$data');
    let backing = platform.heap.get(storage).data;
    const allocations = platform.heap.stats.allocations;
    let replacements = 0;
    let writes = 0;
    vm.onWrite = event => { if (event.kind === 'array') writes++; };
    const started = performance.now();
    for (let index = 0; index < count; index++) {
      if (workload === 'insert-tail') call('Insert', index, 1);
      else call('AddRange', extra);
      const next = platform.heap.get(storage).data;
      if (next !== backing) replacements++;
      backing = next;
    }
    const elapsedMs = performance.now() - started;
    assert.equal(call('get_Count'), count);
    assert(backing.every(value => value === 1));
    if (sample >= 0) samples.push({
      engine, workload, sample, count, elapsedMs, backingReplacements: replacements, slotWrites: writes,
      managedAllocations: platform.heap.stats.allocations - allocations
    });
  } finally {
    if (inputRoot) platform.heap.releaseHandle(inputRoot);
    platform.heap.releaseHandle(ownerRoot);
    vm.stop();
  }
}

for (const engine of ['source', 'cil']) {
  for (const workload of ['insert-tail', 'add-range-one']) {
    for (let sample = -1; sample < 5; sample++) run(engine, workload, sample);
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'List<int>.Insert(Count) and AddRange(single item) with spare capacity via VM platform; setup excluded',
  warmupsPerWorkload: 1, samplesPerWorkload: 5, samples
}, null, 2));
