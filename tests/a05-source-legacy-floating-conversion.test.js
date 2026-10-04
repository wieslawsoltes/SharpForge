import test from 'node:test';
import assert from 'node:assert/strict';
import {float} from '@sharpforge/bytecode';
import {convert} from '../packages/runtime/src/execution/source-ops.js';
import {numericDifferential, numericOracle} from './support/numeric-differential.js';
import {conversionMatrixSource} from './support/numeric-conversion-matrix.js';

test('legacy source Int32 conversion preserves tagged floating payloads and overflow checks', () => {
  for (const kind of ['r4', 'r8']) {
    for (const [value, expected] of [[1.5, 1], [-1.5, -1], [Infinity, 2147483647],
      [-Infinity, -2147483648], [NaN, 0]]) {
      assert.equal(convert(float(value, kind), 0), expected);
      if (Number.isFinite(value)) assert.equal(convert(float(value, kind), 0, 1), expected);
      else assert.throws(() => convert(float(value, kind), 0, 1), {name: 'OverflowException'});
    }
  }
  assert.equal(convert(1.5, 0), 1);
  assert.equal(convert(float(1.5), 1), 1.5);
});

test('source floating local casts retain the hash-pinned native conversion outcomes in all routes', () => {
  const cases = JSON.parse(numericOracle('conversions.json').text);
  const expected = numericOracle('conversions.txt.gz').text.trimEnd().split('\n');
  const selected = cases.map((item, index) => ({item, expected: expected[index]})).filter(({item}) =>
    ['r4', 'r8'].includes(item.source) && item.target === 'int' &&
    ['1.5', '-1.5', 'NaN', 'Infinity', '-Infinity'].includes(item.input) && !item.opcode.endsWith('.un'));
  assert.equal(selected.length, 20);
  numericDifferential('using System;\n' + selected.map(({item}) => conversionMatrixSource(item)).join('\n'),
    selected.map(row => row.expected).join('\n') + '\n', {
      family: 'legacy floating locals', nativeIntBits: selected[0].item.nativeIntBits,
    });
});
