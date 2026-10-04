import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { freemem, loadavg, totalmem } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clean, distribution, environment, git, sha, writeJson } from '../../../scripts/conformance/perf/core.js';

const candidateRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const baselineCommit = 'd64188af91f03d02041316bdde2ee64fd0634be0';
const productCommit = '26d4808350116a2ae95c5216393bd690032c6034';
const nativeSha256 = 'bdb094d3714b593bf70a1bac84bb456def0052c0019dc0ecedf1d4b8b2e298e4';
const driverPath = 'packages/cil/tools/benchmark-pe-inspection.mjs';
const fixturePath = 'tests/fixtures/pe-inspection/';
const batchCounts = Object.freeze({ warmup: 20, measured: 100 });
const identityPaths = ['package.json', ':(glob)packages/*/package.json', ':(glob)packages/*/src/**',
  'tests/managed-fixtures.js', `${fixturePath}native.json`, `${fixturePath}reference-images.json`,
  `${fixturePath}Program.cs`, `:(glob)${fixturePath}*.mjs`];

function argumentsFor(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    assert.ok(['--baseline', '--r2r', '--mixed', '--output'].includes(key), `Unknown argument: ${key}`);
    assert.ok(values[index + 1] && !Object.hasOwn(args, key), `Missing or repeated argument: ${key}`);
    args[key] = resolve(values[index + 1]);
  }
  assert.equal(Object.keys(args).length, 4, 'Required: --baseline <checkout> --r2r <image> --mixed <image> --output <new.json>');
  args['--baseline'] = realpathSync(args['--baseline']);
  const outputParent = realpathSync(dirname(args['--output']));
  for (const root of [candidateRoot, args['--baseline']]) {
    const location = relative(root, outputParent);
    assert.ok(location === '..' || location.startsWith(`..${sep}`), 'Output must be outside both checkouts');
  }
  assert.ok(!existsSync(args['--output']), 'Output exists; preserve each original cohort instead of overwriting it');
  assert.notEqual(args['--baseline'], candidateRoot, 'Use distinct baseline and candidate checkouts');
  return args;
}

function revision(root, expected, exactHead) {
  const head = clean(root);
  if (exactHead) assert.equal(head, expected, 'Baseline must be the exact pre-PE main revision');
  else git(root, 'merge-base', '--is-ancestor', expected, head);
  git(root, 'diff', '--exit-code', expected, '--', ...identityPaths);
  return { root, head, tree: git(root, 'rev-parse', 'HEAD^{tree}'), productRevision: expected };
}

function workspaceAliases(root) {
  const pending = ['@sharpforge/cil'];
  const aliases = {};
  while (pending.length) {
    const name = pending.shift();
    if (Object.hasOwn(aliases, name)) continue;
    const packageRoot = resolve(root, 'packages', name.slice('@sharpforge/'.length));
    const manifestPath = resolve(packageRoot, 'package.json');
    const manifestBytes = readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBytes);
    const entry = realpathSync(createRequire(resolve(root, driverPath)).resolve(name));
    assert.equal(entry, realpathSync(resolve(packageRoot, 'src/index.js')), `${name}: use this checkout's public alias`);
    const dependencies = Object.keys(manifest.dependencies ?? {}).filter(value => value.startsWith('@sharpforge/'));
    for (const dependency of dependencies) {
      const actual = realpathSync(createRequire(manifestPath).resolve(dependency));
      assert.equal(actual, realpathSync(resolve(root, 'packages', dependency.slice('@sharpforge/'.length), 'src/index.js')),
        `${name} must resolve ${dependency} inside its own checkout`);
    }
    aliases[name] = { entry, entrySha256: sha(readFileSync(entry)), manifestSha256: sha(manifestBytes),
      sourceTree: git(root, 'rev-parse', `HEAD:packages/${name.slice('@sharpforge/'.length)}/src`) };
    pending.push(...dependencies);
  }
  return aliases;
}

