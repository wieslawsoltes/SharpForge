import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, RuntimeEventName} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const events = vm => vm.runtimeEvents.read().filter(event => event.name === RuntimeEventName.ExceptionThrown);
const faultFixture = () => managedFixture({methods: [{name: 'Main', result: 'int',
  body: writer => writer.op('ldc.i4.1').op('ldc.i4.0').op('div').op('ret')}]});

function rethrowFixture(explicit = false) {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', locals: ['int'], body(writer, context) {
      writer.mark('try').op('call', context.methods.Inner).op('leave.s', 'done')
        .mark('catch').op('pop').op('ldc.i4.7').op('stloc.0').op('leave.s', 'done')
        .mark('done').op('ldloc.0').op('ret');
    }, handlers: (labels, context) => [{start: labels.try, end: labels.catch,
      target: labels.catch, handlerEnd: labels.done, catchType: context.resolve('System.Exception')}]},
    {name: 'Inner', body(writer) {
      writer.mark('try').op('ldnull').op('throw').mark('catch');
      if (explicit) writer.op('throw');
      else writer.op('pop').op('rethrow');
      writer.mark('end');
    }, handlers: (labels, context) => [{start: labels.try, end: labels.catch,
      target: labels.catch, handlerEnd: labels.end, catchType: context.resolve('System.Exception')}]}
  ]});
}

test('first slice fault records scalar identity before debugger notification and defers subscribers', () => {
  const vm = new CilVirtualMachine(faultFixture(), {runtimeEvents: true});
  const delivered = [], unsubscribe = vm.runtimeEvents.subscribe(event => delivered.push(event));
  const frame = vm.top;
  vm.onException = fault => {
    assert.equal(fault.name, 'DivideByZeroException');
    assert.deepEqual(delivered, []);
    assert.equal(events(vm).length, 1);
    return true;
  };
  try {
    vm.runSlice({instructionBudget: 20, timeBudgetMs: 1000});
    assert.equal(vm.state, 'paused');
    const event = events(vm)[0];
    assert.deepEqual(event.payload, {name: 'DivideByZeroException', exceptionType: 'System.DivideByZeroException',
      method: frame.method.token, frame: frame.id, ilOffset: 2, fatal: false});
    assert.equal(event.instruction, 3);
    assert(Object.isFrozen(event.payload));
    assert.deepEqual(delivered.map(item => item.name), ['ExceptionThrown']);
    const snapshot = vm.snapshot();
    vm.onException = null;
    vm.state = 'running';
    assert.equal(vm.run().state, 'faulted');
    vm.restore(snapshot);
    vm.state = 'running';
    assert.equal(vm.run().state, 'faulted');
    assert.equal(events(vm).length, 1, 'resuming the captured pending fault is propagation');
  } finally { unsubscribe(); vm.stop(); }
});

test('catch rethrow and cross-frame unwind do not duplicate the original event', () => {
  const vm = new CilVirtualMachine(rethrowFixture(), {runtimeEvents: true});
  const faults = [];
  vm.onException = fault => { faults.push(fault); return false; };
  try {
    assert.equal(vm.run().returnValue, 7);
    assert.equal(vm.state, 'terminated');
    assert.equal(faults.length, 2, 'existing first-chance debugger callbacks are unchanged');
    assert.equal(faults[0], faults[1]);
    assert.deepEqual(events(vm).map(event => [event.payload.method, event.payload.name]),
      [[0x06000002, 'NullReferenceException']]);
    const ordered = vm.runtimeEvents.read();
    const exception = ordered.findIndex(event => event.name === 'ExceptionThrown');
    const leave = ordered.findIndex(event => event.name === 'MethodLeave');
    assert(exception >= 0 && leave > exception);
  } finally { vm.stop(); }
});

test('restoring a catch before rethrow still uses the captured canonical fault identity', () => {
  const vm = new CilVirtualMachine(rethrowFixture(), {runtimeEvents: true});
  try {
    vm.runSlice({instructionBudget: 100, timeBudgetMs: 1000,
      onInstruction: instruction => instruction.name === 'rethrow'});
    assert.equal(vm.state, 'paused');
    const original = vm.top.caught.at(-1).fault, snapshot = vm.snapshot();
    assert.equal(events(vm).length, 1);
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      assert.notEqual(vm.top.caught.at(-1).fault, original);
      vm.heap.collect();
      vm.state = 'running';
      assert.equal(vm.run().returnValue, 7);
      assert.equal(events(vm).length, 1);
    }
  } finally { vm.stop(); }
});

