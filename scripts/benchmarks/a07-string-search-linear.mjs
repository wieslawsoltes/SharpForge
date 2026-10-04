// Copy this identical runner to start-index parent 72547446; run baseline and candidate serially.
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
  {body: '\uD83D\uDE00AbCabc', value: 'abc', ordinal: 5, ignoreCase: 2, lastIgnoreCase: 5}
];
const repeatedUnits = Number(process.argv[4] ?? 1024);
assert(Number.isInteger(repeatedUnits) && repeatedUnits >= 128 && repeatedUnits <= 4096 && repeatedUnits % 32 === 0,
  'Repeated units must be a multiple of 32 within 128..4096');
const needleUnits = repeatedUnits / 16;
const adversarial = ['a', 'é'].flatMap(letter => [false, true].map(lateHit => ({
  name: `${letter === 'a' ? 'ascii' : 'unicode'}-${lateHit ? 'late-hit' : 'miss'}`,
  body: letter.repeat(repeatedUnits) + (lateHit ? 'b' : ''),
  value: letter.toUpperCase().repeat(needleUnits - 1) + 'B',
  ordinal: -1, ignoreCase: lateHit ? repeatedUnits + 1 - needleUnits : -1
})));

adversarial.push(
  {name: 'periodic-leading-endpoint-miss', body: 'é'.repeat(repeatedUnits),
    value: '\uDC28' + 'É'.repeat(needleUnits), ordinal: -1, ignoreCase: -1},
  {name: 'periodic-trailing-endpoint-miss', body: 'é'.repeat(repeatedUnits),
    value: 'É'.repeat(needleUnits) + '\uD801', ordinal: -1, ignoreCase: -1},
  {name: 'periodic-both-endpoint-miss', body: '\uDC28é'.repeat(repeatedUnits / 2),
    value: '\uDC28' + 'É\uDC28'.repeat(needleUnits / 2 - 1) + 'É\uD801', ordinal: -1, ignoreCase: -1},
  {name: 'periodic-endpoint-late-hit', body: 'é'.repeat(repeatedUnits) + '\uDC28' + 'é'.repeat(needleUnits) + '\uD801',
    value: '\uDC28' + 'É'.repeat(needleUnits) + '\uD801', ordinal: -1, ignoreCase: repeatedUnits},
  {name: 'periodic-prefix-present-trailing-miss', body: '\uDC28' + 'é'.repeat(repeatedUnits),
    value: '\uDC28' + 'É'.repeat(needleUnits) + '\uD801', ordinal: -1, ignoreCase: -1},
  {name: 'periodic-prefix-after-final-window', body: 'é'.repeat(repeatedUnits) + '\uDC28',
    value: '\uDC28' + 'É'.repeat(needleUnits), ordinal: -1, ignoreCase: -1}
);

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
      const fromWithMode = descriptors.find(row => row.parameters.join(',') === 'string,int,System.StringComparison');
      const lastWithMode = findContracts('System.String', 'LastIndexOf', false)
        .find(row => row.parameters.join(',') === 'string,System.StringComparison');
      const contains = findContracts('System.String', 'Contains', false).find(row => row.parameters.length === 2);
      const evaluate = (rows, count) => {
        const cases = rows.map(row => ({...row, lastIgnoreCase: row.lastIgnoreCase ?? row.ignoreCase,
          args: [managed(row.body), managed(row.value)]}));
        const zeroStart = cases.map(row => ({...row, args: [...row.args, 0]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
        const fromIgnoreCase = cases.map(row => ({...row, args: [...row.args, 0, 5]}));
        return {
          oneArgumentControl: measure(platform, legacy, cases, 'ordinal', count),
          intStartIndexControl: measure(platform, startIndex, zeroStart, 'ordinal', count),
          containsOrdinalControl: measure(platform, contains, ordinal, 'ordinal', count),
          containsIgnoreCaseControl: measure(platform, contains, ignoreCase, 'ignoreCase', count),
          indexOfOrdinal: measure(platform, withMode, ordinal, 'ordinal', count),
          indexOfIgnoreCase: measure(platform, withMode, ignoreCase, 'ignoreCase', count),
          indexOfFromIgnoreCase: measure(platform, fromWithMode, fromIgnoreCase, 'ignoreCase', count),
          lastIndexOfIgnoreCase: measure(platform, lastWithMode, ignoreCase, 'lastIgnoreCase', count)
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
  workload: 'Real source/CIL IndexOf/Contains/LastIndexOf: retained ordinary and repeated-prefix inputs plus raw prefix controls',
  notes: 'Setup, managed strings, optional host GC and assertions excluded. ' +
    'Factorization uses two small host records; a missing raw prefix skips it. No host allocation count claim.',
  engines}, null, 2));
