// Copy this identical runner to 938d86fe; execute baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 2000);
const chunks = Number(process.argv[3] ?? 64);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 5000);
assert(Number.isInteger(chunks) && chunks >= 1 && chunks <= 256);
const unitCount = 16;
const segment = 'a\0\ud800\udc00'.repeat(4);
const initial = segment.repeat(chunks);
const owner = 'System.Text.StringBuilder';
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const contract = (name, parameters) => findContracts(owner, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const constructor = contract('.ctor', []);
const append = contract('Append', ['string']);
const toString = contract('ToString', []);
const workloads = [
  {name: 'length-control', method: 'get_Length', parameters: []},
  {name: 'substring-control', method: 'ToString', parameters: ['int', 'int'], slice: true},
  {name: 'character-append-control', method: 'Append', parameters: ['char'], append: true},
  {name: 'character-get', method: 'get_Chars', parameters: ['int'], read: true},
  {name: 'character-set', method: 'set_Chars', parameters: ['int', 'char'], write: true}
];

function measure(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const builder = platform.invoke(constructor, []);
      heap.pins.push(builder);
      const value = heap.string(segment);
      heap.pins.push(value);
      for (let index = 0; index < chunks; index++) platform.invoke(append, [builder, value]);
      const args = workload.append ? [builder, 65] : workload.slice ? [builder, 0, 1]
        : workload.write ? [builder, 0, 90] : workload.read ? [builder, 0] : [builder];
      let slotWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let checksum = 0;
      const started = performance.now();
      for (let index = 0; index < calls; index++) {
        if (workload.slice || workload.write || workload.read) args[1] = index * 17 % initial.length;
        const result = platform.invoke(descriptor, args);
        if (workload.read || workload.name === 'length-control') checksum += result;
      }
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
      vm.onWrite = null;
      const expected = initial.split('');
      if (workload.write) for (let index = 0; index < calls; index++) expected[index * 17 % initial.length] = 'Z';
      if (workload.read) {
        let sum = 0;
        for (let index = 0; index < calls; index++) sum += initial.charCodeAt(index * 17 % initial.length);
        assert.equal(checksum, sum);
      }
      if (workload.name === 'length-control') assert.equal(checksum, initial.length * calls);
      assert.equal(platform.native(platform.invoke(toString, [builder])), expected.join('') + (workload.append ? 'A'.repeat(calls) : ''));
      return result;
    });
  } finally { vm.onWrite = null; vm.stop(); }
}

function summary(samples, key) {
  const values = samples.map(row => row[key]).toSorted((left, right) => left - right);
  return {median: values[2], p95: values[4]};
}

const engines = {source: {}, cil: {}};
for (const workload of workloads) {
  const descriptor = contract(workload.method, workload.parameters);
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Chars indexer absent on baseline'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = measure(engine, workload, descriptor);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {elapsedMs: summary(samples, 'elapsedMs'),
      managedAllocations: summary(samples, 'managedAllocations'), managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, chunks, unitCount, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released length/substring/Append controls and separate native indexer costs',
  notes: 'Setup and final materialization excluded. Getter scans chunks; setter scans chunks and copies only the affected chunk.',
  engines}, null, 2));
