import test from 'node:test';
import assert from 'node:assert/strict';
import {smallInteger, smallIntegerIndirect, storage} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {smallStorageTypes, smallStorageLocations, smallStorageFixture} from './support/numeric-storage-fixtures.js';

for (const {type, suffix, minimum, maximum} of smallStorageTypes) {
  for (const input of [minimum, maximum, minimum - 1, maximum + 1, -1, 0x12345]) {
    test(`T01.2 ${type} truncates ${input} in every CLI storage location`, () => {
      const bits = suffix.endsWith('1') ? 8 : 16;
      const expected = Number((suffix.startsWith('u') ? BigInt.asUintN : BigInt.asIntN)(bits, BigInt(input)));
      assert.equal(smallInteger(input, type), expected);
      assert.equal(smallIntegerIndirect(input, suffix), expected);
      assert.equal(storage(input, type), expected);
      for (const location of smallStorageLocations) {
        const assembly = smallStorageFixture(type, suffix, location, input);
        const vm = new CilVirtualMachine(assembly, {arguments: location === 'arg' ? [type === 'bool' ? false : 0] : []});
        const result = vm.run();
        assert.equal(result.state, 'terminated', location + ': ' + result.fault?.stack);
        assert.equal(Number(result.returnValue), expected, location);
      }
    });
  }
}

test('T01.2 invalid small integer storage fails before host coercion', () => {
  assert.throws(() => smallInteger(1, 'double'), {name: 'InvalidProgramException'});
  assert.throws(() => smallInteger(1.5, 'byte'), {name: 'InvalidProgramException'});
});
