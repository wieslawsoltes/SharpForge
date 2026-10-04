import test from 'node:test';
import assert from 'node:assert/strict';
import {float} from '@sharpforge/bytecode';
import {typedFloatArray, floatSlots, floatSlotRoot, FloatSlotTag} from '../packages/runtime/src/execution/typed-stack.js';
import {copyExecution} from '../packages/runtime/src/snapshot.js';

test('typed float arrays preserve normal reads, descriptors, iteration, mutation and holes', () => {
  const values = typedFloatArray([], 8);
  const slots = floatSlots(values);
  slots.pushFloat(-0, FloatSlotTag.r4);
  slots.pushFloat(NaN, FloatSlotTag.r8);
  assert(Array.isArray(values));
  assert.equal(values.length, 2);
  assert.equal(floatSlotRoot(values, 0), undefined);
  assert.equal(slots.materializations, 0);
  assert(Object.is(values[0].value, -0));
  assert(Number.isNaN(Object.getOwnPropertyDescriptor(values, '1').value.value));
  assert.equal(values.at(0), values[0]);
  assert.deepEqual([...values], [float(-0, 'r4'), float(NaN)]);
  values.splice(0, 1, float(7));
  assert.equal(values.shift().value, 7);
  values.copyWithin(1, 0);
  delete values[0];
  assert.equal(0 in values, false);
  assert.equal(values[0], undefined);
  values.length = 0;
  values.push(42);
  assert.deepEqual(values, [42]);
  assert.equal(slots.tags[0], 0);
  assert.throws(() => { values.length = -1; }, RangeError);
  assert.deepEqual(values, [42]);
});

test('custom descriptors and frozen arrays materialize before applying native Array invariants', () => {
  const values = typedFloatArray([], 2);
  floatSlots(values).pushFloat(3.25, FloatSlotTag.r8);
  Object.defineProperty(values, '0', {value: float(9), writable: false, configurable: false});
  assert.equal(floatSlots(values), null);
  assert.throws(() => { values[0] = float(5); }, TypeError);
  assert.equal(values[0].value, 9);
  Object.freeze(values);
  assert(Object.isFrozen(values));
  assert.deepEqual([...values], [float(9)]);
  const frozen = typedFloatArray([], 1);
  floatSlots(frozen).pushFloat(-0, FloatSlotTag.r8);
  Object.freeze(frozen);
  assert(Object.is(frozen[0].value, -0));
  const saved = copyExecution({first: frozen, second: frozen});
  assert.equal(saved.first, saved.second);
  assert.notEqual(saved.first, frozen);
  assert.doesNotThrow(() => structuredClone(saved));
  assert(Object.is(saved.first[0].value, -0));
});

test('mutable, accessor and reference-containing lookalikes remain ordinary rooted values', () => {
  const reference = Object.freeze({h: 1, g: 1});
  let number = 1;
  const mutable = {float: 'r8', value: 1};
  const accessor = Object.freeze({float: 'r8', get value() { return number; }});
  const aggregate = Object.freeze({float: 'r8', value: 1, owner: reference});
  const values = typedFloatArray([mutable, accessor, aggregate], 3);
  mutable.value = 2;
  number = 3;
  assert.equal(values[0].value, 2);
  assert.equal(values[1].value, 3);
  assert.equal(floatSlotRoot(values, 2).owner, reference);
  assert.deepEqual([...floatSlots(values).tags], [0, 0, 0]);
});
