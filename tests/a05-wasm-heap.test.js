import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, prepareWasmTier, wasmTierStatistics} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {managedFixture} from './managed-fixtures.js';

function heapFixture() {
  return controlFixture([{name: 'Program', fields: [
    {name: 'Value', type: 'string', flags: 6}, {name: 'Count', type: 'int'},
  ], methods: [
    {name: 'Main', result: 'string', locals: ['Program', 'string[]'], body(writer, context) {
      writer.op('newobj', context.methods.get('Program..ctor')).op('stloc.0')
        .op('ldc.i4.1').op('newarr', context.resolve('System.String')).op('stloc.1')
        .op('ldloc.1').op('ldc.i4.0').op('ldstr', 0x70000000 + context.md.userString('rooted'))
        .op('stelem.ref').op('ldloc.0').op('ldloc.1').op('ldc.i4.0').op('ldelem.ref')
        .op('stfld', context.fields.get('Program.Value')).op('ldc.i4', 123)
        .op('stsfld', context.fields.get('Program.Count')).op('ldloc.0')
        .op('volatile.').op('ldfld', context.fields.get('Program.Value')).op('ret');
    }},
    {name: '.ctor', static: false, flags: 0x1886, body: (writer, context) => writer.op('ldarg.0')
      .op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret')},
  ]}]);
}

test('T11.5 native heap imports preserve handles, barriers, writes and instruction GC', async () => {
  const bytes = heapFixture();
  const options = {gcStress: 'instruction', initialThreshold: 1};
  const baseline = new CilVirtualMachine(bytes, options);
  const vm = new CilVirtualMachine(bytes, {...options, wasmTiering: true});
  const writes = [];
  const expectedWrites = [];
  vm.onWrite = event => writes.push(event.kind);
  baseline.onWrite = event => expectedWrites.push(event.kind);
  const prepared = await prepareWasmTier(vm);
  assert.equal(prepared.status, 'ready', JSON.stringify(prepared));
  baseline.run();
  vm.run();
  assert.equal(vm.state, baseline.state);
  assert.equal(vm.fault, null);
  assert.equal(vm.value(vm.returnValue), 'rooted');
  assert.deepEqual(writes, expectedWrites);
  assert.equal(vm.heap.mutationRevision, baseline.heap.mutationRevision);
  assert.equal(vm.heap.stats.allocations, baseline.heap.stats.allocations);
  assert.equal(vm.heap.stats.collections, baseline.heap.stats.collections);
  assert.ok(wasmTierStatistics(vm).bridgeInstructions > 10);
  assert.ok(writes.includes('array'));
  assert.ok(writes.includes('field'));
  assert.ok(writes.includes('static'));
});

test('T11.5 native field stores invalidate shared snapshot heap pages', async () => {
  const vm = new CilVirtualMachine(heapFixture(), {wasmTiering: true});
  await prepareWasmTier(vm);
  vm.runSlice({instructionBudget: 100, timeBudgetMs: 1000,
    onInstruction: instruction => instruction.name === 'stfld'});
  assert.equal(vm.state, 'paused');
  const snapshot = vm.snapshot();
  const receiver = vm.top.stack.at(-2);
  assert.equal(vm.heap.get(receiver).data[0], null);
  vm.state = 'running';
  vm.run();
  assert.equal(vm.value(vm.returnValue), 'rooted');
  vm.restore(snapshot);
  assert.equal(vm.heap.get(vm.top.stack.at(-2)).data[0], null);
  vm.state = 'running';
  vm.run();
  assert.equal(vm.value(vm.returnValue), 'rooted');
});

test('T11.5 array import preserves bounds and allocation-budget exceptions', async () => {
  for (const [length, index, options] of [[1, 1, {}], [100, 0, {maxArrayLength: 2}]]) {
    const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body: (writer, context) => writer
      .op('ldc.i4', length).op('newarr', context.resolve('System.Int32'))
      .op('ldc.i4', index).op('ldelem.i4').op('ret')} ]});
    const baseline = new CilVirtualMachine(bytes, options);
    const vm = new CilVirtualMachine(bytes, {...options, wasmTiering: true});
    assert.equal((await prepareWasmTier(vm)).status, 'ready');
    baseline.run();
    vm.run();
    assert.equal(vm.fault.name, baseline.fault.name);
    assert.equal(vm.fault.message, baseline.fault.message);
    assert.deepEqual(vm.fault.frames, baseline.fault.frames);
  }
});
