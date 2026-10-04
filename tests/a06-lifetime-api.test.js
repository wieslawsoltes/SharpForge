import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '../packages/runtime/src/index.js';
import {invokeLifetimeGC, resolveWeakTarget} from '../packages/runtime/src/gc/lifetime-api.js';

function makePlatform() {
  const heap = new ManagedHeap();
  const platform = {
    heap,
    native(value) { return value; },
    managed(value) { return value; },
    make(type, values = {}) {
      return heap.allocate('host', type, Object.entries(values).flatMap(([key, value]) => [key, value]));
    },
    get(reference, key) {
      const data = heap.get(reference).data;
      const index = data.indexOf(key);
      return index < 0 ? null : data[index + 1];
    },
    set(reference, key, value) {
      const data = heap.get(reference).data;
      const index = data.indexOf(key);
      if (index < 0) heap.replaceData(reference, [...data, key, value]);
      else heap.writeField(reference, index + 1, value);
    }
  };
  platform.vm = {
    dereference(address, write = false, value = null) {
      assert.equal(address.byref, true);
      if (write) address.container[address.index] = value;
      return address.container[address.index];
    }
  };
  return platform;
}

function invoke(platform, owner, name, args, kind = 'method') {
  const result = invokeLifetimeGC(platform, {owner, name, kind}, args);
  assert.equal(result.handled, true);
  return result.value;
}

test('A06 managed WeakReference wrappers contain only opaque weak-handle state', () => {
  const platform = makePlatform();
  const target = platform.heap.object('Target', []);
  const weak = invoke(platform, 'System.WeakReference', '.ctor', [target], 'constructor');
  platform.heap.createHandle(weak);
  assert.equal(resolveWeakTarget(platform, weak), target);
  assert.equal(platform.heap.get(weak).data.includes(target), false);
  platform.heap.collect();
  assert.equal(invoke(platform, 'System.WeakReference', 'get_IsAlive', [weak]), false);
  assert.equal(invoke(platform, 'System.WeakReference', 'get_Target', [weak]), null);
});

test('A06 WeakReference generic out parameters support both source cells and CIL addresses', () => {
  const platform = makePlatform();
  const type = 'System.WeakReference`1<System.Object>';
  const target = platform.heap.object('Target', []);
  const weak = invoke(platform, type, '.ctor', [target], 'constructor');
  const cell = platform.heap.object('OutCell', [null]);
  assert.equal(invoke(platform, type, '$TryGetTargetCell', [weak, cell]), true);
  assert.equal(platform.heap.get(cell).data[0], target);
  const container = [null];
  const address = Object.freeze({byref: true, container, index: 0});
  assert.equal(invoke(platform, type, 'TryGetTarget', [weak, address]), true);
  assert.equal(container[0], target);
  invoke(platform, type, 'SetTarget', [weak, null]);
  assert.equal(invoke(platform, type, 'TryGetTarget', [weak, address]), false);
  assert.equal(container[0], null);
});

test('A06 managed GCHandle values support byref receivers, opaque IntPtr and explicit Free', () => {
  const platform = makePlatform();
  const owner = 'System.Runtime.InteropServices.GCHandle';
  const target = platform.heap.object('Target', []);
  const wrapper = invoke(platform, owner, 'Alloc', [target, 2]);
  const container = [wrapper];
  const receiver = Object.freeze({byref: true, container, index: 0});
  const pointer = invoke(platform, owner, 'ToIntPtr', [wrapper]);
  const alias = invoke(platform, owner, 'FromIntPtr', [pointer]);
  assert.equal(invoke(platform, owner, 'get_Target', [receiver]), target);
  assert.equal(invoke(platform, owner, 'get_Target', [alias]), target);
  invoke(platform, owner, 'Free', [receiver]);
  assert.equal(invoke(platform, owner, 'get_IsAllocated', [alias]), false);
  assert.throws(() => invoke(platform, owner, 'Free', [alias]), {name: 'InvalidOperationException'});
});

