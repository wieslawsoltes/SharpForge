import test from 'node:test';
import assert from 'node:assert/strict';
import {convert, float, nativeInteger, number} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {binary, compare} from '../packages/runtime/src/execution/numeric-ops.js';
import {formatSourceNumber} from '../packages/runtime/src/execution/source-number-format.js';
import {numericOracle, numericDifferential} from './support/numeric-differential.js';
import {int64Pairs, int64Operations, numericFamilies, numericPairCount}
  from './support/numeric-oracle-spec.js';
import {conversionMatrixSource} from './support/numeric-conversion-matrix.js';
import {smallStorageFixture} from './support/numeric-storage-fixtures.js';

function* lines(text) {
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf('\n', start);
    if (end < 0) throw new Error('Native oracle must end each result with a newline');
    yield text.slice(start, end);
    start = end + 1;
  }
}

function wideResult(opcode, left, right) {
  try {
    const operation = opcode.split('.')[0];
    if (['eq', 'ne', 'lt', 'le', 'gt', 'ge'].includes(operation)) {
      return compare(left, right, operation, opcode.endsWith('.un')) ? '1' : '0';
    }
    return String(binary(opcode, left, right));
  } catch (error) {
    return '!' + error.name;
  }
}

test('T01.1/T01.10 100,000 native operand pairs cover every signed and unsigned Int64 operation', () => {
  const {text, provenance} = numericOracle('int64.txt.gz');
  assert.equal(provenance.files['int64.txt.gz'].pairs, numericPairCount);
  const expected = lines(text);
  let pairs = 0;
  for (const [left, right] of int64Pairs()) {
    for (const {opcode} of int64Operations) {
      const row = expected.next();
      assert.equal(row.done, false, 'Truncated native Int64 table');
      const actual = wideResult(opcode, left, right);
      if (actual !== row.value) assert.equal(actual, row.value, `${opcode}(${left},${right}), pair ${pairs}`);
    }
    pairs++;
  }
  assert.equal(pairs, 100_000);
  assert.equal(expected.next().done, true, 'Unexpected native Int64 rows');
});

test('T01.8/T01.10 the same 100,000-pair C# program matches native in all three execution routes', () => {
  const {text, provenance} = numericOracle('int64.txt.gz');
  numericDifferential(numericOracle('int64.cs').text, text, {
    family: '100k Int64 matrix', nativeIntBits: provenance.nativeIntBits,
    vmOptions: {maxInstructions: 2_000_000_000, maxOutputCharacters: 256 * 1024 * 1024},
  });
});

for (const family of numericFamilies) test('T01.10 native numeric family: ' + family.name, () => {
  const {text, provenance} = numericOracle(family.name + '.txt');
  numericDifferential(numericOracle(family.name + '.cs').text, text, {
    family: family.name, nativeIntBits: provenance.nativeIntBits,
  });
});

function matrixInput(item) {
  if (item.source === 'native') return nativeInteger(BigInt(item.input), item.nativeIntBits);
  if (item.source === 'i8') return BigInt(item.input);
  if (item.source === 'r4' || item.source === 'r8') return float(Number(item.input), item.source);
  return Number(item.input);
}

function matrixResult(item) {
  try {
    const result = convert(item.opcode, matrixInput(item), {nativeIntBits: item.nativeIntBits});
    if (result?.float) {
      if (Number.isNaN(result.value)) return 'NaN';
      const view = new DataView(new ArrayBuffer(8));
      if (result.float === 'r4') {
        view.setFloat32(0, result.value, true);
        return String(view.getInt32(0, true));
      }
      view.setFloat64(0, result.value, true);
      return String(view.getBigInt64(0, true));
    }
    return formatSourceNumber({options: {nativeIntBits: item.nativeIntBits}}, result, item.target);
  } catch (error) {
    return '!' + error.name;
  }
}

test('T01.6/T01.10 exhaustive source/target/checked/.un matrix matches native operand by operand', () => {
  const cases = JSON.parse(numericOracle('conversions.json').text);
  const expected = [...lines(numericOracle('conversions.txt.gz').text)];
  assert.equal(cases.length, expected.length);
  assert.equal(new Set(cases.map(item => item.source)).size, 5);
  for (const [index, item] of cases.entries()) assert.equal(matrixResult(item), expected[index], item.id);
  // Bounded source files avoid compiler size limits without changing any operation.
  for (let offset = 0; offset < cases.length; offset += 48) {
    const chunk = cases.slice(offset, offset + 48);
    numericDifferential('using System;\n' + chunk.map(conversionMatrixSource).join('\n'),
      expected.slice(offset, offset + chunk.length).join('\n') + '\n', {
        family: 'conversion matrix', operands: chunk.map(item => item.id).join(', '), nativeIntBits: chunk[0].nativeIntBits,
      });
  }
});

test('T01.2/T01.10 authored small-storage IL matches the same assembly on the native CLR', () => {
  const rows = JSON.parse(numericOracle('storage.json').text);
  assert.equal(new Set(rows.map(row => row.location)).size, 6);
  assert.equal(new Set(rows.map(row => row.type)).size, 6);
  for (const item of rows) {
    const assembly = smallStorageFixture(item.type, item.suffix, item.location, item.input);
    const result = new CilVirtualMachine(assembly, {arguments: item.location === 'arg' ? [item.type === 'bool' ? false : 0] : []}).run();
    assert.equal(result.state, 'terminated', JSON.stringify(item) + ': ' + result.fault?.stack);
    assert.equal(Number(number(result.returnValue)), item.expected, JSON.stringify(item));
  }
});


test('T01.3/T01.10 complete UInt32 boundary matrix matches native signed stack patterns', () => {
  const {text, provenance} = numericOracle('uint32-matrix.txt');
  const expected = lines(text);
  for (const left of [0, 1, 2147483647, -2147483648, -1]) {
    for (const right of [0, 1, 2147483647, -2147483648, -1]) {
      for (const {opcode} of int64Operations) {
        assert.equal(wideResult(opcode, left, right), expected.next().value, `${opcode}(${left},${right})`);
      }
    }
  }
  assert.equal(expected.next().done, true);
  numericDifferential(numericOracle('uint32-matrix.cs').text, text, {
    family: 'UInt32 matrix', nativeIntBits: provenance.nativeIntBits,
  });
});


test('T01.2/T01.8/T01.10 source small storage and ref calls match the native family', () => {
  const {text, provenance} = numericOracle('small-storage.txt');
  numericDifferential(numericOracle('small-storage.cs').text, text, {
    family: 'small storage', nativeIntBits: provenance.nativeIntBits,
  });
});