function sourceFiles(root, capture) {
  const files = [...new Set([...Object.keys(capture.sourceSha256), 'packages/cil/src/index.js',
    'packages/symbols/src/debug-directory-reader.js', 'packages/symbols/src/local-signatures.js', 'tests/managed-fixtures.js'])];
  return Object.fromEntries(files.map(file => [file, existsSync(resolve(root, file)) ? sha(readFileSync(resolve(root, file))) : null]));
}

function toolFiles() {
  const files = [driverPath, 'packages/cil/tools/pe-benchmark-facts.mjs', 'scripts/conformance/perf/core.js',
    'scripts/planning/schema/validate.js', 'scripts/conformance/static/allowlist.json', 'scripts/limited.js'];
  return Object.fromEntries(files.map(file => [file, sha(readFileSync(resolve(candidateRoot, file)))]));
}

function nativeEvidence() {
  const bytes = readFileSync(resolve(candidateRoot, fixturePath, 'native.json'));
  assert.equal(sha(bytes), nativeSha256, 'Native/source fixture must remain byte exact');
  const capture = JSON.parse(bytes);
  const manifestBytes = readFileSync(resolve(candidateRoot, fixturePath, 'reference-images.json'));
  assert.equal(capture.status, 'pass', 'Successful retained PEReader/SRM capture required');
  assert.equal(capture.manifestSha256, sha(manifestBytes), 'Manifest matches retained capture');
  assert.equal(capture.toolchain.sdk, '10.0.201');
  assert.equal(capture.toolchain.runtime, '10.0.5');
  for (const [file, expected] of Object.entries(capture.sourceSha256))
    assert.equal(sha(readFileSync(resolve(candidateRoot, file))), expected, `${file}: native capture source identity`);
  assert.deepEqual(capture.observations.map(value => value.id), ['r2r', 'mixed']);
  return { capture, manifest: JSON.parse(manifestBytes), manifestSha256: sha(manifestBytes) };
}

function reviewedImport(toolHashes) {
  const allowlist = JSON.parse(readFileSync(resolve(candidateRoot, 'scripts/conformance/static/allowlist.json')));
  const entries = allowlist.allow.filter(value => value.path === driverPath && value.operation === 'dynamic-import');
  assert.equal(entries.length, 1, 'One exact reviewed import allowance');
  assert.equal(entries[0].count, 2, 'Only the trusted baseline entry and adjacent fixed harness module are dynamic');
  assert.equal(entries[0].sha256, toolHashes[driverPath], 'Reviewed driver source hash');
}

function runBatch(context) {
  const { workload, variant, phase, round, report } = context;
  const results = new Array(workload.iterations);
  const invoke = variant.invoke;
  const memoryBefore = process.memoryUsage();
  const start = performance.now();
  let completed = 0;
  let failure;
  try {
    for (; completed < results.length; completed++) results[completed] = invoke();
  } catch (error) {
    failure = error;
  }
  const elapsedMs = performance.now() - start;
  const memoryAfter = process.memoryUsage();
  const sample = { sequence: report.chronologicalSamples.length, phase, round, workload: workload.id, variant: variant.id,
    startedAtMilliseconds: performance.timeOrigin + start, completedCalls: completed, elapsedMs,
    nanosecondsPerCall: completed ? elapsedMs * 1_000_000 / completed : null,
    heapUsedBefore: memoryBefore.heapUsed, heapUsedAfter: memoryAfter.heapUsed,
    heapUsedDelta: memoryAfter.heapUsed - memoryBefore.heapUsed, guard: 'pending' };
  report.chronologicalSamples.push(sample);
  try {
    if (failure) throw failure;
    for (const result of results) variant.guard(result);
    sample.guard = 'pass';
  } catch (error) {
    sample.guard = 'failed';
    throw error;
  } finally {
    results.fill(null);
  }
}

