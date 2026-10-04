import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {nativePointerConversion} from '../packages/runtime/src/execution/native-pointer-conversion.js';
import {createArray, arrayAddress} from '../packages/runtime/src/execution/arrays.js';

test('CIL conv.u over an unmanaged local produces a frame-scoped pointer with mutable writeback', () => {
  const assembly = genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', locals: ['int', 'int*'],
    body(writer) {
      writer.op('ldc.i4', 17).op('stloc.0').op('ldloca.s', 0).op('conv.u').op('stloc.1');
      writer.op('ldloc.1').op('ldc.i4', 41).op('stind.i4').op('ldloc.0').op('ret');
    }}]}]);
  const vm = new CilVirtualMachine(assembly);
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(vm.returnValue, 41);
  } finally { vm.stop(); }
});

test('native conversion rejects managed reference slots and unpinned array interiors', () => {
  const assembly = genericCallFixture([{name: 'Program', methods: [{name: 'Main', locals: ['object'], body: writer => writer.op('ret')}]}]);
  const vm = new CilVirtualMachine(assembly);
  try {
    assert.throws(() => nativePointerConversion(vm, vm.address('local', 0)), {name: 'NotSupportedException'});
    const array = createArray(vm, 'int', [2]);
    assert.throws(() => nativePointerConversion(vm, arrayAddress(vm, array, [0])), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});
