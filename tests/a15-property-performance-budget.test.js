import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {benchmark} from '../scripts/conformance/perf/core.js';
import {checkPropertyBudget} from '../scripts/benchmarks/a15-property-gate.mjs';

const adapters = JSON.parse(readFileSync(new URL('../scripts/benchmarks/a15-property-registry.json', import.meta.url)));
const policy = {schemaVersion: 1, minimumSamples: 20, maximumRegression: 0.2};
function fixture({time = 100, allocations = 10, bytes = 100, tail = null} = {}) {
  const commit = 'a'.repeat(40), samples = Array(20).fill(time);
  if (tail !== null) { samples[18] = tail; samples[19] = tail; }
  return {schemaVersion: 1, commit, harnessCommit: commit, runnerId: 'fixture-runner', registry: null,
    environment: {node: 'v22.0.0', platform: 'linux', arch: 'x64', cpu: 'fixture', logicalCpus: 1,
      osRelease: 'fixture', runnerName: 'fixture', commit}, unsupported: [],
    benchmarks: adapters.map(adapter => benchmark({...adapter, samples, checksum: adapter.scope, metrics: {
      samples: samples.map(() => ({managed: {allocationsPerOperation: allocations, bytesPerOperation: bytes}}))
    }}))};
}

test('A15 property performance policy admits the 20 percent boundary and rejects larger median/tail regressions', () => {
  assert.equal(checkPropertyBudget(fixture(), fixture({time: 120}), policy).passed, true);
  assert.equal(checkPropertyBudget(fixture(), fixture({time: 121}), policy).passed, false);
  assert.equal(checkPropertyBudget(fixture(), fixture({tail: 121}), policy).passed, false);
});

test('A15 allocation budgets apply to measured managed counts and bytes independently', () => {
  assert.equal(checkPropertyBudget(fixture(), fixture({allocations: 12, bytes: 120}), policy).passed, true);
  assert.equal(checkPropertyBudget(fixture(), fixture({allocations: 13}), policy).passed, false);
  assert.equal(checkPropertyBudget(fixture(), fixture({bytes: 121}), policy).passed, false);
  assert.equal(checkPropertyBudget(fixture({allocations: 0}), fixture({allocations: 1}), policy).passed, false);
});

test('A15 performance gates reject missing workloads, unmeasured allocations and changed runner identity', () => {
  const missing = fixture(); missing.benchmarks.pop();
  assert.throws(() => checkPropertyBudget(fixture(), missing, policy), /workload set/);
  const unmeasured = fixture(); unmeasured.benchmarks[0].metrics.samples = [];
  assert.throws(() => checkPropertyBudget(fixture(), unmeasured, policy), /allocation counters/);
  const foreign = fixture(); foreign.runnerId = 'other-runner';
  assert.throws(() => checkPropertyBudget(fixture(), foreign, policy), /same runner/);
  assert.throws(() => checkPropertyBudget(fixture(), fixture(), {...policy, maximumRegression: 0.3}), /policy/);
});
