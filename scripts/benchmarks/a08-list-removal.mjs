// node scripts/benchmarks/a08-list-removal.mjs [count=2000]
// Copy this same runner into the baseline checkout; run both serially on a quiet machine.
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 2000);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
const samples = [];

function run(engine, workload, sample) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
  try {
    for (let index = 0; index < count; index++) call('Add', index);
    const storage = platform.get(reference, '$data');
    let backing = platform.heap.get(storage).data;
    const allocations = platform.heap.stats.allocations;
    let replacements = 0;
    let writes = 0;
    vm.onWrite = event => { if (event.kind === 'array') writes++; };
    let remaining = count;
    const rangeLength = Math.max(1, Math.floor(count / 10));
    const started = performance.now();
    while (remaining) {
      const length = workload === 'tail' ? 1 : Math.min(rangeLength, remaining);
      if (workload === 'tail') call('RemoveAt', remaining - 1);
      else call('RemoveRange', Math.floor((remaining - length) / 2), length);
      remaining -= length;
      const next = platform.heap.get(storage).data;
      if (next !== backing) replacements++;
      backing = next;
    }
    const elapsedMs = performance.now() - started;
    assert.equal(call('get_Count'), 0);
    assert(backing.every(value => value === null));
    if (sample >= 0) samples.push({
      engine, workload, sample, count, elapsedMs, backingReplacements: replacements, slotWrites: writes,
      managedAllocations: platform.heap.stats.allocations - allocations
    });
  } finally { vm.stop(); }
}

for (const engine of ['source', 'cil']) {
  for (const workload of ['tail', 'middle-ranges']) {
    for (let sample = -1; sample < 5; sample++) run(engine, workload, sample);
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'List<int>.RemoveAt(last) and RemoveRange(middle) via VM platform; setup excluded',
  warmupsPerWorkload: 1, samplesPerWorkload: 5, samples
}, null, 2));
