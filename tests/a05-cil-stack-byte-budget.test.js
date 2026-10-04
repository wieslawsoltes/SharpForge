import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {decimalParse} from '@sharpforge/bytecode';
import {cilCallFrame} from '../packages/runtime/src/execution/call-frames.js';
import {popPooledFrame} from '../packages/runtime/src/execution/frame-retirement.js';
import {flushFramePool} from '../packages/runtime/src/execution/frame-pool.js';
import {managedFixture} from './managed-fixtures.js';

const literal = (maxStack = 1) => managedFixture({methods: [
  {name: 'Main', maxStack, result: 'int', body: writer => writer.integer(42).op('ret')}
]});
const empty = () => managedFixture({methods: [{name: 'Main', maxStack: 0, body: writer => writer.op('ret')}]});
const fault = {name: 'StackOverflowException', message: 'Managed stack byte budget exceeded'};
function tokenFor(vm, name) {
  return [...vm.inspector.methods.values()].find(method => method.name === name).token;
}

for (const maxStackBytes of [0, 15, -1, 1.5, NaN, Infinity, '24', null]) {
  test(`invalid stack byte limit ${String(maxStackBytes)} is rejected at admission`, () => {
    assert.throws(() => new CilVirtualMachine(empty(), {maxStackBytes}), /safe integer of at least 16 bytes/);
  });
}

test('zero-peak frames fit sixteen bytes, a single evaluation slot requires twenty-four', () => {
  assert.equal(new CilVirtualMachine(empty(), {maxStackBytes: 16}).run().state, 'terminated');
  assert.throws(() => new CilVirtualMachine(literal(), {maxStackBytes: 23}), fault);
  assert.equal(new CilVirtualMachine(literal(), {maxStackBytes: 24}).run().returnValue, 42);
  assert.equal(new CilVirtualMachine(literal()).run().returnValue, 42, 'the default remains unrestricted by bytes');
});

test('byte accounting follows reserved verified capacity, including inflated CLI headers', () => {
  assert.throws(() => new CilVirtualMachine(literal(8), {maxStackBytes: 24}), fault);
  const vm = new CilVirtualMachine(literal(8), {maxStackValues: 1, maxStackBytes: 24});
  assert.equal(vm.run().returnValue, 42);
});

test('rejected recursive call allocates no frame and leaves the caller inspectable', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackBytes: 24});
  const caller = vm.top, frames = framePoolStatistics(vm).framesAllocated;
  assert.throws(() => vm.call(caller.method.token, []), fault);
  assert.equal(vm.top, caller);
  assert.equal(vm.frames.length, 1);
  assert.equal(framePoolStatistics(vm).framesAllocated, frames);
  assert.equal(vm.run().returnValue, 42);
  vm.state = 'running';
  vm.call(caller.method?.token ?? vm.inspector.pe.entryPoint, []);
  assert.equal(vm.run().returnValue, 42, 'return releases live bytes even when the frame stays pooled');
});

test('argument normalization failure rolls back its provisional reservation', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', maxStack: 0, body: writer => writer.op('ret')},
    {name: 'Echo', maxStack: 1, parameters: ['int'], result: 'int', body: writer => writer.op('ldarg.0').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes, {maxStackBytes: 48});
  const method = vm.inspector.getMethod(tokenFor(vm, 'Echo'));
  // A closed body not reached by the entry verifier retains full checked capacity.
  vm.options.maxStackValues = 1;
  const storage = vm.storage;
  vm.storage = () => { throw new Error('argument conversion failed'); };
  assert.throws(() => cilCallFrame(vm, method, [42], {}), /argument conversion failed/);
  assert.equal(vm.frames.length, 1);
  vm.storage = storage;
  const frame = cilCallFrame(vm, method, [42], {});
  vm.frames.push(frame);
  assert.equal(frame.args[0], 42);
  popPooledFrame(vm);
  flushFramePool(vm);
  assert.equal(vm.run().state, 'terminated');
});

for (const nativeIntBits of [32, 64]) {
  test(`Decimal, native integers and managed addresses use metadata storage widths (${nativeIntBits}-bit ABI)`, () => {
    const bytes = managedFixture({methods: [{name: 'Main', maxStack: 0,
      locals: ['decimal', 'nint', 'object&'], body: writer => writer.op('ret')} ]});
    assert.throws(() => new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: 47}), fault);
    const vm = new CilVirtualMachine(bytes, {nativeIntBits, maxStackBytes: 48});
    assert.equal(vm.run().state, 'terminated');
  });
}

test('concrete instantiated signatures determine Decimal argument and local charges', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackBytes: 80, maxStackValues: 1});
  const original = vm.top.method;
  // Instantiated methods share their verified body but own concrete signature/local metadata.
  const method = {...original, locals: ['decimal'], signature: {...original.signature, parameters: ['decimal']}};
  const frame = cilCallFrame(vm, method, [decimalParse('1.25')], {});
  vm.frames.push(frame);
  assert.throws(() => cilCallFrame(vm, method, [decimalParse('1.25')], {}), fault);
  assert.equal(frame.args[0].coefficient, 125n);
  popPooledFrame(vm);
  flushFramePool(vm);
  assert.equal(vm.run().returnValue, 42);
});

