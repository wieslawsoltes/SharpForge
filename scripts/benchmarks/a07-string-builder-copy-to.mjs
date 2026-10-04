// Copy this identical runner to 1ce94895; execute baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 200);
const chunks = Number(process.argv[3] ?? 64);
assert(Number.isInteger(calls) && calls >= 10 && calls <= 2000);
assert(Number.isInteger(chunks) && chunks >= 4 && chunks <= 256);
const segment = 'a\0\ud800\udc00'.repeat(4);
const text = segment.repeat(chunks);
const sourceIndex = Math.floor(text.length / 4);
const count = Math.floor(text.length / 2);
const owner = 'System.Text.StringBuilder';
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const contract = (name, parameters) => findContracts(owner, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const constructor = contract('.ctor', []);
const append = contract('Append', ['string']);
const workloads = [
  {name: 'substring-control', method: 'ToString', parameters: ['int', 'int']},
  {name: 'copy-window', method: 'CopyTo', parameters: ['int', 'char[]', 'int', 'int'], copy: true},
  {name: 'validated-zero-copy', method: 'CopyTo', parameters: ['int', 'char[]', 'int', 'int'], copy: true, zero: true}
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
      const destination = heap.allocate('array', 'char[]', Array(count + 4).fill(46));
      heap.pins.push(destination);
      const args = workload.copy ? [builder, workload.zero ? text.length : sourceIndex, destination,
        workload.zero ? count + 4 : 2, workload.zero ? 0 : count] : [builder, sourceIndex, count];
      let slotWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let returned;
      const started = performance.now();
      for (let index = 0; index < calls; index++) returned = platform.invoke(descriptor, args);
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
      vm.onWrite = null;
      const expected = text.slice(sourceIndex, sourceIndex + count);
      if (workload.copy) {
        assert.equal(returned, null);
        const units = workload.zero ? Array(count + 4).fill(46)
          : [46, 46, ...expected.split('').map(unit => unit.charCodeAt(0)), 46, 46];
        assert.deepEqual(heap.get(destination).data, units);
        assert.equal(slotWrites, calls * (workload.zero ? 0 : count));
      } else assert.equal(platform.native(returned), expected);
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
      engines[engine][workload.name] = {skipped: true, reason: 'CopyTo overload absent on baseline'};
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
  calls, chunks, sourceIndex, count, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: existing substring control and separate CopyTo/zero-copy costs',
  notes: 'Setup and checks excluded. Nonempty CopyTo uses O(live chunks) host roots, one scan and no managed text allocation.',
  engines}, null, 2));
