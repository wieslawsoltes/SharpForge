import test from 'node:test';
import assert from 'node:assert/strict';
import {executeExample} from '../examples/runtime/example-routes.mjs';
import * as memory from '../examples/runtime/rectangular-memory.mjs';
import * as exceptions from '../examples/runtime/exception-order.mjs';

test('runnable rectangular, lower-bound, Span and fixed example verifies all three routes', () => {
  const results = executeExample(memory.source, memory.expected, memory.options);
  assert.equal(results.length, 3);
  assert.ok(results.every(result => result.output === memory.expected));
});

test('runnable EH example proves filters observe pre-unwind state and throwing filters preserve the original exception', () => {
  const results = executeExample(exceptions.source, exceptions.expected);
  assert.equal(results.length, 3);
  assert.ok(results.every(result => result.output === exceptions.expected));
});
