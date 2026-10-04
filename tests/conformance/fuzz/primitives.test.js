import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_BUDGETS, HARD_LIMITS, normalizeBudgets } from '../../../scripts/conformance/fuzz/budgets.js';
import { createPrng, mutateBytes } from '../../../scripts/conformance/fuzz/mutations.js';

test('offline budgets reject unknown, fractional, nonfinite and widened limits', () => {
  assert.deepEqual(normalizeBudgets(), DEFAULT_BUDGETS);
  assert(Object.isFrozen(normalizeBudgets()));
  for (const [key, maximum] of Object.entries(HARD_LIMITS)) {
    for (const value of [0, -1, 0.5, NaN, Infinity, maximum + 1, String(maximum)]) {
      assert.throws(() => normalizeBudgets({ [key]: value }), RangeError);
    }
  }
  assert.throws(() => normalizeBudgets({ parallel: 100 }), /Unknown/);
  assert.throws(() => normalizeBudgets({ v8HeapMb: 31 }), RangeError);
  assert.equal(normalizeBudgets({ maxCases: 1, maxInputBytes: 1 }).maxCases, 1);
});

test('fixture PRNG preserves its documented sequence and rejects invalid seeds', () => {
  const random = createPrng(1);
  assert.deepEqual([random(0x100000000), random(0x100000000), random(0x100000000)], [1015568748, 1586005467, 2165703038]);
  assert.throws(() => createPrng(-1), RangeError);
  assert.throws(() => createPrng(0x100000000), RangeError);
  assert.throws(() => random(0), RangeError);
});

test('seeded byte variations are repeatable, isolated and always honor the input ceiling', () => {
  for (const source of [new Uint8Array(), Uint8Array.of(1), new Uint8Array(64).fill(7)]) {
    const retained = source.slice();
    for (let caseIndex = 0; caseIndex < 40; caseIndex++) {
      const options = { seed: 0xffffffff, caseIndex, maxInputBytes: 64 };
      const first = mutateBytes(source, options);
      assert.deepEqual(first, mutateBytes(source, options));
      assert(first.input.length <= 64);
      if (first.input.length) first.input[0] ^= 255;
      assert.deepEqual(source, retained);
    }
  }
  assert.throws(() => mutateBytes(new Uint8Array(65), { maxInputBytes: 64 }), RangeError);
  assert.throws(() => mutateBytes(Uint8Array.of(1), { maxInputBytes: 0 }), RangeError);
});
