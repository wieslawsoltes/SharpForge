// Copy this identical runner into the baseline worktree and execute both copies serially.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {compileToIL} from '@sharpforge/compiler';
import {findContracts} from '@sharpforge/framework';
import {hashSetValues} from '@sharpforge/bcl-collections';
import {VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';

const calls = Number(process.argv[2] ?? 512);
const revision = process.argv[3] ?? 'unspecified';
assert(Number.isInteger(calls) && calls >= 32 && calls <= 2000, 'Calls must be within 32..2000');
assert(revision.length <= 120, 'Revision label must contain at most 120 characters');
const source = 'class Program { static void Main() {} }';
const program = compileToIL(source, {pipeline: 'legacy'});
assert.equal(program.success, true, JSON.stringify(program.diagnostics));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function hostFor(engine, family) {
  const vm = engine === 'source' ? new VirtualMachine(program.image) : new CilVirtualMachine(program.assembly);
  const platform = vm.platform;
  const owner = family === 'HashSet' ? 'System.Collections.Generic.HashSet`1<int>'
    : 'System.Collections.Generic.Dictionary`2<int, int>';
  const handles = [];
  const methods = new Map();
  const root = value => { handles.push(platform.heap.createHandle(value)); return value; };
  function member(name, arity) {
    const key = name + '/' + arity;
    if (!methods.has(key)) {
      const matches = findContracts(owner, name).filter(row => row.parameters.length === arity &&
        (name !== '.ctor' || row.parameters[0] === 'int'));
      assert.equal(matches.length, 1, owner + '.' + key);
      methods.set(key, matches[0]);
    }
    return methods.get(key);
  }
  const invoke = (name, reference, values = []) => platform.invoke(member(name, values.length), [reference, ...values]);
  function create(capacity, items = []) {
    const reference = root(platform.invoke(member('.ctor', 1), [capacity]));
    for (const value of items) invoke('Add', reference, family === 'HashSet' ? [value] : [value, value * 10]);
    return reference;
  }
  return {vm, platform, owner, family, root, create, invoke, member,
    stop() { for (const handle of handles) platform.heap.releaseHandle(handle); vm.stop(); }};
}

function summary(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {median: sorted[2], p95: sorted[4]};
}

function measure(engine, workload) {
  const samples = [];
  for (let sample = -1; sample < 5; sample++) {
    const host = hostFor(engine, workload.family ?? 'HashSet');
    try {
      const fixture = workload.prepare(host);
      const results = Array(calls);
      let writes = 0;
      host.vm.onWrite = () => writes++;
      host.platform.heap.collect();
      globalThis.gc?.();
      const before = {...host.platform.heap.stats};
      const started = performance.now();
      for (let index = 0; index < calls; index++) results[index] = workload.run(host, fixture, index);
      const elapsedMs = performance.now() - started;
      const after = host.platform.heap.stats;
      const measured = {elapsedMs, nanosecondsPerCall: elapsedMs * 1_000_000 / calls,
        managedAllocations: after.allocations - before.allocations,
        managedAllocatedBytes: after.allocatedBytes - before.allocatedBytes,
        managedCollections: after.collections - before.collections, writes};
      host.vm.onWrite = null;
      workload.check(host, fixture, results);
      assert.equal(host.platform.heap.pins.length, 0, 'Temporary roots must return to baseline');
      if (sample >= 0) samples.push(measured);
    } finally { host.stop(); }
  }
  return {calls, samples, ...Object.fromEntries(Object.keys(samples[0]).map(name => [name, summary(samples.map(row => row[name]))]))};
}

function ordinaryWorkloads(family) {
  const set = family === 'HashSet';
  const initial = Array.from({length: 32}, (_, index) => index);
  return [
    {name: family + '.addWithGrowth', family,
      prepare: host => { host.member('Add', set ? 1 : 2); return host.create(0); },
      run: (host, reference, index) => host.invoke('Add', reference, set ? [index] : [index, index * 10]),
      check: (host, reference, results) => {
        assert.equal(host.invoke('get_Count', reference), calls);
        for (const result of results) assert.equal(set ? Boolean(host.platform.native(result)) : result, set ? true : null);
      }},
    {name: family + '.addWithSpareCapacity', family,
      prepare: host => { host.member('Add', set ? 1 : 2); return host.create(calls); },
      run: (host, reference, index) => host.invoke('Add', reference, set ? [index] : [index, index * 10]),
      check: (host, reference, results) => {
        assert.equal(host.invoke('get_Count', reference), calls);
        for (const result of results) assert.equal(set ? Boolean(host.platform.native(result)) : result, set ? true : null);
      }},
    {name: family + '.containsExisting', family,
      prepare: host => { host.member(set ? 'Contains' : 'ContainsKey', 1); return host.create(64, initial); },
      run: (host, reference, index) => host.invoke(set ? 'Contains' : 'ContainsKey', reference, [index % 32]),
      check: (host, reference, results) => {
        assert.equal(host.invoke('get_Count', reference), 32);
        for (const result of results) assert.equal(Boolean(host.platform.native(result)), true);
      }},
    {name: family + '.removeAndReuseSlot', family,
      prepare: host => { host.member('Remove', 1); return host.create(64, initial); },
      run: (host, reference, index) => {
        const value = index % 32;
        host.invoke('Remove', reference, [value]);
        return host.invoke('Add', reference, set ? [value] : [value, value * 10]);
      },
      check: (host, reference, results) => {
        assert.equal(host.invoke('get_Count', reference), 32);
        if (set) for (const result of results) assert.equal(Boolean(host.platform.native(result)), true);
      }}
  ];
}

function capacityWorkloads() {
  const singleton = host => host.create(29, [10, 20, 30]);
  const cohort = (host, trim) => Array.from({length: calls}, () => {
    const reference = host.create(trim ? 29 : 7, [10, 20, 30]);
    if (trim) host.invoke('Remove', reference, [20]);
    return reference;
  });
  return [
    {name: 'Capacity', prepare: host => { host.member('get_Capacity', 0); return singleton(host); },
      run: (host, reference) => host.invoke('get_Capacity', reference),
      check: (_host, _reference, results) => assert(results.every(value => value === 29))},
    {name: 'EnsureCapacity.noop', prepare: host => { host.member('EnsureCapacity', 1); return singleton(host); },
      run: (host, reference) => host.invoke('EnsureCapacity', reference, [29]),
      check: (_host, _reference, results) => assert(results.every(value => value === 29))},
    {name: 'TrimExcess.roundedNoop', prepare: host => { host.member('TrimExcess', 1); return singleton(host); },
      run: (host, reference) => host.invoke('TrimExcess', reference, [24]),
      check: (host, reference) => assert.equal(host.invoke('get_Capacity', reference), 29)},
    {name: 'EnsureCapacity.grow', prepare: host => { host.member('EnsureCapacity', 1); return cohort(host, false); },
      run: (host, references, index) => host.invoke('EnsureCapacity', references[index], [37]),
      check: (host, references, results) => {
        assert(results.every(value => value === 37));
        for (const reference of references) assert.equal(host.invoke('get_Count', reference), 3);
      }},
    {name: 'TrimExcess.compact', prepare: host => { host.member('TrimExcess', 0); return cohort(host, true); },
      run: (host, references, index) => host.invoke('TrimExcess', references[index]),
      check: (host, references) => {
        for (const reference of references) {
          assert.equal(host.invoke('get_Capacity', reference), 3);
          assert.deepEqual([...hashSetValues(host.platform, reference)], [10, 30]);
        }
      }}
  ];
}

const engines = {};
const supported = findContracts('System.Collections.Generic.HashSet`1<int>', 'get_Capacity').length === 1;
for (const engine of ['source', 'cil']) {
  const controls = {};
  for (const workload of [...ordinaryWorkloads('HashSet'), ...ordinaryWorkloads('Dictionary')]) {
    controls[workload.name] = measure(engine, workload);
  }
  engines[engine] = {controls};
}
for (const engine of ['source', 'cil']) {
  const capacity = supported ? {} : {supported: false, reason: 'HashSet capacity contracts are absent on this baseline'};
  if (supported) for (const workload of capacityWorkloads()) capacity[workload.name] = measure(engine, workload);
  engines[engine].capacity = capacity;
}
console.log(JSON.stringify({revision, node: process.version, os: process.platform, architecture: process.arch, cpu: cpus()[0]?.model,
  runnerSha256: hash(readFileSync(new URL(import.meta.url))), sourceSha256: hash(source), assemblySha256: hash(program.assembly),
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  workload: 'Real source/CIL VM platform dispatch; identical existing HashSet/Dictionary controls and separate new capacity operations',
  notes: 'Compilation, setup, explicit GC and assertions are excluded. Automatic managed GC and write-observer counters are measured.',
  engines}, null, 2));
