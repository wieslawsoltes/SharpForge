// Copy this identical runner to Contains parent 080ec4ed; run baseline and candidate serially.
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
  {body: '', value: '', ordinal: 0, ignoreCase: 0},
  {body: 'prefix-value-suffix', value: 'value', ordinal: 7, ignoreCase: 7},
  {body: 'prefix-VALUE-suffix', value: 'value', ordinal: -1, ignoreCase: 7},
  {body: 'prefix-value-suffix', value: 'missing', ordinal: -1, ignoreCase: -1},
  {body: 'xéclairz', value: 'ÉCLAIR', ordinal: -1, ignoreCase: 1},
  {body: 'a', value: 'aaaa', ordinal: -1, ignoreCase: -1},
  {body: 'x\u017Fz', value: 'S', ordinal: -1, ignoreCase: -1},
  {body: 'xßz', value: 'SS', ordinal: -1, ignoreCase: -1},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', ordinal: -1, ignoreCase: 2},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', ordinal: -1, ignoreCase: 1},
  {body: '\uD83D\uDE00AbCabc', value: 'abc', ordinal: 5, ignoreCase: 2}
];
const repeatedUnits = 1024;
const needleUnits = 64;
const adversarial = ['a', 'é'].flatMap(letter => [false, true].map(lateHit => ({
  name: `${letter === 'a' ? 'ascii' : 'unicode'}-${lateHit ? 'late-hit' : 'miss'}`,
  body: letter.repeat(repeatedUnits) + (lateHit ? 'b' : ''),
  value: letter.toUpperCase().repeat(needleUnits - 1) + 'B',
  ordinal: -1, ignoreCase: lateHit ? repeatedUnits + 1 - needleUnits : -1
})));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'StringComparison IndexOf overload is absent on the baseline'};
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
      const descriptors = findContracts('System.String', 'IndexOf', false);
      const legacy = descriptors.find(row => row.parameters.length === 1);
      const startIndex = descriptors.find(row => row.parameters.join(',') === 'string,int');
      const withMode = descriptors.find(row => row.parameters.join(',') === 'string,System.StringComparison');
      const contains = findContracts('System.String', 'Contains', false).find(row => row.parameters.length === 2);
      const evaluate = (rows, count) => {
        const cases = rows.map(row => ({...row, args: [managed(row.body), managed(row.value)]}));
        const zeroStart = cases.map(row => ({...row, args: [...row.args, 0]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
        return {
          oneArgumentControl: measure(platform, legacy, cases, 'ordinal', count),
          intStartIndexControl: measure(platform, startIndex, zeroStart, 'ordinal', count),
          containsOrdinalControl: measure(platform, contains, ordinal, 'ordinal', count),
          containsIgnoreCaseControl: measure(platform, contains, ignoreCase, 'ignoreCase', count),
          newIndexOfOrdinal: measure(platform, withMode, ordinal, 'ordinal', count),
          newIndexOfIgnoreCase: measure(platform, withMode, ignoreCase, 'ignoreCase', count)
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
  workload: 'Real source/CIL IndexOf/Contains controls and new UTF16 offsets, including repeated-prefix misses and late hits',
  notes: 'Setup, managed strings, host GC and assertions excluded. Ignore-case search retains O(n*m) worst-case time; no speedup claim.',
  engines}, null, 2));
