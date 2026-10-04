import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

function bytes() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4.1').op('newarr', context.type).op('dup').op('ldc.i4.0')
        .op('newobj', context.methods['.ctor']).op('stelem.ref').op('ldnull')
        .op('call', context.member('System.Array', 'IndexOf', 'int', ['System.Array', 'object'])).op('ret');
    }},
    {name: '.ctor', static: false, body: writer => writer.op('ret')},
    {name: 'Equals', static: false, flags: 0xc6, result: 'bool', parameters: ['object'],
      body: writer => writer.op('ldc.i4.1').op('ret')}
  ]});
}

test('captured array equality rejects missing or forged return linkage before replacing the live VM', async () => {
  const assembly = bytes(), vm = new CilVirtualMachine(assembly);
  vm.runSlice({instructionBudget: 1000, timeBudgetMs: 1000,
    onInstruction: (_instruction, frame) => frame.method.name === 'Equals'});
  assert.equal(vm.state, 'paused');
  const saved = vm.snapshot(), ownerId = vm.frames.at(-2).id;
  const wire = await serializeSnapshot(vm, saved, {json: true});
  for (const mutate of [
    (owner, callee) => { delete callee.objectValueContinuation; },
    owner => { owner.objectValueResult = 1; },
    owner => { owner.intrinsicContinuation.comparisonPending = false; },
    owner => { owner.intrinsicContinuation.index = owner.intrinsicContinuation.length; },
    (_owner, callee) => { callee.objectValueContinuation.capture = false; },
    (_owner, callee) => { callee.objectValueContinuation.operation = 'GetHashCode'; }
  ]) {
    const invalid = vm.snapshot(), owner = invalid.frames.find(frame => frame.id === ownerId), callee = invalid.frames.at(-1);
    mutate(owner, callee);
    const frames = vm.frames, records = vm.heap.records;
    assert.throws(() => vm.restore(invalid), TypeError);
    assert.equal(vm.frames, frames);assert.equal(vm.heap.records, records);
  }
  vm.stop();vm.heap.collect();
  const fresh = new CilVirtualMachine(assembly);
  await restoreSerializedSnapshot(fresh, wire);
  fresh.heap.collect();fresh.state = 'running';
  assert.equal(fresh.run().state, 'terminated', fresh.fault?.message);
  assert.equal(fresh.returnValue, 0);
  fresh.stop();
});
