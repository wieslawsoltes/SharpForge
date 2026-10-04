// Copy this identical runner to Compare-only parent f9292ef3; run baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 5000);
const length = Number(process.argv[3] ?? 128);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 20000, 'Calls must be within 100..20000');
assert(Number.isInteger(length) && length >= 1 && length <= 2048, 'Affix length must be within 1..2048');
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const lower = 'a'.repeat(length);
const upper = 'A'.repeat(length);
const rows = [
  {body: '', value: '', ordinal: true, ignoreCase: true},
  {body: lower, value: lower, ordinal: true, ignoreCase: true},
  {body: lower, value: upper, ordinal: false, ignoreCase: true},
  {body: lower + 'b', value: upper + 'C', ordinal: false, ignoreCase: false},
  {body: 'é'.repeat(length), value: 'É'.repeat(length), ordinal: false, ignoreCase: true},
  {body: 'a', value: 'aaaa', ordinal: false, ignoreCase: false},
  {body: '\u017F', value: 'S', ordinal: false, ignoreCase: false},
  {body: 'ß', value: 'SS', ordinal: false, ignoreCase: false},
  {method: 'StartsWith', body: lower + '\uD801\uDC28', value: upper + '\uD801', ordinal: false, ignoreCase: true},
  {method: 'EndsWith', body: '\uD801\uDC28' + lower, value: '\uDC28' + upper, ordinal: false, ignoreCase: true}
];

function summary(values) {
  const sorted = values.toSorted((first, second) => first - second);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(platform, descriptor, cases, resultName) {
  if (!descriptor) return {skipped: true, reason: 'StringComparison affix overload is absent on the baseline'};
  const results = new Uint8Array(calls);
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    globalThis.gc?.();
    const allocations = platform.heap.stats.allocations;
    const bytes = platform.heap.stats.allocatedBytes;
    const started = performance.now();
    for (let index = 0; index < calls; index++) results[index] = platform.invoke(descriptor, cases[index % cases.length].args);
    const elapsedMs = performance.now() - started;
    const managedAllocations = platform.heap.stats.allocations - allocations;
    const managedAllocatedBytes = platform.heap.stats.allocatedBytes - bytes;
    for (let index = 0; index < calls; index++) assert.equal(Boolean(results[index]), cases[index % cases.length][resultName]);
    if (sample >= 0) samples.push({elapsedMs, managedAllocations, managedAllocatedBytes});
  }
  return {elapsedMs: summary(samples.map(row => row.elapsedMs)),
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
      const methods = {};
      for (const method of ['StartsWith', 'EndsWith']) {
        const descriptors = findContracts('System.String', method, false);
        const legacy = descriptors.find(row => row.parameters.length === 1);
        const withMode = descriptors.find(row => row.parameters.join(',') === 'string,System.StringComparison');
        const cases = rows.filter(row => !row.method || row.method === method).map(row => {
          const receiver = method === 'StartsWith' ? row.body + '!' : '!' + row.body;
          return {...row, args: [managed(receiver), managed(row.value)]};
        });
        const ordinal = cases.map(row => ({...row, args: [...row.args, 4]}));
        const ignoreCase = cases.map(row => ({...row, args: [...row.args, 5]}));
        methods[method] = {
          oneArgumentControl: measure(platform, legacy, cases, 'ordinal'),
          ordinal: measure(platform, withMode, ordinal, 'ordinal'),
          ordinalIgnoreCase: measure(platform, withMode, ignoreCase, 'ignoreCase')
        };
      }
      return methods;
    });
  } finally {vm.stop();}
}

const engines = {};
for (const engine of ['source', 'cil']) engines[engine] = run(engine);
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, affixLength: length, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL platform StartsWith/EndsWith: released one-argument controls and new ordinal mode costs',
  notes: 'Setup, managed strings, host GC and result checks excluded. New overloads are separate; no speedup claim.',
  engines}, null, 2));
