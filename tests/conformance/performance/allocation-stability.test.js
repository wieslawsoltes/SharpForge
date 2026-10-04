import test from 'node:test';
import assert from 'node:assert/strict';
import {allocationSummary} from '../../../scripts/conformance/perf/alloc.js';

const sample = (maxPauseMs, collections = 2) => ({managed: {
  allocationsPerOperation: 1,
  bytesPerOperation: 40,
  maxPauseMs,
  collections
}});

test('unchanged allocations cannot hide unstable GC pauses', () => {
  const result = allocationSummary([sample(4), sample(8)]);
  assert.equal(result.stable, false);
  assert.equal(result.allocationsPerOperation.relativeSpread, 0);
  assert.equal(result.bytesPerOperation.relativeSpread, 0);
  assert.equal(result.maxPauseMs, 8);
  assert.deepEqual(result.maxPauseMsRange, {min: 4, max: 8, relativeSpread: 1});
  assert.deepEqual(result.collectionCounts, [2, 2]);
  assert.equal(allocationSummary([sample(4), sample(4.125)]).stable, true);
  assert.equal(allocationSummary([sample(4), sample(4.25)], .0625).stable, true);
  assert.equal(allocationSummary([sample(4), sample(4.25)], .06).stable, false);
});

test('zero GC pauses remain stable until a nonzero pause is observed', () => {
  const zero = allocationSummary([sample(0, 0), sample(0, 0)]);
  assert.equal(zero.stable, true);
  assert.deepEqual(zero.maxPauseMsRange, {min: 0, max: 0, relativeSpread: 0});
  const transition = allocationSummary([sample(0, 0), sample(1, 1)]);
  assert.equal(transition.stable, false);
  assert.equal(transition.maxPauseMsRange.relativeSpread, null);
});

test('invalid GC measurements are rejected instead of reporting stable evidence', () => {
  for (const pause of [undefined, null, '1', -1, NaN, Infinity]) {
    assert.throws(() => allocationSummary([sample(pause)]), /Invalid managed counter/);
  }
  for (const count of [undefined, null, '1', -1, .5, NaN, Infinity]) {
    const value = sample(1);
    value.managed.collections = count;
    assert.throws(() => allocationSummary([value]), /Invalid managed collection count/);
  }
  assert.equal(allocationSummary([{managed: null}]).status, 'unsupported');
});
