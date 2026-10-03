// node scripts/benchmarks/a08-list-removal.mjs [worktree] [count=2000]
// Run baseline ba89dd0b and candidate serially on the same quiet machine.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../../', import.meta.url)));
const count = Number(process.argv[3] ?? 2000);
assert(Number.isInteger(count) && count > 0 && count <= 100000, 'Count must be within 1..100000');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const {createClosedCollection} = await import(pathToFileURL(resolve(root, 'tests/helpers/closed-collection.js')));
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
  node: process.version, platform: process.platform, arch: process.arch, revision,
  workload: 'List<int>.RemoveAt(last) and RemoveRange(middle) via VM platform; setup excluded',
  warmupsPerWorkload: 1, samplesPerWorkload: 5, samples
}, null, 2));
