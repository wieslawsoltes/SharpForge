import {execFileSync} from 'node:child_process';
import {cpus, release} from 'node:os';
import {performance} from 'node:perf_hooks';
import {verifyVendor} from './verify-vendor.js';
import {licenseGate} from './license-gate.js';
import {secretScan} from './secret-scan.js';
import {commit, repository, writeJSON} from './files.js';

function statistics(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => sorted[Math.ceil(fraction * sorted.length) - 1];
  const middle = Math.floor(sorted.length / 2);
  return {medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: percentile(0.95), p99Ms: percentile(0.99)};
}

async function measure(name, action) {
  const sample = async () => {
    const before = process.memoryUsage().heapUsed;
    const started = performance.now();
    const result = await action();
    const ms = performance.now() - started;
    if (result.status !== 'pass') throw new Error('SUPPLY_BENCHMARK: correctness failed');
    return {ms, nodeRetainedHeapDeltaBytes: process.memoryUsage().heapUsed - before};
  };
  const cold = await sample();
  const warm = [];
  for (let index = 0; index < 20; index++) warm.push(await sample());
  return {name, cold, warm, ...statistics(warm.map(value => value.ms))};
}

function cleanCommit() {
  const status = execFileSync('git', ['status', '--porcelain'], {cwd: repository, encoding: 'utf8'});
  if (status.trim()) throw new Error('SUPPLY_BENCHMARK: clean checkout required');
  return commit();
}

const sourceCommit = cleanCommit();
const results = [];
for (const [name, action] of [['vendor', verifyVendor], ['licenses', licenseGate], ['secrets', secretScan]]) {
  results.push(await measure(name, () => action({root: repository})));
}
if (cleanCommit() !== sourceCommit) throw new Error('SUPPLY_BENCHMARK: checkout changed while measuring');
await writeJSON('artifacts/results/supply/performance.json', {schemaVersion: 1, commit: sourceCommit,
  node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model,
  scope: 'Actual source-tree gate cost; heapUsed deltas are retained JS heap, not total/native allocations', results});
console.log(JSON.stringify(results.map(({name, medianMs, p95Ms, p99Ms}) => ({name, medianMs, p95Ms, p99Ms}))));
