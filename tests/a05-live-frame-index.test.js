import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault, framePoolStatistics} from '@sharpforge/runtime';
import {frameById, nextFrameId, validateFrameIndexSnapshot} from '../packages/runtime/src/execution/frame-lifetimes.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {managedFixture} from './managed-fixtures.js';

const source = 'class Program { static void Worker() {} static int Main() { Worker(); return 7; } }';
let compiled;
function make(engine, options = {}) {
  compiled ??= compileToIL(source);
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  if (engine === 'cil') return new CilVirtualMachine(compiled.assembly, options);
  return new VirtualMachine(engine === 'reload' ? compiled.assembly : compiled.image, options);
}
const methodId = vm => vm.inspector ? vm.top.method.token : vm.top.methodId;
const expired = (vm, id) => assert.throws(() => frameById(vm, id), {
  name: 'InvalidProgramException', message: 'Managed address outlived its frame',
});
function workerDelegate(vm) {
  const method = vm.inspector
    ? [...vm.inspector.methods.values()].find(item => item.name === 'Worker').token
    : vm.image.methods.find(item => item.name === 'Worker').id;
  return vm.platform.make('System.Action', {method, receiver: null, mode: 'static'}, 'delegate');
}

for (const engine of ['source', 'reload', 'cil']) {
  test(`${engine}: indexed lookup does not enumerate active frames or logical contexts`, () => {
    const vm = make(engine), method = methodId(vm);
    try {
      for (let depth = 0; depth < 128; depth++) vm.call(method, []);
      const first = vm.frames[0], middle = vm.frames[64], last = vm.top;
      const noScan = () => { throw new Error('Frame lookup scanned the execution graph'); };
      vm.allFrames = noScan;
      vm.frames[Symbol.iterator] = noScan;
      vm.scheduler.contexts[Symbol.iterator] = noScan;
      try {
        for (let iteration = 0; iteration < 1000; iteration++) {
          assert.equal(frameById(vm, first.id), first);
          assert.equal(frameById(vm, middle.id), middle);
          assert.equal(frameById(vm, last.id), last);
        }
      } finally {
        delete vm.allFrames;
        delete vm.frames[Symbol.iterator];
        delete vm.scheduler.contexts[Symbol.iterator];
      }
    } finally { vm.stop(); }
  });

  test(`${engine}: logical retirement expires identity before deferred clearing and pool reuse`, () => {
    const vm = make(engine), method = methodId(vm), frame = vm.top, id = frame.id;
    try {
      assert.equal(popPooledFrame(vm), frame);
      assert.equal(frame.id, id, 'retired storage remains readable until the instruction boundary');
      expired(vm, id);
      flushFramePool(vm);
      vm.call(method, []);
      assert.equal(vm.top, frame);
      assert(vm.top.id > id);
      expired(vm, id);
      assert.equal(frameById(vm, vm.top.id), frame);
    } finally { vm.stop(); }
    expired(vm, vm.frameId);
  });

  test(`${engine}: provisional enqueue preserves parent roots and atomically discards admitted children`, () => {
    const vm = make(engine, {maxStackBytes: 1024 * 1024});
    const parentFrames = vm.frames, parent = vm.top, parentId = parent.id;
    const reference = vm.heap.object('object', []);
    parent.locals.push(reference);
    const delegate = workerDelegate(vm), failure = new Error('Failure after provisional admission');
    const call = vm.call;
    let childId, childReference;
    vm.call = function (...args) {
      vm.heap.collect();
      assert.doesNotThrow(() => vm.heap.get(reference), 'saved parent is a GC root during provisional admission');
      assert.equal(frameById(vm, parentId), parent);
      call.apply(this, args);
      childId = vm.top.id;
      childReference = vm.heap.object('object', []);
      vm.top.locals.push(childReference);
      throw failure;
    };
    try {
      assert.throws(() => vm.scheduler.enqueue(delegate), error => error === failure);
      assert.equal(vm.frames, parentFrames);
      assert.equal(vm.top, parent);
      assert.equal(vm.state, 'ready');
      assert.equal(vm.scheduler.contexts.size, 1);
      assert.equal(frameById(vm, parentId), parent);
      expired(vm, childId);
      assert(framePoolStatistics(vm).released >= 1);
      vm.heap.collect();
      assert.doesNotThrow(() => vm.heap.get(reference));
      assert.throws(() => vm.heap.get(childReference), {name: 'InvalidReferenceException'});
    } finally { delete vm.call; vm.stop(); }
  });

  test(`${engine}: queued contexts keep both frame sets live across activation and cancellation`, () => {
    const vm = make(engine), main = vm.top, mainId = main.id;
    try {
      const id = vm.scheduler.enqueue(workerDelegate(vm));
      const context = vm.scheduler.contexts.get(id), child = context.frames[0], childId = child.id;
      assert.equal(frameById(vm, childId), child);
      assert.equal(frameById(vm, mainId), main);
      vm.scheduler.load(context);
      assert.equal(frameById(vm, childId), child);
      assert.equal(frameById(vm, mainId), main);
      vm.fault = new ManagedFault('ExecutionLimitException', 'fatal active context');
      vm.state = 'faulted';
      vm.scheduler.cancelAll();
      expired(vm, mainId);
      assert.equal(frameById(vm, childId), child, 'active fatal storage remains inspectable until stop');
      vm.stop();
      expired(vm, childId);
    } finally { vm.stop(); }
  });

  test(`${engine}: parked frame identity survives freeze and restore, and expires at cancellation`, () => {
    const vm = make(engine), id = vm.top.id;
    try {
      vm.scheduler.freeze(1);
      vm.runSlice();
      assert.equal(vm.state, 'waiting');
      const parked = vm.scheduler.current.frames[0];
      assert.equal(frameById(vm, id), parked);
      const saved = vm.snapshot();
      vm.scheduler.cancelAll();
      expired(vm, id);
      vm.restore(saved);
      const restored = vm.scheduler.current.frames[0];
      assert.notEqual(restored, parked);
      assert.equal(frameById(vm, id), restored);
      vm.scheduler.cancelAll();
      expired(vm, id);
    } finally { vm.stop(); }
  });

  test(`${engine}: terminal context disposal retires active storage before another context can run`, () => {
    const vm = make(engine), id = vm.top.id;
    try {
      vm.scheduler.ensure();
      vm.state = 'terminated';
      vm.scheduler.finish(vm.scheduler.current);
      assert.equal(vm.frames.length, 0);
      expired(vm, id);
      assert(framePoolStatistics(vm).released >= 1);
    } finally { vm.stop(); }
  });

  test(`${engine}: detached host-edited arrays cannot keep expired frames addressable`, () => {
    const vm = make(engine), frame = vm.top, id = frame.id;
    try {
      vm.frames = [];
      expired(vm, id);
      vm.frames = [frame];
      expired(vm, id, 'copying a detached frame to another array is not managed admission');
    } finally { vm.stop(); }
  });

  test(`${engine}: malformed identity restores leave frames, pools and lookup unchanged`, () => {
    const vm = make(engine), frame = vm.top, id = frame.id, saved = vm.snapshot();
    try {
      const malformed = [
        {...saved, frameId: id - 1},
        {...saved, frameId: Number.MAX_SAFE_INTEGER + 1},
        {...saved, frames: [...saved.frames, saved.frames[0]]},
        {...saved, frames: saved.frames.map(item => ({...item, id: 0}))},
      ];
      const statistics = framePoolStatistics(vm);
      for (const snapshot of malformed) {
        assert.throws(() => vm.restore(snapshot));
        assert.equal(vm.top, frame);
        assert.equal(frameById(vm, id), frame);
        assert.deepEqual(framePoolStatistics(vm), statistics);
      }
    } finally { vm.stop(); }
  });

  test(`${engine}: exhausted identity sequences reject calls without admitting an unsafe integer`, () => {
    const vm = make(engine), frame = vm.top, method = methodId(vm);
    try {
      vm.frameId = Number.MAX_SAFE_INTEGER;
      assert.throws(() => vm.call(method, []), {name: 'ExecutionLimitException'});
      assert.equal(vm.frameId, Number.MAX_SAFE_INTEGER);
      assert.equal(vm.frames.length, 1);
      assert.equal(frameById(vm, frame.id), frame);
    } finally { vm.stop(); }
  });
}

