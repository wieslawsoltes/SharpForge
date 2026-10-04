// node --expose-gc scripts/benchmarks/a09-string-writer-buffer.mjs [calls=64] [length=1024]
// Copy this exact runner to b0521bbd; run the checkouts serially on a quiet machine.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {findContracts} from '@sharpforge/framework';
import {writerPlatform, writerType} from '../../tests/fixtures/text-writer/engines.js';

const calls = Number(process.argv[2] ?? 64);
const length = Number(process.argv[3] ?? 1024);
assert(Number.isInteger(calls) && calls >= 1 && calls <= 1024);
assert(Number.isInteger(length) && length >= 1 && length <= 4096);
assert(calls * length <= 262144, 'Keep each writer below 262144 output units');
const input = Array.from({length}, (_, index) => [65, 0, 0xd800, 0xdc00, 0xffff][index % 5]);
const text = String.fromCharCode(...input);
const workloads = [
  {name: 'string-control', parameters: ['string']}, {name: 'character-control', parameters: ['char']},
  {name: 'whole-buffer', parameters: ['char[]']}, {name: 'slice-buffer', parameters: ['char[]', 'int', 'int']}
];

function summary(samples, key) {
  const values = samples.map(sample => sample[key]).toSorted((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

function sample(engine, workload, descriptor) {
  const writer = writerPlatform(engine);
  const {platform, vm, reference, call} = writer;
  const {heap} = platform;
  const slice = workload.name === 'slice-buffer';
  const buffer = heap.allocate('array', 'char[]', slice ? [33, ...input, 63] : [...input]);
  const root = heap.createHandle(buffer);
  const character = workload.name === 'character-control';
  const args = workload.name === 'string-control' ? [reference, text] : character ? [reference, 0] :
    slice ? [reference, buffer, 1, length] : [reference, buffer];
  let slotWrites = 0;
  try {
    vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
    globalThis.gc?.();
    const allocations = heap.stats.allocations;
    const bytes = heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) {
      if (character) {
        for (const unit of input) { args[1] = unit; platform.invoke(descriptor, args); }
      } else platform.invoke(descriptor, args);
    }
    const elapsedMs = performance.now() - started;
    const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
      managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
    vm.onWrite = null;
    assert.equal(platform.native(call('ToString')), text.repeat(calls));
    return result;
  } finally { vm.onWrite = null; heap.releaseHandle(root); writer.stop(); }
}

const engines = {source: {}, cil: {}};
for (const workload of workloads) {
  const descriptor = findContracts(writerType, 'Write').find(member => member.parameters.join(',') === workload.parameters.join(','));
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Buffer overload absent on the baseline'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const value = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(value);
    }
    engines[engine][workload.name] = {elapsedMs: summary(samples, 'elapsedMs'),
      managedAllocations: summary(samples, 'managedAllocations'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, length, outputUnits: calls * length, warmups: 1, samples: 5,
  workload: 'Actual source/CIL platform dispatch: existing string/character writes and new full/slice character buffers',
  notes: 'Setup and final materialization checks excluded; managed allocation and slot-write counters included. New paths skipped on baseline.',
  engines}, null, 2));
