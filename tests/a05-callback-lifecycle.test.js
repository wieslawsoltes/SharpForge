import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, ManagedFault, framePoolStatistics} from '@sharpforge/runtime';
import {initializingCallbackAssembly} from './fixtures/managed-object-string.js';

function sourceProgram() {
  const program = compileToIL(`using System;
    class Value { public override string ToString() { Console.WriteLine("callback"); return "returned"; } }
    class Program { static void Main() {
      object value = new Value();
      try { Console.WriteLine(value.ToString()); } catch (Exception) { Console.WriteLine("caught"); }
      Console.WriteLine("after");
    } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return program;
}

const factories = {
  source: (program, options) => new VirtualMachine(program.image, options),
  cil: (program, options) => new CilVirtualMachine(program.assembly, options)
};

function receiverFor(vm) {
  return vm.heap.object(vm.inspector ? vm.typeSystem.table('Value') : vm.heap.methodTables.get('Value'), []);
}

function stringify(vm, receiver) {
  return vm.platform.bclHost.invokeObjectToString(vm.platform, receiver);
}

for (const [engine, create] of Object.entries(factories)) {
  test(`managed callback ${engine}: subscriber failures escape the enclosing managed catch unchanged`, () => {
    const vm = create(sourceProgram(), {runtimeEvents: true});
    const failure = new Error('host observer failed');
    const methodName = engine === 'source' ? 'Value.ToString' : 'Value::ToString';
    const unsubscribe = vm.runtimeEvents.subscribe(event => {
      if (event.name !== 'MethodLoad' || event.payload.name !== methodName) return;
      unsubscribe();
      throw failure;
    });
    try {
      assert.throws(() => vm.run(), error => error === failure);
      assert.equal(vm.output.join(''), 'callback\nreturned\nafter\n');
      assert.equal(vm.fault, null);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
    } finally { unsubscribe(); vm.stop(); }
  });

  test(`managed callback ${engine}: stopping from output never resumes a disposed Object.ToString caller`, () => {
    const vm = create(sourceProgram(), {runtimeEvents: true});
    let stopped = false, writesAfterStop = 0, allocationsAtStop;
    vm.onWrite = () => { if (stopped) writesAfterStop++; };
    vm.onOutput = text => {
      assert.equal(text, 'callback\n');
      vm.stop();
      stopped = true;
      allocationsAtStop = vm.heap.stats.allocations;
    };
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated');
      assert.equal(result.fault, null);
      assert.equal(result.output, 'callback\n');
      assert.equal(vm.frames.length, 0);
      if (!vm.inspector) assert.equal(vm.stack.length, 0);
      assert.equal(vm.allFrames().length, 0);
      assert.equal(vm.pendingFault, null);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(writesAfterStop, 0);
      assert.equal(vm.heap.stats.allocations, allocationsAtStop);
      assert.equal(vm.run().output, 'callback\n');
    } finally { vm.stop(); }
  });

  test(`managed callback ${engine}: direct cancellation does not restore pending faults or caller roots`, () => {
    const vm = create(sourceProgram());
    const receiver = receiverFor(vm);
    const observer = () => true;
    vm.state = 'paused';
    vm.pendingFault = new ManagedFault('Exception', 'previous pending fault');
    vm.onException = observer;
    vm.onOutput = () => vm.stop();
    const pins = vm.heap.pins.length;
    try {
      assert.deepEqual(stringify(vm, receiver), {handled: true, value: null, canceled: true});
      assert.equal(vm.state, 'terminated');
      assert.equal(vm.frames.length, 0);
      if (!vm.inspector) assert.equal(vm.stack.length, 0);
      assert.equal(vm.pendingFault, null);
      assert.equal(vm.fault, null);
      assert.equal(vm.onException, observer);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.heap.pins.length, pins);
    } finally { vm.stop(); }
  });

  test(`managed callback ${engine}: snapshot and restore rejection leave the active continuation usable`, () => {
    const vm = create(sourceProgram());
    const receiver = receiverFor(vm);
    vm.state = 'paused';
    const saved = vm.snapshot(), caller = vm.top;
    let callbacks = 0;
    vm.onOutput = () => {
      callbacks++;
      const frames = vm.frames, top = vm.top, revision = vm.heap.mutationRevision;
      assert.throws(() => vm.snapshot(), /synchronous managed callbacks/);
      assert.throws(() => vm.restore(saved), /synchronous managed callbacks/);
      assert.equal(vm.frames, frames);
      assert.equal(vm.top, top);
      assert.equal(vm.state, 'running');
      assert.equal(vm.heap.mutationRevision, revision);
      assert.equal(typeof vm.heap.snapshot(), 'object');
    };
    try {
      assert.equal(vm.value(stringify(vm, receiver).value), 'returned');
      assert.equal(callbacks, 1);
      assert.equal(vm.top, caller);
      assert.equal(vm.state, 'paused');
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      vm.restore(vm.snapshot());
      assert.equal(vm.state, 'paused');
    } finally { vm.stop(); }
  });

  test(`managed callback ${engine}: a pending task wait cannot suspend the retained caller`, () => {
    const vm = create(sourceProgram());
    const receiver = receiverFor(vm), caller = vm.top;
    const task = vm.scheduler.createTask();
    vm.state = 'paused';
    vm.onOutput = () => vm.scheduler.wait(task.ref);
    try {
      assert.throws(() => stringify(vm, receiver), error => error.name === 'InvalidOperationException' &&
        error.message.includes('synchronous function evaluation'));
      assert.equal(vm.top, caller);
      assert.equal(vm.state, 'paused');
      assert.equal(vm.scheduler.current.wait, null);
      assert.equal(task.waiters.size, 0);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
    } finally { vm.stop(); }
  });
}

function initializerVM() {
  const vm = new CilVirtualMachine(initializingCallbackAssembly(), {maxStackBytes: 1024});
  vm.state = 'paused';
  return vm;
}

test('abandoned cctor wrapper OOM preserves the initiating fault and releases every callback frame', () => {
  const vm = initializerVM(), receiver = receiverFor(vm), caller = vm.top;
  const type = vm.typeSystem.table('Failer').definitionToken;
  const maximum = vm.heap.maxBytes;
  vm.onOutput = () => {
    vm.heap.collect();
    vm.heap.maxBytes = vm.heap.stats.liveBytes;
  };
  let thrown;
  try {
    assert.throws(() => stringify(vm, receiver), error => {
      thrown = error;
      return error.name === 'OutOfMemoryException';
    });
    const state = vm.initialized.get(type);
    assert.equal(state.status, 'failed');
    assert.equal(state.ownerContext, null);
    assert.equal(state.waitTask, null);
    assert.equal(state.fault, thrown.initializationFailure);
    assert.equal(state.fault.message, 'initializer cause');
    assert(thrown.cleanupErrors.some(error => error.name === 'OutOfMemoryException'));
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert(framePoolStatistics(vm).released >= 2);
    vm.heap.maxBytes = maximum;
    vm.heap.collect();
    vm.heap.get(state.fault.reference);
    assert.throws(() => vm.ensureInitialized(type, 'field'), error => error === state.fault);
  } finally { vm.heap.maxBytes = maximum; vm.stop(); }
});

test('abandoned cctor wakes every initializer waiter after a host completion observer throws', () => {
  const vm = initializerVM(), receiver = receiverFor(vm), caller = vm.top;
  const type = vm.typeSystem.table('Failer').definitionToken;
  const observerFailure = new Error('task completion observer failed');
  let task;
  vm.onOutput = () => {
    const state = vm.initialized.get(type);
    task = vm.scheduler.createTask('void', {contextId: vm.scheduler.currentId});
    state.waitTask = task.ref;
    for (const id of [2, 3]) {
      vm.scheduler.contexts.set(id, {id, status: 'waiting', frames: [], stack: [],
        wait: {task: task.ref, pushResult: false}});
      task.waiters.add(id);
    }
    vm.onWrite = write => {
      if (write.property === '$status' && write.handle === task.ref.h) throw observerFailure;
    };
    vm.state = 'paused';
  };
  try {
    assert.throws(() => stringify(vm, receiver), error =>
      error.name === 'InvalidOperationException' && error.cleanupErrors.includes(observerFailure));
    const state = vm.initialized.get(type);
    assert.equal(state.status, 'failed');
    assert.equal(state.ownerContext, null);
    assert.equal(state.waitTask, null);
    assert.equal(task.status, 'completed');
    assert.equal(task.waiters.size, 0);
    for (const id of [2, 3]) {
      const waiter = vm.scheduler.contexts.get(id);
      assert.equal(waiter.status, 'ready');
      assert.equal(waiter.wait, null);
      assert.deepEqual(waiter.stack, []);
    }
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert(framePoolStatistics(vm).released >= 2);
    assert.throws(() => vm.ensureInitialized(type, 'field'), error => error === state.fault);
  } finally { vm.onWrite = null; vm.stop(); }
});
