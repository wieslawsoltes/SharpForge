import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem, loadavg } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MetadataBuilder, Writer, writePE } from '@sharpforge/cil';
import { clean, distribution, environment, sha, writeJson } from '../../../scripts/conformance/perf/core.js';
import { runProcess } from '../../../scripts/conformance/oracle/process.js';
import { boundsFixture } from '../../../tests/fixtures/pe-bounds/input.mjs';
import { verifyBoundsCapture } from '../../../tests/fixtures/pe-bounds/verify.mjs';
import { sourceIdentity, toolHashes, workloads } from './pe-bounds-benchmark-shared.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert.equal(process.argv.length, 10, 'Required: --baseline <checkout> --r2r <image> --mixed <image> --output <fresh-directory>');
assert.deepEqual([process.argv[2], process.argv[4], process.argv[6], process.argv[8]], ['--baseline', '--r2r', '--mixed', '--output']);
const [baseline, r2r, mixed, output] = [3, 5, 7, 9].map(index => resolve(process.argv[index]));
assert.ok(!existsSync(output));
assert.ok(!output.startsWith(resolve(root) + '/') && !output.startsWith(baseline + '/'));
mkdirSync(output);
const report = { status: 'running', startedAt: new Date().toISOString(), commands: [], chronologicalSamples: [], comparisons: [],
  performanceAcceptance: 'pending independent review', protocol: { warmupBatches: 20, measuredBatches: 100, workloads,
    unit: 'microseconds/operation', statisticsScope: 'True median and nearest-rank p95/p99 of batch means',
    timed: 'Public readPE calls plus storing returned references; options and output arrays prepared outside timing',
    excluded: 'Imports, process startup, fixture construction, native replay, guards, statistics and I/O',
    memory: 'Signed net heapUsed deltas, not allocations or peak RSS; no forced GC' } };
const save = () => writeJson(resolve(output, 'report.json'), report);
save();

function saveInput(id, bytes) {
  const path = resolve(output, id + '.dll');
  writeFileSync(path, bytes, { flag: 'wx' });
  return { id, path, sha256: sha(bytes), bytes: bytes.length, inspection: false };
}

function inputs() {
  const rows = [saveInput('small', boundsFixture().bytes)];
  const metadata = new MetadataBuilder('DensePEBounds').finish();
  const section = new Writer().zero(72).bytes(metadata).finish();
  const sections = Array.from({ length: 95 }, (_, index) => ({ name: '.s' + index,
    data: Uint8Array.of(index), characteristics: 0x40000040 }));
  rows.push(saveInput('dense96', writePE(section, 72, metadata.length, 0, { sections })));
  const cfg = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/decompiler-cfg/native.json')));
  const il = Buffer.from(cfg.image, 'base64');
  assert.equal(sha(il), cfg.imageSha256);
  rows.push(saveInput('il', il));
  const manifest = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/pe-inspection/reference-images.json')));
  for (const [id, path] of [['r2r', r2r], ['mixed', mixed]]) {
    const definition = manifest.images.find(row => row.id === id), bytes = readFileSync(path);
    assert.equal(sha(bytes), definition.sha256);
    assert.equal(bytes.length, definition.bytes);
    rows.push({ id, path, sha256: definition.sha256, bytes: bytes.length, inspection: true });
  }
  return rows;
}

