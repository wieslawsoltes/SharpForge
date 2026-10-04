import test from 'node:test';
import assert from 'node:assert/strict';
import {HeapLimits, resolveHeapHardLimit} from '../packages/runtime/src/gc/limits.js';
import {normalizeCollectionRequest, shouldCompactLarge} from '../packages/runtime/src/gc/compact-api.js';

test('absolute hard-limit configuration takes precedence over an explicit-memory percentage', () => {
  assert.equal(resolveHeapHardLimit({GCHeapHardLimit: '0x1000'}), 4096);
  assert.equal(resolveHeapHardLimit({heapHardLimitPercent: 25, memoryLimitBytes: 1000}), 250);
  assert.equal(resolveHeapHardLimit({heapHardLimitBytes: 200, heapHardLimitPercent: 25, memoryLimitBytes: 1000}), 200);
  assert.equal(resolveHeapHardLimit({heapHardLimitBytes: 600, heapHardLimitPercent: 25}), 600);
  assert.equal(resolveHeapHardLimit({heapHardLimitPercent: 50, memoryLimitBytes: 2 ** 32}), 2 ** 31);
  assert.throws(() => resolveHeapHardLimit({heapHardLimitPercent: 20}), /Explicit memory limit/);
  assert.throws(() => resolveHeapHardLimit({heapHardLimitPercent: 101, memoryLimitBytes: 1000}), RangeError);
  assert.throws(() => resolveHeapHardLimit({heapHardLimitBytes: -1}), RangeError);
  assert.throws(() => resolveHeapHardLimit({heapHardLimitBytes: 0}), RangeError);
});

test('hard OOM recovery preserves roots for the full compacting retry after an automatic collection', () => {
  const calls = [];
  const roots = [{h: 3, g: 4}];
  const managed = {
    maxBytes: 128, threshold: 128, stats: {liveBytes: 120},
    collector: {beforeAllocation(bytes, values) { calls.push({kind: 'automatic', bytes, values: [...values]}); }},
    collect(values, options) { calls.push({kind: 'recovery', values: [...values], options}); this.stats.liveBytes = 32; }
  };
  const limits = new HeapLimits(managed);
  limits.reserve(64, (function* () { yield* roots; })());
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].values, roots);
  assert.deepEqual(calls[1].values, roots);
  assert.deepEqual(calls[1].options, {generation: 2, reason: 'OutOfMemory', blocking: true, compacting: true});
  assert.equal(limits.recoveryCollections, 1);
});

test('native allocation failure retries exactly once and leaves unrelated exceptions untouched', () => {
  const managed = {maxBytes: 128, threshold: 128, stats: {}, collect() {}};
  const limits = new HeapLimits(managed);
  let attempts = 0;
  const value = limits.allocationFailureRetry(() => {
    if (++attempts === 1) throw new RangeError('Array buffer allocation failed');
    return 42;
  });
  assert.equal(value, 42);
  assert.equal(attempts, 2);
  const original = new TypeError('Incorrect storage representation');
  assert.throws(() => limits.allocationFailureRetry(() => { throw original; }), error => error === original);
  assert.throws(() => limits.allocationFailureRetry(() => {
    throw new RangeError('Array buffer allocation failed');
  }), {name: 'OutOfMemoryException'});
  assert.equal(limits.failures, 1);
});

test('collection overloads validate modes and only full collections request LOH compaction', () => {
  assert.deepEqual(normalizeCollectionRequest({generation: 2, mode: 'Forced', compacting: true}), {
    generation: 2, mode: 1, compacting: true, blocking: true, reason: 'Induced'
  });
  assert.throws(() => normalizeCollectionRequest({mode: 'Unrecognized'}), {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => normalizeCollectionRequest({generation: -1}), {name: 'ArgumentOutOfRangeException'});
  assert.throws(() => normalizeCollectionRequest({mode: 'Aggressive', compacting: false}), {name: 'ArgumentException'});
  const settings = {largeObjectHeapCompactionMode: 2};
  assert.equal(shouldCompactLarge(settings, {generation: 0}), false);
  assert.equal(shouldCompactLarge(settings, {generation: 2}), true);
  assert.equal(settings.largeObjectHeapCompactionMode, 2, 'planning does not prematurely consume CompactOnce');
  assert.equal(shouldCompactLarge({largeObjectHeapCompactionMode: 1}, {generation: 2, reason: 'OutOfMemory'}), true);
});
