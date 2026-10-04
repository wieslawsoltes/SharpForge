import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ab} from '../conformance/perf/ab.js';
import {compare} from '../conformance/perf/compare.js';
import {args, isMain, repository, json, writeJson, distribution} from '../conformance/perf/core.js';

const policyPath = fileURLToPath(new URL('../../planning/qualification/property-performance-budget.json', import.meta.url));
const registryPath = fileURLToPath(new URL('./a15-property-registry.json', import.meta.url));

function regression(before, after, maximum) {
  const ratio = before === 0 ? after === 0 ? 1 : Infinity : after / before;
  return {base: before, head: after, relative: Number.isFinite(ratio) ? ratio - 1 : null, passed: ratio <= 1 + maximum};
}

function allocations(benchmark, name, minimumSamples) {
  const values = benchmark.metrics?.samples?.map(sample => sample.managed?.[name]);
  if (!values || values.length < minimumSamples || values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Measured managed allocation counters are required for ' + benchmark.id);
  }
  return distribution(values).median;
}

/** Raw data, exact workload identities, environment and managed counters are all required; missing evidence cannot pass. */
export function checkPropertyBudget(base, head, policy = json(policyPath)) {
  if (policy.schemaVersion !== 1 || !Number.isInteger(policy.minimumSamples) || policy.minimumSamples < 20
    || !Number.isFinite(policy.maximumRegression) || policy.maximumRegression < 0 || policy.maximumRegression > 0.2) {
    throw new Error('Invalid A15 property performance policy');
  }
  const expected = json(registryPath).map(row => row.id).sort();
  for (const report of [base, head]) {
    if (JSON.stringify(report.benchmarks.map(row => row.id).sort()) !== JSON.stringify(expected)) throw new Error('A15 workload set mismatch');
  }
  const paired = compare(base, head, {threshold: policy.maximumRegression, minSamples: policy.minimumSamples});
  const rows = paired.rows.map(row => {
    const before = base.benchmarks.find(value => value.id === row.id), after = head.benchmarks.find(value => value.id === row.id);
    const metrics = {
      medianMs: regression(row.base.median, row.head.median, policy.maximumRegression),
      p95Ms: regression(row.base.p95, row.head.p95, policy.maximumRegression),
      managedAllocationsPerOperation: regression(allocations(before, 'allocationsPerOperation', policy.minimumSamples),
        allocations(after, 'allocationsPerOperation', policy.minimumSamples), policy.maximumRegression),
      managedBytesPerOperation: regression(allocations(before, 'bytesPerOperation', policy.minimumSamples),
        allocations(after, 'bytesPerOperation', policy.minimumSamples), policy.maximumRegression)
    };
    return {id: row.id, engine: row.engine, metrics, passed: Object.values(metrics).every(value => value.passed)};
  });
  return {schemaVersion: 1, baseCommit: base.commit, headCommit: head.commit, runnerId: head.runnerId,
    maximumRegression: policy.maximumRegression, passed: rows.every(row => row.passed), rows};
}

export async function qualifyPropertyPerformance({base, head = 'HEAD', root = repository, output, signal} = {}) {
  const policy = json(policyPath);
  base ??= policy.baselineCommit;
  if (typeof base !== 'string' || !/^[a-f0-9]{40,64}$/.test(base)) {
    throw new Error('A15 performance requires an exact measured baseline commit after full-scope qualification');
  }
  output ??= join(root, 'artifacts/results/performance/property');
  const ids = json(registryPath).map(row => row.id);
  await ab({root, base, head, ids, registry: registryPath, pairs: policy.minimumSamples, output,
    threshold: policy.maximumRegression, signal});
  const result = checkPropertyBudget(json(join(output, 'base.json')), json(join(output, 'head.json')), policy);
  writeJson(join(output, 'property-budget.json'), result);
  return result;
}

if (isMain(import.meta.url)) {
  const options = args(), controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const result = await qualifyPropertyPerformance({base: options.base, head: options.head,
    root: resolve(options.root ?? repository), output: options.output, signal: controller.signal});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.passed) process.exitCode = 1;
}
