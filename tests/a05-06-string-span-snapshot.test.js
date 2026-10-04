import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {VirtualMachine, CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {spanFromString} from '../packages/runtime/src/execution/string-span.js';
import {spanGet, spanSlice} from '../packages/runtime/src/execution/spans.js';

const compiled = compileToIL('Console.WriteLine(42);');
assert(compiled.success, JSON.stringify(compiled.diagnostics));

for (const engine of ['source', 'cil']) {
  const machine = () => engine === 'source' ? new VirtualMachine(compiled.image) : new CilVirtualMachine(compiled.assembly);
  test(`${engine}: readonly UTF-16 spans replay after collection of the original string`, async () => {
    const vm = machine();
    vm.returnValue = spanFromString(vm, vm.heap.string('A\u{1f642}Z'), 1, 2);
    const saved = vm.snapshot(), wire = await serializeSnapshot(vm);
    vm.stop();
    vm.returnValue = null;
    vm.heap.collect();
    vm.restore(saved);
    assert.equal(spanGet(vm, vm.returnValue, 0), 0xd83d);
    assert.equal(spanGet(vm, vm.returnValue, 1), 0xde42);
    const fresh = machine();
    await restoreSerializedSnapshot(fresh, wire);
    assert.equal(spanGet(fresh, fresh.returnValue, 0), 0xd83d);
    assert.equal(spanGet(fresh, fresh.returnValue, 1), 0xde42);
    fresh.returnValue = spanSlice(fresh, spanFromString(fresh, fresh.returnValue.pointer.owner), 4, 0);
    const empty = fresh.snapshot();
    fresh.restore(empty);
    assert.equal(fresh.returnValue.length, 0);
    assert.equal(fresh.returnValue.pointer.index, 4);
    vm.stop();
    fresh.stop();
  });

  test(`${engine}: forged mutable, mistyped and oversized string spans reject before replacement`, () => {
    const vm = machine();
    vm.returnValue = spanFromString(vm, vm.heap.string('abc'));
    const frames = vm.frames, records = vm.heap.records;
    for (const changes of [{readonly: false}, {length: 4}, {elementType: vm.heap.methodTables.get('int')}]) {
      const saved = vm.snapshot();
      saved.returnValue = Object.freeze({...saved.returnValue, ...changes});
      assert.throws(() => vm.restore(saved), /Span/);
      assert.equal(vm.frames, frames);
      assert.equal(vm.heap.records, records);
    }
    const saved = vm.snapshot();
    saved.returnValue = Object.freeze({...saved.returnValue,
      pointer: Object.freeze({...saved.returnValue.pointer, readonly: false})});
    assert.throws(() => vm.restore(saved), /readonly string address/);
    assert.equal(vm.frames, frames);
    assert.equal(vm.heap.records, records);
    vm.stop();
  });
}
