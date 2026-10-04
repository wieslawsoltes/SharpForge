// Copy this identical runner to parent 16a13a16; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 5000);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const comparerType = 'System.StringComparer';

function descriptor(owner, name, parameters = []) {
  return findContracts(owner, name).find(row => row.parameters.join(',') === parameters.join(','));
}

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, contract, args, expected) {
  if (!contract) return {skipped: true, reason: 'FromComparison is absent on the baseline'};
  const output = Array(calls);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) output[index] = platform.invoke(contract, args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (const value of output) assert.equal(value, expected);
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls, elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}

function run(engine) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  try {
    return platform.heap.withRoots([], () => {
      const text = value => {
        const reference = platform.managed(value, 'string');
        platform.heap.pins.push(reference);
        return reference;
      };
      const ordinalGetter = descriptor(comparerType, 'get_Ordinal');
      const ignoreGetter = descriptor(comparerType, 'get_OrdinalIgnoreCase');
      const ordinal = platform.invoke(ordinalGetter, []);
      const ignoreCase = platform.invoke(ignoreGetter, []);
      const first = text('a');
      const second = text('A');
      const compare = descriptor(comparerType, 'Compare', ['string', 'string']);
      const withMode = descriptor('System.String', 'Compare', ['string', 'string', 'System.StringComparison']);
      const factory = descriptor(comparerType, 'FromComparison', ['System.StringComparison']);
      return {
        releasedOrdinalGetter: measure(platform, ordinalGetter, [], ordinal),
        releasedIgnoreCaseGetter: measure(platform, ignoreGetter, [], ignoreCase),
        releasedOrdinalCompare: measure(platform, compare, [ordinal, first, second], 1),
        releasedIgnoreCaseCompare: measure(platform, compare, [ignoreCase, first, second], 0),
        releasedModeCompare: measure(platform, withMode, [first, second, 5], 0),
        newOrdinalFactory: measure(platform, factory, [4], ordinal),
        newIgnoreCaseFactory: measure(platform, factory, [5], ignoreCase)
      };
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL platform getter, comparison and warmed FromComparison dispatch',
  notes: 'Setup, host GC and result checks excluded. Singleton allocation is warmed before timing; new API cost is separate.',
  engines}, null, 2));
