// Copy this identical runner to merged indexer parent 1fe6e268; run baseline and candidate serially.
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
  {body: '', value: '', start: -1, first: 0, last: 0, prefix: 0},
  {body: '', value: '', start: 0, first: 0, last: 0, prefix: 0},
  {body: 'abc', value: '', start: 0, first: 0, last: 3, prefix: 1},
  {body: 'abc', value: '', start: 3, first: 0, last: 3, prefix: 3},
  {body: 'abcABCabc', value: 'abc', start: 4, first: 0, last: 6, prefix: 0},
  {body: 'abcABCabc', value: 'abc', start: 9, first: 0, last: 6, prefix: 6},
  {body: 'same', value: 'same', start: 2, first: 0, last: 0, prefix: -1},
  {body: 'abc', value: 'missing', start: 1, first: -1, last: -1, prefix: -1},
  {body: 'xéclairz', value: 'ÉCLAIR', start: 6, first: 1, last: 1, prefix: 1},
  {body: 'x\u017Fz', value: 'S', start: 1, first: -1, last: -1, prefix: -1},
  {body: 'xßz', value: 'SS', start: 1, first: -1, last: -1, prefix: -1},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', start: 2, first: 2, last: 2, prefix: -1},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', start: 2, first: 1, last: 1, prefix: 1},
  {body: '\uD83D\uDE00AbCabc', value: 'abc', start: 6, first: 2, last: 5, prefix: 2},
  {body: 'aaaaa', value: 'AA', start: 2, first: 0, last: 3, prefix: 1},
  {body: 'aaaaaaaaBaaaaaaaaB', value: 'AAAAAAAB', start: 8, first: 1, last: 10, prefix: 1},
  {body: 'aaaaaaaaaBaaaaaaaaaB', value: 'AAAAAAAAB', start: 9, first: 1, last: 11, prefix: 1}
];
const prefixUnits = 1024;
const suffixUnits = 4096;
const adversarial = ['a', 'é'].flatMap(letter => [8, 9, 64].flatMap(needleUnits => ['clipped-hit', 'included-hit', 'all-overlaps']
  .map(kind => {
    const overlap = kind === 'all-overlaps';
    const body = overlap ? letter.repeat(prefixUnits + suffixUnits)
      : letter.repeat(prefixUnits) + 'b' + letter.repeat(suffixUnits) + 'b';
    return {
      name: `${letter === 'a' ? 'ascii' : 'unicode'}-${needleUnits}-${kind}`, body,
      value: letter.toUpperCase().repeat(overlap ? needleUnits : needleUnits - 1) + (overlap ? '' : 'B'),
      start: kind === 'included-hit' ? prefixUnits : prefixUnits - 1,
      first: overlap ? 0 : prefixUnits + 1 - needleUnits,
      last: body.length - needleUnits,
      prefix: kind === 'clipped-hit' ? -1 : prefixUnits + (overlap ? 0 : 1) - needleUnits
    };
  })));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'LastIndexOf start comparison overload is absent on the baseline'};
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
      const legacyLast = descriptor('LastIndexOf', 'string');
      const withStart = descriptor('LastIndexOf', 'string,int,System.StringComparison');
      const evaluate = (rows, count) => {
        const cases = rows.map(row => {
          const end = Math.min(row.start + 1, row.body.length);
          const ordinal = row.body.lastIndexOf(row.value);
          const prefixOrdinal = row.value.length > end ? -1 : row.body.lastIndexOf(row.value, end - row.value.length);
          return {...row, ordinal, prefixOrdinal, args: [managed(row.body), managed(row.value)]};
        });
        const whole = cases.map(row => ({...row, args: [...row.args, 5]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, row.start, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, row.start, 5]}));
        return {
          indexOfIgnoreCaseControl: measure(platform, first, whole, 'first', count),
          lastIndexOfIgnoreCaseControl: measure(platform, last, whole, 'last', count),
          releasedLastControl: measure(platform, legacyLast, cases, 'ordinal', count),
          newLastIndexOfStartOrdinal: measure(platform, withStart, ordinal, 'prefixOrdinal', count),
          newLastIndexOfStartIgnoreCase: measure(platform, withStart, ignoreCase, 'prefix', count)
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
  calls, stressCalls, prefixUnits, suffixUnits, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL prefix-last search, 8/9/64-unit needles, clipped/included hits and all overlapping matches',
  notes: 'Setup/GC/checks excluded. Existing first/last controls use the identical runner. New prefix costs are reported separately.',
  engines}, null, 2));
