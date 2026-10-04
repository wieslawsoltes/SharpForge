import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean, distribution, environment, git, sha, writeJson } from '../../../scripts/conformance/perf/core.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { verifyMetadataGenerationCapture } from '../../../tests/fixtures/metadata-generations/verify.mjs';
import { benchmarkCheckout, benchmarkTools } from './metadata-generations-benchmark-source.mjs';
import { baselineCommit, controls, features, measuredBatches, nativeReferenceDirectory,
  preparationProductCommit, warmupBatches } from './metadata-generations-benchmark-protocol.mjs';

const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
assert.equal(process.argv.length, 6, 'Usage: benchmark-metadata-generations.mjs --baseline <checkout> --output <fresh-directory>');
assert.equal(process.argv[2], '--baseline');
assert.equal(process.argv[4], '--output');
const baseline = realpathSync(resolve(process.argv[3]));
assert.notEqual(baseline, root, 'The baseline and candidate use distinct worktrees');
const destination = resolve(realpathSync(dirname(resolve(process.argv[5]))), basename(resolve(process.argv[5])));
for (const checkout of [root, baseline]) {
  const path = relative(checkout, destination);
  assert.ok(path === '..' || path.startsWith('..' + sep), 'Reports must remain outside both frozen checkouts');
}
assert.ok(!existsSync(destination), 'A cohort must use a fresh destination; earlier evidence is never overwritten');
mkdirSync(destination);
const reportFile = resolve(destination, 'report.json');
const report = {
  schemaVersion: 1, status: 'running', startedAt: new Date().toISOString(),
  invocation: { argv: [process.execPath, ...process.execArgv, ...process.argv.slice(1)], cwd: process.cwd() },
  commands: [], chronologicalSamples: [], defaultComparisons: [], explicitBudgetComparisons: [], newFeatures: [],
  performanceAcceptance: 'pending independent review; successful execution never approves a regression',
};
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  report.cancelledBy = signal;
  cancellation.abort();
});
const save = () => writeJson(reportFile, report);
const worker = resolve(root, 'packages/cil/tools/metadata-generations-benchmark-worker.mjs');
const featureWorker = resolve(root, 'packages/cil/tools/metadata-generations-benchmark-features.mjs');
const processLimits = Object.freeze({ timeoutMs: 300000, maxOutputBytes: 16 * 1024 * 1024 });
const relevantEnvironment = () => Object.fromEntries([
  'CI', 'NODE_OPTIONS', 'SHARPFORGE_MAX_PARALLEL_RUNS', 'SHARPFORGE_TEST_CONCURRENCY', 'SHARPFORGE_MAX_OLD_SPACE_MB',
].map(name => [name, process.env[name] ?? null]));

async function retainChild(label, definition, script = worker) {
  assert.match(label, /^[a-zA-Z0-9-]+$/);
  const jobFile = resolve(destination, label + '.job.json');
  const resultFile = resolve(destination, label + '.result.json');
  const job = { ...definition, harnessCommit: report.harnessCommit, tools: report.tools, resultFile };
  writeJson(jobFile, job);
  const command = {
    label, sequence: report.commands.length, argv: [process.execPath, script, '--job', jobFile], cwd: definition.root,
    jobFile, jobSha256: sha(readFileSync(jobFile)), resultFile, environment: relevantEnvironment(), ...processLimits,
    startedAt: new Date().toISOString(),
  };
  report.commands.push(command);
  save();
  let failure;
  try {
    command.process = await runProcess(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd, signal: cancellation.signal, ...processLimits,
    });
  } catch (error) {
    failure = error;
    command.process = error.result ?? { exitCode: null, signal: null, error: error.message };
  }
  command.finishedAt = new Date().toISOString();
  for (const stream of ['stdout', 'stderr']) {
    const bytes = command.process[stream] ?? '';
    command[stream + 'File'] = resolve(destination, label + '.' + stream + '.log');
    writeFileSync(command[stream + 'File'], bytes);
    command[stream + 'Sha256'] = sha(bytes);
  }
  if (existsSync(resultFile)) {
    const bytes = readFileSync(resultFile);
    command.resultSha256 = sha(bytes);
    try { command.result = JSON.parse(bytes); }
    catch (error) { failure ??= error; }
  } else command.resultUnavailable = 'The worker exited before writing a result; no absent samples are inferred';
  for (const sample of command.result?.chronologicalSamples ?? []) {
    report.chronologicalSamples.push({ ...sample, sequence: report.chronologicalSamples.length,
      childSequence: sample.sequence, child: label, side: definition.side, bounded: definition.bounded ?? null });
  }
  save();
  if (failure) throw failure;
  assert.equal(command.process.exitCode, 0, label + ' process exit');
  assert.equal(command.process.signal, null, label + ' process signal');
  assert.equal(command.result?.status, definition.mode === 'prepare' ? 'prepared' : 'passed', label + ' worker guards');
  assert.equal(command.result.jobSha256, command.jobSha256, label + ' immutable job identity');
  assert.deepEqual(command.result.tools, report.tools, label + ' executable tool identity');
  return command.result;
}

