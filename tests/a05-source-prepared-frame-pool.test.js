import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {clearFramePool, framePool} from '../packages/runtime/src/execution/frame-pool.js';
import {prepareSourceCall} from '../packages/runtime/src/execution/source-prepared-calls.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function setup(options = {}, image = sourceFusionFixture()) {
  const vm = new VirtualMachine(image, options);
  const prepared = prepareSourceCall(vm.image, 0, 0);
  assert(prepared);
  return {vm, prepared, pool: framePool(vm)};
}

test('prepared frame authority cannot be forged or used with another source image', () => {
  const {vm, prepared, pool} = setup();
  const foreign = setup();
  try {
    const before = framePoolStatistics(vm);
    assert(Object.isFrozen(prepared.frameCapability));
    assert.deepEqual(Object.keys(prepared.frameCapability), []);
    for (const token of [{}, Object.freeze({}), foreign.prepared.frameCapability]) {
      assert.throws(() => pool.acquireSource(token), /storage capability/);
      assert.deepEqual(framePoolStatistics(vm), before);
    }
  } finally {
    vm.stop();
    foreign.vm.stop();
  }
});

test('shared prepared metadata binds to separate VM-owned storage', () => {
  const first = setup();
  const second = setup({}, first.vm.image);
  try {
    const left = first.pool.acquireSource(first.prepared.frameCapability);
    const right = second.pool.acquireSource(first.prepared.frameCapability);
    assert.notEqual(left, right);
    for (const key of ['args', 'locals', 'stack', 'caught', 'unwinds']) assert.notEqual(left[key], right[key]);
    left.locals[0] = 17;
    assert.equal(right.locals[0], undefined);
    first.pool.retire(left);
    first.pool.flush();
    assert.equal(framePoolStatistics(second.vm).released, 0);
    second.pool.retire(right);
    second.pool.flush();
  } finally {
    first.vm.stop();
    second.vm.stop();
  }
});

test('changed method shape and a discarded pool cannot reuse prepared storage', () => {
  const {vm, prepared, pool} = setup();
  try {
    const frame = pool.acquireSource(prepared.frameCapability);
    pool.retire(frame);
    pool.flush();
    const before = framePoolStatistics(vm);
    const method = vm.image.methods[0], locals = method.locals;
    method.locals = [...locals];
    assert.throws(() => pool.acquireSource(prepared.frameCapability), /storage capability/);
    method.locals = locals;
    locals.push({name: 'changed', slot: 3, type: 'int'});
    assert.throws(() => pool.acquireSource(prepared.frameCapability), /storage capability/);
    locals.pop();
    vm.image.methods[0] = {...method};
    assert.throws(() => pool.acquireSource(prepared.frameCapability), /storage capability/);
    vm.image.methods[0] = method;
    assert.deepEqual(framePoolStatistics(vm), before);
    clearFramePool(vm);
    assert.throws(() => pool.acquireSource(prepared.frameCapability), /no longer current/);
    const replacement = framePool(vm);
    const fresh = replacement.acquireSource(prepared.frameCapability);
    assert.notEqual(fresh, frame);
    assert.notEqual(fresh.locals, frame.locals);
    replacement.retire(fresh);
    replacement.flush();
  } finally { vm.stop(); }
});

test('prepared retirement preserves temporary roots, revokes leases and clears every late own field', () => {
  const {vm, prepared, pool} = setup();
  try {
    const frame = pool.acquireSource(prepared.frameCapability);
    const arrays = Object.fromEntries(['args', 'locals', 'stack', 'caught', 'unwinds'].map(key => [key, frame[key]]));
    const reference = vm.heap.object('System.Object', []);
    const handle = vm.heap.createHandle(reference);
    const lease = {handle, active: true};
    Object.assign(frame, {id: 123, methodId: 0, returnObject: reference, genericIdentity: 'Late.Type',
      methodArguments: ['object'], prefixState: {reference}, rootCaptures: {locals: new Set([0])}, objectStringReturn: true,
      delegateContinuation: {entries: [reference], args: [reference]},
      exceptionEventContinuation: {fault: {reference}, handlers: [reference], args: [reference]},
      lateHostMetadata: {reference}, stackRegions: new Map([[1, {reference}]]), pinLeases: new Map([[0, lease]])});
    frame.locals[0] = reference;
    frame.args.push(reference);
    frame.stack.push(reference);
    frame.caught.push({fault: {reference}});
    frame.unwinds.push({value: reference});
    const ownFields = Object.keys(frame);
    const before = framePoolStatistics(vm);
    pool.retire(frame);
    assert.equal(lease.active, false);
    assert.equal(vm.heap.getHandle(handle), null);
    assert.equal(frame.stackRegions.size, 0);
    assert.equal(frame.locals[0], reference);
    vm.heap.collect();
    assert(vm.heap.get(reference));
    pool.flush();
    for (const key of ownFields) {
      if (Object.hasOwn(arrays, key)) {
        assert.equal(frame[key], arrays[key]);
        assert.equal(frame[key].length, 0, key);
      } else assert.equal(frame[key], undefined, key);
    }
    assert.equal(framePoolStatistics(vm).released, before.released + 1);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), /reference/i);
    const reused = pool.acquireSource(prepared.frameCapability);
    assert.equal(reused, frame);
    assert.equal(reused.id, undefined);
    assert.equal(reused.locals.length, prepared.capacity);
    assert(reused.locals.every(value => value === undefined));
    for (const key of Object.keys(arrays)) assert.equal(reused[key], arrays[key]);
    pool.retire(reused);
    pool.flush();
  } finally { vm.stop(); }
});

