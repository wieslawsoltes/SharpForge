import test from 'node:test';
import assert from 'node:assert/strict';
import {source, expected} from '../examples/runtime/scalar-semantics.mjs';
import {executeExample} from '../examples/runtime/example-routes.mjs';
import {executeCacheExample} from '../examples/runtime/execution-caches.mjs';

test('T01 scalar example preserves width, IEEE bits, decimal scale and arithmetic faults on all routes', () => {
  const results = executeExample(source, expected);
  assert.equal(results.length, 3);
  for (const result of results) assert.equal(result.output, expected, result.engine);
});

test('T07 preparation, explicit invalidation and restore preserve guest execution on all routes', () => {
  const results = executeCacheExample();
  assert.deepEqual(results.map(result => result.engine), ['source', 'reloaded source', 'direct CIL']);
  for (const result of results) {
    assert.equal(result.output, '16\n', result.engine);
    assert.ok(result.invalidatedEpoch > result.initialEpoch, result.engine);
    assert.ok(result.restoredEpoch > result.invalidatedEpoch, result.engine);
  }
});
