import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {microbenchmarks} from '../bench/vm/fixtures.js';
import {parseQualificationOptions} from '../bench/vm/qualification-options.js';
import {qualificationAcceptance, recordMeasurement} from '../bench/vm/qualification.js';
import {selectProfilerDefinitions, requiredProfilerRows, profilerCoverage} from '../bench/vm/qualification-profiler.js';

const expectedOff = ['profiler-off-source-arith', 'profiler-off-source-calls', 'profiler-off-source-allocation',
  'profiler-off-cil-arith', 'profiler-off-cil-calls', 'profiler-off-cil-allocation'];
const measured = definition => ({id: definition.id, status: 'measured', required: definition.required,
  target: {acceptance: definition.required ? 'met' : 'reported'}});

test('profiler selection retains all original definitions and default alternating off/on row order', () => {
  const reference = Object.freeze({referenceIdentity: true});
  const both = selectProfilerDefinitions('both', reference);
  const off = selectProfilerDefinitions('off', reference), on = selectProfilerDefinitions('on', reference);
  assert.deepEqual(requiredProfilerRows, expectedOff);
  assert.deepEqual(both.map(row => row.id), expectedOff.flatMap(id => [id, id.replace('-off-', '-on-')]));
  assert.deepEqual(off, both.filter(row => row.required));
  assert.deepEqual(on, both.filter(row => !row.required));
  assert.equal(off.length, 6);
  assert.equal(on.length, 6);
  for (const definition of both) {
    assert.equal(definition.fixture, microbenchmarks.find(fixture => definition.id.endsWith('-' + fixture.id)));
    assert.deepEqual(definition.baselineOptions, {profile: false});
    assert.equal(definition.issue, 1402);
    if (definition.required) {
      assert.equal(definition.baselineRuntime, reference);
      assert.deepEqual(definition.candidateOptions, {profile: false});
      assert.deepEqual(definition.target, {kind: 'maximum-overhead', value: 0.01});
    } else {
      assert.equal(Object.hasOwn(definition, 'baselineRuntime'), false, 'enabled mode uses product baseline');
      assert.equal(Object.hasOwn(definition, 'target'), false, 'enabled timing is an observation');
      assert.deepEqual(definition.candidateOptions, {profile: {sampleBudget: 256}});
    }
  }
  assert.throws(() => selectProfilerDefinitions('enabled'), /Invalid profiler mode/);
});

test('CLI selection keeps all sample and fixture bounds, with explicit default and valid suites', () => {
  const base = ['--runner', 'profiler-selection'];
  assert.equal(parseQualificationOptions(base).profilerMode, 'both');
  for (const mode of ['off', 'on', 'both']) {
    const options = parseQualificationOptions([...base, '--suite', 'profiler', '--profiler-mode', mode,
      '--samples', '100', '--warmup', '10']);
    assert.equal(options.profilerMode, mode);
    assert.equal(options.samples, 100);
    assert.equal(options.warmup, 10);
    assert.equal(options.profilerReference, null, 'on-only does not need an alternate runtime');
  }
  for (const extra of [['--profiler-mode', 'invalid'], ['--profiler-mode', 'off', '--profiler-mode', 'on'],
    ['--suite', 'roots', '--profiler-mode', 'off'], ['--suite', 'targets', '--profiler-mode', 'on']]) {
    assert.throws(() => parseQualificationOptions([...base, ...extra]));
  }
});

test('required-off qualification rejects missing, failed, optional, and wrong-engine rows', () => {
  const off = selectProfilerDefinitions('off').map(measured);
  assert.equal(qualificationAcceptance(off, requiredProfilerRows), 'met');
  for (const replacement of [null, {...off.at(-1), status: 'failed'}, {...off.at(-1), required: false},
    {...off.at(-1), id: 'profiler-off-reloaded-allocation'}]) {
    const incomplete = [...off.slice(0, -1), ...(replacement ? [replacement] : [])];
    assert.equal(qualificationAcceptance(incomplete, requiredProfilerRows), 'incomplete');
  }
  const missed = off.map((row, index) => index ? row : {...row, target: {acceptance: 'missed'}});
  assert.equal(qualificationAcceptance(missed, requiredProfilerRows), 'missed');
  const uncertain = off.map((row, index) => index ? row : {...row, target: {acceptance: 'inconclusive'}});
  assert.equal(qualificationAcceptance(uncertain, requiredProfilerRows), 'inconclusive');
});

test('on-only never qualifies required off overhead, even alongside successful non-profiler suites', () => {
  const on = selectProfilerDefinitions('on').map(measured);
  const rows = [...on, {id: 'unrelated-target', status: 'measured', target: {acceptance: 'met'}}];
  assert.equal(qualificationAcceptance(rows, requiredProfilerRows), 'incomplete');
  const coverage = profilerCoverage(rows, 'on');
  assert.deepEqual(coverage.requiredOff.missing, expectedOff);
  assert.deepEqual(coverage.requiredOff.omitted, expectedOff);
  assert.equal(coverage.enabledOverhead.measured.length, 6);
  assert.equal(coverage.complete, false);
});

test('off-only success records omitted enabled rows, while both groups establish complete coverage', () => {
  const off = selectProfilerDefinitions('off').map(measured);
  const coverage = profilerCoverage(off, 'off');
  assert.equal(coverage.mode, 'off');
  assert.deepEqual(coverage.requiredOff.missing, []);
  assert.deepEqual(coverage.requiredOff.omitted, []);
  assert.equal(coverage.enabledOverhead.missing.length, 6);
  assert.equal(coverage.enabledOverhead.omitted.length, 6);
  assert.equal(coverage.complete, false, 'off threshold success does not invent enabled observations');
  const both = profilerCoverage(selectProfilerDefinitions().map(measured));
  assert.equal(both.complete, true);
  assert.equal(both.requiredOff.measured.length, 6);
  assert.equal(both.enabledOverhead.measured.length, 6);
  assert.deepEqual(both.enabledOverhead.omitted, []);
});

test('failed enabled observations keep optional classification and retained execution errors', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'a05-profiler-selection-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const out = join(directory, 'failed-observation.json');
  const context = {signal: new AbortController().signal, options: {out}, report: {rows: [], errors: []}};
  const id = 'profiler-on-cil-allocation';
  const failure = new Error('intentional enabled measurement failure');
  failure.evidence = {id, status: 'failed', samples: {baseline: [], candidate: []}};
  await recordMeasurement(context, id, async () => { throw failure; }, false);
  const retained = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(retained.rows[0].required, false);
  assert.equal(retained.rows[0].status, 'failed');
  assert.equal(retained.errors[0].message, failure.message, 'execution errors remain failures for the overall report');
  assert.equal(qualificationAcceptance(retained.rows, requiredProfilerRows), 'incomplete');
  assert.deepEqual(profilerCoverage(retained.rows, 'on').enabledOverhead.measured, []);
  const off = selectProfilerDefinitions('off').map(measured);
  assert.equal(qualificationAcceptance([...off, ...retained.rows], requiredProfilerRows), 'met',
    'required-off acceptance is separate from the retained enabled execution failure');
});
