import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {verifiedStackBound} from '@sharpforge/cil';
import {VirtualMachine, CilVirtualMachine, ManagedFault, framePoolStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../packages/runtime/src/execution/synchronous-call.js';
import {callbackAssembly, unverifiedCallbackAssembly} from './fixtures/managed-object-string.js';

const controlFields = ['frames', 'stack', 'state', 'sourcePause', 'currentPoint', 'pendingFault',
  'fault', 'returnValue', 'exitCode', 'onException'];

function sourceVM(options = {}, body = 'Console.WriteLine("callback"); return new StringBuilder("dynamic").ToString();') {
  const program = compileToIL(`using System;using System.Text;
    class Value { public override string ToString() { ${body} } }
    class Program { static void Main() { Console.WriteLine("main"); } }`);
  assert.equal(program.success, true, JSON.stringify(program.diagnostics));
  return new VirtualMachine(program.image, options);
}

function objectFor(vm, name) {
  return vm.heap.object(vm.inspector ? vm.typeSystem.table(name) : vm.heap.methodTables.get(name), []);
}

function stringify(vm, receiver) {
  return vm.platform.bclHost.invokeObjectToString(vm.platform, receiver);
}

for (const engine of ['source', 'cil']) {
  test(`synchronous callback ${engine}: caller control, dynamic roots and reentrant frames survive collection`, () => {
    const vm = engine === 'source' ? sourceVM({runtimeEvents: true})
      : new CilVirtualMachine(callbackAssembly({value: 'dynamic', trace: true}), {runtimeEvents: true});
    const receiver = objectFor(vm, engine === 'source' ? 'Value' : 'Fixture.Program');
    const outer = vm.top;
    vm.state = 'paused';
    vm.sourcePause = true;
    vm.currentPoint = {uri: 'paused.cs', line: 3};
    vm.returnValue = vm.heap.string('prior return');
    vm.pendingFault = new ManagedFault('Exception', 'pending', vm.heap.allocate('exception', 'Exception', [null]));
    vm.fault = new ManagedFault('Exception', 'prior', vm.heap.allocate('exception', 'Exception', [null]));
    vm.exitCode = 17;
    const observedFaults = [];
    vm.onException = fault => { observedFaults.push(fault); return true; };
    const saved = Object.fromEntries(controlFields.map(field => [field, vm[field]]));
    let nested = false, lateValue, outputCalls = 0;
    vm.onOutput = () => {
      outputCalls++;
      assert.equal(vm.scheduler.suppressed, true);
      assert(vm.allFrames().includes(outer));
      assert.equal(vm.scheduler.current.frames, saved.frames);
      if (!nested) {
        nested = true;
        lateValue = vm.heap.string('written after callback entry');
        outer.locals.push(lateValue);
        assert.equal(vm.value(stringify(vm, receiver).value), 'dynamic');
      }
      vm.heap.collect();
      assert.equal(vm.value(lateValue), 'written after callback entry');
      assert.equal(vm.value(saved.returnValue), 'prior return');
      vm.heap.get(saved.pendingFault.reference);
      vm.heap.get(saved.fault.reference);
    };
    const pins = vm.heap.pins.length, budget = vm.options.maxInstructions;
    try {
      const result = stringify(vm, receiver);
      assert.equal(result.handled, true);
      assert.equal(vm.value(result.value), 'dynamic');
      assert.equal(outputCalls, 2);
      assert.equal(observedFaults.length, 0);
      for (const field of controlFields) assert.equal(vm[field], saved[field], field);
      assert.equal(vm.scheduler.suppressed, false);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.options.maxInstructions, budget);
      assert.equal(vm.heap.pins.length, pins);
      assert(!vm.runtimeEvents.read().some(event => event.name === 'MethodLeave' &&
        event.payload.frame === outer.id && event.payload.reason === 'canceled'));
    } finally { vm.stop(); }
  });

  test(`synchronous callback ${engine}: fault restores preexisting pending state and releases callback frames`, () => {
    const vm = engine === 'source' ? sourceVM({}, 'throw new Exception("failure");')
      : new CilVirtualMachine(callbackAssembly({throwing: true}));
    const receiver = objectFor(vm, engine === 'source' ? 'Value' : 'Fixture.Program');
    vm.state = 'paused';
    vm.pendingFault = new ManagedFault('Exception', 'prior pending');
    vm.onException = () => { throw new Error('The synchronous callback cannot pause at a debugger observer'); };
    const saved = Object.fromEntries(controlFields.map(field => [field, vm[field]]));
    const baseline = framePoolStatistics(vm), pins = vm.heap.pins.length;
    try {
      assert.throws(() => stringify(vm, receiver), error => error instanceof ManagedFault &&
        (engine === 'source' ? error.message === 'failure' : error.name === 'NullReferenceException'));
      for (const field of controlFields) assert.equal(vm[field], saved[field], field);
      assert(framePoolStatistics(vm).released > baseline.released);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.scheduler.suppressed, false);
      assert.equal(vm.heap.pins.length, pins);
    } finally { vm.stop(); }
  });
}

