import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {constructBoundDelegate, delegateMethodPointer} from '../packages/runtime/src/execution/delegate-targets.js';
import {managedFixture} from './managed-fixtures.js';

function fixture(throwing) {
  return managedFixture({methods: [
    {name: 'Main', body(writer, context) {
      writer.op('ldftn', context.methods.Callback).op('pop')
        .mark('try').op(throwing ? 'ldc.i4.1' : 'ldc.i4.0').op('call', context.methods.Worker).op('leave.s', 'second')
        .mark('catch').op('pop').op('leave.s', 'second')
        .mark('second').op('ldc.i4.0').op('call', context.methods.Worker).op('ret');
    }, handlers: (labels, context) => [{start: labels.get('try'), end: labels.get('catch'),
      target: labels.get('catch'), handlerEnd: labels.get('second'), catchType: context.resolve('System.Exception')}]},
    {name: 'Worker', parameters: ['bool'], body: writer => writer.op('ldarg.0').op('brfalse.s', 'done')
      .op('ldnull').op('throw').mark('done').op('ret')},
    {name: 'Callback', body: (writer, context) => writer.op('ldstr', 0x70000000 + context.md.userString('once'))
      .op('call', context.member('System.Console', 'WriteLine', 'void', ['string'])).op('ret')}
  ]});
}

function reachWorker(vm) {
  for (let count = 0; count < 100 && vm.top?.method.name !== 'Worker'; count++) {
    vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
  }
  assert.equal(vm.top?.method.name, 'Worker', vm.fault?.message);
  return vm.top;
}

for (const throwing of [false, true]) {
  test(`async registration ${throwing ? 'unwind' : 'normal return'} cannot leak into a reused CIL frame`, () => {
    const vm = new CilVirtualMachine(fixture(throwing), {runtimeEvents: true});
    try {
      const frame = reachWorker(vm), identity = frame.id;
      const task = vm.scheduler.createTask('void');
      const receiver = constructBoundDelegate(vm, 'System.Action', null, delegateMethodPointer(vm, 0x06000003));
      frame.asyncRegistration = Object.freeze({task: task.ref, continuation: Object.freeze({kind: 'delegate', receiver})});
      vm.heap.collect();
      assert.doesNotThrow(() => vm.heap.get(receiver));
      for (let count = 0; count < 100 && vm.top === frame; count++) {
        vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});
      }
      assert.notEqual(vm.top, frame, vm.fault?.message);
      assert.equal(frame.asyncRegistration, undefined, 'Instruction-end retirement clears pending registration metadata');
      assert.equal(task.continuations?.length ?? 0, throwing ? 0 : 1,
        'Only a normal ret completes the registration after popping its frame');
      const reused = reachWorker(vm);
      assert.equal(reused, frame, 'The same pooled storage is exercised by the second call');
      assert.notEqual(reused.id, identity);
      assert.equal(reused.asyncRegistration, undefined);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(task.continuations?.length ?? 0, throwing ? 0 : 1, 'Reuse cannot register the old callback again');
      vm.scheduler.complete(task);
      assert.equal(vm.run().state, 'terminated', vm.fault?.message);
      assert.equal(vm.output.join(''), throwing ? '' : 'once\n');
      assert.equal(task.continuations?.length ?? 0, 0);
      vm.heap.collect();
      assert.throws(() => vm.heap.get(receiver), {name: 'InvalidReferenceException'});
    } finally { vm.stop(); }
  });
}
