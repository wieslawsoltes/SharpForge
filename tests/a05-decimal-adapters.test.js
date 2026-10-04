import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {decimalParse, decimalBits, decimalIntrinsicDefinitions} from '@sharpforge/bytecode';
import {invokeDecimal} from '../packages/runtime/src/execution/decimal-intrinsics.js';
import {storage, binary} from '../packages/runtime/src/execution/numeric-ops.js';
import {formatSourceValue} from '../packages/runtime/src/value-formatting.js';

function host(cil) {
  const heap = new ManagedHeap(), slots = new Map();
  return {heap, ...(cil ? {inspector: {}} : {}), slots,
    dereference(address, write, value) {
      if (write) slots.set(address, value);
      return slots.get(address);
    }};
}
function descriptor(name, parameters, isStatic = true, returnType) {
  return decimalIntrinsicDefinitions.find(entry => entry.owner === 'System.Decimal' && entry.name === name &&
    entry.isStatic === isStatic && entry.parameters.join(',') === parameters.join(',') && (!returnType || entry.returnType === returnType));
}
for (const cil of [false, true]) test(`Decimal intrinsic adapter uses ${cil ? 'CIL' : 'source'} boolean values and exact out storage`, () => {
  const vm = host(cil), address = {byref: true};
  const call = descriptor('TryParse', ['string', 'System.Decimal&']);
  assert.equal(invokeDecimal(vm, call, [vm.heap.string('12.30'), address]).value, cil ? 1 : true);
  assert.deepEqual(decimalBits(vm.slots.get(address)), [1230, 0, 0, 131072]);
  assert.equal(invokeDecimal(vm, call, [vm.heap.string('bad'), address]).value, cil ? 0 : false);
  assert.deepEqual(decimalBits(vm.slots.get(address)), [0, 0, 0, 0]);
  const equals = descriptor('Equals', ['System.Decimal', 'System.Decimal']);
  assert.equal(invokeDecimal(vm, equals, [decimalParse('1.0'), decimalParse('1.00')]).value, cil ? 1 : true);
});
test('Decimal storage rejects implicit numeric coercion and CLI arithmetic rejects Decimal operands', () => {
  const value = decimalParse('1.10');
  assert.equal(storage(value, 'System.Decimal'), value);
  assert.equal(storage(value, 'decimal'), value);
  assert.throws(() => storage(1.1, 'System.Decimal'), {name: 'InvalidProgramException'});
  assert.throws(() => storage(value, 'double'), {name: 'InvalidProgramException'});
  assert.throws(() => binary('add', value, value), {name: 'InvalidProgramException'});
  assert.equal(formatSourceValue(host(false), value), '1.10');
});
test('Decimal object Equals checks actual value kind and CompareTo rejects incompatible objects', () => {
  const vm = host(false), value = decimalParse('1');
  assert.equal(invokeDecimal(vm, descriptor('Equals', ['object'], false), [value, 1]).value, false);
  assert.throws(() => invokeDecimal(vm, descriptor('CompareTo', ['object'], false), [value, 1]), {name: 'ArgumentException'});
  assert.equal(invokeDecimal(vm, descriptor('CompareTo', ['object'], false), [value, null]).value, 1);
});
