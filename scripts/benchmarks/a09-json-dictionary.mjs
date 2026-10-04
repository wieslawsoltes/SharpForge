import assert from 'node:assert/strict';
import {createClosedCollection} from '../../tests/helpers/closed-collection.js';
import {findContracts} from '@sharpforge/framework';
const serialize = findContracts('System.Text.Json.JsonSerializer', 'Serialize', true)[0];
const samples = [];
for (const engine of ['source', 'cil']) {
  const {vm, platform, reference, call} = createClosedCollection(engine, 'Dictionary', 'string, int');
  try {
    const entries = Array.from({length: 64}, (_, index) => ['k' + index, index]);
    for (const [key, value] of entries) call('Add', platform.managed(key, 'string'), value);
    const expected = JSON.stringify(Object.fromEntries(entries));
    for (let sample = -1; sample < 5; sample++) {
      const allocated = vm.heap.stats.allocations;
      const start = performance.now();
      for (let index = 0; index < 100; index++) {
        assert.equal(platform.native(platform.invoke(serialize, [reference])), expected);
      }
      const elapsedMs = performance.now() - start;
      if (sample >= 0) samples.push({engine, sample, elapsedMs, managedAllocations: vm.heap.stats.allocations - allocated});
    }
  } finally {vm.stop();}
}
console.log(JSON.stringify({node: process.version, count: 100, entries: 64, samples}, null, 2));
