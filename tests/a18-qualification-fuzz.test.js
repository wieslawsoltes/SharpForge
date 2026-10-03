import test from 'node:test';
import assert from 'node:assert/strict';
import {readDesignSource} from '@sharpforge/designer';
import {firstSeed, sequenceCount, fuzzSource, seededRandom, runSeededSequence} from './fixtures/a18/fuzz.js';

test('fuzz PRNG reproduces each seed without reading time or shared process state', () => {
  for (const seed of [0, 1, firstSeed, 0xffffffff]) {
    const first = seededRandom(seed);
    const second = seededRandom(seed);
    assert.deepEqual(Array.from({length: 128}, () => first(1000)), Array.from({length: 128}, () => second(1000)));
  }
});

for (let offset = 0; offset < sequenceCount; offset += 50) {
  test(`50 full edit/compile/source/CIL sequences: ${offset + 1}–${offset + 50}`, () => {
    const baseline = readDesignSource(fuzzSource, {uri: 'Fuzz.cs', className: 'View', methodName: 'Create'});
    for (let index = offset; index < offset + 50; index++) {
      const result = runSeededSequence((firstSeed + index) >>> 0, {baseline});
      assert.ok(result.operations.length >= 6);
      assert.equal(result.runtime.source.status, 'passed');
      assert.equal(result.runtime.cil.status, 'passed');
    }
  });
}
