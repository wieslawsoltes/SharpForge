import test from 'node:test';
import assert from 'node:assert/strict';
import {pairedTarget} from '../bench/vm/qualification-statistics.js';
import {measureExecutionPair} from '../bench/vm/qualification-execution.js';
import {measureRootQualification} from '../bench/vm/root-qualification.js';
import {qualificationAssembly} from '../bench/vm/qualification-assembly.js';

const options = {samples: 20, warmup: 1, nativeBits: 32, timeoutSeconds: 60, seed: 12012, resamples: 1000, rootScans: 1};

test('paired target intervals distinguish achieved, missed and unresolved requirements deterministically', () => {
  const before = Array(20).fill(100), after = Array(20).fill(25), target = {kind: 'minimum-speedup', value: 3};
  assert.equal(pairedTarget(before, after, target, options).acceptance, 'met');
  assert.equal(pairedTarget(before, Array(20).fill(50), target, options).acceptance, 'missed');
  const noisy = Array.from({length: 20}, (_, index) => index < 10 ? 20 : 70);
  const result = pairedTarget(before, noisy, target, options);
  assert.equal(result.acceptance, 'inconclusive');
  assert.deepEqual(result, pairedTarget(before, noisy, target, options));
  assert.equal(pairedTarget(before, Array(20).fill(100.5), {kind: 'maximum-overhead', value: 0.01}, options).acceptance, 'met');
  assert.equal(pairedTarget(before, Array(20).fill(101), {kind: 'maximum-overhead', value: 0.01}, options).acceptance, 'missed');
  assert.throws(() => pairedTarget(before, Array(19).fill(25), target, options));
});

test('paired execution verifies every result, preserves warm plans and reports raw phases', async () => {
  const definition = {id: 'tiny-add', engine: 'cil', fixture: {id: 'tiny-add', expectedReturn: 5},
    build: () => ({assembly: qualificationAssembly({body: writer => writer.integer(2).integer(3).op('add').op('ret')}), image: null}),
    baselineOptions: {specializeNumericHandlers: false}, candidateOptions: {specializeNumericHandlers: true},
    target: {kind: 'minimum-speedup', value: 2}};
  const row = await measureExecutionPair(definition, options);
  assert.equal(row.status, 'measured');
  for (const mode of ['baseline', 'candidate']) {
    assert.equal(row.samples[mode].length, 22);
    assert.equal(row.samples[mode][0].phase, 'first');
    assert.equal(row.summary[mode].executionMs.count, 20);
    assert(row.samples[mode].every(sample => sample.outputVerified && sample.instructions === 4));
    assert(row.samples[mode].slice(2).every(sample => sample.offsetMapAllocations === 0 && sample.frameArraysAllocated === 0));
  }
  const cancellation = new AbortController();
  cancellation.abort(new Error('cancel paired execution'));
  await assert.rejects(measureExecutionPair(definition, options, cancellation.signal), /cancel paired execution/);
  await assert.rejects(measureExecutionPair({...definition, fixture: {id: 'wrong', expectedReturn: 6}}, options), /unexpected/);
});

for (const engine of ['source', 'cil']) {
  test(`${engine}: 500-frame root qualification compares the same complete live inventory`, async () => {
    const row = await measureRootQualification(engine, options);
    assert.equal(row.frames, 500);
    assert.equal(row.status, 'measured');
    assert.equal(row.collectionVerified, true);
    for (const mode of ['baseline', 'candidate']) {
      assert.equal(row.summary[mode].scanMs.count, 20);
      assert(row.samples[mode].every(sample => sample.inventoryVerified && sample.managed === 500));
    }
    assert(row.samples.baseline[0].visited > row.samples.candidate[0].visited);
  });
}
