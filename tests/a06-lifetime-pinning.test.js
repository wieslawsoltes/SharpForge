import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap, RootCategory, createInteriorReference, resolveInteriorReference} from '../packages/runtime/src/index.js';

test('A06 simultaneous pins share an address until the last lease releases it', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('int', 4);
  const first = heap.lifetime.pin(reference, {owner: 'ffi'});
  const second = heap.lifetime.pin(reference, {owner: 'debugger'});
  assert.equal(first.address, second.address);
  assert.equal(heap.get(reference).pinCount, 2);
  const offset = first.address.add(4);
  assert.equal(heap.lifetime.addresses.resolve(offset).byteOffset, 4);
  heap.collect();
  assert.equal(heap.lifetime.addressOfPinnedObject(reference), first.address);
  assert.equal(first.dispose(), true);
  assert.equal(first.dispose(), false);
  assert.equal(heap.lifetime.addresses.resolve(first.address).reference, reference);
  assert.equal(second.dispose(), true);
  assert.equal(heap.get(reference).pinCount, 0);
  assert.throws(() => heap.lifetime.addresses.resolve(offset), {name: 'InvalidAddressException'});
  const next = heap.lifetime.pin(reference);
  assert.ok(next.address.value > first.address.value);
  next.dispose();
});

test('A06 counted pin leases publish the stable pinned root category until the last release', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('byte', 8);
  const first = heap.lifetime.pin(reference, {owner: 'ffi'});
  const second = heap.lifetime.pin(reference, {owner: 'debugger'});
  const roots = () => {
    const found = [];
    heap.lifetime.pinning.visitRoots((value, category) => found.push({value, category}));
    return found;
  };
  assert.deepEqual(roots(), [{value: reference, category: RootCategory.Pinned}]);
  first.dispose();
  assert.deepEqual(roots(), [{value: reference, category: RootCategory.Pinned}]);
  second.dispose();
  assert.deepEqual(roots(), []);
});

test('A06 lifetime-pinned arrays retain one address across temporary leases and compaction', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('byte', 4, {pinned: true});
  const root = heap.createHandle(reference);
  const address = heap.lifetime.addressOfPinnedObject(reference);
  const initial = {...heap.get(reference).storage};
  assert.equal(heap.get(reference).pinCount, 0);
  for (let cycle = 0; cycle < 2; cycle++) {
    const lease = heap.lifetime.pin(reference);
    assert.equal(lease.address, address);
    lease.dispose();
    assert.equal(heap.get(reference).pinCount, 0);
    heap.collect([], {generation: 2, compacting: true});
    assert.equal(heap.lifetime.addressOfPinnedObject(reference), address);
    assert.equal(heap.lifetime.addresses.resolve(address).reference, reference);
    assert.equal(heap.get(reference).storage.offset, initial.offset);
    assert.equal(heap.get(reference).storage.arenaId, initial.arenaId);
  }
  heap.releaseHandle(root);
  heap.collect();
  assert.equal(heap.tryGet(reference), null);
  assert.throws(() => heap.lifetime.addresses.resolve(address), {name: 'InvalidAddressException'});
  const replacement = heap.array('byte', 4, {pinned: true});
  assert(heap.lifetime.addressOfPinnedObject(replacement).value > address.value);
});

test('A06 a POH address first acquired through a lease survives its disposal without rooting the array', () => {
  const heap = new ManagedHeap();
  const reference = heap.array('int', 2, {pinned: true});
  const lease = heap.lifetime.pin(reference);
  lease.dispose();
  assert.equal(heap.lifetime.addressOfPinnedObject(reference), lease.address);
  const roots = [];
  heap.lifetime.visitStrongRoots(value => roots.push(value));
  assert.deepEqual(roots, []);
  heap.collect();
  assert.equal(heap.tryGet(reference), null);
  assert.throws(() => heap.lifetime.addresses.resolve(lease.address), {name: 'InvalidAddressException'});
});

