import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {invokeManagedMethod} from '../packages/runtime/src/ui/callbacks.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture() {
  return genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', maxStack: 0, body: writer => writer.op('ret')},
    {name: 'Outer', maxStack: 0, body: writer => writer.op('nop').op('ret')},
    {name: 'Inner', maxStack: 0, body: writer => writer.op('nop').op('ret')},
    {name: 'Spin', maxStack: 0, body: writer => writer.mark('loop').op('br.s', 'loop')}
  ]}]);
}

const token = (vm, name) => [...vm.inspector.methods.values()].find(method => method.name === name).token;
const entries = vm => vm.runtimeEvents.read().filter(event => event.name === 'MethodEnter');
const leaves = vm => vm.runtimeEvents.read().filter(event => event.name === 'MethodLeave');

function assertClosedOnce(vm) {
  const enter = entries(vm), leave = leaves(vm);
  assert.equal(leave.length, enter.length);
  for (const event of enter) {
    const closed = leave.filter(value => value.payload.frame === event.payload.frame);
    assert.equal(closed.length, 1, 'Each entered frame closes exactly once');
    assert.equal(closed[0].payload.method, event.payload.method);
    assert(closed[0].sequence > event.sequence);
  }
}

test('A16 nested CIL callback event flushes preserve live outer frames until their real returns', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const main = vm.top.id, outer = token(vm, 'Outer'), inner = token(vm, 'Inner');
  const runSlice = vm.runSlice;
  let invoked = false, outerFrame;
  try {
    vm.runSlice = function(options) {
      return runSlice.call(this, {...options, onInstruction(instruction, frame) {
        if (invoked || frame.method.token !== outer || instruction.name !== 'nop') return;
        invoked = true;
        outerFrame = frame.id;
        invokeManagedMethod(vm.platform, inner, null, []);
        assert.equal(vm.top, frame);
        assert.equal(leaves(vm).some(event => [main, outerFrame].includes(event.payload.frame)), false,
          'The inner slice must not report retained Main or Outer frames as canceled');
      }});
    };
    invokeManagedMethod(vm.platform, outer, null, []);
    assert.equal(invoked, true);
    assert.equal(leaves(vm).some(event => event.payload.frame === main), false);
    assert.deepEqual(leaves(vm).map(event => event.payload.method), [inner, outer]);
    assert(leaves(vm).every(event => event.payload.reason === 'return'));
    vm.runSlice = runSlice;
    assert.equal(vm.run().state, 'terminated');
    assert.equal(leaves(vm).at(-1).payload.frame, main);
    assertClosedOnce(vm);
    const count = leaves(vm).length;
    vm.stop();
    assert.equal(leaves(vm).length, count, 'Stopping completed execution does not close spans twice');
  } finally { vm.runSlice = runSlice; vm.stop(); }
});

test('A16 aborted CIL callbacks close only their owned span and preserve caller termination accounting', () => {
  const vm = new CilVirtualMachine(fixture(), {runtimeEvents: true});
  const main = vm.top.id, spin = token(vm, 'Spin');
  try {
    assert.throws(() => invokeManagedMethod(vm.platform, spin, null, [], {maxInstructions: 2}),
      {name: 'ExecutionLimitException'});
    const canceled = leaves(vm);
    assert.equal(canceled.length, 1);
    assert.equal(canceled[0].payload.method, spin);
    assert.equal(canceled[0].payload.reason, 'canceled');
    assert.notEqual(canceled[0].payload.frame, main);
    assert.equal(vm.top.id, main);
    assert.equal(vm.run().state, 'terminated');
    assert.equal(leaves(vm).at(-1).payload.frame, main);
    assert.equal(leaves(vm).at(-1).payload.reason, 'return');
    assertClosedOnce(vm);
  } finally { vm.stop(); }
});
