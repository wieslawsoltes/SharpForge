// Copy this identical runner to Decimal332 baseline 479c6ac5 and its prerequisite integration; run serially.
import assert from 'node:assert/strict';
import {cpus} from 'node:os';
import {performance} from 'node:perf_hooks';
import {contractForMember, findContracts} from '@sharpforge/framework';
import {intrinsicDefinition, intrinsicKey} from '@sharpforge/cil';

const calls = Number(process.argv[2] ?? 20000);
assert(Number.isInteger(calls) && calls >= 1000 && calls <= 100000, 'Calls must be within 1000..100000');
const owner = 'System.Text.StringBuilder';
const member = (owner, name, parameters, returnType, isStatic = false) => ({
  kind: 'method', owner, name, signature: {parameters, returnType, isStatic, genericArity: 0, callingConvention: 0}
});
const integer = member(owner, 'Append', ['int'], owner);
const sine = member('System.Math', 'Sin', ['double'], 'double', true);
const decimalAppend = member(owner, 'Append', ['System.Decimal'], owner);
const decimalAdd = member('System.Decimal', 'Add', ['System.Decimal', 'System.Decimal'], 'System.Decimal', true);
const decimalContract = findContracts(owner, 'Append', false).find(contract => contract.parameters.join(',') === 'decimal');
const workloads = [
  {name: 'framework-integer-control', lookup: contractForMember, descriptor: integer, expected: 804},
  {name: 'cil-integer-control', lookup: intrinsicDefinition, descriptor: integer, expected: 804},
  {name: 'framework-double-control', lookup: contractForMember, descriptor: sine,
    expected: findContracts('System.Math', 'Sin', true)[0].id},
  {name: 'cil-double-control', lookup: intrinsicDefinition, descriptor: sine,
    expected: findContracts('System.Math', 'Sin', true)[0].id},
  {name: 'cil-builtin-decimal-control', lookup: intrinsicDefinition, descriptor: decimalAdd, expected: intrinsicKey(decimalAdd)},
  {name: 'framework-decimal-append', lookup: contractForMember, descriptor: decimalAppend, expected: decimalContract?.id, feature: true},
  {name: 'cil-decimal-append', lookup: intrinsicDefinition, descriptor: decimalAppend, expected: decimalContract?.id, feature: true}
];

function identity(result) {
  return result?.contract?.id ?? result?.id ?? result?.key;
}

function sample(workload) {
  const {lookup, descriptor, expected} = workload;
  globalThis.gc?.();
  let matches = 0;
  let wrongMatches = 0;
  const started = performance.now();
  for (let index = 0; index < calls; index++) {
    const result = lookup(descriptor);
    if (result) {
      matches++;
      if (identity(result) !== expected) wrongMatches++;
    }
  }
  const elapsedMs = performance.now() - started;
  assert.equal(wrongMatches, 0, workload.name);
  if (!workload.feature) assert.equal(matches, calls, workload.name);
  return {elapsedMs, matches, wrongMatches};
}

const results = {};
for (const workload of workloads) {
  if (workload.expected === undefined) {
    results[workload.name] = {skipped: true, reason: 'Decimal Append is absent on this prerequisite-only revision'};
    continue;
  }
  const samples = [];
  for (let index = -1; index < 5; index++) {
    const result = sample(workload);
    if (index >= 0) samples.push(result);
  }
  const times = samples.map(row => row.elapsedMs).toSorted((left, right) => left - right);
  results[workload.name] = {expected: workload.expected, medianMs: times[2], p95Ms: times[4], samples};
}
console.log(JSON.stringify({node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
  calls, warmups: 1, samples: 5, gcAvailable: typeof globalThis.gc === 'function',
  scope: 'Actual registered-framework and CIL intrinsic lookup; registration, descriptors and host GC excluded.',
  notes: 'Decimal Append was unresolved on the baseline, so its match count changes. This is a correctness comparison, not a speedup claim.',
  allocationScope: 'Lookup creates host signature arrays/keys; no managed heap is instantiated or measured.', results}, null, 2));
