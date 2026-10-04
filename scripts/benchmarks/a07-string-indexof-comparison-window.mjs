// Copy this identical runner to combined parent 57bc331b; run baseline and candidate serially.
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
  {body: '', value: '', start: 0, count: 0, first: 0, last: 0, next: 0},
  {body: 'abc', value: '', start: 2, count: 0, first: 0, last: 3, next: 2},
  {body: 'abcABCabc', value: 'abc', start: 1, count: 4, first: 0, last: 6, next: -1},
  {body: 'prefix-value-suffix', value: 'value', start: 7, count: 5, first: 7, last: 7, next: 7},
  {body: 'prefix-VALUE-suffix', value: 'value', start: 8, count: 10, first: 7, last: 7, next: -1},
  {body: 'abc', value: 'missing', start: 1, count: 0, first: -1, last: -1, next: -1},
  {body: 'xéclairz', value: 'ÉCLAIR', start: 1, count: 6, first: 1, last: 1, next: 1},
  {body: 'x\u017Fz', value: 'S', start: 1, count: 1, first: -1, last: -1, next: -1},
  {body: 'xßz', value: 'SS', start: 1, count: 2, first: -1, last: -1, next: -1},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', start: 2, count: 2, first: 2, last: 2, next: 2},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', start: 1, count: 2, first: 1, last: 1, next: 1},
  {body: '\uD83D\uDE00AbCabc', value: 'abc', start: 3, count: 5, first: 2, last: 5, next: 5},
  {body: 'AbCaBcABC', value: 'abc', start: 4, count: 4, first: 0, last: 6, next: -1},
  {body: 'aaaaa', value: 'AA', start: 2, count: 2, first: 0, last: 3, next: 2},
  {body: 'aaaaaaaaBaaaaaaaaB', value: 'AAAAAAAB', start: 2, count: 8, first: 1, last: 10, next: -1},
  {body: 'aaaaaaaaaBaaaaaaaaaB', value: 'AAAAAAAAB', start: 2, count: 9, first: 1, last: 11, next: -1}
];
const prefixUnits = 4096;
const repeatedUnits = 1024;
const suffixUnits = 4096;
const adversarial = ['a', 'é'].flatMap(letter => [8, 9, 64].flatMap(needleUnits => ['excluded-hit', 'late-hit'].map(kind => ({
  name: `${letter === 'a' ? 'ascii' : 'unicode'}-${needleUnits}-${kind}`,
  body: 'x'.repeat(prefixUnits) + letter.repeat(repeatedUnits) + (kind === 'late-hit' ? 'b' : '') +
    letter.repeat(suffixUnits) + 'b',
  value: letter.toUpperCase().repeat(needleUnits - 1) + 'B', start: prefixUnits,
  count: repeatedUnits + (kind === 'late-hit' ? 1 : 0),
  first: kind === 'late-hit' ? prefixUnits + repeatedUnits + 1 - needleUnits
    : prefixUnits + repeatedUnits + suffixUnits + 1 - needleUnits,
  last: prefixUnits + repeatedUnits + suffixUnits + 1 + (kind === 'late-hit' ? 1 : 0) - needleUnits,
  next: kind === 'excluded-hit' ? -1 : prefixUnits + repeatedUnits + 1 - needleUnits
}))));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'Window StringComparison overload is absent on the baseline'};
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
    for (let index = 0; index < count; index++) assert.equal(results[index], cases[index % cases.length][resultName]);
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
      const descriptor = (name, parameters) => findContracts('System.String', name, false)
        .find(row => row.parameters.join(',') === parameters);
      const first = descriptor('IndexOf', 'string,System.StringComparison');
      const last = descriptor('LastIndexOf', 'string,System.StringComparison');
      const legacyStart = descriptor('IndexOf', 'string,int');
      const withWindow = descriptor('IndexOf', 'string,int,int,System.StringComparison');
      const evaluate = (rows, count) => {
        const cases = rows.map(row => {
          const ordinal = row.body.indexOf(row.value, row.start);
          const windowOrdinal = ordinal > row.start + row.count - row.value.length ? -1 : ordinal;
          return {...row, ordinal, windowOrdinal, args: [managed(row.body), managed(row.value)]};
        });
        const whole = cases.map(row => ({...row, args: [...row.args, 5]}));
        const legacy = cases.map(row => ({...row, args: [...row.args, row.start]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, row.start, row.count, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, row.start, row.count, 5]}));
        return {
          indexOfIgnoreCaseControl: measure(platform, first, whole, 'first', count),
          lastIndexOfIgnoreCaseControl: measure(platform, last, whole, 'last', count),
          releasedIntStartControl: measure(platform, legacyStart, legacy, 'ordinal', count),
          newIndexOfWindowOrdinal: measure(platform, withWindow, ordinal, 'windowOrdinal', count),
          newIndexOfWindowIgnoreCase: measure(platform, withWindow, ignoreCase, 'next', count)
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
  calls, stressCalls, prefixUnits, repeatedUnits, suffixUnits, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL bounded windows, excluded prefix/suffix, repeated 8/9/64-unit needles, outside and inside hits',
  notes: 'Setup/GC/checks excluded. OIC uses the window bound; Ordinal host search may scan the excluded suffix. New costs are separate.',
  engines}, null, 2));