test('A06 managed conditional tables retain values only through live keys and table owners', () => {
  const platform = makePlatform();
  const owner = 'System.Runtime.CompilerServices.ConditionalWeakTable`2<System.Object,System.Object>';
  const table = invoke(platform, owner, '.ctor', [], 'constructor');
  const key = platform.heap.object('Key', []);
  const value = platform.heap.object('Value', []);
  const out = platform.heap.object('OutCell', [null]);
  invoke(platform, owner, 'Add', [table, key, value]);
  assert.equal(invoke(platform, owner, '$TryGetValueCell', [table, key, out]), true);
  assert.equal(platform.heap.get(out).data[0], value);
  const tableRoot = platform.heap.createHandle(table);
  platform.heap.createHandle(key);
  platform.heap.collect();
  assert.equal(platform.heap.get(value).type, 'Value');
  platform.heap.releaseHandle(tableRoot);
  platform.heap.collect();
  assert.throws(() => platform.heap.get(value), {name: 'InvalidReferenceException'});
});

test('A06 managed CWT callback aliases delegate through the runtime callback executor', () => {
  const platform = makePlatform();
  const owner = 'System.Runtime.CompilerServices.ConditionalWeakTable`2<System.Object,System.Object>';
  const table = invoke(platform, owner, '.ctor', [], 'constructor');
  const key = platform.heap.object('Key', []);
  const value = platform.heap.object('Value', []);
  const callback = platform.heap.object('ManagedDelegate', []);
  let calls = 0;
  platform.heap.lifetime.dependentValueFactory = (receivedPlatform, receivedCallback) => receivedKey => {
    assert.equal(receivedPlatform, platform);
    assert.equal(receivedCallback, callback);
    assert.equal(receivedKey, key);
    calls++;
    return value;
  };
  assert.equal(invoke(platform, owner, '$GetValueDelegate', [table, key, callback]), value);
  assert.equal(invoke(platform, owner, '$GetValueDelegate', [table, key, callback]), value);
  assert.equal(calls, 1);
});

test('A06 managed finalizer waiting delegates to the cooperative runtime hook', () => {
  const platform = makePlatform();
  const suspension = Object.freeze({suspended: true});
  platform.heap.lifetime.waitForPendingFinalizersHook = () => suspension;
  assert.equal(invoke(platform, 'System.GC', 'WaitForPendingFinalizers', []), suspension);
  assert.throws(() => invoke(platform, 'System.GC', 'SuppressFinalize', [null]), {name: 'ArgumentNullException'});
});

test('A06 managed SafeHandle base methods retain derived fields and execute critical release', () => {
  const platform = makePlatform();
  const owner = 'System.Runtime.InteropServices.SafeHandle';
  const reference = platform.heap.object('DerivedSafeHandle', [11]);
  const calls = [];
  platform.heap.lifetime.managedInstanceInvoker = (receiver, name) => {
    assert.equal(receiver, reference);
    if (name === 'get_IsInvalid') return false;
    calls.push(name);
    return true;
  };
  invoke(platform, owner, '.ctor', [reference, 0n, true], 'constructor');
  invoke(platform, owner, 'SetHandle', [reference, 42n]);
  assert.deepEqual([...platform.heap.get(reference).data], [11]);
  assert.equal(invoke(platform, owner, 'DangerousGetHandle', [reference]), 42n);
  const success = platform.heap.object('SuccessCell', [false]);
  invoke(platform, owner, '$DangerousAddRefCell', [reference, success]);
  assert.equal(platform.heap.get(success).data[0], true);
  invoke(platform, owner, 'Dispose', [reference]);
  assert.equal(invoke(platform, owner, 'get_IsClosed', [reference]), true);
  assert.deepEqual(calls, []);
  invoke(platform, owner, 'DangerousRelease', [reference]);
  assert.deepEqual(calls, ['ReleaseHandle']);
});

test('A06 shutdown does not invoke managed SafeHandle ReleaseHandle overrides', () => {
  const platform = makePlatform();
  const owner = 'System.Runtime.InteropServices.SafeHandle';
  const reference = platform.heap.object('DerivedSafeHandle', []);
  const calls = [];
  platform.heap.lifetime.managedInstanceInvoker = (_reference, name) => {
    calls.push(name);
    return name !== 'get_IsInvalid';
  };
  invoke(platform, owner, '.ctor', [reference, 7n, true], 'constructor');
  platform.heap.collect();
  platform.heap.lifetime.shutdown();
  assert.deepEqual(calls, []);
});
