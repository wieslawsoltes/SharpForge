// Copy this identical runner to Two-Way parent a5206eb7; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 5000);
const stressCalls = Number(process.argv[3] ?? 20);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
assert(Number.isInteger(stressCalls) && stressCalls >= 1 && stressCalls <= 100, 'Stress calls must be within 1..100');
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const ordinary = [
  {body: '', value: '', firstOrdinal: 0, firstIgnoreCase: 0, lastOrdinal: 0, lastIgnoreCase: 0},
  {body: 'abc', value: '', firstOrdinal: 0, firstIgnoreCase: 0, lastOrdinal: 3, lastIgnoreCase: 3},
  {body: 'prefix-value-suffix', value: 'value', firstOrdinal: 7, firstIgnoreCase: 7, lastOrdinal: 7, lastIgnoreCase: 7},
  {body: 'prefix-VALUE-suffix', value: 'value', firstOrdinal: -1, firstIgnoreCase: 7, lastOrdinal: -1, lastIgnoreCase: 7},
  {body: 'abc', value: 'missing', firstOrdinal: -1, firstIgnoreCase: -1, lastOrdinal: -1, lastIgnoreCase: -1},
  {body: 'xéclairz', value: 'ÉCLAIR', firstOrdinal: -1, firstIgnoreCase: 1, lastOrdinal: -1, lastIgnoreCase: 1},
  {body: 'x\u017Fz', value: 'S', firstOrdinal: -1, firstIgnoreCase: -1, lastOrdinal: -1, lastIgnoreCase: -1},
  {body: 'xßz', value: 'SS', firstOrdinal: -1, firstIgnoreCase: -1, lastOrdinal: -1, lastIgnoreCase: -1},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', firstOrdinal: -1, firstIgnoreCase: 2, lastOrdinal: -1, lastIgnoreCase: 2},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', firstOrdinal: -1, firstIgnoreCase: 1, lastOrdinal: -1, lastIgnoreCase: 1},
  {body: '\uD83D\uDE00AbCabc', value: 'abc', firstOrdinal: 5, firstIgnoreCase: 2, lastOrdinal: 5, lastIgnoreCase: 5},
  {body: 'AbCaBcABC', value: 'abc', firstOrdinal: -1, firstIgnoreCase: 0, lastOrdinal: -1, lastIgnoreCase: 6},
  {body: 'aaaaa', value: 'AA', firstOrdinal: -1, firstIgnoreCase: 0, lastOrdinal: -1, lastIgnoreCase: 3}
];
const repeatedUnits = 1024;
const needleUnits = 64;
const adversarial = ['a', 'é'].flatMap(letter => ['miss', 'late-hit', 'all-overlaps'].map(kind => ({
  name: `${letter === 'a' ? 'ascii' : 'unicode'}-${kind}`,
  body: letter.repeat(repeatedUnits) + (kind === 'late-hit' ? 'b' : ''),
  value: letter.toUpperCase().repeat(kind === 'all-overlaps' ? needleUnits : needleUnits - 1) + (kind === 'all-overlaps' ? '' : 'B'),
  firstOrdinal: -1, lastOrdinal: -1,
  firstIgnoreCase: kind === 'miss' ? -1 : kind === 'all-overlaps' ? 0 : repeatedUnits + 1 - needleUnits,
  lastIgnoreCase: kind === 'miss' ? -1 : kind === 'all-overlaps' ? repeatedUnits - needleUnits : repeatedUnits + 1 - needleUnits
})));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'StringComparison LastIndexOf overload is absent on the baseline'};
  const results = new Int32Array(count);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < count; index++) results[index] = platform.invoke(descriptor, cases[index % cases.length].args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < count; index++) {
      const expected = cases[index % cases.length][resultName];
      assert.equal(descriptor.result === 'bool' ? Boolean(results[index]) : results[index],
        descriptor.result === 'bool' ? expected >= 0 : expected);
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
      const managed = value => {
        const reference = platform.managed(value, 'string');
        platform.heap.pins.push(reference);
        return reference;
      };
      const descriptors = findContracts('System.String', 'LastIndexOf', false);
      const legacy = descriptors.find(row => row.parameters.length === 1);
      const first = findContracts('System.String', 'IndexOf', false)
        .find(row => row.parameters.join(',') === 'string,System.StringComparison');
      const withMode = descriptors.find(row => row.parameters.join(',') === 'string,System.StringComparison');
      const contains = findContracts('System.String', 'Contains', false).find(row => row.parameters.length === 2);
      const evaluate = (rows, count) => {
        const cases = rows.map(row => ({...row, args: [managed(row.body), managed(row.value)]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
        return {
          oneArgumentLastControl: measure(platform, legacy, cases, 'lastOrdinal', count),
          indexOfOrdinalControl: measure(platform, first, ordinal, 'firstOrdinal', count),
          indexOfIgnoreCaseControl: measure(platform, first, ignoreCase, 'firstIgnoreCase', count),
          containsIgnoreCaseControl: measure(platform, contains, ignoreCase, 'firstIgnoreCase', count),
          newLastIndexOfOrdinal: measure(platform, withMode, ordinal, 'lastOrdinal', count),
          newLastIndexOfIgnoreCase: measure(platform, withMode, ignoreCase, 'lastIgnoreCase', count)
        };
      };
      const stress = {};
      for (const row of adversarial) stress[row.name] = evaluate([row], stressCalls);
      return {ordinary: evaluate(ordinary, calls), adversarial: stress};
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, stressCalls, repeatedUnits, needleUnits, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL last offsets with first-search controls, repeated-prefix misses, late hits and every overlap',
  notes: 'Setup, managed strings, host GC and checks excluded. Last search continues once with period memory; new costs are separate.',
  engines}, null, 2));