test('synchronous CIL callback preserves mutable caller byrefs, GC roots and verified aggregate stack accounting', () => {
  const vm = new CilVirtualMachine(callbackAssembly(), {maxStackBytes: 1024});
  const caller = vm.top;
  caller.locals[0] = vm.heap.string('original');
  const address = vm.address('local', 0);
  const method = vm.inspector.types.find(type => type.name === 'Fixture.Program').methods.find(method => method.name === 'StoreAndCollect');
  vm.state = 'paused';
  try {
    for (let index = 0; index < 4; index++) {
      invalidateExecutionCode(vm, 'callback byref proof');
      const value = invokeManagedMethod(vm.platform, method.token, null, [address]);
      assert.equal(vm.value(value), 'replacement');
      assert.equal(vm.value(caller.locals[0]), 'replacement');
      assert.equal(vm.dereference(address), caller.locals[0]);
      assert.equal(vm.top, caller);
      assert.equal(vm.state, 'paused');
      vm.heap.collect();
      assert.equal(vm.value(caller.locals[0]), 'replacement');
    }
  } finally { vm.stop(); }
});

test('synchronous callbacks cannot leave paused execution or retain an abandoned pooled frame', () => {
  const vm = sourceVM();
  const receiver = objectFor(vm, 'Value'), caller = vm.top;
  vm.onOutput = () => { vm.state = 'paused'; };
  vm.state = 'paused';
  const pins = vm.heap.pins.length;
  try {
    for (let index = 0; index < 3; index++) {
      assert.throws(() => stringify(vm, receiver), {name: 'InvalidOperationException'});
      assert.equal(vm.top, caller);
      assert.equal(vm.scheduler.callbackScopes.length, 0);
      assert.equal(vm.heap.pins.length, pins);
    }
    assert(framePoolStatistics(vm).reused >= 2);
  } finally { vm.stop(); }
});

test('synchronous call limits reject invalid budgets and include retained caller depth', () => {
  const vm = sourceVM();
  const receiver = objectFor(vm, 'Value');
  const method = vm.image.methods.find(method => method.owner === 'Value' && method.name === 'ToString');
  try {
    for (const maxInstructions of [0, -1, Infinity, NaN, 1.5]) {
      assert.throws(() => invokeManagedMethod(vm.platform, method.id, receiver, [], {maxInstructions}), RangeError);
    }
    vm.options.maxFrames = 1;
    assert.throws(() => stringify(vm, receiver), {name: 'StackOverflowException'});
    assert.equal(vm.scheduler.callbackScopes?.length ?? 0, 0);
  } finally { vm.stop(); }
});

test('synchronous callback instruction exhaustion restores the paused caller and frees abandoned frame storage', () => {
  const vm = new CilVirtualMachine(callbackAssembly({loop: true}), {maxSynchronousInstructions: 32, maxStackBytes: 1024});
  const receiver = objectFor(vm, 'Fixture.Program'), frames = vm.frames;
  vm.state = 'paused';
  const before = vm.instructions;
  try {
    assert.throws(() => stringify(vm, receiver), {name: 'ExecutionLimitException'});
    assert.equal(vm.instructions - before, 32);
    assert.equal(vm.frames, frames);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.equal(vm.scheduler.suppressed, false);
    assert(framePoolStatistics(vm).released >= 1);
  } finally { vm.stop(); }
});


