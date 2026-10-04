import test from 'node:test';
import assert from 'node:assert/strict';
import {measureArrayFairness} from '../bench/vm/array-fairness.js';

const options = {nativeBits: 32, arrayElements: 512, timeoutSeconds: 60};

for (const engine of ['source', 'cil']) {
  test(`${engine}: fairness measures actual slices and verifies every sorted element`, async () => {
    const row = await measureArrayFairness(engine, options);
    assert.equal(row.status, 'measured');
    assert.equal(row.outputVerified, true);
    assert.equal(row.target.acceptance, 'partial');
    assert.equal(row.target.meetsAcceptanceSize, false);
    assert.equal(row.summary.sliceMs.count, row.slices.length);
    assert(row.slices.every(slice => slice.durationMs > 0));
    assert.equal(row.target.observed, Math.max(...row.slices.map(slice => slice.durationMs)));
  });
}

test('fairness rejects invalid sizes and cancels before guest construction', async () => {
  await assert.rejects(measureArrayFairness('cil', {...options, arrayElements: 1000001}), RangeError);
  const cancellation = new AbortController();
  cancellation.abort(new Error('cancel sort fairness'));
  await assert.rejects(measureArrayFairness('cil', options, cancellation.signal), /cancel sort fairness/);
});
