// Copy this identical runner to the integrated pre-registration reproduction parent; execute runs serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {float, int32BitsToSingle} from '@sharpforge/bytecode';
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
const workloads = [
  {name: 'string-control', type: 'string', value: 'A', output: 'A'},
  {name: 'double-control', type: 'double', value: float(1000000000, 'r8'), output: '1000000000'},
  {name: 'integer-control', type: 'int', value: 65, output: '65'},
  {name: 'single-fraction', type: 'float', value: int32BitsToSingle(0x3dcccccd), output: '0.1'},
  {name: 'single-notation', type: 'float', value: int32BitsToSingle(0x4e6e6b28), output: '1E+09'},
  {name: 'single-negative-zero', type: 'float', value: int32BitsToSingle(-2147483648), output: '-0'},
  {name: 'single-maximum', type: 'float', value: int32BitsToSingle(0x7f7fffff), output: '3.4028235E+38'}
];

function sample(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const builder = platform.invoke(constructor, [heap.string('seed|')]);
      heap.pins.push(builder);
      const value = workload.type === 'string' ? heap.string(workload.value) : workload.value;
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
      engines[engine][workload.name] = {skipped: true, reason: 'Single overload absent on baseline'};
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
  workload: 'Actual source/CIL platform dispatch: released string/Double/int controls and separate Single append costs',
  notes: 'Setup, managed input, host GC and materialization excluded. One chunk per append; output <=65005 UTF-16 units.',
  engines}, null, 2));