test('CIL managed byrefs retain ownership and resolve restored frames instead of abandoned storage', () => {
  const vm = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', locals: ['int'],
    body: writer => writer.op('ret')}]}));
  const foreign = new CilVirtualMachine(managedFixture({methods: [{name: 'Main', locals: ['int'],
    body: writer => writer.op('ret')}]}));
  try {
    const address = vm.address('local', 0);
    vm.dereference(address, true, 7);
    const original = vm.top, saved = vm.snapshot();
    vm.dereference(address, true, 99);
    vm.restore(saved);
    assert.notEqual(vm.top, original);
    assert.equal(vm.dereference(address), 7);
    vm.dereference(address, true, 11);
    assert.equal(original.locals[0], 99);
    assert.throws(() => foreign.dereference(address), {name: 'InvalidProgramException'});
    vm.stop();
    assert.throws(() => vm.dereference(address), {name: 'InvalidProgramException'});
  } finally { vm.stop(); foreign.stop(); }
});

test('captured context identities reject aliasing, sequence violations and divergent current stacks', () => {
  const frame = {id: 1};
  const context = {id: 1, status: 'running', frames: [frame]};
  const snapshot = {frames: [frame], frameId: 1, scheduler: {currentId: 1, parked: false, contexts: [[1, context]]}};
  assert.doesNotThrow(() => validateFrameIndexSnapshot(snapshot));
  for (const contexts of [
    [[1, {...context, frames: [{id: 2}]}]],
    [[1, context], [1, context]],
    [[1, context], [2, {id: 2, status: 'waiting', frames: [frame]}]],
    [[1, {...context, status: 'completed'}]],
    [[2, {...context, id: 2, frames: []}]],
  ]) assert.throws(() => validateFrameIndexSnapshot({...snapshot, scheduler: {...snapshot.scheduler, contexts}}),
    {name: 'InvalidProgramException'});
});

test('invalid managed sequence values do not mutate the sequence', () => {
  for (const frameId of [-1, 0.5, NaN, Infinity]) {
    const vm = {frameId};
    assert.throws(() => nextFrameId(vm), {name: 'InvalidProgramException'});
    assert(Object.is(vm.frameId, frameId));
  }
});
