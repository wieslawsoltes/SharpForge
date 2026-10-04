import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { clean, environment, sha, writeJson } from '../../../scripts/conformance/perf/core.js';
import { benchmarkCheckout, benchmarkTools } from './metadata-generations-benchmark-source.mjs';
import { controls, fixturePins } from './metadata-generations-benchmark-protocol.mjs';
import { guardReader, metadataFacts, peFacts } from './metadata-generations-benchmark-facts.mjs';
import { measureWorkload } from './metadata-generations-benchmark-measure.mjs';

const harnessRoot = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
assert.equal(process.argv[2], '--job');
assert.equal(process.argv.length, 4, 'Worker accepts one explicit parent-authored job');
const jobBytes = readFileSync(resolve(process.argv[3])), job = JSON.parse(jobBytes);
assert.ok(job.mode === 'prepare' || job.mode === 'measure', 'Known worker mode');
assert.ok(!existsSync(job.resultFile), 'Retain each worker result without overwrite');
const report = { schemaVersion: 1, status: 'running', mode: job.mode, jobSha256: sha(jobBytes),
  side: job.side, startedAt: new Date().toISOString(), results: [], chronologicalSamples: [] };

function prepareInputs(api, fixture) {
  const metadata = fixture.metadataFixture().builder.finish();
  const smallPE = api.writePE(new api.Writer().zero(72).bytes(metadata).finish(), 72, metadata.length, 0);
  const native = JSON.parse(readFileSync(resolve(job.root, fixturePins.native.path)));
  assert.equal(native.compilation.exitCode, 0, 'Retained real fixture compilation');
  assert.equal(native.execution.exitCode, 0, 'Retained real fixture observation');
  assert.equal(native.execution.signal, null);
  const realPE = Buffer.from(native.image, 'base64');
  assert.equal(realPE.length, fixturePins.native.imageBytes);
  assert.equal(sha(realPE), fixturePins.native.imageSha256);
  const pe = api.readPE(realPE);
  const inspected = api.readPE(realPE, { inspection: true });
  for (const method of native.native.methods) {
    assert.equal(Buffer.from(inspected.methodBody(method.token).code).toString('base64'), method.code, 'Existing native CIL bytes: ' + method.name);
  }
  const realMetadata = realPE.subarray(pe.metadataOffset, pe.metadataOffset + pe.metadataDirectory.size);
  const cases = {};
  for (const [id, md, image] of [['small', metadata, smallPE], ['real', realMetadata, realPE]]) {
    const metadataResult = metadataFacts(api, md), peResult = peFacts(api, image);
    assert.deepEqual(peResult.metadata, metadataResult, 'Identical standalone and PE metadata facts');
    cases[id] = { metadataBase64: Buffer.from(md).toString('base64'), peBase64: Buffer.from(image).toString('base64'),
      metadataSha256: sha(md), peSha256: sha(image), metadataBytes: md.length, peBytes: image.length,
      metadata: metadataResult, pe: peResult };
  }
  assert.equal(cases.small.metadata.raw.counts[2], 4, 'Established structural fixture type count');
  assert.equal(cases.small.metadata.raw.counts[6], 1, 'Established structural fixture method count');
  report.nativeControl = { fixtureSha256: fixturePins.native.sha256, imageSha256: sha(realPE), nativeMethodBodies: native.native.methods.length,
    qualification: 'Existing retained Roslyn/CoreCLR input and observed CIL bytes; no new native invocation' };
  report.cases = cases;
}

