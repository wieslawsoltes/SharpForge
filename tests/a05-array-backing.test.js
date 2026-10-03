import test from 'node:test';
import assert from 'node:assert/strict';
import {MethodTableRegistry} from '../packages/runtime/src/execution/method-table.js';
import {
  primitiveArrayStorage, arrayStorageBytes, cloneArrayStorage, storageRead, storageWrite, rawArrayBytes
} from '../packages/runtime/src/execution/array-storage.js';
import {arrayAllocationLimit, arrayInteger} from '../packages/runtime/src/execution/array-limits.js';

test('primitive arrays have exact typed backing widths and independent copies', () => {
  const registry = new MethodTableRegistry({nativeIntBits: 64});
  for (const [name, constructor, width] of [
    ['byte', Uint8Array, 1], ['short', Int16Array, 2], ['int', Int32Array, 4],
    ['long', BigInt64Array, 8], ['float', Float32Array, 4], ['double', Float64Array, 8]
  ]) {
    const data = primitiveArrayStorage(registry.get(name), 7);
    assert.ok(data instanceof constructor);
    assert.equal(arrayStorageBytes(data), 7 * width);
    storageWrite(data, 1, name === 'long' ? 123n : 123);
    const saved = cloneArrayStorage(data);
    storageWrite(data, 1, name === 'long' ? 456n : 456);
    assert.equal(saved[1], name === 'long' ? 123n : 123);
  }
  const native = registry.get('nint');
  const data = primitiveArrayStorage(native, 1);
  storageWrite(data, 0, {nativeInt: 64, value: 9007199254740993n});
  assert.deepEqual(storageRead(data, 0, native), {nativeInt: 64, value: 9007199254740993n});
});

test('array capacity comes from element width and heap budget with an optional lower cap', () => {
  const registry = new MethodTableRegistry();
  const vm = {heap: {maxBytes: 32 * 1024 * 1024}, options: {}};
  assert.ok(arrayAllocationLimit(vm, registry.get('byte')) >= 4_000_000);
  assert.equal(arrayAllocationLimit(vm, registry.get('byte')), vm.heap.maxBytes - 32);
  vm.options.maxArrayLength = 100;
  assert.equal(arrayAllocationLimit(vm, registry.get('byte')), 100);
  assert.equal(arrayInteger(4_000_000n), 4_000_000);
  assert.throws(() => arrayInteger(9007199254740993n), {name: 'IndexOutOfRangeException'});
  assert.throws(() => rawArrayBytes([null]), /primitive typed array/);
});
