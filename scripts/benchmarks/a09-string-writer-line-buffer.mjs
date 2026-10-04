// node --expose-gc scripts/benchmarks/a09-string-writer-line-buffer.mjs [calls=64] [length=1024]
// Copy this exact runner to 1ff8cd7b; run the checkouts serially on a quiet machine.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {findContracts} from '@sharpforge/framework';
import {writerPlatform, writerType} from '../../tests/fixtures/text-writer/engines.js';

const calls = Number(process.argv[2] ?? 64);
const length = Number(process.argv[3] ?? 1024);
assert(Number.isInteger(calls) && calls >= 1 && calls <= 1024);
assert(Number.isInteger(length) && length >= 1 && length <= 4096);
assert(calls * (length + 1) <= 262144, 'Keep each writer below 262144 output units');
const input = Array.from({length}, (_, index) => [65, 0, 0xd800, 0xdc00, 0xffff][index % 5]);
const text = String.fromCharCode(...input);
const workloads = [
  {name: 'string-line-control', method: 'WriteLine', parameters: ['string'], string: true},
  {name: 'separate-full-control', method: 'Write', parameters: ['char[]'], separate: true},
  {name: 'separate-slice-control', method: 'Write', parameters: ['char[]', 'int', 'int'], separate: true, slice: true},
  {name: 'whole-buffer-line', method: 'WriteLine', parameters: ['char[]']},
  {name: 'slice-buffer-line', method: 'WriteLine', parameters: ['char[]', 'int', 'int'], slice: true},
  {name: 'separate-character-control', method: 'Write', parameters: ['char'], character: true, separate: true},
  {name: 'character-line', method: 'WriteLine', parameters: ['char'], character: true}
];
const newline = findContracts(writerType, 'WriteLine').find(member => member.parameters.length === 0);

function summary(samples, key) {
  const values = samples.map(sample => sample[key]).toSorted((left, right) => left - right);
  return {median: values[Math.floor(values.length / 2)], p95: values[Math.ceil(values.length * 0.95) - 1]};
}

function sample(engine, workload, descriptor) {
  const writer = writerPlatform(engine);
  const {platform, vm, reference, call} = writer;
  const {heap} = platform;
  const buffer = heap.allocate('array', 'char[]', workload.slice ? [33, ...input, 63] : [...input]);
  const root = heap.createHandle(buffer);
  const args = workload.character ? [reference, 0xd800] : workload.string ? [reference, text] :
    workload.slice ? [reference, buffer, 1, length] : [reference, buffer];
  const newlineArgs = [reference];
  let slotWrites = 0;
  try {
    vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
    globalThis.gc?.();
    const allocations = heap.stats.allocations;
    const bytes = heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) {
      platform.invoke(descriptor, args);
      if (workload.separate) platform.invoke(newline, newlineArgs);
    }
    const elapsedMs = performance.now() - started;
    const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
      managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
    vm.onWrite = null;
    assert.equal(platform.native(call('ToString')), ((workload.character ? '\ud800' : text) + '\n').repeat(calls));
    return result;
  } finally { vm.onWrite = null; heap.releaseHandle(root); writer.stop(); }
}

const engines = {source: {}, cil: {}};
for (const workload of workloads) {
  const descriptor = findContracts(writerType, workload.method)
    .find(member => member.parameters.join(',') === workload.parameters.join(','));
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'WriteLine overload absent on the baseline'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const value = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(value);
    }
    engines[engine][workload.name] = {outputUnits: calls * (workload.character ? 2 : length + 1), elapsedMs: summary(samples, 'elapsedMs'),
      managedAllocations: summary(samples, 'managedAllocations'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, length, warmups: 1, samples: 5,
  workload: 'Actual source/CIL platform dispatch: string lines, separate buffer/character newline controls and combined line calls',
  notes: 'Setup and materialization excluded; managed allocation and slot-write counters included. New paths skipped on baseline.',
  engines}, null, 2));
