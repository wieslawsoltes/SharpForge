import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap, HostHandleKind, ManagedGCHandle, GCHandleType, RootCategory} from '../packages/runtime/src/index.js';

test('A06 host handles retain legacy weak options and isolate heap owners', () => {
  const heap = new ManagedHeap();
  const foreign = new ManagedHeap();
  const target = heap.object('HandleTarget', []);
  const strong = heap.createHandle(target);
  const weak = heap.createHandle(target, {weak: true});
  assert.equal(foreign.getHandle(strong), null);
  assert.equal(foreign.releaseHandle(strong), false);
  assert.equal(heap.getHandle(weak), target);
  assert.throws(() => heap.createHandle(42, {weak: true}), TypeError);
  assert.throws(() => heap.createHandle(null, {weak: true}), TypeError);
  heap.collect();
  assert.equal(heap.getHandle(weak), target);
  assert.equal(heap.releaseHandle(strong), true);
  assert.equal(heap.releaseHandle(strong), false);
  heap.collect();
  assert.equal(heap.getHandle(weak), null);
  assert.equal(heap.stats.hostStrongHandles, 0);
  heap.releaseHandle(weak);
  assert.equal(heap.stats.hostWeakHandles, 0);
});

test('A06 typed owner teardown releases only the selected owner and reports creation sites', () => {
  const heap = new ManagedHeap({debugHandles: true});
  const left = heap.object('Left', []);
  const right = heap.object('Right', []);
  const leftHandle = heap.lifetime.createHandle(left, {owner: 'window:left'});
  const rightHandle = heap.lifetime.createHandle(right, {owner: 'window:right', kind: HostHandleKind.Pinned});
  const leaks = heap.lifetime.leakReport();
  assert.equal(leaks.handles.length, 2);
  assert.equal(leaks.handles[0].owner, 'window:left');
  assert.match(leaks.handles[0].creationStack, /Host handle created/);
  assert.equal(heap.lifetime.releaseOwner('window:left').handles, 1);
  assert.equal(heap.getHandle(leftHandle), null);
  assert.equal(heap.getHandle(rightHandle), right);
  assert.equal(heap.lifetime.isPinned(right), true);
  heap.collect();
  assert.throws(() => heap.get(left), {name: 'InvalidReferenceException'});
  assert.equal(heap.lifetime.releaseOwner('window:right').handles, 1);
  assert.equal(heap.lifetime.isPinned(right), false);
  assert.deepEqual(heap.lifetime.leakReport(), {handles: [], pins: [], resources: []});
});

test('A06 host root categories survive rewind independently of owner teardown tags', () => {
  const heap = new ManagedHeap();
  const ordinary = heap.object('OrdinaryRoot', []);
  const inspected = heap.object('DebuggerRoot', []);
  const handle = heap.createHandle(ordinary);
  const debuggerHandle = heap.createHandle(inspected, {category: RootCategory.Debugger, owner: 'debugger-stop'});
  heap.createHandle(inspected, {weak: true, category: RootCategory.Interop});
  const roots = [];
  heap.lifetime.hostHandles.visitStrongRoots((reference, category) => roots.push({reference, category}));
  assert.deepEqual(roots, [
    {reference: ordinary, category: RootCategory.Handle},
    {reference: inspected, category: RootCategory.Debugger}
  ]);
  assert.match(heap.retentionPath(inspected).path[0].label, /debugger/);
  const snapshot = heap.snapshot();
  assert.equal(heap.lifetime.releaseOwner('debugger-stop').handles, 1);
  heap.collect();
  assert.equal(heap.tryGet(inspected), null);
  heap.restore(snapshot);
  assert.equal(heap.getHandle(debuggerHandle), inspected);
  assert.match(heap.retentionPath(inspected).path[0].label, /debugger/);
  assert.equal(heap.lifetime.releaseOwner('debugger-stop').handles, 1);
  assert.equal(heap.getHandle(handle), ordinary);
});

test('A06 invalid host root categories fail before publishing handles or pin leases', () => {
  const heap = new ManagedHeap();
  const target = heap.array('byte', 4);
  const nextId = heap.nextHandleId;
  assert.throws(() => heap.createHandle(target, {kind: HostHandleKind.Pinned, category: 'invalid'}), TypeError);
  assert.equal(heap.nextHandleId, nextId);
  assert.equal(heap.handles.size, 0);
  assert.equal(heap.get(target).pinCount, 0);
  assert.equal(heap.lifetime.pinning.leases.size, 0);
});