function measure(workloads, report) {
  for (let ordinal = 0; ordinal < batchCounts.warmup + batchCounts.measured; ordinal++) {
    const phase = ordinal < batchCounts.warmup ? 'warmup' : 'measurement';
    const round = ordinal < batchCounts.warmup ? ordinal : ordinal - batchCounts.warmup;
    for (let slot = 0; slot < workloads.length; slot++) {
      const workload = workloads[(slot + ordinal) % workloads.length];
      const variants = ordinal % 2 ? workload.variants.toReversed() : workload.variants;
      for (const variant of variants) runBatch({ workload, variant, phase, round, report });
    }
  }
}

function summarize(workload, samples) {
  const statistics = {};
  for (const variant of workload.variants) {
    const rows = samples.filter(row => row.workload === workload.id && row.variant === variant.id);
    assert.equal(rows.filter(row => row.phase === 'warmup').length, batchCounts.warmup);
    const measured = rows.filter(row => row.phase === 'measurement');
    assert.equal(measured.length, batchCounts.measured);
    assert.ok(rows.every(row => row.guard === 'pass' && row.completedCalls === workload.iterations));
    statistics[variant.id] = { nanosecondsPerCall: distribution(measured.map(row => row.nanosecondsPerCall)),
      resultSha256: variant.expectedSha256,
      observedHeap: { minDeltaBytes: Math.min(...measured.map(row => row.heapUsedDelta)),
        maxDeltaBytes: Math.max(...measured.map(row => row.heapUsedDelta)),
        maxEndHeapUsedBytes: Math.max(...measured.map(row => row.heapUsedAfter)) } };
  }
  const result = { workload: workload.id, iterationsPerBatch: workload.iterations, statistics };
  if (workload.group === 'ordinary') {
    result.changePercent = Object.fromEntries(['median', 'p95', 'p99'].map(metric => [metric,
      (statistics.candidate.nanosecondsPerCall[metric] / statistics.baseline.nanosecondsPerCall[metric] - 1) * 100]));
    result.medianOverFivePercent = result.changePercent.median > 5;
  }
  return result;
}

async function capture(args, report) {
  const revisions = { baseline: revision(args['--baseline'], baselineCommit, true),
    candidate: revision(candidateRoot, productCommit, false) };
  const aliases = { baseline: workspaceAliases(args['--baseline']), candidate: workspaceAliases(candidateRoot) };
  const reference = nativeEvidence();
  const tools = toolFiles();
  reviewedImport(tools);
  assert.equal(sha(readFileSync(resolve(args['--baseline'], 'tests/managed-fixtures.js'))),
    sha(readFileSync(resolve(candidateRoot, 'tests/managed-fixtures.js'))), 'Unchanged common fixture helper');
  Object.assign(report, { revisions, workspaceAliases: aliases, toolSha256: tools,
    sourceSha256: { baseline: sourceFiles(args['--baseline'], reference.capture), candidate: sourceFiles(candidateRoot, reference.capture) },
    nativeEvidence: { sha256: nativeSha256, manifestSha256: reference.manifestSha256, toolchain: reference.capture.toolchain } });
  // Inputs select data only. These imports are pinned local developer source and the fixed adjacent harness.
  const baseline = await import(pathToFileURL(aliases.baseline['@sharpforge/cil'].entry).href);
  const { ordinaryWorkloads, referenceWorkload } = await import('./pe-benchmark-facts.mjs');
  const ordinary = ordinaryWorkloads(baseline);
  const features = reference.manifest.images.map(definition => referenceWorkload({ definition,
    bytes: readFileSync(args[`--${definition.id}`]),
    native: reference.capture.observations.find(value => value.id === definition.id).native }));
  const workloads = [...ordinary.workloads, ...features.map(value => value.workload)];
  report.fixtureEvidence = { ordinary: ordinary.evidence, newFeature: features.map(value => value.evidence) };
  report.measurementStart = { memory: process.memoryUsage(), loadAverage: loadavg(), freeMemoryBytes: freemem() };
  report.status = 'measuring';
  writeJson(args['--output'], report);
  measure(workloads, report);
  report.measurementEnd = { memory: process.memoryUsage(), loadAverage: loadavg(), freeMemoryBytes: freemem() };
  ordinary.verify();
  for (const feature of features) feature.verify();
  assert.deepEqual(revision(args['--baseline'], baselineCommit, true), revisions.baseline, 'Stable baseline checkout');
  assert.deepEqual(revision(candidateRoot, productCommit, false), revisions.candidate, 'Stable candidate checkout');
  assert.deepEqual(workspaceAliases(args['--baseline']), aliases.baseline, 'Stable baseline aliases');
  assert.deepEqual(workspaceAliases(candidateRoot), aliases.candidate, 'Stable candidate aliases');
  assert.deepEqual(toolFiles(), tools, 'Stable tool source');
  nativeEvidence();
  report.results = {
    ordinary: workloads.filter(value => value.group === 'ordinary').map(value => summarize(value, report.chronologicalSamples)),
    newFeature: workloads.filter(value => value.group === 'new-feature').map(value => summarize(value, report.chronologicalSamples)),
  };
  report.correctness = { everyResultConsumedAndChecked: true, completeLegacyFactsBeforeAndAfter: true,
    bothNativeReferencesBeforeAndAfter: true, inputPayloadsRetained: false };
  report.status = 'pass';
}