test('an explicit throw of a caught object is a new origin while invalid rethrow is a new fault', () => {
  const vm = new CilVirtualMachine(rethrowFixture(true), {runtimeEvents: true});
  const invalid = new CilVirtualMachine(managedFixture({methods: [{name: 'Main',
    body: writer => writer.op('rethrow')}]}), {runtimeEvents: true});
  try {
    assert.equal(vm.run().returnValue, 7);
    assert.equal(events(vm).length, 2);
    assert(events(vm).every(event => event.payload.exceptionType === 'System.NullReferenceException'));
    assert.equal(invalid.run().fault.name, 'InvalidProgramException');
    assert.equal(events(invalid).length, 1);
    assert.equal(events(invalid)[0].payload.name, 'InvalidProgramException');
  } finally { vm.stop(); invalid.stop(); }
});

test('finally continuation propagates a fault without emitting another origin', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', body: (writer, context) => writer.op('call', context.methods.Fail).op('ret')},
    {name: 'Fail', body: writer => writer.mark('try').op('ldnull').op('throw')
      .mark('finally').op('nop').op('endfinally').mark('end'),
    handlers: labels => [{flags: 2, start: labels.try, end: labels.finally,
      target: labels.finally, handlerEnd: labels.end}]}
  ]});
  const vm = new CilVirtualMachine(bytes, {runtimeEvents: true});
  try {
    assert.equal(vm.run().fault.name, 'NullReferenceException');
    assert.equal(events(vm).length, 1);
    assert.equal(events(vm)[0].payload.method, 0x06000002);
  } finally { vm.stop(); }
});

test('instruction admission limits are observed without changing raw diagnostic names', () => {
  const bytes = managedFixture({methods: [{name: 'Main', body: writer => writer.mark('loop').op('br.s', 'loop')}]});
  const vm = new CilVirtualMachine(bytes, {runtimeEvents: true, maxInstructions: 0});
  try {
    assert.equal(vm.run().fault.name, 'InstructionLimitException');
    assert.deepEqual(events(vm).map(event => [event.payload.name, event.payload.exceptionType, event.payload.fatal]),
      [['InstructionLimitException', 'System.ExecutionEngineException', true]]);
    assert.equal(events(vm)[0].payload.ilOffset, 0);
  } finally { vm.stop(); }
});

test('subscriber failure stays outside guest EH and disposal cancels delivery', () => {
  const vm = new CilVirtualMachine(rethrowFixture(), {runtimeEvents: true});
  const failure = new Error('host event subscriber');
  const unsubscribe = vm.runtimeEvents.subscribe(event => {
    if (event.name === RuntimeEventName.ExceptionThrown) throw failure;
  });
  try {
    assert.throws(() => vm.run(), error => error === failure);
    assert.equal(vm.state, 'terminated');
    assert.equal(vm.returnValue, 7);
    assert.equal(vm.fault, null);
    unsubscribe();
    assert.doesNotThrow(() => vm.stop());
  } finally { unsubscribe(); vm.stop(); }
});

test('small logs preserve drop accounting and disabled/manual execution retains its boundary', () => {
  const observed = new CilVirtualMachine(faultFixture(), {runtimeEvents: {capacity: 1}});
  observed.onException = () => true;
  const manual = new CilVirtualMachine(faultFixture(), {runtimeEvents: true});
  const plain = new CilVirtualMachine(faultFixture());
  try {
    observed.runSlice({instructionBudget: 10, timeBudgetMs: 1000});
    assert.equal(events(observed).length, 1);
    assert.equal(observed.runtimeEvents.dropped, 2);
    manual.step(); manual.step();
    assert.throws(() => manual.step(), {name: 'DivideByZeroException'});
    assert.equal(events(manual).length, 0, 'manual step leaves fault ownership to its host');
    assert.equal(plain.run().fault.name, 'DivideByZeroException');
    assert.equal(plain.runtimeEvents, null);
  } finally { observed.stop(); manual.stop(); plain.stop(); }
});
