import test from 'node:test';
import assert from 'node:assert/strict';
import {float, int64Binary, int64Compare} from '@sharpforge/bytecode';
import {copyExecution} from '../packages/runtime/src/snapshot.js';
import {smallLongNumber, smallLongOperation, compareSmallLong} from '../packages/runtime/src/execution/int64-fast.js';
import {typedFloatArray, floatSlots, floatSlotRoot, SmallLongSlotTag} from '../packages/runtime/src/execution/typed-stack.js';

const maximum = Number.MAX_SAFE_INTEGER;
const minimum = -maximum;

test('safe Int64 operations match exact BigInt and decline rounded or unsigned-negative results', () => {
  const bounds = [minimum, minimum + 1, -2147483649, -1, 0, 1, 2147483648, maximum - 1, maximum];
  let seed = 0x614d919483n;
  const next = () => {
    seed = BigInt.asIntN(64, seed * 6364136223846793005n + 1442695040888963407n);
    return Number(seed % BigInt(maximum));
  };
  for (const name of ['add', 'sub', 'mul', 'add.ovf', 'sub.ovf', 'mul.ovf', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un']) {
    const operation = smallLongOperation(name);
    const check = (left, right) => {
      const actual = operation(left, right);
      if (actual !== undefined) {
        assert(Number.isSafeInteger(actual));
        assert.equal(BigInt(actual), int64Binary(name, BigInt(left), BigInt(right)), `${name}: ${left}, ${right}`);
      }
    };
    for (const left of bounds) for (const right of bounds) check(left, right);
    for (let index = 0; index < 1024; index++) check(next(), next());
  }
  assert.equal(smallLongOperation('add')(maximum, 2), undefined);
  assert.equal(smallLongOperation('sub')(minimum, 2), undefined);
  assert.equal(smallLongOperation('mul')(maximum, 3), undefined);
  assert.equal(smallLongOperation('mul')(maximum, 0), 0);
  assert.equal(smallLongOperation('sub.ovf.un')(0, 1), undefined);
  assert.equal(smallLongOperation('add.ovf.un')(-1, 0), undefined);
  for (const name of ['shl', 'shr', 'and', 'or', 'xor']) assert.equal(smallLongOperation(name), null);
  for (const left of bounds) for (const right of bounds) for (const unsigned of [false, true]) {
    assert.equal(compareSmallLong(left, right, unsigned), int64Compare(BigInt(left), BigInt(right), unsigned));
  }
  assert.equal(smallLongNumber(BigInt(maximum)), maximum);
  assert.equal(smallLongNumber(BigInt(minimum)), minimum);
  assert.equal(smallLongNumber(BigInt(maximum) + 1n), undefined);
  assert.equal(smallLongNumber(1), undefined);
});

test('private long lanes retain BigInt Array reads, ordinary Number writes and float carriers', () => {
  const floating = float(1.25);
  const array = typedFloatArray([1n, -2n, floating, 3, 1n << 63n], 8, true);
  const slots = floatSlots(array);
  assert(Array.isArray(array));
  assert.equal(slots.tags[0], SmallLongSlotTag);
  assert.equal(slots.numbers[1], -2);
  assert.deepEqual([...array], [1n, -2n, floating, 3, 1n << 63n]);
  assert.equal(array[2], floating);
  assert.equal(Object.getOwnPropertyDescriptor(array, '0').value, 1n);
  array[0] = 7;
  assert.equal(slots.tags[0], 0);
  assert.equal(array[0], 7);
  array[0] = 7n;
  assert.equal(array.pop(), 1n << 63n);
  assert.deepEqual(array.splice(1, 1, 9n), [-2n]);
  assert.deepEqual(array.slice(), [7n, 9n, floating, 3]);
  const reference = {h: 7, g: 1};
  array[0] = reference;
  assert.equal(floatSlotRoot(array, 0), reference);
  slots.setLong(1, 11);
  assert.equal(floatSlotRoot(array, 1), undefined);
  assert.equal(array[1], 11n);
  array.length = 0;
  assert.equal(slots.tags.some(Boolean), false);
  assert.equal(slots.numbers.some(Boolean), false);
});

test('descriptors, sealing, freezing and prototype edits disable raw storage without leaking Numbers', () => {
  for (const edit of [array => Object.freeze(array), array => Object.seal(array),
    array => Object.defineProperty(array, '0', {value: 5n, writable: false}),
    array => Object.setPrototypeOf(array, Object.create(Array.prototype))]) {
    const array = typedFloatArray([1n, -2n], 2, true);
    edit(array);
    assert.equal(floatSlots(array), null);
    assert.equal(typeof array[0], 'bigint');
    assert.equal(array[1], -2n);
    assert.equal(Object.getOwnPropertyDescriptor(array, '1').value, -2n);
  }
  const array = typedFloatArray([3n], 1, true);
  Object.defineProperty(array, '0', {get: () => 17n});
  assert.equal(array[0], 17n);
  assert.equal(floatSlots(array), null);
});

test('snapshot copies preserve aliases, frozen storage and ordinary BigInt array reads', () => {
  for (const freeze of [false, true]) {
    const array = typedFloatArray([3n, float(-0)], 2, true);
    if (freeze) Object.freeze(array);
    const saved = copyExecution({first: array, second: array});
    assert.notEqual(saved.first, array);
    assert.equal(saved.first, saved.second);
    assert.equal(floatSlots(saved.first), null);
    assert.equal(saved.first[0], 3n);
    assert(Object.is(saved.first[1].value, -0));
    assert.equal(Object.isFrozen(saved.first), freeze);
    if (freeze) assert.throws(() => { saved.first[0] = 4n; }, TypeError);
    else {
      saved.first[0] = 4n;
      assert.equal(saved.second[0], 4n);
    }
    assert.equal(array[0], 3n);
  }
  const existing = typedFloatArray([8n, float(0.5)], 2);
  const slots = floatSlots(existing);
  assert.equal(slots.tags[0], 0);
  assert.equal(typedFloatArray(existing, 2, true), existing);
  assert.equal(slots.tags[0], SmallLongSlotTag);
  assert.equal(existing[0], 8n);
  assert.equal(existing[1].value, 0.5);
});
