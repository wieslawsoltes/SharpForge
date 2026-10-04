// node --expose-gc scripts/benchmarks/a07-ordinal-ignore-case.mjs [calls=20000] [prefixLength=128]
// Copy this same runner to ff291bb0 for the released Ordinal baseline; run checkouts serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 20000);
const length = Number(process.argv[3] ?? 128);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 200000);
assert(Number.isInteger(length) && length >= 1 && length <= 2048);
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const owner = 'System.StringComparer';
const compare = findContracts(owner, 'Compare').find(member => member.parameters.join(',') === 'string,string');
const pairs = [
  [null, '', -1, -1], ['a'.repeat(length), 'A'.repeat(length), 1, 0],
  ['x'.repeat(length) + 'a', 'x'.repeat(length) + 'B', 1, -1],
  ['é'.repeat(length), 'É'.repeat(length), 1, 0],
  ['\uD801\uDC28'.repeat(length), '\uD801\uDC00'.repeat(length), 1, 0],
  ['s', '\u017f', -1, -1], ['ß', 'SS', 1, 1], ['a', 'z'.repeat(length), -1, -1]
];

function summary(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1]};
}

function measure(platform, getter, arguments_, mode) {
  if (!getter) return {skipped: true, reason: 'OrdinalIgnoreCase is absent on the baseline'};
  const comparer = platform.invoke(getter, []);
  const args = arguments_.map(pair => [comparer, ...pair]);
  const results = new Int32Array(calls);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const start = performance.now();
    for (let index = 0; index < calls; index++) results[index] = platform.invoke(compare, args[index % args.length]);
    const elapsedMs = performance.now() - start;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < calls; index++) assert.equal(Math.sign(results[index]), pairs[index % pairs.length][mode]);
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {elapsedMs: summary(samples.map(value => value.elapsedMs)),
    managedAllocations: summary(samples.map(value => value.managedAllocations)), samples};
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
      const arguments_ = pairs.map(pair => pair.slice(0, 2).map(managed));
      const ordinal = findContracts(owner, 'get_Ordinal', true)[0];
      const ignoreCase = findContracts(owner, 'get_OrdinalIgnoreCase', true)[0];
      return {ordinal: measure(platform, ordinal, arguments_, 2), ordinalIgnoreCase: measure(platform, ignoreCase, arguments_, 3)};
    });
  } finally { vm.stop(); }
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, prefixLength: length, warmups: 1, samples: 5,
  workload: 'Actual source/CIL platform Compare dispatch: null, ASCII/Unicode equal folds, long prefixes, early mismatch and surrogate pairs',
  notes: 'Setup, singleton creation and checks excluded. Ordinal baseline and new ignore-case cost reported separately; managed allocations only.',
  engines}, null, 2));
