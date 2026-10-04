import test from 'node:test';
import assert from 'node:assert/strict';
import {float} from '@sharpforge/bytecode';
import {FloatSlotTag, typedFloatArray, floatSlots, floatSlotRoot} from '../packages/runtime/src/execution/typed-stack.js';

function compare(array, reference) {
  assert.equal(Array.isArray(array), true);
  assert.equal(array.length, reference.length);
  assert.deepEqual(Reflect.ownKeys(array), Reflect.ownKeys(reference));
  assert.deepEqual(Object.getOwnPropertyDescriptors(array), Object.getOwnPropertyDescriptors(reference));
  assert.deepEqual(array.slice(), reference.slice());
  assert.deepEqual([...array], [...reference]);
  for (let index = 0; index < reference.length + 2; index++) {
    assert.equal(index in array, index in reference);
    assert.deepEqual(array[index], reference[index]);
  }
}

test('private stack retains its bounded high-water storage while public pops clear every root plane', () => {
  const array = typedFloatArray([], 8, true);
  const slots = floatSlots(array);
  const owner = {h: 17};
  array.push(owner, float(2.5), 3n);
  assert.equal(slots.values.length, 3);
  array.length = 0;
  assert.equal(slots.values.length, 3, 'shrinking the public stack retains its backing storage');
  compare(array, []);
  for (let index = 0; index < 3; index++) {
    assert.equal(floatSlotRoot(array, index), undefined);
    assert.equal(slots.tags[index], 0);
    assert.equal(slots.present[index], 0);
    assert.equal(slots.materialized[index], undefined);
  }
  const materializations = slots.materializations;
  for (let index = 0; index < 1000; index++) {
    slots.pushFloat(index + 0.25, FloatSlotTag.r8);
    assert.equal(slots.popNumber(), index + 0.25);
    assert.equal(array.length, 0);
    assert.equal(slots.values.length, 3);
  }
  assert.equal(slots.materializations, materializations);
});

test('logical holes, deletes, growth and ordinary Array operations match the reference', () => {
  const array = typedFloatArray([], 16, true);
  const reference = [];
  const changes = [
    values => { values.length = 6; },
    values => { values[3] = float(-0); values[5] = 13n; },
    values => { delete values[3]; },
    values => { values.unshift(float(NaN)); },
    values => { values.splice(2, 1, 'plain', float(Infinity)); },
    values => { values.reverse(); },
    values => { values.length = 1; },
    values => { values.length = 8; },
    values => { values.fill(float(1.5), 3, 6); },
    values => { values.copyWithin(0, 3, 6); },
    values => { values.pop(); }
  ];
  for (const change of changes) {
    change(array);
    change(reference);
    compare(array, reference);
  }
  assert(floatSlots(array), 'ordinary Array operations retain the typed representation');
});

test('capacity overflow and host descriptors materialize the complete ordinary Array', () => {
  for (const customize of [
    values => { values[7] = float(7); },
    values => { values.length = 8; },
    values => { Object.defineProperty(values, '1', {value: float(9), writable: false}); },
    values => { Object.preventExtensions(values); },
    values => { Object.seal(values); },
    values => { Object.freeze(values); },
    values => { values.note = 'host'; },
    values => { Object.setPrototypeOf(values, Array.prototype); }
  ]) {
    const array = typedFloatArray([float(1), float(2), float(3)], 4);
    const reference = [float(1), float(2), float(3)];
    array.length = reference.length = 2;
    delete array[0];
    delete reference[0];
    customize(array);
    customize(reference);
    assert.equal(floatSlots(array), null);
    compare(array, reference);
    assert.equal(Object.isExtensible(array), Object.isExtensible(reference));
    assert.equal(Object.isSealed(array), Object.isSealed(reference));
    assert.equal(Object.isFrozen(array), Object.isFrozen(reference));
  }
});

test('invalid and coercible Array lengths preserve native errors and conversion side effects', () => {
  for (const length of [-1, 1.5, NaN, Infinity, 0x100000000, 1n, Symbol('length')]) {
    const array = typedFloatArray([float(1)], 4);
    const reference = [float(1)];
    let expected;
    try { reference.length = length; } catch (error) { expected = error; }
    assert(expected);
    assert.throws(() => { array.length = length; }, {name: expected.name});
    compare(array, reference);
  }
  for (const makeLength of [() => '3', () => ({valueOf() { this.calls++; return this.calls === 1 ? 2 : 3; }, calls: 0})]) {
    const array = typedFloatArray([float(1)], 4);
    const reference = [float(1)];
    const actualLength = makeLength();
    const expectedLength = makeLength();
    let expected;
    try { reference.length = expectedLength; } catch (error) { expected = error; }
    if (expected) assert.throws(() => { array.length = actualLength; }, {name: expected.name});
    else array.length = actualLength;
    assert.equal(actualLength.calls, expectedLength.calls);
    compare(array, reference);
  }
});
