// Copy this identical runner to 9838196d; run baseline and candidate serially.
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
const whole = findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 2);
const equality = findContracts('System.String', 'Equals', true).find(row => row.parameters.length === 3);
const compare = findContracts('System.String', 'Compare', true)
  .find(row => row.parameters.join(',') === 'string,string,System.StringComparison');
const prefix = 'x'.repeat(length);
const upper = 'X'.repeat(length);
const rows = [
  {first: null, second: null, ordinal: 0, ignoreCase: 0},
  {first: '', second: null, ordinal: 1, ignoreCase: 1},
  {first: '', second: '', ordinal: 0, ignoreCase: 0},
  {first: prefix + 'a', second: prefix + 'a', ordinal: 0, ignoreCase: 0},
  {first: prefix + 'a', second: upper + 'A', ordinal: 1, ignoreCase: 0},
  {first: prefix + 'a', second: upper + 'b', ordinal: 1, ignoreCase: -1},
  {first: 'é'.repeat(length) + '\uD800a', second: 'É'.repeat(length) + '\uD800A', ordinal: 1, ignoreCase: 0},
  {first: '\u017F', second: 'S', ordinal: 1, ignoreCase: 1},
  {first: 'ß', second: 'SS', ordinal: 1, ignoreCase: 1},
  {first: '\uE000', second: '\uD800\uDC00', ordinal: 1, ignoreCase: -1}
];

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, mode, isEquality = false) {
  if (!descriptor) return {skipped: true, reason: 'String.Compare comparison overload is absent on the baseline'};
  const results = new Int32Array(calls);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) results[index] = platform.invoke(descriptor, cases[index % cases.length].args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < calls; index++) {
      const expected = cases[index % cases.length][mode];
      assert.equal(isEquality ? Boolean(results[index]) : Math.sign(results[index]), isEquality ? expected === 0 : expected);
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
      const cases = rows.map(row => ({...row, args: [managed(row.first), managed(row.second)]}));
      const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
      const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
      return {
        compareOrdinalControl: measure(platform, whole, cases, 'ordinal'),
        equalsOrdinalControl: measure(platform, equality, ordinal, 'ordinal', true),
        equalsIgnoreCaseControl: measure(platform, equality, ignoreCase, 'ignoreCase', true),
        newOrdinalCompare: measure(platform, compare, ordinal, 'ordinal'),
        newIgnoreCaseCompare: measure(platform, compare, ignoreCase, 'ignoreCase')
      };
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, prefixLength: length, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL platform comparison: released CompareOrdinal/Equals controls and new mode-aware Compare',
  notes: 'Setup, managed strings, host GC and result checks excluded. New feature costs are separate; no speedup claim.',
  engines}, null, 2));
