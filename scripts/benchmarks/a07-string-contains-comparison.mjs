// Copy this identical runner to range-only parent 1a9105df; run baseline and candidate serially.
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
  {body: '', value: '', ordinal: true, ignoreCase: true},
  {body: 'prefix-value-suffix', value: 'value', ordinal: true, ignoreCase: true},
  {body: 'prefix-VALUE-suffix', value: 'value', ordinal: false, ignoreCase: true},
  {body: 'prefix-value-suffix', value: 'missing', ordinal: false, ignoreCase: false},
  {body: 'xéclairz', value: 'ÉCLAIR', ordinal: false, ignoreCase: true},
  {body: 'a', value: 'aaaa', ordinal: false, ignoreCase: false},
  {body: 'x\u017Fz', value: 'S', ordinal: false, ignoreCase: false},
  {body: 'xßz', value: 'SS', ordinal: false, ignoreCase: false},
  {body: 'x\uD801\uDC28az', value: '\uDC28A', ordinal: false, ignoreCase: true},
  {body: 'xa\uD801\uDC28z', value: 'A\uD801', ordinal: false, ignoreCase: true}
];
const repeatedUnits = 1024;
const needleUnits = 64;
const adversarial = ['a', 'é'].flatMap(letter => [false, true].map(lateHit => ({
  name: `${letter === 'a' ? 'ascii' : 'unicode'}-${lateHit ? 'late-hit' : 'miss'}`,
  body: letter.repeat(repeatedUnits) + (lateHit ? 'b' : ''),
  value: letter.toUpperCase().repeat(needleUnits - 1) + 'B',
  ordinal: false, ignoreCase: lateHit
})));

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName, count) {
  if (!descriptor) return {skipped: true, reason: 'StringComparison Contains overload is absent on the baseline'};
  const results = new Uint8Array(count);
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
    for (let index = 0; index < count; index++) assert.equal(Boolean(results[index]), cases[index % cases.length][resultName]);
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
      const descriptors = findContracts('System.String', 'Contains', false);
      const legacy = descriptors.find(row => row.parameters.length === 1);
      const withMode = descriptors.find(row => row.parameters.join(',') === 'string,System.StringComparison');
      const evaluate = (rows, count) => {
        const cases = rows.map(row => ({...row, args: [managed(row.body), managed(row.value)]}));
        const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
        return {
          oneArgumentControl: measure(platform, legacy, cases, 'ordinal', count),
          ordinal: measure(platform, withMode, ordinal, 'ordinal', count),
          ordinalIgnoreCase: measure(platform, withMode, ignoreCase, 'ignoreCase', count)
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
  workload: 'Real source/CIL platform Contains: ordinary paths plus bounded repeated-prefix misses and late hits',
  notes: 'Setup, managed strings, host GC and assertions excluded. Ignore-case search has O(n*m) worst-case time; no speedup claim.',
  engines}, null, 2));
