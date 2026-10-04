import test from 'node:test';
import assert from 'node:assert/strict';
import { measureVerifierBatch } from '../packages/cil/tools/verifier-benchmark-measure.mjs';

test('benchmark batch bounds reject invalid work before invoking a workload', () => {
  const workload = { run() { assert.fail('invalid work reached the workload'); } };
  for (const iterations of [0, -1, 1.5, 5001, Infinity, NaN])
    assert.throws(() => measureVerifierBatch(workload, iterations), /Integer/);
});

test('benchmark guards reject a wrong intermediate result even when the final result is correct', () => {
  let invocation = 0;
  const workload = { name: 'IntermediateFailure', expected: 'verified', readValue: value => value.status,
    run: () => ({ status: invocation++ === 1 ? 'unknown' : 'verified' }) };
  assert.throws(() => measureVerifierBatch(workload, 3), /invocation 1/);
  assert.equal(invocation, 3);
});

test('benchmark checks every retained result after the timed operation loop completes', () => {
  let invocation = 0;
  let checked = 0;
  const workload = { name: 'GuardOrder', expected: 'verified',
    run: () => { invocation++; return { status: 'verified' }; },
    readValue(value) {
      assert.equal(invocation, 4);
      checked++;
      return value.status;
    } };
  const result = measureVerifierBatch(workload, 4);
  assert.equal(checked, 4);
  assert.equal(result.checkedInvocations, 4);
  assert.ok(Number.isFinite(result.ms) && result.ms >= 0);
  assert.ok(Number.isFinite(result.heapDeltaBytes));
});
