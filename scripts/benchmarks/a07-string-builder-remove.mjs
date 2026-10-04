// Copy this identical runner to pre-product 1aceb629b; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 2000);
const chunks = Number(process.argv[3] ?? 64);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 5000);
assert(Number.isInteger(chunks) && chunks >= 1 && chunks <= 128);
const segment = 'a\0\ud800\udc00'.repeat(4);
const owner = 'System.Text.StringBuilder';
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const contract = (name, parameters) => {
  const descriptor = findContracts(owner, name).find(member => member.parameters.join(',') === parameters.join(','));
  assert(descriptor, `${name}(${parameters.join(',')})`);
  return descriptor;
};
const constructor = contract('.ctor', ['string']);
const append = contract('Append', ['string']);
const toString = contract('ToString', []);
const workloads = [
  {name: 'length-control', method: 'get_Length', parameters: []},
  {name: 'substring-control', method: 'ToString', parameters: ['int', 'int']},
  {name: 'remove-one-control', method: 'Remove', parameters: ['int', 'int'], nonempty: true, flat: true},
  {name: 'remove-zero-flat', method: 'Remove', parameters: ['int', 'int'], flat: true},
  {name: 'remove-zero-segmented', method: 'Remove', parameters: ['int', 'int']},
  {name: 'remove-zero-long-segmented', method: 'Remove', parameters: ['int', 'int'], long: true}
];

function measure(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const chunk = workload.long ? segment.repeat(16) : segment;
      const expected = chunk.repeat(chunks);
      const initial = (workload.nonempty ? 'A'.repeat(calls) : '') + expected;
      const builder = platform.invoke(constructor, [heap.string(workload.flat ? initial : '')]);
      heap.pins.push(builder);
      if (!workload.flat) {
        const value = heap.string(chunk);
        heap.pins.push(value);
        for (let index = 0; index < chunks; index++) platform.invoke(append, [builder, value]);
      }
      const count = workload.nonempty || workload.method === 'ToString' ? 1 : 0;
      const args = workload.parameters.length ? [builder, 0, count] : [builder];
      let writes = 0;
      vm.onWrite = () => {writes++;};
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let checksum = 0;
      const started = performance.now();
      for (let index = 0; index < calls; index++) {
        const result = platform.invoke(descriptor, args);
        if (!workload.parameters.length) checksum += result;
      }
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, writes};
      vm.onWrite = null;
      if (!workload.parameters.length) assert.equal(checksum, expected.length * calls);
      assert.equal(platform.native(platform.invoke(toString, [builder])), expected);
      return result;
    });
  } finally {vm.onWrite = null; vm.stop();}
}

function summary(samples, key) {
  const values = samples.map(row => row[key]).toSorted((left, right) => left - right);
  return {median: values[2], p95: values[4]};
}

const engines = {source: {}, cil: {}};
for (const workload of workloads) {
  const descriptor = contract(workload.method, workload.parameters);
  for (const engine of Object.keys(engines)) {
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = measure(engine, workload, descriptor);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {elapsedMs: summary(samples, 'elapsedMs'),
      managedAllocations: summary(samples, 'managedAllocations'), managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'),
      writes: summary(samples, 'writes'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, chunks, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released Length/ToString/Remove controls and valid zero-length Remove',
  notes: 'Setup and final text checks excluded. Nonempty Remove retains full-text materialization. Host allocations are not counted.',
  engines}, null, 2));
