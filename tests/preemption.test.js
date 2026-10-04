import test from 'node:test';
import assert from 'node:assert/strict';
import {measureTieredFairness} from '../bench/vm/tiered-fairness.js';

const options = {nativeBits: 32, timeoutSeconds: 60};

test('timed tiered fairness enters actual Wasm and accounts for every instruction and slice', async () => {
  const iterations = 4096;
  const row = await measureTieredFairness(options, undefined, iterations);
  assert.equal(row.status, 'measured');
  assert.equal(row.outputVerified, true);
  assert.equal(row.target.acceptance, 'partial', 'the reduced test cannot qualify the full workload');
  assert.equal(row.target.meetsAcceptanceSize, false);
  assert.equal(row.reference.returnValue, iterations);
  assert.equal(row.returnValue, iterations);
  assert.equal(row.instructions, 7 * iterations + 4);
  assert.equal(row.timedInstructions, row.instructions);
  assert.equal(row.reference.instructions, row.instructions);
  assert.equal(row.reference.wasmTiering, null);
  assert.equal(row.tierBeforeExecution.osrTransitions, 0);
  assert.equal(row.tierBeforeExecution.selectedInstructions, 0);
  assert.equal(row.tierAfterExecution.osrTransitions, 1);
  assert.equal(row.selectedInstructions, row.instructions - 23, 'the first three loop iterations stay interpreted');
  assert(row.slices.filter(slice => slice.selectedInstructions > 0).length >= 2);
  assert(row.slices.every(slice => slice.durationMs > 0 && slice.instructions > 0 && slice.instructions <= slice.instructionBudget));
  assert.equal(row.slices[0].instructions, 16);
  assert.equal(row.summary.sliceMs.count, row.slices.length);
  assert.equal(row.target.observed, Math.max(...row.slices.map(slice => slice.durationMs)));
  assert.equal(row.target.value, 2 * row.requestedSliceMs);
  assert.deepEqual(row.disposal, {state: 'terminated', activeFrames: 0, tierEnabled: false});
});

test('unavailable Wasm is a failed fairness observation rather than interpreter qualification', async context => {
  context.mock.method(WebAssembly, 'instantiate', async () => { throw new Error('fairness backend unavailable'); });
  await assert.rejects(measureTieredFairness(options, undefined, 32), error => {
    assert.match(error.message, /requires actual compiled Wasm:.*fairness backend unavailable/);
    assert.equal(error.evidence.status, 'failed');
    assert.equal(error.evidence.slices.length, 1);
    assert.equal(error.evidence.slices[0].selectedInstructions, 0);
    assert.deepEqual(error.evidence.disposal, {state: 'terminated', activeFrames: 0, tierEnabled: false});
    return true;
  });
});

test('tiered fairness rejects invalid bounds and cancellation before guest construction', async () => {
  for (const iterations of [0, 31, 1000001, NaN]) {
    await assert.rejects(measureTieredFairness(options, undefined, iterations), RangeError);
  }
  await assert.rejects(measureTieredFairness({...options, nativeBits: 16}, undefined, 32), RangeError);
  const cancellation = new AbortController();
  cancellation.abort(new Error('cancel tiered fairness'));
  await assert.rejects(measureTieredFairness(options, cancellation.signal, 32), /cancel tiered fairness/);
});

test('cancellation during asynchronous tier preparation disposes its VM and cannot produce a passing row', async context => {
  const cancellation = new AbortController();
  context.mock.method(WebAssembly, 'instantiate', async () => {
    cancellation.abort(new Error('cancel fairness compilation'));
    throw new Error('cancelled compiler');
  });
  await assert.rejects(measureTieredFairness(options, cancellation.signal, 32), error => {
    assert.match(error.message, /cancel fairness compilation/);
    assert.equal(error.evidence.status, 'cancelled');
    assert.equal(error.evidence.slices.reduce((total, slice) => total + slice.selectedInstructions, 0), 0);
    assert.deepEqual(error.evidence.disposal, {state: 'terminated', activeFrames: 0, tierEnabled: false});
    return true;
  });
});
