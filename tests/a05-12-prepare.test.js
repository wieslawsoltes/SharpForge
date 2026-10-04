import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareExecution, executionCodeStatistics} from '@sharpforge/runtime';
import {controlFixture, genericInstance} from './support/control-fixture.js';
import {withVM} from '../bench/vm/operations.js';

function assertPreparedRun(vm, expected) {
  const prepared = prepareExecution(vm);
  assert.deepEqual(prepareExecution(vm).statistics, prepared.statistics);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, expected);
  assert.equal(executionCodeStatistics(vm).decodePlans, prepared.statistics.decodePlans,
    'Execution decoded a method inside the supposedly prepared interval');
  return prepared;
}

test('T12 preparation covers actual nongeneric call identities and excludes unreachable invalid IL', async () => {
  const bytes = controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4', 41).op('call', context.methods.get('Program.Increment')).op('ret');
    }},
    {name: 'Increment', result: 'int', parameters: ['int'],
      body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')},
    {name: 'Unreachable', body: writer => writer.op('pop').op('ret')}
  ]}]);
  await withVM(() => new CilVirtualMachine(bytes), vm => {
    const before = {instructions: vm.instructions, pc: vm.top.pc, allocations: vm.heap.stats.allocations};
    const prepared = prepareExecution(vm);
    assert.deepEqual({instructions: vm.instructions, pc: vm.top.pc, allocations: vm.heap.stats.allocations}, before);
    assert.equal(prepared.methods, vm.report.methods.length);
    assert.equal(prepared.contexts.some(([token]) => token === 0x06000003), false);
    assertPreparedRun(vm, 42);
  });
});

function genericFixture() {
  return controlFixture([
    {name: 'Cell`1', genericParameters: [{}], methods: [{
      name: 'Identity', parameters: ['object'], result: 'object', genericParameters: [{}],
      signature: Uint8Array.from([0x10, 1, 1, 0x1e, 0, 0x1e, 0]),
      body: writer => writer.op('ldarg.0').op('ret')
    }]},
    {name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
      const owner = context.typeSpec(genericInstance(context.types.get('Cell`1'), [[14]]));
      const definition = context.md.member(owner, 'Identity', Uint8Array.from([0x10, 1, 1, 0x1e, 0, 0x1e, 0]));
      const target = context.methodSpec(definition, [[8]]);
      writer.op('ldc.i4', 42).op('call', target).op('call', target).op('ret');
    }}]}
  ]);
}

test('T12 closed generic and restored live method aliases are prepared without replacing frames', async () => {
  await withVM(() => new CilVirtualMachine(genericFixture()), vm => {
    const cold = prepareExecution(vm);
    assert(cold.deferredMethods.includes(0x06000001), 'An open definition needs a closed context');
    for (let count = 0; count < 20 && vm.top.method.name !== 'Identity'; count++) vm.step();
    assert.equal(vm.top.method.name, 'Identity');
    const snapshot = vm.snapshot();
    const live = vm.top.method;
    const prepared = prepareExecution(vm);
    assert.equal(vm.top.method, live);
    assert(prepared.contexts.some(([token, owner, arguments_]) => token === 0x06000001 &&
      owner === 'Cell`1<System.String>' && arguments_.join(',') === 'System.Int32'));
    assertPreparedRun(vm, 42);
    vm.restore(snapshot);
    const restored = vm.top.method;
    const restoredPlan = prepareExecution(vm);
    assert.equal(vm.top.method, restored, 'Preparation must preserve restored/debugger method identity');
    assert(restoredPlan.plans > restoredPlan.methods, 'Both restored and new canonical objects need plans');
    assertPreparedRun(vm, 42);
  });
});
