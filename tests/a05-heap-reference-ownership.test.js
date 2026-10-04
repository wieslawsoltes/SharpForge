import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap, CilVirtualMachine} from '@sharpforge/runtime';
import {ownsHeapReference} from '../packages/runtime/src/execution/heap-reference.js';
import {genericCallFixture} from './support/generic-call-fixture.js';

test('allocation provenance distinguishes equal-looking heaps and copied handles without changing heap.get', () => {
  const first = new ManagedHeap(), second = new ManagedHeap();
  const reference = first.object('System.Object', []), foreign = second.object('System.Object', []);
  const copied = Object.freeze({...reference});
  assert.deepEqual(reference, foreign);
  assert.deepEqual(Object.keys(reference), ['h', 'g']);
  assert(Object.isFrozen(reference));
  assert.equal(ownsHeapReference(first, reference), true);
  for (const value of [foreign, copied, null, undefined, 0]) assert.equal(ownsHeapReference(first, value), false);
  assert.equal(first.get(copied), first.get(reference), 'existing coordinate-based heap lookup is unchanged');
});

test('ownership never replaces generation checks or roots an otherwise dead object', () => {
  const heap = new ManagedHeap(), reference = heap.object('System.Object', []);
  heap.collect();
  assert.equal(ownsHeapReference(heap, reference), true);
  assert.throws(() => heap.get(reference), {name: 'InvalidReferenceException'});
  const replacement = heap.object('System.Object', []);
  assert.equal(replacement.h, reference.h);
  assert.notEqual(replacement.g, reference.g);
  assert.equal(ownsHeapReference(heap, replacement), true);
});

test('ordinary heap rollback preserves issued aliases without adopting copied or abandoned handles', () => {
  const heap = new ManagedHeap(), child = heap.object('System.Object', []);
  const parent = heap.object('System.Object', [child]), snapshot = heap.snapshot();
  const abandoned = heap.object('System.Object', []);
  heap.restore(snapshot);
  assert.equal(heap.get(parent).data[0], child);
  assert(ownsHeapReference(heap, parent));
  assert(ownsHeapReference(heap, child));
  assert.equal(ownsHeapReference(heap, Object.freeze({...child})), false);
  assert.throws(() => heap.get(abandoned), {name: 'InvalidReferenceException'});
});

test('guest object aliases in frames, statics, arrays and stacks retain their allocation identity on restore', () => {
  const bytes = genericCallFixture([
    {name: 'Holder', methods: [{name: '.ctor', static: false, body: writer => writer.op('ret')}]},
    {name: 'Program', fields: [{name: 'Root', type: 'Holder', flags: 0x16}], methods: [
      {name: 'Main', result: 'Holder', locals: ['Holder', 'Holder[]'], body(writer, context) {
        writer.op('newobj', context.methods.get('Holder..ctor')).op('stloc.0');
        writer.op('ldloc.0').op('stsfld', context.fields.get('Program.Root'));
        writer.op('ldc.i4.1').op('newarr', context.resolve('Holder')).op('stloc.1');
        writer.op('ldloc.1').op('ldc.i4.0').op('ldloc.0').op('stelem.ref');
        writer.op('ldloc.0').op('ret');
      }}
    ]}
  ]);
  const vm = new CilVirtualMachine(bytes);
  try {
    vm.runSlice({instructionBudget: 1000, timeBudgetMs: Infinity,
      onInstruction: (instruction, frame) => frame.method.name === 'Main' && instruction.name === 'ret'});
    assert.equal(vm.state, 'paused');
    const reference = vm.top.locals[0], snapshot = vm.snapshot();
    assert.throws(() => vm.restore({...snapshot, frames: null}), TypeError);
    assert.equal(vm.top.locals[0], reference, 'failed preflight leaves the issued handle intact');
    for (let replay = 0; replay < 2; replay++) {
      vm.restore(snapshot);
      const frame = vm.top;
      assert.equal(frame.locals[0], reference);
      assert.equal(frame.stack.at(-1), reference);
      assert.equal(vm.heap.get(frame.locals[1]).data[0], reference);
      assert([...vm.statics.values()].includes(reference));
      assert(ownsHeapReference(vm.heap, reference));
      vm.heap.collect();
      assert.equal(vm.heap.get(reference).type, 'Holder');
      vm.state = 'running';
      assert.equal(vm.run().state, 'terminated');
      assert.equal(vm.returnValue, reference);
    }
  } finally { vm.stop(); }
});
