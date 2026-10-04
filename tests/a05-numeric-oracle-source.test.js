import test from 'node:test';
import assert from 'node:assert/strict';
import {numericOracle, numericDifferential} from './support/numeric-differential.js';

test('native numeric source retains the explicit System import used by the CLR generator', () => {
  const source = numericOracle('uint32.cs');
  const expected = numericOracle('uint32.txt');
  assert.match(source.text, /^using System;/);
  assert.match(source.text, /catch\(Exception error\)/);
  const result = numericDifferential(source.text, expected.text, {
    family: 'stored UInt32 source', nativeIntBits: source.provenance.nativeIntBits,
  });
  assert.equal(result.compiled.image.sources[0].text, source.text);
  assert.deepEqual(Object.keys(result.outputs), ['source', 'reloaded source', 'direct CIL']);
  for (const output of Object.values(result.outputs)) assert.equal(output.characters, expected.text.length);
});