test('prepared cleanup skips inherited getters and allocates no Object.keys array', context => {
  const {vm, prepared, pool} = setup();
  try {
    const frame = pool.acquireSource(prepared.frameCapability);
    const prototype = Object.create(Object.getPrototypeOf(frame), {
      inheritedHostMetadata: {enumerable: true, get() { throw new Error('Inherited getter was read'); }}
    });
    Object.setPrototypeOf(frame, prototype);
    frame.lateHostMetadata = {owned: true};
    context.mock.method(Object, 'keys', () => { throw new Error('Per-return key array'); });
    try {
      pool.retire(frame);
      pool.flush();
    } finally { context.mock.restoreAll(); }
    assert.equal(frame.lateHostMetadata, undefined);
    assert.equal(Object.hasOwn(frame, 'inheritedHostMetadata'), false);
    assert.equal(frame.locals.length, 0);
  } finally { vm.stop(); }
});

test('prepared cleanup preserves ordinary deleted and nonenumerable factory-field behavior', () => {
  const {vm, prepared, pool} = setup({framePooling: false});
  try {
    const frames = [pool.acquire(vm.image.methods[0], prepared.capacity), pool.acquireSource(prepared.frameCapability)];
    for (const frame of frames) {
      const prototype = Object.create(Object.getPrototypeOf(frame), {
        args: {enumerable: true, get() { throw new Error('Inherited common array was read'); }}
      });
      delete frame.args;
      Object.setPrototypeOf(frame, prototype);
      Object.defineProperty(frame, 'methodId', {value: 71, writable: true, enumerable: false, configurable: true});
      frame.lateHostMetadata = {owned: true};
      pool.retire(frame);
    }
    pool.flush();
    for (const frame of frames) {
      assert.equal(Object.hasOwn(frame, 'args'), false);
      assert.equal(frame.methodId, 71);
      assert.equal(frame.locals.length, 0);
      assert.equal(frame.lateHostMetadata, undefined);
      assert.equal(frame.id, undefined);
    }
    assert.deepEqual(Object.getOwnPropertyDescriptors(frames[1]), Object.getOwnPropertyDescriptors(frames[0]));
  } finally { vm.stop(); }
});

test('prepared storage keeps ordinary retention budgets and statistics', () => {
  for (const options of [{framePooling: false}, {framePoolBytes: 0}, {framePoolBytes: 151}, {framePoolBytes: 152}]) {
    const {vm, prepared, pool} = setup(options);
    try {
      const first = pool.acquireSource(prepared.frameCapability);
      pool.retire(first);
      pool.flush();
      const before = framePoolStatistics(vm);
      const retained = options.framePooling !== false && options.framePoolBytes >= 152;
      assert.equal(before.retainedBytes, retained ? 152 : 0);
      assert.equal(before.cachedFrames, retained ? 1 : 0);
      const second = pool.acquire(vm.image.methods[0], prepared.capacity);
      assert.equal(second === first, retained);
      second.lateOrdinaryMetadata = {owned: true};
      pool.retire(second);
      pool.flush();
      assert.equal(second.lateOrdinaryMetadata, undefined);
      assert.equal(second.locals.length, 0);
      const after = framePoolStatistics(vm);
      assert.equal(after.reused, retained ? 1 : 0);
      assert.equal(after.framesAllocated, before.framesAllocated + (retained ? 0 : 1));
      assert.equal(after.arraysAllocated, before.arraysAllocated + (retained ? 0 : 5));
      assert.equal(after.released, before.released + 1);
      assert.equal(after.retainedBytes, before.retainedBytes);
    } finally { vm.stop(); }
  }
});
