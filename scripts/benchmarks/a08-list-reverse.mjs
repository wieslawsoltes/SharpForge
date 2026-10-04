// node scripts/benchmarks/a08-list-reverse.mjs [count=2000] [repetitions=200]
// Copy this same runner into the baseline checkout; run both serially on a quiet machine.
import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';

const count = Number(process.argv[2] ?? 2000);
const repetitions = Number(process.argv[3] ?? 200);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
assert(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 1000, 'Repetitions must be within 1..1000');
const samples = [];

function run(engine, capacityFactor, sample) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'List', 'int');
  const ownerRoot = platform.heap.createHandle(reference);
  try {
    call('set_Capacity', count * capacityFactor);
    for (let index = 0; index < count; index++) call('Add', index);
    const storage = platform.get(reference, '$data');
    let backing = platform.heap.get(storage).data;
    const allocations = platform.heap.stats.allocations;
    let replacements = 0;
    let writes = 0;
    vm.onWrite = event => { if (event.kind === 'array') writes++; };
    const started = performance.now();
    for (let index = 0; index < repetitions; index++) {
      call('Reverse');
      const next = platform.heap.get(storage).data;
      if (next !== backing) replacements++;
      backing = next;
    }
    const elapsedMs = performance.now() - started;
    assert.equal(call('get_Count'), count);
    assert.equal(call('get_Capacity'), count * capacityFactor);
    for (let index = 0; index < count; index++) {
      assert.equal(backing[index], repetitions % 2 ? count - index - 1 : index);
    }
    assert(backing.slice(count).every(value => value === null));
    if (sample >= 0) samples.push({
      engine, capacityFactor, sample, count, repetitions, elapsedMs,
      backingReplacements: replacements, slotWrites: writes,
      managedAllocations: platform.heap.stats.allocations - allocations
    });
  } finally {
    platform.heap.releaseHandle(ownerRoot);
    vm.stop();
  }
}

for (const engine of ['source', 'cil']) {
  for (const capacityFactor of [1, 4]) {
    for (let sample = -1; sample < 5; sample++) run(engine, capacityFactor, sample);
  }
}
console.log(JSON.stringify({
  node: process.version, platform: process.platform, arch: process.arch,
  workload: 'List<int>.Reverse via VM platform with exact/spare capacity and a write observer; setup excluded',
  warmupsPerWorkload: 1, samplesPerWorkload: 5, samples
}, null, 2));
