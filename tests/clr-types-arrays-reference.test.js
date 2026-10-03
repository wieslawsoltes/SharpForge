import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrayContext } from './clr-types-array-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/clr-constructed-types/native-arrays.json', import.meta.url)));

test('CLR array interfaces, accessor signatures and constructor arities match independent CoreCLR reflection', () => {
  assert.match(native.runtime, /^\.NET 10\./);
  const types = arrayContext().types;
  for (const expected of native.arrays) {
    let element = types.intrinsic(expected.name.startsWith('System.String') ? 'System.String' : 'System.Int32');
    if (expected.name.endsWith('[][]')) element = types.szArray(element);
    const type = expected.szarray ? types.szArray(element) : types.array(element, expected.rank);
    assert.equal(type.fullName, expected.name);
    assert.equal(type.baseType.fullName, expected.baseType);
    assert.deepEqual(type.interfaces.map(contract => contract.fullName).sort(), expected.interfaces);
    const actualMethods = type.methods.filter(method => method.name !== '.ctor').map(method => ({
      name: method.name, result: method.returnType.fullName, parameters: method.parameters.map(parameter => parameter.fullName),
    }));
    assert.deepEqual(actualMethods.sort((a, b) => a.name.localeCompare(b.name)),
      expected.methods.sort((a, b) => a.name.localeCompare(b.name)));
    assert.deepEqual(type.methods.filter(method => method.name === '.ctor').map(method => method.parameters.length).sort(),
      expected.constructors);
  }
  assert.equal(types.pointer(types.intrinsic('System.Int32')).fullName, native.pointerName);
  assert.equal(types.byRef(types.intrinsic('System.Int32')).fullName, native.byrefName);
});
