import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/heap.js';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {nullableValue, valueDefault, boxValue, unboxValue} from '../packages/runtime/src/execution/value-types.js';
import {valueLayout} from '../packages/runtime/src/execution/value-layout.js';

function context() {
  const registry = new MethodTableRegistry({nativeIntBits: 64});
  registry.define({name: 'E', base: 'System.Enum', flags: {enum: true, valueType: true}, enumUnderlyingType: 'int'});
  registry.define({name: 'Point', base: 'System.ValueType', flags: {valueType: true}, fields: [
    {name: 'Byte', type: 'byte'}, {name: 'X', type: 'int'}, {name: 'Y', type: 'short'}
  ]});
  return {heap: new ManagedHeap({methodTables: registry}), options: {nativeIntBits: 64}, snapshotOwner: Object.freeze({})};
}

test('Nullable boxes to null or a copy of T, and unbox.any reconstructs Nullable', () => {
  const vm = context();
  const empty = valueDefault(vm, 'int?');
  assert.equal(boxValue(vm, empty, 'int?'), null);
  const full = nullableValue(vm, 'int?', 12);
  const reference = boxValue(vm, full, 'int?');
  assert.equal(vm.heap.get(reference).methodTable.name, 'System.Int32');
  assert.equal(unboxValue(vm, reference, 'int?').value, 12);
  assert.equal(unboxValue(vm, null, 'int?').hasValue, false);
  assert.throws(() => unboxValue(vm, reference, 'long'), {name: 'InvalidCastException'});
});

test('enum-underlying unbox compatibility preserves enum type headers', () => {
  const vm = context();
  const reference = boxValue(vm, 7, 'E');
  assert.equal(unboxValue(vm, reference, 'int'), 7);
  assert.equal(vm.heap.get(reference).methodTable.name, 'E');
  assert.equal(unboxValue(vm, boxValue(vm, 8, 'int'), 'E'), 8);
  assert.throws(() => unboxValue(vm, reference, 'long'), {name: 'InvalidCastException'});
});

test('sequential structs use alignment and native ABI widths, not slot count', () => {
  const vm = context();
  assert.deepEqual(valueLayout(vm, 'Point').offsets, [0, 4, 8]);
  assert.equal(valueLayout(vm, 'Point').size, 12);
  assert.equal(valueLayout(vm, 'nint').size, 8);
  assert.equal(valueLayout(vm, 'int?').size, 8);
});
