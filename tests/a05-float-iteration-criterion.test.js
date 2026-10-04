import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessFloatIterationCriterion} from '../bench/vm/float-allocation-criterion.js';
import {parseFloatAllocationTrace} from '../bench/vm/float-allocation-trace.js';

function row(mode, iterations, bytes) {
  return {mode, iterations, instructions: iterations * 11, warmupIterations: mode === 'reference' ? 10000 : 100000,
    warmupSlices: 10, outputVerified: true, floatCarriers: mode === 'reference' ? 70000 : 0,
    managedAllocations: 0, framesAllocated: 0, frameArraysAllocated: 0,
    environment: {node: 'test-node', v8: 'test-v8', platform: 'test-platform', arch: 'test-arch'},
    instrumentation: {path: 'float.js', beforeSHA256: 'before', afterSHA256: 'after', allocationSites: 1},
    trace: {reportedAllocatedBytes: bytes, collectionsDuringLoop: mode === 'reference' ? 1 : 0}};
}

function evidence() {
  const groups = ['typed', 'mixed'].map(mode => ({mode, control: row(mode, 0, 664),
    samples: [row(mode, 100000, mode === 'typed' ? 28608 : 32712), row(mode, 1000000, mode === 'typed' ? 28608 : 30984)]}));
  return {groups, control: row('reference', 10000, 36097936)};
}

test('per-iteration allocation evidence preserves positive fixed slice costs and separate all-run limits', () => {
  const {groups, control} = evidence();
  const actual = assessFloatIterationCriterion(groups, control);
  assert.equal(actual.acceptance, 'met');
  assert.deepEqual(actual.observations.map(item => item.incrementalAllocatedBytes), [0, -1728]);
  assert.deepEqual(actual.observations[0].bytesAboveZeroIterationControl, [27944, 27944]);
  assert.deepEqual(actual.observations[0].instructions, [1100000, 11000000]);
  assert.equal(actual.allHostObjectsPerRun, 'unqualified');
  assert.equal(actual.floatDifferential, 'requires-separate-evidence');
  assert.match(actual.scope, /direct-CIL.*Node\/V8.*entry\/exit/);
  assert.deepEqual(evidence(), {groups, control}, 'assessment does not rewrite raw evidence');
});

test('a single observed byte of growth or any loop collection stays inconclusive without tolerance', () => {
  for (const change of [item => item.trace.reportedAllocatedBytes++, item => item.trace.collectionsDuringLoop++]) {
    const {groups, control} = evidence();
    change(groups[0].samples[1]);
    assert.equal(assessFloatIterationCriterion(groups, control).acceptance, 'inconclusive');
  }
});

test('exact loop allocation counters cannot be hidden by flat or falling V8 bytes', () => {
  for (const key of ['floatCarriers', 'managedAllocations', 'framesAllocated', 'frameArraysAllocated']) {
    const {groups, control} = evidence();
    groups[1].samples[0][key] = 1;
    assert.equal(assessFloatIterationCriterion(groups, control).acceptance, 'missed', key);
  }
});

test('partial workloads, altered warmup, mismatched engines and missing allocation controls cannot qualify', () => {
  const edits = [
    data => data.groups.pop(), data => data.groups[0].samples.pop(),
    data => data.groups[0].samples[1].iterations--, data => data.groups[0].samples[1].instructions--,
    data => data.groups[0].samples[1].warmupSlices = 1, data => data.groups[0].samples[1].warmupIterations--,
    data => data.groups[0].samples[1].environment.v8 = 'other',
    data => data.groups[0].samples[1].instrumentation.beforeSHA256 = 'other',
    data => data.groups[0].samples[1].outputVerified = false,
    data => data.groups[0].samples[1].trace.reportedAllocatedBytes = NaN,
    data => data.control.floatCarriers = 0, data => data.control.trace.reportedAllocatedBytes = 0
  ];
  for (const edit of edits) {
    const data = evidence();
    edit(data);
    assert.equal(assessFloatIterationCriterion(data.groups, data.control).acceptance, 'unqualified');
  }
  assert.equal(assessFloatIterationCriterion(null, null).acceptance, 'unqualified');
});

test('allocation trace includes all in-loop bytes and closing pre-collection allocation, not retained size', () => {
  const collection = (allocated, start, end) =>
    `[1:0xabcdef] 123 ms: gc=ms allocated=${allocated} start_object_size=${start} end_object_size=${end}\n`;
  const payload = row('typed', 100000, 0);
  const output = collection(10000, 15000, 1000) + 'A05_FLOAT_TRACE_BEGIN\n' +
    collection(3000, 4000, 1000) + collection(7000, 8000, 1000) + 'A05_FLOAT_TRACE_END\n' +
    collection(5000, 6000, 1000) + 'A05_FLOAT_RESULT ' + JSON.stringify(payload) + '\n';
  const actual = parseFloatAllocationTrace(output);
  assert.equal(actual.trace.collectionsDuringLoop, 2);
  assert.equal(actual.trace.reportedAllocatedBytes, 15000);
  assert.equal(actual.trace.closingCollection.reportedAllocatedBytes, 5000);
  assert.equal(actual.trace.loopCollections.length, 2);
});

test('retained reports keep their historical labels while fixed-loop interpretation distinguishes real allocation growth', () => {
  const directory = '../planning/qualification/a05-evidence/float-allocation-2026-10-04/';
  for (const [name, expected] of [
    ['a05-float-allocation-single-boundary-warm-slices.json', 'met'],
    ['a05-float-allocation-warm-slices.json', 'inconclusive'],
    ['a05-float-allocation-single-boundary.json', 'unqualified']
  ]) {
    const original = readFileSync(new URL(directory + name, import.meta.url), 'utf8');
    const report = JSON.parse(original);
    assert.equal(assessFloatIterationCriterion(report.rows, report.positiveAllocationControl).acceptance, expected, name);
    assert.equal(report.acceptance, 'partial');
    assert.deepEqual(report, JSON.parse(original), 'the archived report is not rewritten or relabeled');
  }
});
