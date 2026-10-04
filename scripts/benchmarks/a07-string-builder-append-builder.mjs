// Copy this identical runner to the final 524322 parent; execute baseline and candidate serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 2000);
assert(Number.isInteger(calls) && calls >= 100 && calls <= 5000, 'Calls must be within 100..5000');
const owner = 'System.Text.StringBuilder';
const program = compileToIL('class Program { static void Main() {} }');
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const contract = (name, parameters) => findContracts(owner, name)
  .find(member => member.parameters.join(',') === parameters.join(','));
const constructor = contract('.ctor', ['string']);
const toString = contract('ToString', []);
const selected = '\0\ud800'.repeat(32);
const workloads = [
  {name: 'string-control', parameters: ['string'], text: selected},
  {name: 'builder-source', parameters: [owner], text: selected},
  {name: 'self-builder', parameters: [owner], self: true, text: 'seed|'},
  {name: 'empty-builder', parameters: [owner], text: ''},
  {name: 'null-builder', parameters: [owner], text: null}
];

function sample(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const initial = heap.string('seed|');
      heap.pins.push(initial);
      const text = workload.text === null ? null : heap.string(workload.text);
      heap.pins.push(text);
      const source = workload.parameters[0] === 'string' || text === null ? text : platform.invoke(constructor, [text]);
      heap.pins.push(source);
      const targets = [];
      for (let index = 0; index < (workload.self ? calls : 1); index++) {
        const builder = platform.invoke(constructor, [initial]);
        heap.pins.push(builder);
        targets.push(builder);
      }
      const args = [targets[0], source];
      let slotWrites = 0;
      vm.onWrite = event => { if (event.kind === 'array') slotWrites++; };
      globalThis.gc?.();
      const allocations = heap.stats.allocations;
      const bytes = heap.stats.allocatedBytes;
      let returned;
      const started = performance.now();
      for (let index = 0; index < calls; index++) {
        if (workload.self) args[0] = args[1] = targets[index];
        returned = platform.invoke(descriptor, args);
      }
      const elapsedMs = performance.now() - started;
      const result = {elapsedMs, managedAllocations: heap.stats.allocations - allocations,
        managedAllocatedBytes: heap.stats.allocatedBytes - bytes, slotWrites};
      vm.onWrite = null;
      assert.deepEqual(returned, targets.at(-1));
      const expected = workload.self ? 'seed|seed|' : 'seed|' + (workload.text ?? '').repeat(calls);
      for (const builder of targets) assert.equal(platform.native(platform.invoke(toString, [builder])), expected);
      return result;
    });
  } finally { vm.onWrite = null; vm.stop(); }
}

function summary(samples, key) {
  const values = samples.map(row => row[key]).toSorted((left, right) => left - right);
  return {median: values[2], p95: values[4]};
}

const engines = {source: {}, cil: {}};
for (const workload of workloads) {
  const descriptor = contract('Append', workload.parameters);
  for (const engine of Object.keys(engines)) {
    if (!descriptor) {
      engines[engine][workload.name] = {skipped: true, reason: 'Source-builder overload absent on baseline'};
      continue;
    }
    const samples = [];
    for (let index = -1; index < 5; index++) {
      const result = sample(engine, workload, descriptor);
      if (index >= 0) samples.push(result);
    }
    engines[engine][workload.name] = {setupTargets: workload.self ? calls : 1,
      elapsedMs: summary(samples, 'elapsedMs'), managedAllocations: summary(samples, 'managedAllocations'),
      managedAllocatedBytes: summary(samples, 'managedAllocatedBytes'), samples};
  }
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Actual source/CIL platform dispatch: released string control and separate builder/self/no-op costs',
  notes: 'Setup, host GC and materialization excluded. Self calls each use a prebuilt target once; maximum output 320005 units.',
  engines}, null, 2));