const args = argumentsFor(process.argv.slice(2));
const report = { format: 'sharpforge.pe-inspection-benchmark', schemaVersion: 1, status: 'preparing',
  startedAt: new Date().toISOString(), command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  environment: { ...environment(candidateRoot), totalMemoryBytes: totalmem(), sharedHost: true,
    nodeExecutable: process.execPath, nodeExecutableSha256: sha(readFileSync(process.execPath)),
    nodeOptions: process.env.NODE_OPTIONS ?? null, ci: process.env.CI ?? null,
    testConcurrency: process.env.SHARPFORGE_TEST_CONCURRENCY ?? null,
    maximumParallelRuns: process.env.SHARPFORGE_MAX_PARALLEL_RUNS ?? null,
    maximumOldSpaceMB: process.env.SHARPFORGE_MAX_OLD_SPACE_MB ?? null },
  configuration: { warmupBatchesPerWorkloadAndVariant: 20, measuredBatchesPerWorkloadAndVariant: 100,
    clock: 'performance.now', unit: 'nanoseconds per call', median: 'mean of the two central samples',
    p95: 'nearest rank', p99: 'nearest rank', variantOrder: 'alternates each round', workloadOrder: 'rotates each round',
    measuredRegion: 'API calls and storing returned references into an array allocated before timing',
    correctnessRegion: 'Each returned result, pre/post full facts, and native comparisons are checked outside timing',
    forcedGC: false, allocationCounter: null },
  limitations: [
    'Shared host; scheduling, JIT, GC, and other work can affect samples. No isolated-machine performance claim.',
    'One process holds both public package graphs; module loading and common fixture creation are outside timing.',
    'Result retention and out-of-timing correctness checks affect heap liveness and subsequent GC for both variants.',
    'Signed heapUsed deltas are observations, not allocation counts or peak memory; GC may make a delta negative.',
    'The three-method PE32 fixture isolates common inspector behavior; it does not qualify every loader or large-assembly scale.',
    'New inspectPE timings include parsing, debug/signing payload copying and owned headers, with no equivalent baseline operation.',
    'Native reference comparison is outside timing. No input execution, native disassembly, R2R method mapping, or signature verification.',
    'A benchmark status of pass means guards and sample counts passed; a regression over 5% still needs explicit PR sign-off.',
  ], chronologicalSamples: [] };
writeJson(args['--output'], report);
try {
  await capture(args, report);
} catch (error) {
  report.status = 'failed';
  report.failure = { name: error.name, message: error.message };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeJson(args['--output'], report);
  console.log(JSON.stringify({ output: args['--output'], status: report.status, failure: report.failure, results: report.results }, null, 2));
}