function runControl(api) {
  const definition = controls.find(value => value.id === job.workload);
  assert.ok(definition, 'Fixed control workload');
  assert.equal(typeof job.bounded, 'boolean');
  if (job.bounded) assert.equal(job.side, 'candidate', 'Explicit row bounds are a separate new cost');
  const inputBytes = readFileSync(job.inputsFile);
  assert.equal(sha(inputBytes), job.inputsSha256, 'Frozen prepared input/fact bytes');
  const sample = JSON.parse(inputBytes).cases[definition.fixture], kind = definition.api;
  const bytes = Buffer.from(sample[kind === 'pe' ? 'peBase64' : 'metadataBase64'], 'base64');
  const expected = sample[kind], complete = kind === 'pe' ? peFacts : metadataFacts;
  assert.equal(sha(bytes), sample[kind === 'pe' ? 'peSha256' : 'metadataSha256']);
  assert.deepEqual(complete(api, bytes), expected, 'Complete control facts before timing');
  const rowCount = sample.metadata.rowCount;
  const boundedOptions = kind === 'pe' ? { metadataOptions: { maxRows: rowCount } } : { maxRows: rowCount };
  const invoke = kind === 'pe'
    ? job.bounded ? () => api.readPE(bytes, boundedOptions) : () => api.readPE(bytes)
    : job.bounded ? () => api.readMetadata(bytes, boundedOptions) : () => api.readMetadata(bytes);
  if (job.bounded) {
    const tooSmall = kind === 'pe' ? { metadataOptions: { maxRows: rowCount - 1 } } : { maxRows: rowCount - 1 };
    assert.throws(() => kind === 'pe' ? api.readPE(bytes, tooSmall) : api.readMetadata(bytes, tooSmall), { code: 'MD_READ_ROW_LIMIT' });
  }
  report.control = { ...definition, bounded: job.bounded, explicitOptions: job.bounded ? boundedOptions : null,
    inputSha256: sha(bytes), inputBytes: bytes.length, expectedFactsSha256: sha(JSON.stringify(expected)),
    timedCall: job.bounded ? 'Public reader with an exact-row-count budget and omitted signal' : 'Public reader with one argument and default options' };
  measureWorkload({ ...definition, id: definition.id + (job.bounded ? '-bounded' : ''), invoke,
    guard: value => guardReader(value, expected, bytes, kind) }, report);
  assert.deepEqual(complete(api, bytes), expected, 'Complete control facts after timing');
  assert.equal(sha(bytes), report.control.inputSha256, 'Control input remains byte exact');
}

try {
  assert.equal(clean(harnessRoot), job.harnessCommit, 'Frozen executable harness');
  report.tools = benchmarkTools(harnessRoot);
  assert.deepEqual(report.tools, job.tools, 'Exact parent/worker source hashes');
  report.source = benchmarkCheckout(job.root, job.side);
  assert.equal(report.source.head, job.productHead, 'Frozen product checkout');
  report.environment = { ...environment(job.root), v8: process.versions.v8, execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null, sharedHost: true, forcedGC: false, totalMemoryBytes: totalmem(),
    freeMemoryBytesBefore: freemem(), loadAverageBefore: loadavg(), memoryBefore: process.memoryUsage() };
  const entry = report.source.packages.find(value => value.name === '@sharpforge/cil').entry;
  const api = await import(pathToFileURL(entry).href);
  report.productImport = entry;
  if (job.mode === 'prepare') {
    const fixture = await import(pathToFileURL(resolve(job.root, fixturePins.structural.path)).href);
    prepareInputs(api, fixture);
  } else runControl(api);
  assert.deepEqual(benchmarkCheckout(job.root, job.side), report.source, 'Product source remains frozen');
  assert.deepEqual(benchmarkTools(harnessRoot), report.tools, 'Tool source remains frozen');
  assert.equal(clean(harnessRoot), job.harnessCommit);
  report.environment.freeMemoryBytesAfter = freemem();
  report.environment.loadAverageAfter = loadavg();
  report.environment.memoryAfter = process.memoryUsage();
  report.status = job.mode === 'prepare' ? 'prepared' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
}
report.finishedAt = new Date().toISOString();
writeJson(job.resultFile, report);
console.log(JSON.stringify({ result: job.resultFile, status: report.status, error: report.error }));
