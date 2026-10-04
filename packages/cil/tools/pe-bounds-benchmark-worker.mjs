import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { distribution, environment, sha, writeJson, clean } from '../../../scripts/conformance/perf/core.js';
import { readerFacts, sourceIdentity, toolHashes, workloads } from './pe-bounds-benchmark-shared.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert.equal(process.argv.length, 4);
assert.equal(process.argv[2], '--job');
const jobBytes = readFileSync(process.argv[3]), job = JSON.parse(jobBytes);
const report = { status: 'running', startedAt: new Date().toISOString(), jobSha256: sha(jobBytes), samples: [], warmups: [],
  chronologicalSamples: [], source: null, environment: null, facts: {} };
const inspectionOptions = Object.freeze({ inspection: true });
try {
  assert.equal(clean(root), job.harnessCommit);
  assert.deepEqual(toolHashes(root), job.tools);
  const policy = JSON.parse(readFileSync(resolve(root, 'scripts/conformance/static/allowlist.json')));
  const path = 'packages/cil/tools/pe-bounds-benchmark-worker.mjs';
  const entries = policy.allow.filter(row => row.path === path && row.operation === 'dynamic-import');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].count, 1);
  assert.equal(entries[0].sha256, job.tools[path]);
  report.source = sourceIdentity(job.root, job.side, job.revisions);
  assert.deepEqual(report.source, job.source);
  report.environment = environment(job.root);
  // The operator-selected checkout, full source inventory and exact public entry are verified before this fixed import.
  const api = await import(pathToFileURL(report.source.packages[0].entry).href);
  const inputs = job.inputs.map(input => {
    const bytes = new Uint8Array(readFileSync(input.path));
    assert.equal(sha(bytes), input.sha256);
    const facts = readerFacts(api.readPE(bytes, input.inspection ? inspectionOptions : undefined), bytes);
    report.facts[input.id] = facts;
    return { ...input, bytes, facts };
  });
  if (job.mode === 'measure') {
    const definition = workloads.find(row => row.id === job.workload);
    assert.ok(definition);
    const input = inputs.find(row => row.id === definition.id);
    assert.deepEqual(input.facts, job.expected);
    report.operationsPerBatch = definition.operations;
    for (let index = 0; index < 120; index++) {
      const outputs = new Array(definition.operations), heapBefore = process.memoryUsage().heapUsed;
      const started = performance.now();
      let completed = 0, failure;
      try {
        for (; completed < outputs.length; completed++)
          outputs[completed] = api.readPE(input.bytes, input.inspection ? inspectionOptions : undefined);
      } catch (error) { failure = error; }
      const elapsedMs = performance.now() - started;
      const sample = { sequence: index, phase: index < 20 ? 'warmup' : 'measured', batch: index < 20 ? index : index - 20,
        startedAtMilliseconds: performance.timeOrigin + started, operations: completed, elapsedMs,
        microsecondsPerOperation: completed ? elapsedMs * 1000 / completed : null,
        netHeapBytes: process.memoryUsage().heapUsed - heapBefore, guard: 'pending' };
      report.chronologicalSamples.push(sample);
      (index < 20 ? report.warmups : report.samples).push(sample);
      if (failure) throw failure;
      for (const pe of outputs) assert.deepEqual(readerFacts(pe, input.bytes), input.facts);
      sample.guard = 'passed';
    }
    report.statistics = distribution(report.samples.map(row => row.microsecondsPerOperation));
  } else assert.equal(job.mode, 'prepare');
  assert.deepEqual(sourceIdentity(job.root, job.side, job.revisions), report.source);
  assert.deepEqual(toolHashes(root), job.tools);
  assert.equal(clean(root), job.harnessCommit);
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeJson(job.output, report);
  console.log(JSON.stringify({ status: report.status, error: report.error }));
}