function comparison(id, before, after) {
  const metrics = {};
  for (const metric of ['median', 'p95', 'p99']) {
    const baselineValue = before.statistics[metric], candidateValue = after.statistics[metric];
    metrics[metric] = { baseline: baselineValue, candidate: candidateValue, delta: candidateValue - baselineValue,
      percent: baselineValue ? (candidateValue / baselineValue - 1) * 100 : null };
  }
  return { id, unit: before.unit, statisticsScope: before.statisticsScope,
    baselineOperationsPerBatch: before.operationsPerBatch, candidateOperationsPerBatch: after.operationsPerBatch, metrics };
}

function verifySamples(result, definitions) {
  assert.deepEqual(result.results.map(value => value.id), definitions.map(value => value.id), 'Fixed workload inventory');
  for (const [index, row] of result.results.entries()) {
    const definition = definitions[index];
    assert.equal(row.operationsPerBatch, definition.operations);
    assert.equal(row.warmups.length, warmupBatches);
    assert.equal(row.samples.length, measuredBatches);
    for (const [phase, samples] of [['warmup', row.warmups], ['measured', row.samples]]) {
      samples.forEach((sample, batch) => {
        assert.equal(sample.phase, phase);
        assert.equal(sample.batch, batch);
        assert.equal(sample.operations, definition.operations);
        assert.equal(sample.guard, 'passed');
        assert.equal(sample.microsecondsPerOperation, sample.elapsedMs * 1000 / definition.operations);
      });
    }
    assert.deepEqual(row.statistics, distribution(row.samples.map(sample => sample.microsecondsPerOperation)));
    assert.deepEqual(row.batchMilliseconds, distribution(row.samples.map(sample => sample.elapsedMs)));
  }
  const expected = result.results.flatMap(value => [...value.warmups, ...value.samples]);
  assert.deepEqual(result.chronologicalSamples, expected, 'Raw chronological batches remain unsorted');
}

async function prepare() {
  report.harnessCommit = clean(root);
  report.sources = { baseline: benchmarkCheckout(baseline, 'baseline'), candidate: benchmarkCheckout(root, 'candidate') };
  assert.equal(report.sources.candidate.head, report.harnessCommit);
  report.tools = benchmarkTools(root);
  const plan = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/metadata-generations/validation-plan.json')));
  assert.equal(plan.performance.baselineCommit, baselineCommit);
  assert.equal(plan.performance.productCommit, preparationProductCommit);
  assert.deepEqual(plan.performance.controls, controls);
  assert.deepEqual(plan.performance.features, features);
  assert.equal(plan.performance.warmupBatches, warmupBatches);
  assert.equal(plan.performance.measuredBatches, measuredBatches);
  const nativePath = nativeReferenceDirectory + '/native.json';
  git(root, 'ls-files', '--error-unmatch', '--', nativePath);
  const nativeBytes = readFileSync(resolve(root, nativePath));
  const verified = await verifyMetadataGenerationCapture(resolve(root, nativeReferenceDirectory), { strictSource: true });
  report.native = { path: nativePath, sha256: sha(nativeBytes), gitBlob: git(root, 'rev-parse', 'HEAD:' + nativePath),
    retainedAtCommit: report.harnessCommit, captureCommit: verified.record.sourceCommit,
    toolchain: verified.record.toolchain, observerSha256: verified.record.observerSHA256,
    originalManifestSha256: verified.record.originalManifestSHA256,
    originalArtifacts: verified.record.corpora.original.artifacts, mixedArtifacts: verified.record.mixedCreation.artifacts };
  report.environment = { ...environment(root), v8: process.versions.v8, sharedHost: true, forcedGC: false,
    variables: relevantEnvironment(), totalMemoryBytes: totalmem(), freeMemoryBytesBefore: freemem(), loadAverageBefore: loadavg() };
  report.protocol = { warmupBatches, measuredBatches, controls, features, processLimits, processOrder: plan.performance.processOrder,
    timing: 'Synchronous public calls plus retaining each returned value in a preallocated array',
    excluded: 'Process/import startup, input construction, native replay, setup, complete guards, disposal, statistics and I/O',
    statistics: 'True median and nearest-rank p95/p99 of batch means in microseconds per operation',
    memory: 'Signed net Node heapUsed delta per batch; includes GC and excludes many ArrayBuffer/native allocations',
    scheduling: 'One child at a time; controls precede the candidate-only generation process; no reruns or adaptive counts',
    qualification: 'Existing reader controls and new JavaScript feature costs only; no cold-start or native execution timing' };
  save();
  const prepared = {};
  for (const side of ['baseline', 'candidate']) {
    const source = report.sources[side];
    prepared[side] = await retainChild('prepare-' + side, { mode: 'prepare', side, root: source.root, productHead: source.head });
  }
  assert.deepEqual(prepared.candidate.cases, prepared.baseline.cases, 'Full input and reader parity before any timed batch');
  const inputsFile = resolve(destination, 'inputs.json');
  writeJson(inputsFile, { cases: prepared.baseline.cases });
  report.inputs = { path: inputsFile, sha256: sha(readFileSync(inputsFile)), preparedFactsEqual: true,
    baselinePreparation: 'prepare-baseline.result.json', candidatePreparation: 'prepare-candidate.result.json' };
  save();
}