test('A06 GCHandle kinds preserve their typed retention and validate release', () => {
  const heap = new ManagedHeap();
  const first = heap.object('First', []);
  const second = heap.object('Second', []);
  const normal = ManagedGCHandle.alloc(heap, first);
  const weak = ManagedGCHandle.alloc(heap, first, GCHandleType.Weak);
  const long = ManagedGCHandle.alloc(heap, first, GCHandleType.WeakTrackResurrection);
  const pinned = ManagedGCHandle.alloc(heap, second, GCHandleType.Pinned);
  assert.equal(normal.isAllocated, true);
  assert.equal(pinned.target, second);
  const address = pinned.addrOfPinnedObject();
  assert.equal(heap.lifetime.addresses.resolve(address).reference, second);
  assert.throws(() => normal.addrOfPinnedObject(), {name: 'InvalidOperationException'});
  normal.free();
  heap.collect();
  assert.equal(weak.target, null);
  assert.equal(long.target, null);
  assert.equal(pinned.target, second);
  pinned.free();
  assert.throws(() => heap.lifetime.addresses.resolve(address), {name: 'InvalidAddressException'});
  assert.equal(pinned.isAllocated, false);
  assert.throws(() => pinned.free(), {name: 'InvalidOperationException'});
  assert.throws(() => pinned.target, {name: 'InvalidOperationException'});
  assert.throws(() => { pinned.target = first; }, {name: 'InvalidOperationException'});
  weak.free();
  long.free();
});

test('A06 GCHandle tokens roundtrip within one owner and remain invalid after free', () => {
  const heap = new ManagedHeap();
  const reference = heap.object('TokenTarget', []);
  const handle = ManagedGCHandle.alloc(heap, reference);
  const pointer = handle.toIntPtr();
  const alias = ManagedGCHandle.fromIntPtr(heap, pointer);
  assert.equal(alias.toIntPtr(), pointer);
  assert.equal(alias.target, reference);
  assert.throws(() => ManagedGCHandle.fromIntPtr(new ManagedHeap(), pointer), {name: 'InvalidOperationException'});
  assert.throws(() => ManagedGCHandle.fromIntPtr(heap, pointer.value), {name: 'InvalidOperationException'});
  alias.free();
  assert.equal(handle.isAllocated, false);
  assert.throws(() => ManagedGCHandle.fromIntPtr(heap, pointer), {name: 'InvalidOperationException'});
  assert.throws(() => ManagedGCHandle.alloc(heap, reference, 4), RangeError);
  assert.throws(() => ManagedGCHandle.alloc(heap, reference, 1.5), RangeError);
});

test('A06 setting a pinned target acquires the replacement before retiring the old address', () => {
  const heap = new ManagedHeap();
  const first = heap.object('First', []);
  const next = heap.object('Next', []);
  const handle = ManagedGCHandle.alloc(heap, first, GCHandleType.Pinned);
  const oldAddress = handle.addrOfPinnedObject();
  handle.target = next;
  assert.equal(heap.lifetime.isPinned(first), false);
  assert.equal(heap.lifetime.isPinned(next), true);
  assert.throws(() => heap.lifetime.addresses.resolve(oldAddress), {name: 'InvalidAddressException'});
  handle.target = null;
  assert.equal(handle.addrOfPinnedObject(), 0n);
  assert.equal(heap.lifetime.isPinned(next), false);
  handle.free();
});

test('A06 stale weak identities do not bind to recycled object slots', () => {
  const heap = new ManagedHeap();
  const first = heap.object('BeforeRecycle', []);
  const weak = heap.createHandle(first, {weak: true});
  heap.collect();
  const second = heap.object('AfterRecycle', []);
  assert.equal(second.h, first.h);
  assert.notEqual(second.g, first.g);
  assert.equal(heap.getHandle(weak), null);
  assert.throws(() => heap.lifetime.setHandle(weak, first), {name: 'InvalidReferenceException'});
  heap.lifetime.setHandle(weak, second);
  assert.equal(heap.getHandle(weak), second);
});
