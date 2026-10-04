import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { freemem, loadavg, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '@sharpforge/cil';
import { clean, environment, sha, writeJson } from '../../../scripts/conformance/perf/core.js';
import { verifyMetadataGenerationCapture } from '../../../tests/fixtures/metadata-generations/verify.mjs';
import { replayMetadataGenerations } from '../../../tests/fixtures/metadata-generations/replay.mjs';
import { benchmarkCheckout, benchmarkTools } from './metadata-generations-benchmark-source.mjs';
import { features } from './metadata-generations-benchmark-protocol.mjs';
import { dataFacts } from './metadata-generations-benchmark-facts.mjs';
import { measureWorkload } from './metadata-generations-benchmark-measure.mjs';

const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
assert.equal(process.argv[2], '--job');
assert.equal(process.argv.length, 4, 'Feature worker accepts one explicit parent-authored job');
const jobBytes = readFileSync(resolve(process.argv[3])), job = JSON.parse(jobBytes);
assert.ok(!existsSync(job.resultFile), 'Retain each worker result without overwrite');
const report = { schemaVersion: 1, status: 'running', side: 'candidate', jobSha256: sha(jobBytes),
  startedAt: new Date().toISOString(), results: [], chronologicalSamples: [] };
const initialOptions = Object.freeze({ format: 'pe' });
const firstOptions = Object.freeze({ generation: 1 }), secondOptions = Object.freeze({ generation: 2 });

function history(inputs, generation) {
  const reader = new api.MetadataGenerations(inputs[0], initialOptions);
  if (generation >= 1) reader.append(inputs[1], firstOptions);
  if (generation >= 2) reader.append(inputs[2], secondOptions);
  return reader;
}

function historyFacts(reader) {
  const tables = reader.tables({ includeEmpty: false });
  const rows = tables.map(table => reader.rows(table.table, { limit: 1000 }));
  rows.forEach((page, index) => {
    assert.equal(page.rows.length, tables[index].rowCount, 'Fixed corpus fits one complete table page');
    assert.equal(page.nextOffset, null);
  });
  const map = reader.controlRows(31, { limit: 1000 }), log = reader.controlRows(30, { limit: 1000 });
  for (const page of [map, log]) {
    assert.equal(page.rows.length, page.total, 'Fixed corpus fits one complete control page');
    assert.equal(page.nextOffset, null);
  }
  return dataFacts({ generation: reader.generation, identity: reader.identity, counts: reader.counts,
    retainedBytes: reader.retainedBytes, retainedRecords: reader.retainedRecords, tables, rows, heaps: reader.heaps(), map, log });
}

function queryTargets(reader, native) {
  const methods = new Map(reader.rows('MethodDef').rows.map(row => [reader.heapEntry('#Strings', row.values[3]).value, row]));
  const entities = ['Old', 'Stable', 'Added', 'AddedAgain'].map(name => {
    assert.ok(methods.has(name), 'Predetermined mixed method: ' + name);
    return { kind: 'entity', value: methods.get(name).token };
  });
  const added = methods.get('Added');
  assert.equal(added.generation, 2);
  assert.equal(reader.row(added.token, firstOptions).generation, 1);
  const userString = native.generations[2].heapMappings.find(value => value.kind === 'userString' &&
    value.success && value.readSuccess && value.userStringStatus === 'valid' && value.heapValue === 'second update 😀');
  assert.ok(userString, 'Predetermined non-ASCII native user string');
  const heaps = [
    { heap: '#Strings', kind: 'string', value: added.values[3] },
    { heap: '#Blob', kind: 'blob', value: added.values[4] },
    { heap: '#GUID', kind: 'guid', value: 1 },
    { heap: '#US', kind: 'userString', value: userString.value },
  ];
  return { entities, heaps, added: added.token };
}

function workloads(inputs, reader, native) {
  const expected = [];
  for (let generation = 0; generation <= 2; generation++) {
    const value = history(inputs, generation);
    expected.push(historyFacts(value));
    value.dispose();
  }
  const targets = queryTargets(reader, native);
  const entityResults = targets.entities.map(handle => reader.getGenerationHandle(handle));
  const heapResults = targets.heaps.map(({ kind, value }) => reader.getGenerationHandle({ kind, value }));
  const heapValues = targets.heaps.map(({ heap, value }) => dataFacts(reader.heapEntry(heap, value)));
  const latest = reader.row(targets.added), historical = reader.row(targets.added, firstOptions);
  const actions = {
    'generation-construct': { invoke: () => new api.MetadataGenerations(inputs[0], initialOptions),
      guard: value => assert.deepEqual(historyFacts(value), expected[0]), cleanup: values => values.forEach(value => value?.dispose()) },
    'generation-append-first': { prepare: count => Array.from({ length: count }, () => history(inputs, 0)),
      invoke: (index, state) => state[index].append(inputs[1], firstOptions),
      guard: (value, index, state) => { assert.equal(value, 1); assert.deepEqual(historyFacts(state[index]), expected[1]); },
      cleanup: (values, state) => state?.forEach(value => value.dispose()) },
    'generation-append-second': { prepare: count => Array.from({ length: count }, () => history(inputs, 1)),
      invoke: (index, state) => state[index].append(inputs[2], secondOptions),
      guard: (value, index, state) => { assert.equal(value, 2); assert.deepEqual(historyFacts(state[index]), expected[2]); },
      cleanup: (values, state) => state?.forEach(value => value.dispose()) },
    'generation-map-entity': { invoke: index => reader.getGenerationHandle(targets.entities[index % 4]),
      guard: (value, index) => assert.deepEqual(value, entityResults[index % 4]) },
    'generation-map-heap': { invoke: index => reader.getGenerationHandle(targets.heaps[index % 4]),
      guard: (value, index) => assert.deepEqual(value, heapResults[index % 4]) },
    'generation-row-latest': { invoke: () => reader.row(targets.added), guard: value => assert.deepEqual(value, latest) },
    'generation-row-historical': { invoke: () => reader.row(targets.added, firstOptions), guard: value => assert.deepEqual(value, historical) },
    'generation-heap-entry': { invoke: index => reader.heapEntry(targets.heaps[index % 4].heap, targets.heaps[index % 4].value),
      guard: (value, index) => assert.deepEqual(dataFacts(value), heapValues[index % 4]) },
  };
  report.workloadFacts = { fixture: 'mixed native Roslyn baseline plus two real metadata deltas', targets,
    entityResults, heapResults, heapValues, latest, historical, historySha256: expected.map(value => sha(JSON.stringify(value))),
    dimensions: expected.map(value => ({ generation: value.generation, retainedBytes: value.retainedBytes,
      retainedRecords: value.retainedRecords, counts: value.counts })),
    appendTiming: 'Only the requested append is timed; construction of the immediately preceding history is outside each timed batch',
    heapMix: 'Equal round-robin Strings, Blob, GUID and user-string probes; reported cost is their fixed mixture' };
  return features.map(definition => ({ ...definition, ...actions[definition.id] }));
}

let reader;
try {
  assert.equal(clean(root), job.harnessCommit, 'Frozen candidate and harness head');
  report.tools = benchmarkTools(root);
  assert.deepEqual(report.tools, job.tools);
  report.source = benchmarkCheckout(root, 'candidate');
  assert.equal(report.source.head, job.productHead);
  report.environment = { ...environment(root), v8: process.versions.v8, execArgv: process.execArgv,
    nodeOptions: process.env.NODE_OPTIONS ?? null, sharedHost: true, forcedGC: false, totalMemoryBytes: totalmem(),
    freeMemoryBytesBefore: freemem(), loadAverageBefore: loadavg(), memoryBefore: process.memoryUsage() };
  const referenceBytes = readFileSync(resolve(root, 'tests/fixtures/metadata-generations/reference/native.json'));
  assert.equal(sha(referenceBytes), job.nativeSha256, 'Committed native reference pinned before launching the worker');
  const verified = await verifyMetadataGenerationCapture(undefined, { strictSource: true });
  const native = verified.record.corpora.mixed, inputs = verified.inputs.mixed;
  const replay = replayMetadataGenerations(native, inputs, assert.deepEqual);
  reader = replay.reader;
  assert.deepEqual(replay.totals, native.replay, 'Full independent native replay before feature timing');
  report.native = { sha256: sha(referenceBytes), sourceCommit: verified.record.sourceCommit,
    toolchain: verified.record.toolchain, replay: replay.totals, artifacts: native.artifacts };
  const before = historyFacts(reader);
  for (const workload of workloads(inputs, reader, native)) measureWorkload(workload, report);
  assert.deepEqual(historyFacts(reader), before, 'Queries do not alter retained history');
  inputs.forEach((bytes, index) => assert.equal(sha(bytes), native.artifacts[index].sha256, 'Native inputs remain byte exact'));
  assert.deepEqual(benchmarkCheckout(root, 'candidate'), report.source);
  assert.deepEqual(benchmarkTools(root), report.tools);
  report.environment.freeMemoryBytesAfter = freemem();
  report.environment.loadAverageAfter = loadavg();
  report.environment.memoryAfter = process.memoryUsage();
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error.name, message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally { reader?.dispose(); }
report.finishedAt = new Date().toISOString();
writeJson(job.resultFile, report);
console.log(JSON.stringify({ result: job.resultFile, status: report.status, error: report.error }));
