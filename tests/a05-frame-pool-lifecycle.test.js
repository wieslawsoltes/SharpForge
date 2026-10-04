import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, VirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {compileToIL} from '@sharpforge/compiler';
import {managedFixture} from './managed-fixtures.js';

function scheduledWorker() {
  return managedFixture({methods: [
    {name: 'Main', body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker)
        .op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false))
        .op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']))
        .op('pop').op('ret');
    }},
    {name: 'Worker', locals: ['object'], body: (writer, context) => writer
      .op('newobj', context.member('System.Object', '.ctor', 'void', [], false)).op('stloc.0')
      .op('ldc.i4', 60000).op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int']))
      .op('ldloc.0').op('pop').op('ret')}
  ]});
}

for (const cancel of [false, true]) {
  test(`CIL: parked frames remain live until ${cancel ? 'cancellation' : 'natural return'}`, () => {
    const vm = new CilVirtualMachine(scheduledWorker(), {virtualTime: true});
    assert.equal(vm.run().state, 'waiting', vm.fault?.message);
    const child = [...vm.scheduler.contexts.values()].find(context => context.kind === 'task');
    const frame = child.frames[0], identity = frame.id, reference = frame.locals[0];
    vm.heap.collect();
    assert(vm.heap.get(reference));
    vm.runSlice();
    assert.equal(frame.id, identity);
    assert.equal(frame.locals[0], reference);
    if (cancel) vm.scheduler.cancelAll();
    else {
      vm.scheduler.advance(60000);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    }
    assert.equal(frame.id, undefined);
    assert.equal(frame.locals.length, 0);
    assert.equal(frame.args.length, 0);
    assert.equal(frame.stack.length, 0);
    vm.heap.collect();
    assert.throws(() => vm.heap.get(reference), /reference/i);
    vm.stop();
    assert.equal(framePoolStatistics(vm).retainedBytes, 0);
  });
}

test('CIL: retirement clears late fields and stop preserves fatal inspection until disposal', () => {
  const vm = new CilVirtualMachine(managedFixture());
  vm.options.maxInstructions = 0;
  const frame = vm.top, reference = vm.heap.object('System.Object', []);
  frame.returnObject = reference;
  frame.genericIdentity = 'Fixture.Program';
  frame.methodArguments = ['object'];
  frame.prefixState = {reference};
  assert.equal(vm.run().state, 'faulted');
  assert.equal(vm.top, frame);
  assert.equal(frame.method.name, 'Main');
  assert.equal(frame.returnObject, reference);
  vm.stop();
  for (const key of ['method', 'returnObject', 'genericIdentity', 'methodArguments', 'prefixState']) {
    assert.equal(frame[key], undefined, key);
  }
  vm.heap.collect();
  assert.throws(() => vm.heap.get(reference), /reference/i);
});

for (const engine of ['source', 'cil']) {
  test(`${engine}: exception unwinding releases callee roots before reuse`, () => {
    const result = compileToIL('class Program { static void Fail() { int[] x = new int[1]; throw new Exception("expected"); } static int Main() { int caught = 0; for (int i = 0; i < 5; i++) { try { Fail(); } catch (Exception) { caught++; } } return caught; } }');
    assert(result.success, JSON.stringify(result.diagnostics));
    const vm = engine === 'cil' ? new CilVirtualMachine(result.assembly) : new VirtualMachine(result.image);
    assert.equal(vm.run().state, 'terminated', vm.fault?.message);
    assert.equal(vm.returnValue, 5);
    assert(framePoolStatistics(vm).reused >= 4);
    // The emitted entry wrapper, Main, and five Fail invocations all retire.
    assert.equal(framePoolStatistics(vm).released, 7);
    vm.stop();
  });
}
