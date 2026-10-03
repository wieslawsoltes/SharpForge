import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtures, fixtureDigest} from '../../../scripts/conformance/diff/gc/fixtures.js';
import {traceFixture} from '../../../scripts/conformance/diff/gc/js-collector.js';
import {recordJSTrace, runGCTrace} from '../../../scripts/conformance/diff/gc-trace.js';
import {compareTraces, validateTrace} from '../../../scripts/conformance/diff/gc/compare.js';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const commit = 'a'.repeat(40);
const expected = seed => ({seed, fixtures: fixtures(seed), fixtureSHA256: fixtureDigest(fixtures(seed))});
// Synthetic comparator input only; never emitted as a Rust qualification artifact.
const comparisonFixture = js => ({...structuredClone(js), collector: {engine: 'rust', version: 'synthetic-unit-fixture'}});
test('GC fixtures are deterministic for uint32 boundary seeds and seeded graph changes', () => {
  for (const seed of [0, 1, 0xffffffff]) assert.deepEqual(fixtures(seed), fixtures(seed));
  assert.notEqual(fixtureDigest(fixtures(1)), fixtureDigest(fixtures(2)));
  for (const seed of [-1, 1.5, NaN, 0x100000000]) assert.throws(() => fixtures(seed), /uint32/);
});
test('production JS collector retains rooted cycles, reclaims unreachable cycles, and clears weak handles', () => {
  const rows = fixtures(1).map(traceFixture);
  assert.deepEqual(rows[0].checkpoints.map(row => row.reachable), [['a', 'b'], []]);
  assert.deepEqual(rows[0].checkpoints[1].collected, ['a', 'b']);
  assert.equal(rows[1].checkpoints[0].weak.weak, 'a'); assert.equal(rows[1].checkpoints[1].weak.weak, null);
  assert.deepEqual(rows[2].checkpoints[1].reachable, ['new']); assert.equal(rows[2].checkpoints[1].weak.weak, null);
  assert.deepEqual(rows[3].checkpoints.map(row => row.reachable), [[], []]);
  assert(rows.every(row => row.finalization.status === 'unsupported' && row.finalization.order === null));
});
test('GC adapters reject invalid operations, duplicate objects and invalid field bounds', () => {
  assert.throws(() => traceFixture({operations: [{op: 'fake'}]}), /Unsupported/);
  assert.throws(() => traceFixture({operations: [{op: 'allocate', id: 'x', fields: 0}, {op: 'allocate', id: 'x', fields: 0}]}), /Invalid allocation/);
  assert.throws(() => traceFixture({operations: [{op: 'allocate', id: 'x', fields: 0}, {op: 'link', id: 'x', field: 0, target: null}]}), /Invalid field/);
});
test('trace comparison classifies actual set/weak differences and never claims missing finalization matches', () => {
  const js = recordJSTrace({seed: 4, commit}), rust = comparisonFixture(js), input = expected(4);
  assert.equal(compareTraces(js, rust, input).status, 'partial');
  rust.traces[0].checkpoints[0].reachable = ['a'];
  rust.traces[1].checkpoints[0].weak.weak = null;
  assert.deepEqual(compareTraces(js, rust, input).differences.map(row => row.classification), ['reachable-set', 'weak-reference-liveness']);
  assert.throws(() => validateTrace({...rust, platform: null}, input), /provenance/);
  const wrongSeed = {...rust, seed: 3}; assert.throws(() => compareTraces(js, wrongSeed, input), /provenance/);
  assert.throws(() => compareTraces(js, js, input), /distinct/);
  const missing = comparisonFixture(js); missing.traces[0].checkpoints.pop(); assert.throws(() => validateTrace(missing, input), /Incomplete/);
  const malformed = comparisonFixture(js); malformed.traces[0].checkpoints[0].reachable = ['x']; assert.throws(() => validateTrace(malformed, input), /Malformed/);
});
test('finalization order is compared when both explicit trace records support it', () => {
  const js = recordJSTrace({seed: 1, commit}), rust = comparisonFixture(js);
  for (const trace of [js, rust]) for (const row of trace.traces) row.finalization = {status: 'recorded', order: []};
  js.traces[0].finalization.order = ['a', 'b']; rust.traces[0].finalization.order = ['b', 'a'];
  const report = compareTraces(js, rust, expected(1)); assert.equal(report.status, 'different');
  assert.equal(report.differences[0].classification, 'finalization-order');
});
test('default GC report retains real JS trace and explicit unavailable Rust status', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sf-gc-report-'));
  try { const path = join(dir, 'report.json'), report = await runGCTrace({output: path});
    assert.equal(report.status, 'unsupported'); assert.equal(report.rust.status, 'unsupported');
    assert(report.js.traces.length > 0); assert.equal(report.qualification, 'unknown');
    assert.equal(JSON.parse(await readFile(path, 'utf8')).comparison.reachableSets, 'unknown');
  } finally { await rm(dir, {recursive: true, force: true}); }
});
