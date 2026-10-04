import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {framePool, clearFramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {preparedCilTarget} from '../packages/runtime/src/execution/prepared-cil-frame.js';
import {invalidateExecutionCode} from '../packages/runtime/src/execution/code-version.js';
import {inlineCacheFixture} from './support/inline-cache-fixture.js';

function setup(options = {}, inspector = new AssemblyInspector(inlineCacheFixture())) {
  const vm = new CilVirtualMachine(inspector, options);
  const target = inspector.types.find(type => type.name === 'Receiver0').methods.find(method => method.name === 'Value');
  const prepared = preparedCilTarget(vm, target.token, {});
  assert(prepared);
  return {vm, prepared, pool: framePool(vm)};
}

test('prepared CIL storage authority is opaque, owned by metadata, and isolated between VM pools', () => {
  const first = setup();
  const shared = setup({}, first.vm.inspector);
  const foreign = setup();
  try {
    const capability = first.prepared.frameCapability;
    assert(Object.isFrozen(capability));
    assert.deepEqual(Object.keys(capability), []);
    const before = framePoolStatistics(first.vm);
    for (const token of [{}, Object.freeze({}), foreign.prepared.frameCapability]) {
      assert.throws(() => first.pool.acquireCil(token), /storage capability/);
      assert.deepEqual(framePoolStatistics(first.vm), before);
    }
    const left = first.pool.acquireCil(capability);
    const right = shared.pool.acquireCil(capability);
    assert.notEqual(left, right);
    for (const key of ['args', 'locals', 'stack', 'caught', 'unwinds']) assert.notEqual(left[key], right[key]);
    left.args[0] = 17;
    assert.equal(right.args[0], undefined);
    first.pool.retire(left);
    first.pool.flush();
    assert.equal(framePoolStatistics(shared.vm).released, 0);
    shared.pool.retire(right);
    shared.pool.flush();
  } finally { first.vm.stop(); shared.vm.stop(); foreign.vm.stop(); }
});

test('prepared CIL storage rejects stale shape, code owner and discarded pools', () => {
  const {vm, prepared, pool} = setup();
  const method = prepared.method;
  try {
    const before = framePoolStatistics(vm);
    const changes = [
      ['locals', [...method.locals]], ['signature', {...method.signature}], ['maxStack', method.maxStack + 1]
    ];
    for (const [key, value] of changes) {
      const original = method[key];
      method[key] = value;
      assert.throws(() => pool.acquireCil(prepared.frameCapability), /storage capability/);
      method[key] = original;
    }
    method.locals.push('int');
    assert.throws(() => pool.acquireCil(prepared.frameCapability), /storage capability/);
    method.locals.pop();
    method.signature.parameters.push('int');
    assert.throws(() => pool.acquireCil(prepared.frameCapability), /storage capability/);
    method.signature.parameters.pop();
    assert.deepEqual(framePoolStatistics(vm), before);
    clearFramePool(vm);
    assert.throws(() => pool.acquireCil(prepared.frameCapability), /no longer current/);
    const replacement = framePool(vm);
    const frame = replacement.acquireCil(prepared.frameCapability);
    replacement.retire(frame);
    replacement.flush();
    invalidateExecutionCode(vm, 'prepared-pool-test');
    assert.throws(() => replacement.acquireCil(prepared.frameCapability), /no longer current/);
  } finally { vm.stop(); }
});

test('prepared CIL retirement revokes memory leases and preserves deferred roots until scrub', () => {
  const {vm, prepared, pool} = setup();
  try {
    const frame = pool.acquireCil(prepared.frameCapability);
    const arrays = Object.fromEntries(['args', 'locals', 'stack', 'caught', 'unwinds'].map(key => [key, frame[key]]));
    const reference = vm.heap.object('System.Object', []);
    const handle = vm.heap.createHandle(reference);
    const lease = {handle, active: true};
    Object.assign(frame, {method: prepared.method, id: 789, returnObject: reference,
      genericIdentity: 'Late.Type', methodArguments: ['object'], objectStringReturn: true,
      delegateContinuation: {entries: [reference], args: [reference]},
      exceptionEventContinuation: {fault: {reference}, handlers: [reference], args: [reference]},
      lateHostMetadata: {reference}, stackRegions: new Map([[1, {reference}]]), pinLeases: new Map([[0, lease]])});
    frame.args[0] = reference;
    frame.stack.push(reference);
    const fields = Object.keys(frame);
    pool.retire(frame);
    assert.equal(lease.active, false);
    assert.equal(vm.heap.getHandle(handle), null);
    assert.equal(frame.stackRegions.size, 0);
    assert.equal(frame.args[0], reference);
    vm.heap.collect();
    assert(vm.heap.get(reference));
    pool.flush();
    for (const key of fields) {
      if (Object.hasOwn(arrays, key)) {
        assert.equal(frame[key], arrays[key]);
        assert.equal(frame[key].length, 0, key);
      } else assert.equal(frame[key], undefined, key);
    }
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), /reference/i);
    const next = pool.acquireCil(prepared.frameCapability);
    assert.equal(next, frame);
    assert.equal(next.args.length, 1);
    assert.equal(next.args[0], undefined);
    pool.retire(next);
    pool.flush();
  } finally { vm.stop(); }
});

