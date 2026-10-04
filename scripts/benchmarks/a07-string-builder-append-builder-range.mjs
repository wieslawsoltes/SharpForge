// Copy this identical runner to the final Decimal332 parent; execute both revisions serially.
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
const appendString = contract('Append', ['string']);
const toString = contract('ToString', []);
const selected = '\0\ud800'.repeat(32);
const workloads = [
  {name: 'string-control', parameters: ['string'], segments: [selected]},
  {name: 'whole-builder-control', parameters: [owner], segments: [selected]},
  {name: 'string-range-control', parameters: ['string', 'int', 'int'], segments: ['prefix', selected, 'suffix'], start: 6, count: 64},
  {name: 'builder-range', parameters: [owner, 'int', 'int'], segments: ['prefix', selected, 'suffix'], start: 6, count: 64},
  {name: 'many-chunk-range', parameters: [owner, 'int', 'int'], segments: Array(64).fill('\0\ud800'), start: 31, count: 64},
  {name: 'self-range', parameters: [owner, 'int', 'int'], segments: ['seed|'], start: 1, count: 3, self: true},
  {name: 'zero-range', parameters: [owner, 'int', 'int'], segments: ['unused'], start: 2147483647, count: 0},
  {name: 'null-range', parameters: [owner, 'int', 'int'], segments: null, start: 0, count: 0}
];

function setup(platform, workload) {
  const {heap} = platform;
  const initial = heap.string('seed|');
  heap.pins.push(initial);
  let source = null;
  if (workload.segments !== null) {
    if (workload.parameters[0] === 'string') source = heap.string(workload.segments.join(''));
    else {
      source = platform.invoke(constructor, [heap.string('')]);
      heap.pins.push(source);
      for (const segment of workload.segments) platform.invoke(appendString, [source, heap.string(segment)]);
    }
    heap.pins.push(source);
  }
  const targets = [];
  for (let index = 0; index < (workload.self ? calls : 1); index++) {
    const builder = platform.invoke(constructor, [initial]);
    heap.pins.push(builder);
    targets.push(builder);
  }
  const args = [targets[0], source];
  if (workload.count !== undefined) args.push(workload.start, workload.count);
  return {targets, args};
}

function sample(engine, workload, descriptor) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const {heap} = platform;
  try {
    return heap.withRoots([], () => {
      const {targets, args} = setup(platform, workload);
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
      const text = workload.segments?.join('') ?? '';
      const selected = workload.count === undefined ? text : text.slice(workload.start, workload.start + workload.count);
      const expected = 'seed|' + selected.repeat(workload.self ? 1 : calls);
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
      engines[engine][workload.name] = {skipped: true, reason: 'Ranged source-builder overload absent on parent'};
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
  workload: 'Actual source/CIL platform dispatch: released string/builder controls and separate ranged-builder costs',
  notes: 'Setup, host GC and materialization excluded. Self calls each use a prebuilt target once; maximum output 320005 units.',
  allocationScope: 'Managed counters exclude selected host substrings and segment references.', engines}, null, 2));
