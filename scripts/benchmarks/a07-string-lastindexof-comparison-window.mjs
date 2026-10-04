// Copy this identical runner to parent 2ca53c88; run baseline and candidate serially.
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
  {body: '', value: '', start: -1, count: -2147483648, first: 0, last: 0, prefix: 0, window: 0},
  {body: '', value: 'a', start: 0, count: 2147483647, first: -1, last: -1, prefix: -1, window: -1},
  {body: 'abc', value: '', start: 1, count: 0, first: 0, last: 3, prefix: 2, window: 2},
  {body: 'abc', value: 'c', start: 3, count: 1, first: 2, last: 2, prefix: 2, window: -1},
  {body: 'abc', value: 'c', start: 3, count: 2, first: 2, last: 2, prefix: 2, window: 2},
  {body: 'abcabc', value: 'bc', start: 5, count: 2, first: 1, last: 4, prefix: 4, window: 4},
  {body: 'abcabc', value: 'bc', start: 5, count: 1, first: 1, last: 4, prefix: 4, window: -1},
  {body: 'abcabc', value: 'bc', start: 2, count: 2, first: 1, last: 4, prefix: 1, window: 1},
  {body: 'aBaB', value: 'b', start: 2, count: 1, first: 1, last: 3, prefix: 1, window: -1},
  {body: 'xéclairz', value: 'ÉCLAIR', start: 6, count: 6, first: 1, last: 1, prefix: 1, window: 1},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', start: 3, count: 2, first: 2, last: 2, prefix: 2, window: 2},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', start: 2, count: 2, first: 1, last: 1, prefix: 1, window: 1},
  {body: 'x\uD801\uDC28a\uD801\uDC28z', value: '\uDC28A\uD801', start: 4, count: 3, first: 2, last: 2, prefix: 2, window: 2},
  {body: 'aaaaa', value: 'AA', start: 3, count: 3, first: 0, last: 3, prefix: 2, window: 2},
  {body: 'aaaaaaaaBaaaaaaaaB', value: 'AAAAAAAB', start: 17, count: 8, first: 1, last: 10, prefix: 10, window: 10},
  {body: 'aaaaaaaaaBaaaaaaaaaB', value: 'AAAAAAAAB', start: 19, count: 9, first: 1, last: 11, prefix: 11, window: 11}
];
const prefixUnits = 4096;
const windowUnits = 1024;
const suffixUnits = 4096;
const adversarial = ['a', 'é'].flatMap(letter => [8, 9, 64].flatMap(needleUnits => ['outside-hits', 'inside-hit', 'all-overlaps']
  .map(kind => {
    const overlap = kind === 'all-overlaps';
    const before = letter.repeat(prefixUnits) + 'b';
    const window = letter.repeat(windowUnits) + (kind === 'inside-hit' ? 'b' : '');
    const body = before + window + letter.repeat(suffixUnits) + 'b';
    const end = before.length + window.length;
    return {
      name: `${letter === 'a' ? 'ascii' : 'unicode'}-${needleUnits}-${kind}`, body,
      value: letter.toUpperCase().repeat(overlap ? needleUnits : needleUnits - 1) + (overlap ? '' : 'B'),
      start: end - 1, count: window.length,
      first: overlap ? 0 : before.length - needleUnits,
      last: body.length - (overlap ? 1 : 0) - needleUnits,
      prefix: kind === 'outside-hits' ? before.length - needleUnits : end - needleUnits,
      window: kind === 'outside-hits' ? -1 : end - needleUnits
    };
  })));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'LastIndexOf window comparison overload is absent on the baseline'};
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
      const prefix = descriptor('LastIndexOf', 'string,int,System.StringComparison');
      const legacyLast = descriptor('LastIndexOf', 'string');
      const withWindow = descriptor('LastIndexOf', 'string,int,int,System.StringComparison');
      const evaluate = (rows, count) => {
        const cases = rows.map(row => {
          const end = Math.min(row.start + 1, row.body.length);
          const size = row.body.length === 0 ? 0 : row.start === row.body.length && row.count > 0 ? row.count - 1 : row.count;
          const found = row.body.lastIndexOf(row.value, end - row.value.length);
          const windowOrdinal = row.value.length > size || found < end - size ? -1 : found;
          return {...row, ordinal: row.body.lastIndexOf(row.value), windowOrdinal, args: [managed(row.body), managed(row.value)]};
        });
        const whole = cases.map(row => ({...row, args: [...row.args, 5]}));
        const prefixCases = cases.map(row => ({...row, args: [...row.args, row.start, 5]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, row.start, row.count, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, row.start, row.count, 5]}));
        return {
          indexOfIgnoreCaseControl: measure(platform, first, whole, 'first', count),
          lastIndexOfIgnoreCaseControl: measure(platform, last, whole, 'last', count),
          prefixIgnoreCaseControl: measure(platform, prefix, prefixCases, 'prefix', count),
          releasedLastControl: measure(platform, legacyLast, cases, 'ordinal', count),
          newLastIndexOfWindowOrdinal: measure(platform, withWindow, ordinal, 'windowOrdinal', count),
          newLastIndexOfWindowIgnoreCase: measure(platform, withWindow, ignoreCase, 'window', count)
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
  calls, stressCalls, prefixUnits, windowUnits, suffixUnits, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL backward windows, 8/9/64-unit needles, excluded prefix/suffix and overlapping matches',
  notes: 'Setup/GC/checks excluded. Ordinal may inspect the excluded prefix; OIC bounds candidates to the window. New costs are separate.',
  engines}, null, 2));
