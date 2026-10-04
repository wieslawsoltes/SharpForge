import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeInteger} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {comparePointers, pointerTruth} from '../packages/runtime/src/execution/pointer-comparison.js';
import {sourcePointerConvert} from '../packages/runtime/src/execution/source-pointer-ops.js';

const fixture = body => genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['int*'], body}]}]);

for (const bits of [32, 64]) {
  test(`native ${bits}-bit zero is a null capability without accepting another ABI or mutable carriers`, () => {
    const vm = new CilVirtualMachine(fixture(writer => writer.op('ldc.i4', 0).op('ret')), {nativeIntBits: bits});
    try {
      const zero = nativeInteger(0, bits);
      assert.equal(comparePointers(vm, null, zero, 'eq'), true);
      assert.equal(comparePointers(vm, zero, null, 'ne'), false);
      assert.equal(pointerTruth(vm, zero), false);
      assert.equal(sourcePointerConvert(vm, zero, 'int'), null);
      assert.equal(vm.compare(null, zero, 'eq'), true);
      assert.equal(vm.compare(zero, null, 'gt', true), false);
      for (const invalid of [nativeInteger(1, bits), nativeInteger(0, bits === 32 ? 64 : 32),
        {nativeInt: bits, value: bits === 32 ? 0 : 0n}]) {
        assert.equal(comparePointers(vm, null, invalid, 'eq'), false);
        assert.equal(vm.compare(null, invalid, 'eq'), false);
        assert.throws(() => sourcePointerConvert(vm, invalid, 'int'), {name: 'InvalidProgramException'});
      }
    } finally { vm.stop(); }
  });

  test(`CIL ${bits}-bit null pointer locals compare equally to conv.u zero in comparisons and branches`, () => {
    const bytes = fixture(writer => {
      writer.op('ldloc.0').op('ldc.i4', 0).op('conv.u').op('bne.un', 'unequal');
      writer.op('ldloc.0').op('ldc.i4', 0).op('conv.u').op('ceq').op('ret');
      writer.mark('unequal').op('ldc.i4', -1).op('ret');
    });
    const vm = new CilVirtualMachine(bytes, {nativeIntBits: bits});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(vm.returnValue, 1);
    } finally { vm.stop(); }
  });
}
