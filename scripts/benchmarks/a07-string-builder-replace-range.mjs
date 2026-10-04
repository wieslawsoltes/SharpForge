// Copy this runner to repro 91b265df5; execute baseline and candidate serially.
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
const contract = (name, parameters) => findContracts(owner, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const constructor = contract('.ctor', ['string']);
const append = contract('Append', ['string']);
const toString = contract('ToString', []);
const workloads = [
  {name: 'length-control', method: 'get_Length', parameters: []},
  {name: 'whole-string-control', method: 'Replace', parameters: ['string', 'string'], change: true},
  {name: 'range-equal-width', method: 'Replace', parameters: ['string', 'string', 'int', 'int'], change: true},
  {name: 'range-zero', method: 'Replace', parameters: ['string', 'string', 'int', 'int'], zero: true},
  {name: 'range-absent', method: 'Replace', parameters: ['string', 'string', 'int', 'int']},
  {name: 'range-repeated-prefix-miss', method: 'Replace', parameters: ['string', 'string', 'int', 'int'], stress: true},
  {name: 'range-repeated-prefix-late-hit', method: 'Replace', parameters: ['string', 'string', 'int', 'int'], stress: true, change: true}
];

function createInput(platform, workload) {
  const {heap} = platform;
  const initial = workload.stress ? 'a'.repeat(16384) + 'b' : segment.repeat(chunks);
  const builder = platform.invoke(constructor, [heap.string(workload.stress ? initial : '')]);
  heap.pins.push(builder);
  if (!workload.stress) {
    const value = heap.string(segment);
    heap.pins.push(value);
    for (let index = 0; index < chunks; index++) platform.invoke(append, [builder, value]);
  }
  const oldText = workload.stress ? 'a'.repeat(127) + (workload.change ? 'b' : 'z') : workload.change ? 'a' : 'q';
  const newText = workload.stress ? 'a'.repeat(127) + 'c' : 'b';
  const values = [oldText, newText].map(value => {
    const reference = heap.string(value);
    heap.pins.push(reference);
    return reference;
  });
  const args = workload.parameters.length === 0 ? [builder] : workload.parameters.length === 2
    ? [builder, ...values] : [builder, ...values, 0, workload.zero ? 0 : initial.length];
  return {builder, args, initial, oldText, newText, values};
}

function measure(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const {builder, args, initial, oldText, newText, values} = createInput(platform, workload);
      const iterations = workload.stress ? 20 : calls;
      let writes = 0;
      vm.onWrite = () => {writes++;};
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let checksum = 0;
      const started = performance.now();
      for (let index = 0; index < iterations; index++) {
        if (workload.change) {
          args[1] = values[index % 2];
          args[2] = values[1 - index % 2];
        }
        const result = platform.invoke(descriptor, args);
        if (workload.parameters.length === 0) checksum += result;
      }
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, iterations, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, writes};
      vm.onWrite = null;
      if (workload.parameters.length === 0) assert.equal(checksum, initial.length * iterations);
      const expected = workload.change && iterations % 2 ? initial.split(oldText).join(newText) : initial;
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
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Range overload absent on baseline'};
      continue;
    }
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
  calls, chunks, stressCalls: 20, stressUnits: 16385, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released Length/whole Replace controls and separate ranged literal replacement costs',
  notes: 'Setup and final text checks excluded; managed counters omit host split arrays and temporary text. Native host search cost is measured.',
  engines}, null, 2));