async function measureControls() {
  const results = { baseline: new Map(), candidate: new Map() };
  for (const [index, definition] of controls.entries()) {
    const sides = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    for (const side of sides) {
      const source = report.sources[side];
      const result = await retainChild(definition.id + '-' + side, { mode: 'measure', side, root: source.root,
        productHead: source.head, workload: definition.id, bounded: false,
        inputsFile: report.inputs.path, inputsSha256: report.inputs.sha256 });
      verifySamples(result, [definition]);
      results[side].set(definition.id, result.results[0]);
    }
    const row = comparison(definition.id, results.baseline.get(definition.id), results.candidate.get(definition.id));
    row.medianRegressionOverFivePercent = row.metrics.median.percent > 5;
    report.defaultComparisons.push(row);
    save();
  }
  for (const definition of controls) {
    const result = await retainChild(definition.id + '-candidate-bounded', { mode: 'measure', side: 'candidate', root,
      productHead: report.sources.candidate.head, workload: definition.id, bounded: true,
      inputsFile: report.inputs.path, inputsSha256: report.inputs.sha256 });
    verifySamples(result, [{ ...definition, id: definition.id + '-bounded' }]);
    report.explicitBudgetComparisons.push({ ...comparison(definition.id, results.candidate.get(definition.id), result.results[0]),
      baselineMeaning: 'Candidate default options', candidateMeaning: 'Candidate explicit exact-row-count bound' });
    save();
  }
}

try {
  await prepare();
  await measureControls();
  const result = await retainChild('generation-features-candidate', { mode: 'features', side: 'candidate', root,
    productHead: report.sources.candidate.head, nativeSha256: report.native.sha256 }, featureWorker);
  verifySamples(result, features);
  report.newFeatures = result.results.map(({ id, unit, operationsPerBatch, statisticsScope, statistics, batchMilliseconds }) =>
    ({ id, unit, operationsPerBatch, statisticsScope, statistics, batchMilliseconds, baselineEquivalent: false }));
  assert.equal(report.commands.length, 15, 'Two preparations, eight default controls, four bounded controls, one feature worker');
  assert.deepEqual(report.commands.map(command => command.label), report.protocol.processOrder, 'Predetermined serial process order');
  assert.equal(report.chronologicalSamples.length, 20 * (warmupBatches + measuredBatches), 'Exactly twenty fixed workloads');
  assert.deepEqual(benchmarkCheckout(baseline, 'baseline'), report.sources.baseline);
  assert.deepEqual(benchmarkCheckout(root, 'candidate'), report.sources.candidate);
  assert.deepEqual(benchmarkTools(root), report.tools);
  assert.equal(sha(readFileSync(resolve(root, report.native.path))), report.native.sha256);
  assert.equal(sha(readFileSync(report.inputs.path)), report.inputs.sha256);
  report.environment.freeMemoryBytesAfter = freemem();
  report.environment.loadAverageAfter = loadavg();
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
save();
console.log(JSON.stringify({ report: reportFile, status: report.status, error: report.error,
  performanceAcceptance: report.performanceAcceptance }));
