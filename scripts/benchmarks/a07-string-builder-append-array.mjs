// Copy this identical runner to ef0d27c3; execute parent and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 2000);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 5000, 'Calls must be within 100..5000');
const owner = 'System.Text.StringBuilder';
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const contract = (name, parameters) => findContracts(owner, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const constructor = contract('.ctor', ['string']);
const toString = contract('ToString', []);
const selected = '\0\ud800'.repeat(32);
const units = text => Array.from({length: text.length}, (_, index) => text.charCodeAt(index));
const large = '\ud800\udc00\0'.repeat(1366);
const workloads = [
  {name: 'string-control', parameters: ['string'], value: selected, output: selected},
  {name: 'character-control', parameters: ['char'], value: 65, output: 'A'},
  {name: 'string-range-control', parameters: ['string', 'int', 'int'], value: 'x' + selected + 'y',
    range: [1, selected.length], output: selected},
  {name: 'full-array', parameters: ['char[]'], value: units(selected), output: selected},
  {name: 'array-slice', parameters: ['char[]', 'int', 'int'], value: units('x' + selected + 'y'),
    range: [1, selected.length], output: selected},
  {name: 'block-boundary', parameters: ['char[]'], value: units(large), output: large, calls: 20},
  {name: 'zero-at-end', parameters: ['char[]', 'int', 'int'], value: [65], range: [1, 0], output: ''},
  {name: 'null-array', parameters: ['char[]'], value: null, output: ''}
];

function sample(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  const iterations = workload.calls ?? calls;
  try {
    return heap.withRoots([], () => {
      const builder = platform.invoke(constructor, [heap.string('seed|')]);
      heap.pins.push(builder);
      const value = Array.isArray(workload.value) ? heap.allocate('array', 'char[]', [...workload.value])
        : platform.managed(workload.value, workload.parameters[0]);
      heap.pins.push(value);
      const args = [builder, value, ...(workload.range ?? [])];
      let slotWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let returned;
      const started = performance.now();
      for (let index = 0; index < iterations; index++) returned = platform.invoke(descriptor, args);
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
      vm.onWrite = null;
      assert.deepEqual(returned, builder);
      assert.equal(platform.native(platform.invoke(toString, [builder])), 'seed|' + workload.output.repeat(iterations));
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
  const descriptor = contract('Append', workload.parameters);
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Character-array overload absent on parent'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {calls: workload.calls ?? calls,
      outputUnits: 5 + (workload.calls ?? calls) * workload.output.length,
      elapsedMs: summary(samples, 'elapsedMs'), managedAllocations: summary(samples, 'managedAllocations'),
      managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released scalar/range controls and separate array conversion/no-op costs',
  notes: 'Setup, input allocation, host GC and final materialization excluded. Host temporary blocks/text are not managed allocations.',
  engines}, null, 2));