test('lowered and invalid live limits reject before dispatch or direct push', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackBytes: 24});
  vm.step();
  vm.options.maxStackBytes = 23;
  assert.throws(() => vm.step(), fault);
  assert.throws(() => vm.push(7), fault);
  assert.equal(vm.top.pc, 1);
  assert.deepEqual(vm.top.stack, [42]);
  vm.options.maxStackBytes = NaN;
  assert.throws(() => vm.step(), /safe integer/);
  vm.options.maxStackBytes = 24;
  assert.equal(vm.run().returnValue, 42);
});

test('turning on a byte limit accounts existing frames; removing it restores default admission', () => {
  const vm = new CilVirtualMachine(literal());
  vm.options.maxStackBytes = 23;
  assert.throws(() => vm.step(), fault);
  delete vm.options.maxStackBytes;
  assert.equal(vm.run().returnValue, 42);
});

test('snapshot rejection precedes heap/frame mutation, and successful replay reconstructs live charges', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackBytes: 48});
  vm.call(vm.top.method.token, []);
  const snapshot = vm.snapshot();
  const frames = vm.frames, revision = vm.heap.mutationRevision;
  vm.options.maxStackBytes = 47;
  assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
  assert.equal(vm.frames, frames);
  assert.equal(vm.heap.mutationRevision, revision);
  vm.options.maxStackBytes = 48;
  vm.restore(snapshot);
  assert.throws(() => vm.call(vm.top.method.token, []), fault);
  vm.stop();
  vm.call(vm.inspector.pe.entryPoint, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 42, 'stop clears prior accounting');
});

function workers() {
  return managedFixture({methods: [
    {name: 'Main', maxStack: 2, body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker);
      writer.op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false));
      writer.op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']));
      writer.op('pop').op('ret');
    }},
    {name: 'Worker', maxStack: 1, body: (writer, context) => writer.integer(60000)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret')}
  ]});
}

test('parked contexts count against the VM total and parked snapshots are preflighted', () => {
  const vm = new CilVirtualMachine(workers(), {virtualTime: true, maxStackBytes: 56});
  assert.equal(vm.run().state, 'waiting');
  const snapshot = vm.snapshot();
  vm.options.maxStackBytes = 23;
  assert.throws(() => vm.restore(snapshot), /Snapshot exceeds managed stack byte budget/);
  vm.options.maxStackBytes = 47;
  assert.throws(() => vm.call(tokenFor(vm, 'Worker'), []), fault);
  vm.options.maxStackBytes = 56;
  vm.restore(snapshot);
  vm.scheduler.advance(60000);
  assert.equal(vm.run().state, 'terminated');
  vm.restore(snapshot);
  vm.stop();
  vm.call(tokenFor(vm, 'Worker'), []);
  assert.equal(vm.frames.length, 1, 'cancellation releases parked charges');
  vm.stop();
});

test('replaced unverified bodies reserve their checked fallback rather than stale verified capacity', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackValues: 2, maxStackBytes: 24});
  vm.top.method.instructions = [...vm.top.method.instructions];
  assert.throws(() => vm.step(), fault);
  assert.equal(vm.top.pc, 0);
});

test('exception unwind releases a callee before the next call uses the same byte budget', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', maxStack: 1, body(writer, context) {
      for (let index = 0; index < 2; index++) {
        writer.mark('try' + index).op('call', context.methods.Thrower).op('leave.s', 'done' + index);
        writer.mark('catch' + index).op('pop').op('leave.s', 'done' + index).mark('done' + index);
      }
      writer.integer(42).op('ret');
    }, handlers(labels, context) {
      return [0, 1].map(index => ({start: labels.get('try' + index), end: labels.get('catch' + index),
        target: labels.get('catch' + index), handlerEnd: labels.get('done' + index),
        catchType: context.resolve('System.Exception')}));
    }},
    {name: 'Thrower', maxStack: 2, body: writer =>
      writer.op('ldc.i4.1').op('ldc.i4.0').op('div').op('pop').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes, {maxStackBytes: 56});
  assert.equal(vm.run().returnValue, 42);
});


test('admission while enqueue switches frame arrays still accounts the parent context', () => {
  const vm = new CilVirtualMachine(workers());
  vm.scheduler.ensure();
  const parentFrames = vm.frames;
  vm.frames = [];
  vm.options.maxStackBytes = 55;
  assert.throws(() => vm.call(tokenFor(vm, 'Worker'), []), fault);
  assert.equal(vm.frames.length, 0);
  vm.frames = parentFrames;
  vm.stop();
});


for (const changed of ['locals', 'signature', 'parameters']) {
  test(`host replacement of ${changed} triggers byte admission before the next instruction`, () => {
    const vm = new CilVirtualMachine(literal(), {maxStackBytes: 24});
    vm.step();
    if (changed === 'locals') vm.top.method.locals = ['decimal'];
    else if (changed === 'signature') {
      vm.top.method.signature = {...vm.top.method.signature, parameters: ['decimal']};
    } else vm.top.method.signature.parameters = ['decimal'];
    assert.throws(() => vm.step(), fault);
    assert.throws(() => vm.push(7), fault);
    assert.equal(vm.top.pc, 1);
    assert.deepEqual(vm.top.stack, [42]);
    vm.stop();
  });
}
