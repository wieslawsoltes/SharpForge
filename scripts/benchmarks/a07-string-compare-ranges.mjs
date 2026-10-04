// Copy this identical runner to aab81434; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 5000);
const length = Number(process.argv[3] ?? 128);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
assert(Number.isInteger(length) && length >= 1 && length <= 2048, 'Prefix length must be within 1..2048');
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const descriptors = findContracts('System.String', 'CompareOrdinal', true);
const whole = descriptors.find(row => row.parameters.length === 2);
const range = descriptors.find(row => row.parameters.length === 5);
const prefix = 'x'.repeat(length);
const rows = [
  {first: null, second: '', indexA: -1, indexB: -1, length: -1, whole: -1, range: -1},
  {first: '', second: '', indexA: 0, indexB: 0, length: 2147483647, whole: 0, range: 0},
  {first: prefix + 'a', second: prefix + 'b', indexA: 0, indexB: 0, length: 2147483647, whole: -1, range: -1},
  {first: 'Z' + prefix, second: 'A' + prefix, indexA: 1, indexB: 1, length: length, whole: 1, range: 0},
  {first: 'q\uD800', second: 'a\uDC00', indexA: 1, indexB: 1, length: 1, whole: 1, range: -1024},
  {first: 'xabc', second: 'yabcdef', indexA: 1, indexB: 1, length: 2147483647, whole: -1, range: -3},
  {first: 'z' + prefix, second: 'a' + prefix, indexA: 0, indexB: 0, length: length, whole: 1, range: 25}
];

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, args, mode) {
  if (!descriptor) return {skipped: true, reason: 'Range overload is absent on the baseline'};
  const results = new Int32Array(calls);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) results[index] = platform.invoke(descriptor, args[index % rows.length]);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < calls; index++) {
      assert.equal(mode === 'whole' ? Math.sign(results[index]) : results[index], rows[index % rows.length][mode]);
    }
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {elapsedMs: summary(samples.map(row => row.elapsedMs)),
    managedAllocations: summary(samples.map(row => row.managedAllocations)),
    managedAllocatedBytes: summary(samples.map(row => row.managedAllocatedBytes)), samples};
}

function run(engine) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  try {
    return platform.heap.withRoots([], () => {
      const managed = value => {
        const reference = platform.managed(value, 'string');
        platform.heap.pins.push(reference);
        return reference;
      };
      const values = rows.map(row => [managed(row.first), managed(row.second)]);
      const args = rows.map((row, index) => [values[index][0], row.indexA, values[index][1], row.indexB, row.length]);
      return {twoArgumentControl: measure(platform, whole, values, 'whole'), newRange: measure(platform, range, args, 'range')};
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, prefixLength: length, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL platform CompareOrdinal: unchanged two-argument control and bounded new range overload',
  notes: 'Setup, managed string creation, host GC and result checks excluded. New feature cost is separate; no speedup claim.',
  engines}, null, 2));
