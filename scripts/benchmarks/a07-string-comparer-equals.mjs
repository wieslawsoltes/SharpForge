// Copy this identical runner to parent 0a39e7c9; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 5000);
const stressCalls = Number(process.argv[3] ?? 100);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
assert(Number.isInteger(stressCalls) && stressCalls >= 20 && stressCalls <= 1000, 'Stress calls must be within 20..1000');
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const comparerType = 'System.StringComparer';
const inputs = [
  {name: 'nulls', first: null, second: null, ignoreCase: true},
  {name: 'null-empty', first: null, second: '', ignoreCase: false},
  {name: 'short-case', first: 'abc', second: 'ABC', ignoreCase: true},
  {name: 'different-length', first: 'abc', second: 'AB', ignoreCase: false},
  {name: 'expansion', first: 'ß', second: 'SS', ignoreCase: false},
  {name: 'long-s', first: '\u017f', second: 'S', ignoreCase: false},
  {name: 'accent-case', first: 'é', second: 'É', ignoreCase: true},
  {name: 'deseret', first: '\uD801\uDC28', second: '\uD801\uDC00', ignoreCase: true},
  {name: 'unpaired', first: '\uDC28a\uD801', second: '\uDC28A\uD801', ignoreCase: true},
  {name: 'long-case', first: 'é'.repeat(1024), second: 'É'.repeat(1024), ignoreCase: true},
  {name: 'long-tail', first: 'é'.repeat(1023) + 'b', second: 'É'.repeat(1023) + 'C', ignoreCase: false},
  {name: 'long-length', first: 'é'.repeat(1024), second: 'É'.repeat(1023), ignoreCase: false}
];

function descriptor(name, parameters = []) {
  return findContracts(comparerType, name).find(row => row.parameters.join(',') === parameters.join(','));
}

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, contract, cases, compare = false, count = calls) {
  if (!contract) return {skipped: true, reason: 'Equals(string,string) is absent on the baseline'};
  const output = Array(count);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) output[index] = platform.invoke(contract, cases[index % cases.length].args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < count; index++) {
      assert.equal(compare ? output[index] === 0 : output[index], cases[index % cases.length].expected);
    }
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {calls: count, elapsedMs: summary(samples.map(row => row.elapsedMs)),
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
      const ordinalGetter = descriptor('get_Ordinal');
      const ignoreGetter = descriptor('get_OrdinalIgnoreCase');
      const ordinal = platform.invoke(ordinalGetter, []);
      const ignoreCase = platform.invoke(ignoreGetter, []);
      const compare = descriptor('Compare', ['string', 'string']);
      const equals = descriptor('Equals', ['string', 'string']);
      const factory = descriptor('FromComparison', ['System.StringComparison']);
      const cases = inputs.map(row => ({...row, values: [text(row.first), text(row.second)]}));
      const ordinary = cases.filter(row => !row.name.startsWith('long-') || row.name === 'long-s');
      const groups = {ordinary, ...Object.fromEntries(cases.filter(row => row.name.startsWith('long-') && row.name !== 'long-s')
        .map(row => [row.name, [row]]))};
      const rows = {};
      for (const [name, group] of Object.entries(groups)) {
        const count = name === 'ordinary' ? calls : stressCalls;
        const ordinalCases = group.map(row => ({args: [ordinal, ...row.values], expected: row.first === row.second}));
        const ignoreCases = group.map(row => ({args: [ignoreCase, ...row.values], expected: row.ignoreCase}));
        rows[name] = {
          releasedOrdinalCompare: measure(platform, compare, ordinalCases, true, count),
          releasedIgnoreCaseCompare: measure(platform, compare, ignoreCases, true, count),
          newOrdinalEquals: measure(platform, equals, ordinalCases, false, count),
          newIgnoreCaseEquals: measure(platform, equals, ignoreCases, false, count)
        };
      }
      return {
        releasedOrdinalGetter: measure(platform, ordinalGetter, [{args: [], expected: ordinal}]),
        releasedIgnoreCaseGetter: measure(platform, ignoreGetter, [{args: [], expected: ignoreCase}]),
        releasedFactory: measure(platform, factory, [{args: [4], expected: ordinal}, {args: [5], expected: ignoreCase}]),
        workloads: rows
      };
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL comparer equality: short nullable/Unicode pairs and 1024-unit equality, tail and length differences',
  notes: 'Setup, host GC and checks excluded. Existing getter/factory/Compare controls and new Equals are reported separately.',
  engines}, null, 2));
