// Copy this identical runner to 2a1c6007; run baseline and candidate serially.
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
const comparisons = findContracts('System.String', 'Compare', true);
const whole = comparisons.find(row => row.parameters.length === 3);
const range = comparisons.find(row => row.parameters.length === 6);
const ordinalRange = findContracts('System.String', 'CompareOrdinal', true).find(row => row.parameters.length === 5);
const prefix = 'x'.repeat(length);
const upper = 'X'.repeat(length);
const rows = [
  {first: null, second: null, indexA: -1, indexB: -1, length: -1,
    wholeOrdinal: 0, wholeIgnoreCase: 0, rangeOrdinal: 0, rangeIgnoreCase: 0},
  {first: null, second: '', indexA: -1, indexB: -1, length: -1,
    wholeOrdinal: -1, wholeIgnoreCase: -1, rangeOrdinal: -1, rangeIgnoreCase: -1},
  {first: 'x' + prefix + 'a', second: 'y' + upper + 'A', indexA: 1, indexB: 1, length: 2147483647,
    wholeOrdinal: -1, wholeIgnoreCase: -1, rangeOrdinal: 1, rangeIgnoreCase: 0},
  {first: 'x' + prefix + 'a', second: 'x' + upper + 'b', indexA: 1, indexB: 1, length: 2147483647,
    wholeOrdinal: 1, wholeIgnoreCase: -1, rangeOrdinal: 1, rangeIgnoreCase: -1},
  {first: 'q' + prefix + 'a!', second: 'q' + upper + 'A?', indexA: 1, indexB: 1, length: length + 1,
    wholeOrdinal: 1, wholeIgnoreCase: -1, rangeOrdinal: 1, rangeIgnoreCase: 0},
  {first: 'x\uD801\uDC28', second: 'x\uD801\uDC00', indexA: 1, indexB: 1, length: 1,
    wholeOrdinal: 1, wholeIgnoreCase: 0, rangeOrdinal: 0, rangeIgnoreCase: 0},
  {first: 'x\uD801\uDC28', second: 'x\uD801\uDC00', indexA: 2, indexB: 2, length: 1,
    wholeOrdinal: 1, wholeIgnoreCase: 0, rangeOrdinal: 1, rangeIgnoreCase: 1},
  {first: 'xabc', second: 'xABCDEF', indexA: 1, indexB: 1, length: 2147483647,
    wholeOrdinal: 1, wholeIgnoreCase: -1, rangeOrdinal: 1, rangeIgnoreCase: -1},
  {first: 'xab', second: 'yab', indexA: 1, indexB: 1, length: 2,
    wholeOrdinal: -1, wholeIgnoreCase: -1, rangeOrdinal: 0, rangeIgnoreCase: 0},
  {first: 'x\uE000', second: 'x\uD800\uDC00', indexA: 1, indexB: 1, length: 2,
    wholeOrdinal: 1, wholeIgnoreCase: -1, rangeOrdinal: 1, rangeIgnoreCase: -1},
  {first: 'abc', second: 'ABC', indexA: 3, indexB: 3, length: 2147483647,
    wholeOrdinal: 1, wholeIgnoreCase: 0, rangeOrdinal: 0, rangeIgnoreCase: 0}
];

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, mode) {
  if (!descriptor) return {skipped: true, reason: 'Mode-aware range overload is absent on the baseline'};
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
    for (let index = 0; index < calls; index++) assert.equal(Math.sign(results[index]), cases[index % cases.length][mode]);
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
      const full = rows.map((row, index) => ({...row, args: values[index]}));
      const ranges = rows.map((row, index) => ({...row,
        args: [values[index][0], row.indexA, values[index][1], row.indexB, row.length]}));
      const withMode = (cases, mode) => cases.map(row => ({...row, args: [...row.args, mode]}));
      return {
        ordinalRangeControl: measure(platform, ordinalRange, ranges, 'rangeOrdinal'),
        wholeOrdinalControl: measure(platform, whole, withMode(full, 4), 'wholeOrdinal'),
        wholeIgnoreCaseControl: measure(platform, whole, withMode(full, 5), 'wholeIgnoreCase'),
        newOrdinalRange: measure(platform, range, withMode(ranges, 4), 'rangeOrdinal'),
        newIgnoreCaseRange: measure(platform, range, withMode(ranges, 5), 'rangeIgnoreCase')
      };
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, prefixLength: length, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL dispatch: released ordinal range/whole comparison controls and new mode-aware ranges',
  notes: 'Setup, managed strings, host GC and checks excluded. New feature costs are separate; no speedup claim.',
  engines}, null, 2));