test('a new local shape discards cached storage and prevents late retirement into the old bucket', () => {
  const {vm, prepared, pool} = setup();
  const method = prepared.method;
  try {
    const cached = pool.acquireCil(prepared.frameCapability);
    const outstanding = pool.acquireCil(prepared.frameCapability);
    pool.retire(cached);
    pool.flush();
    assert.equal(framePoolStatistics(vm).retainedBytes, 200);
    method.locals.push('int');
    assert.throws(() => pool.acquireCil(prepared.frameCapability), /storage capability/);
    const refreshed = preparedCilTarget(vm, method.token, {});
    const current = pool.acquireCil(refreshed.frameCapability);
    assert.equal(current.locals.length, 1);
    assert.notEqual(current, cached);
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
    assert.equal(framePoolStatistics(vm).cachedFrames, 0);
    pool.retire(outstanding);
    pool.flush();
    assert.equal(outstanding.args.length, 0);
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
    pool.retire(current);
    pool.flush();
    assert.equal(framePoolStatistics(vm).retainedBytes, 208);
    const reused = pool.acquire(method, 1);
    assert.equal(reused, current);
    assert.equal(reused.locals.length, 1);
    pool.retire(reused);
    pool.flush();
  } finally { method.locals.length = 0; vm.stop(); }
});

test('prepared CIL scrub matches ordinary deletion, nonenumerability, inherited getters and setter order', () => {
  const {vm, prepared, pool} = setup({framePooling: false});
  try {
    const calls = [];
    const frames = [pool.acquire(prepared.method, 1), pool.acquireCil(prepared.frameCapability)];
    for (const [index, frame] of frames.entries()) {
      const prototype = Object.create(Object.getPrototypeOf(frame), {
        args: {enumerable: true, get() { throw new Error('Inherited common array was read'); }}
      });
      delete frame.args;
      Object.setPrototypeOf(frame, prototype);
      Object.defineProperty(frame, 'method', {value: prepared.method, writable: true, enumerable: false, configurable: true});
      for (const key of ['point', 'lateHostMetadata']) Object.defineProperty(frame, key, {
        enumerable: true, configurable: true, get() { return null; },
        set(value) { calls.push([index, key, value]); }
      });
      pool.retire(frame);
      pool.flush();
      assert.equal(Object.hasOwn(frame, 'args'), false);
      assert.equal(frame.method, prepared.method);
      assert.equal(frame.stack.length, 0);
      assert.equal(frame.id, undefined);
    }
    assert.deepEqual(calls.filter(call => call[0] === 0).map(call => call.slice(1)),
      calls.filter(call => call[0] === 1).map(call => call.slice(1)));
  } finally { vm.stop(); }
});

test('prepared CIL buckets preserve retention budgets and follow current stack capacity', () => {
  for (const options of [{framePooling: false}, {framePoolBytes: 0}, {framePoolBytes: 199}, {framePoolBytes: 200}]) {
    const {vm, prepared, pool} = setup(options);
    try {
      const first = pool.acquireCil(prepared.frameCapability);
      pool.retire(first);
      pool.flush();
      const before = framePoolStatistics(vm);
      const retained = options.framePooling !== false && options.framePoolBytes >= 200;
      assert.equal(before.retainedBytes, retained ? 200 : 0);
      const second = pool.acquire(prepared.method, 1);
      assert.equal(second === first, retained);
      pool.retire(second);
      pool.flush();
      assert.equal(framePoolStatistics(vm).retainedBytes, before.retainedBytes);
      const previous = framePoolStatistics(vm);
      vm.options.maxStackValues = 4;
      const resized = pool.acquireCil(prepared.frameCapability);
      assert.notEqual(resized, second, 'Different evaluation capacity cannot reuse the old bucket');
      assert.equal(framePoolStatistics(vm).framesAllocated, previous.framesAllocated + 1);
      pool.retire(resized);
      pool.flush();
    } finally { vm.stop(); }
  }
});
