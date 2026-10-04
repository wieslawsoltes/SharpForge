// Copy this identical runner to 1bc75904 (or its final integration); run both revisions serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {decimal} from '@sharpforge/bytecode';
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
const maximum = 79228162514264337593543950335n;
const workloads = [
  {name: 'string-control', type: 'string', value: 'A', output: 'A'},
  {name: 'integer-control', type: 'int', value: 65, output: '65'},
  {name: 'character-control', type: 'char', value: 65, output: 'A'},
  {name: 'decimal-maximum', type: 'decimal', value: decimal(maximum), output: '79228162514264337593543950335'},
  {name: 'decimal-minimum', type: 'decimal', value: decimal(maximum, 0, true), output: '-79228162514264337593543950335'},
  {name: 'decimal-scale-28', type: 'decimal', value: decimal(maximum, 28, true), output: '-7.9228162514264337593543950335'},
  {name: 'decimal-signed-zero', type: 'decimal', value: decimal(0n, 28, true), output: '0.0000000000000000000000000000'},
  {name: 'decimal-trailing-zeros', type: 'decimal', value: decimal(12300n, 4), output: '1.2300'}
];

function sample(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const builder = platform.invoke(constructor, [heap.string('seed|')]);
      heap.pins.push(builder);
      const value = platform.managed(workload.value, workload.type);
      heap.pins.push(value);
      const args = [builder, value];
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
      assert.deepEqual(returned, builder);
      assert.equal(platform.native(platform.invoke(toString, [builder])), 'seed|' + workload.output.repeat(calls));
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
  const descriptor = contract('Append', [workload.type]);
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Decimal overload absent on parent'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {outputUnits: 5 + calls * workload.output.length,
      elapsedMs: summary(samples, 'elapsedMs'), managedAllocations: summary(samples, 'managedAllocations'),
      managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released scalar controls and exact Decimal append costs',
  notes: 'Setup, input carriers, host GC and materialization excluded. One text chunk per append plus backing growth; output <=155005 units.',
  allocationScope: 'Managed heap counters exclude host formatting strings and BigInt temporaries.',
  engines}, null, 2));