test('A06 pinned objects exclude relocation while adjacent unpinned storage compacts', () => {
  const heap = new ManagedHeap();
  const pinned = heap.array('int', 16);
  heap.array('int', 16);
  const movable = heap.array('int', 16);
  const pin = heap.lifetime.pin(pinned);
  const root = heap.createHandle(movable);
  const beforePinned = {...heap.get(pinned).storage};
  const beforeMovable = {...heap.get(movable).storage};
  heap.collect([], {generation: 2, compacting: true});
  assert.equal(heap.get(pinned).storage.offset, beforePinned.offset);
  assert.equal(heap.get(pinned).storage.arenaId, beforePinned.arenaId);
  const afterMovable = heap.get(movable).storage;
  assert.ok(afterMovable.offset !== beforeMovable.offset || afterMovable.arenaId !== beforeMovable.arenaId);
  assert.equal(heap.lifetime.addressOfPinnedObject(pinned), pin.address);
  heap.releaseHandle(root);
  pin.dispose();
});

test('A06 address resolution rejects foreign owners, out-of-range access and stale pins', () => {
  const heap = new ManagedHeap();
  const other = new ManagedHeap();
  const reference = heap.array('byte', 4);
  const pin = heap.lifetime.pin(reference);
  assert.throws(() => other.lifetime.addresses.resolve(pin.address), {name: 'InvalidAddressException'});
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address.value), {name: 'InvalidAddressException'});
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address.add(-1)), {name: 'InvalidAddressException'});
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address.add(heap.get(reference).size)), {name: 'InvalidAddressException'});
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address, {byteLength: -1}), RangeError);
  pin.dispose();
  heap.collect();
  heap.array('byte', 4);
  assert.throws(() => heap.lifetime.addresses.resolve(pin.address), {name: 'InvalidAddressException'});
});

test('A06 interior references keep their owner alive and use relocated current storage', () => {
  const heap = new ManagedHeap();
  heap.array('int', 16);
  const array = heap.array('int', 4);
  const address = createInteriorReference(heap, array, [2]);
  const root = heap.createHandle(address);
  const before = heap.get(array).storage.offset;
  heap.collect([], {generation: 2, compacting: true});
  assert.notEqual(heap.get(array).storage.offset, before);
  assert.equal(heap.lifetime.isPinned(array), false);
  resolveInteriorReference(heap, address, {write: true, value: 42});
  assert.equal(heap.get(array).data[2], 42);
  assert.equal(resolveInteriorReference(heap, address), 42);
  heap.releaseHandle(root);
  heap.collect();
  assert.throws(() => resolveInteriorReference(heap, address), {name: 'InvalidReferenceException'});
});

test('A06 interior paths validate readonly, owner identity, bounds and reference boundaries', () => {
  const heap = new ManagedHeap();
  const other = new ManagedHeap();
  const reference = heap.object('InlineOwner', [[1, 2]]);
  const nested = createInteriorReference(heap, reference, [0, 1]);
  resolveInteriorReference(heap, nested, {write: true, value: 9});
  assert.equal(heap.get(reference).data[0][1], 9);
  const readOnly = createInteriorReference(heap, reference, [0, 0], {readOnly: true});
  assert.throws(() => resolveInteriorReference(heap, readOnly, {write: true, value: 2}), {name: 'InvalidOperationException'});
  assert.throws(() => resolveInteriorReference(other, nested), {name: 'InvalidProgramException'});
  assert.throws(() => createInteriorReference(heap, reference, []), RangeError);
  assert.throws(() => createInteriorReference(heap, reference, [-1]), RangeError);
  assert.throws(() => createInteriorReference(heap, reference, [2]), {name: 'IndexOutOfRangeException'});
  const child = heap.object('Child', [1]);
  const parent = heap.object('Parent', [child]);
  assert.throws(() => createInteriorReference(heap, parent, [0, 0]), {name: 'InvalidProgramException'});
});

test('A06 virtual address exhaustion is explicit and never wraps a token', () => {
  const heap = new ManagedHeap({maxVirtualAddress: 65568n});
  const reference = heap.object('TooLargeForAddressRange', []);
  assert.throws(() => heap.lifetime.pin(reference), {name: 'OutOfMemoryException'});
  assert.equal(heap.lifetime.isPinned(reference), false);
  assert.equal(heap.get(reference).pinCount, 0);
});