async function child(label, side, mode, workload, expected) {
  const resultPath = resolve(output, label + '.result.json'), jobPath = resolve(output, label + '.job.json');
  const job = { harnessCommit: report.harnessCommit, root: report.sources[side].root, source: report.sources[side],
    side, mode, workload, expected, inputs: report.inputs, tools: report.tools, output: resultPath };
  writeJson(jobPath, job);
  const command = { label, jobSha256: sha(readFileSync(jobPath)), startedAt: new Date().toISOString(),
    argv: [process.execPath, resolve(root, 'packages/cil/tools/pe-bounds-benchmark-worker.mjs'), '--job', jobPath], cwd: job.root };
  report.commands.push(command);
  save();
  try {
    command.result = await runProcess(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd, timeoutMs: 300000, maxOutputBytes: 8 * 1024 * 1024,
    });
  } catch (error) { command.result = error.result ?? { error: error.message }; throw error; }
  finally {
    command.finishedAt = new Date().toISOString();
    for (const stream of ['stdout', 'stderr']) {
      const bytes = command.result?.[stream] ?? '';
      writeFileSync(resolve(output, label + '.' + stream + '.log'), bytes, { flag: 'wx' });
      command[stream + 'Sha256'] = sha(bytes);
    }
    if (existsSync(resultPath)) {
      command.worker = JSON.parse(readFileSync(resultPath));
      command.workerSha256 = sha(readFileSync(resultPath));
      for (const sample of command.worker.chronologicalSamples)
        report.chronologicalSamples.push({ ...sample, child: label, childSequence: sample.sequence,
          sequence: report.chronologicalSamples.length });
    }
    save();
  }
  assert.equal(command.result.exitCode, 0, label);
  assert.equal(command.result.signal, null, label);
  assert.equal(command.worker.status, 'passed', label);
  assert.equal(command.worker.jobSha256, command.jobSha256);
  return command.worker;
}

try {
  report.harnessCommit = clean(root);
  report.sources = { baseline: sourceIdentity(baseline, 'baseline'), candidate: sourceIdentity(root, 'candidate') };
  report.tools = toolHashes(root);
  const nativePath = resolve(root, 'tests/fixtures/pe-bounds/reference');
  const native = verifyBoundsCapture(nativePath);
  report.native = { sha256: sha(readFileSync(resolve(nativePath, 'native.json'))), sourceCommit: native.sourceCommit };
  report.inputs = inputs();
  report.environment = { ...environment(root), sharedHost: true, nodeOptions: process.env.NODE_OPTIONS ?? null,
    loadBefore: loadavg(), freeMemoryBefore: freemem(), forcedGC: false };
  const before = await child('prepare-baseline', 'baseline', 'prepare');
  const after = await child('prepare-candidate', 'candidate', 'prepare');
  assert.deepEqual(after.facts, before.facts, 'Complete public reader facts match before any timing');
  for (const [index, definition] of workloads.entries()) {
    const results = {};
    for (const side of index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const row = await child(definition.id + '-' + side, side, 'measure', definition.id, before.facts[definition.id]);
      assert.equal(row.warmups.length, 20);
      assert.equal(row.samples.length, 100);
      assert.ok(row.chronologicalSamples.every(sample => sample.guard === 'passed' && sample.operations === definition.operations));
      assert.deepEqual(row.statistics, distribution(row.samples.map(sample => sample.microsecondsPerOperation)));
      results[side] = row.statistics;
    }
    report.comparisons.push({ id: definition.id, results, changePercent: Object.fromEntries(['median', 'p95', 'p99'].map(name =>
      [name, (results.candidate[name] / results.baseline[name] - 1) * 100])) });
  }
  assert.equal(report.commands.length, 12);
  assert.equal(report.chronologicalSamples.length, 1200);
  assert.deepEqual(sourceIdentity(root, 'candidate'), report.sources.candidate);
  assert.deepEqual(sourceIdentity(baseline, 'baseline'), report.sources.baseline);
  assert.deepEqual(toolHashes(root), report.tools);
  for (const input of report.inputs) assert.equal(sha(readFileSync(input.path)), input.sha256, 'Unchanged input: ' + input.id);
  assert.equal(sha(readFileSync(resolve(nativePath, 'native.json'))), report.native.sha256);
  verifyBoundsCapture(nativePath);
  report.environment.loadAfter = loadavg();
  report.environment.freeMemoryAfter = freemem();
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ output, status: report.status, error: report.error }));
}