test('CIL constructor admission verifies the reachable Object.ToString override', () => {
  assert.throws(() => new CilVirtualMachine(callbackAssembly({unverified: true})), error =>
    error.name === 'CilError' && /ToString IL_0: Evaluation stack underflow/.test(error.message));
});

test('synchronous CIL callback verification rejection preserves prior report and stack proof', () => {
  const vm = new CilVirtualMachine(unverifiedCallbackAssembly(), {maxStackBytes: 1024});
  const report = vm.report, caller = vm.top, frames = vm.frames, instructions = vm.instructions, pins = [...vm.heap.pins];
  const method = vm.inspector.types.find(type => type.name === 'Fixture.Program').methods
    .find(method => method.name === 'UnverifiedCallback');
  assert.equal(report.methods.includes(method.token), false, 'the entry point does not reach this ordinary host callback');
  const proof = verifiedStackBound(vm.inspector, report, caller.method);
  vm.state = 'paused';
  try {
    assert.throws(() => invokeManagedMethod(vm.platform, method.token, null, []), error =>
      error.name === 'InvalidProgramException' && /Evaluation stack underflow/.test(error.message));
    assert.equal(vm.report, report);
    assert.equal(verifiedStackBound(vm.inspector, vm.report, caller.method), proof);
    assert.equal(vm.top, caller);
    assert.equal(vm.frames, frames);
    assert.equal(vm.instructions, instructions);
    assert.deepEqual(vm.heap.pins, pins);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes?.length ?? 0, 0);
  } finally { vm.stop(); }
});

test('direct host callback execution buffers subscriber delivery until an explicit host flush', () => {
  const vm = new CilVirtualMachine(callbackAssembly({loop: true}), {runtimeEvents: true, maxSynchronousInstructions: 4096});
  const receiver = objectFor(vm, 'Fixture.Program'), caller = vm.top;
  const failure = new Error('observer rejected delivery');
  const unsubscribe = vm.runtimeEvents.subscribe(() => { throw failure; });
  vm.state = 'paused';
  try {
    assert.throws(() => stringify(vm, receiver), {name: 'ExecutionLimitException'});
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.equal(vm.scheduler.suppressed, false);
    assert(framePoolStatistics(vm).released >= 1);
    assert.throws(() => vm.runtimeEvents.flush(), error => error === failure);
  } finally { unsubscribe(); vm.stop(); }
});

test('nested synchronous calls share the managed frame-depth limit', () => {
  const vm = sourceVM({maxFrames: 4}, 'object value = this; return value.ToString();');
  const receiver = objectFor(vm, 'Value'), caller = vm.top;
  vm.state = 'paused';
  try {
    assert.throws(() => stringify(vm, receiver), {name: 'StackOverflowException'});
    assert.equal(vm.options.maxFrames, 4);
    assert.equal(vm.top, caller);
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.equal(vm.scheduler.suppressed, false);
  } finally { vm.stop(); }
});

test('callbacks preserve an already-suppressed scheduler and obey the enclosing instruction limit', () => {
  const vm = new CilVirtualMachine(callbackAssembly({loop: true}), {maxSynchronousInstructions: 1000, maxInstructions: 20});
  const receiver = objectFor(vm, 'Fixture.Program'), caller = vm.top;
  vm.state = 'paused';
  vm.scheduler.suppressed = true;
  try {
    assert.throws(() => stringify(vm, receiver), {name: 'InstructionLimitException'});
    assert.equal(vm.instructions, 21);
    assert.equal(vm.options.maxInstructions, 20);
    assert.equal(vm.top, caller);
    assert.equal(vm.scheduler.callbackScopes.length, 0);
    assert.equal(vm.scheduler.suppressed, true);
  } finally { vm.scheduler.suppressed = false; vm.stop(); }
});
