// Copy this identical runner to frozen 593f96c6; execute baseline and candidate serially.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {float, int32BitsToSingle} from '@sharpforge/bytecode';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 20000);
assert(Number.isInteger(calls) && calls >= 1000 && calls <= 200000, 'Calls must be within 1000..200000');
const oracle = JSON.parse(readFileSync(new URL('../../packages/bcl-core/reference/string-builder-append-single-net10.json', import.meta.url)));
const rows = oracle.rows.filter(row => !row.nullReceiver);
const singles = rows.map(row => int32BitsToSingle(Number.parseInt(row.bits, 16) | 0));
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const workloads = [
  {name: 'double-common-control', type: 'double', values: [0, 1, 42, 0.1, 123.25].map(value => float(value, 'r8'))},
  {name: 'double-widened-control', type: 'double', values: singles.map(value => float(value.value, 'r8')),
    expected: rows.map(row => row.doubleText)},
  {name: 'single-carriers', type: 'float', values: singles, expected: rows.map(row => row.text)},
  {name: 'single-raw', type: 'float', values: singles.map(value => value.value), expected: rows.map(row => row.text)}
];

function sample(engine, workload) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  try {
    const {heap} = vm;
    const values = workload.values;
    const mismatches = [];
    if (workload.expected) {
      for (const [index, value] of values.entries()) {
        const actual = vm.format(value, workload.type);
        if (actual !== workload.expected[index]) mismatches.push({bits: rows[index].bits, actual, expected: workload.expected[index]});
      }
    }
    globalThis.gc?.();
    const allocations = heap.stats.allocations;
    const bytes = heap.stats.allocatedBytes;
    let units = 0;
    const start = performance.now();
    for (let index = 0; index < calls; index++) units += vm.format(values[index % values.length], workload.type).length;
    return {elapsedMs: performance.now() - start, units, managedAllocations: heap.stats.allocations - allocations,
      managedAllocatedBytes: heap.stats.allocatedBytes - bytes, mismatches};
  } finally { vm.stop(); }
}

function summary(samples, key) {
  const values = samples.map(row => row[key]).toSorted((left, right) => left - right);
  return {median: values[2], p95: values[4]};
}

const engines = {source: {}, cil: {}};
for (const engine of Object.keys(engines)) {
  for (const workload of workloads) {
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = sample(engine, workload);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {elapsedMs: summary(samples, 'elapsedMs'),
      managedAllocations: summary(samples, 'managedAllocations'), managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'),
      samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL display formatters: existing Double controls, typed Single carriers and raw binary32 numbers',
  notes: 'Compilation, bit decoding, VM setup, oracle comparison and host GC excluded. Host temporary strings are not managed allocations.',
  engines}, null, 2));
