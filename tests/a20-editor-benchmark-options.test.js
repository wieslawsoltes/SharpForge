import test from 'node:test';
import assert from 'node:assert/strict';
import { editorBenchmarkSizes, validateOptions } from '../scripts/editor-benchmarks/common.js';
import { editorBenchmarkMaxSize, validateFixtureSize } from '../scripts/editor-benchmarks/limits.js';
import { waitForBenchmarkReady } from '../scripts/editor-benchmarks/browser-ready.js';

test('200 MiB qualification is explicitly accepted without growing defaults or allocating a large fixture', () => {
  const sizeBytes = 200 * 1024 ** 2;
  assert.equal(validateFixtureSize(sizeBytes), sizeBytes);
  assert.deepEqual(validateOptions({ sizes: [sizeBytes], samples: 3, warmups: 0 }), { sizes: [sizeBytes], samples: 3, warmups: 0 });
  assert.deepEqual(editorBenchmarkSizes, [1024, 1024 ** 2, 10 * 1024 ** 2, 100 * 1024 ** 2]);
  assert.deepEqual(validateOptions().sizes, editorBenchmarkSizes);
  assert.equal(validateFixtureSize(editorBenchmarkMaxSize), 256 * 1024 ** 2);
  assert.throws(() => validateFixtureSize(editorBenchmarkMaxSize + 1), /256 MiB/);
});

test('browser readiness only uses evaluate and stops once the real API appears', async () => {
  let polls = 0;
  const page = { evaluate: async predicate => { assert.equal(typeof predicate, 'function'); return ++polls === 3; } };
  await waitForBenchmarkReady(page, { timeoutMs: 1000, intervalMs: 1 });
  assert.equal(polls, 3);
});

test('browser readiness has a deadline even when evaluate hangs, and propagates page errors or cancellation', async () => {
  await assert.rejects(waitForBenchmarkReady({ evaluate: () => new Promise(() => {}) }, { timeoutMs: 10, intervalMs: 1 }), /initialize/);
  const failure = new Error('Page closed');
  await assert.rejects(waitForBenchmarkReady({ evaluate: async () => { throw failure; } }), error => error === failure);
  const controller = new AbortController();
  const pending = waitForBenchmarkReady({ evaluate: () => new Promise(() => {}) }, { signal: controller.signal });
  const cancellation = new Error('Cancelled by caller');
  controller.abort(cancellation);
  await assert.rejects(pending, error => error === cancellation);
  await assert.rejects(waitForBenchmarkReady({ evaluate: () => assert.fail('Already cancelled') }, { signal: controller.signal }),
    error => error === cancellation);
});
