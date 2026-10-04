import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilVirtualMachine, serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {beginObjectEquals} from '../packages/runtime/src/execution/object-value-operation.js';

const compiled = compileToIL('Console.WriteLine(42);');
assert(compiled.success, JSON.stringify(compiled.diagnostics));

function pending() {
  const vm = new CilVirtualMachine(compiled.assembly, {weakStringInterning: true});
  const left = vm.heap.string('x'.repeat(4096)), right = vm.heap.string('x'.repeat(4096));
  beginObjectEquals(vm, left, right, {capture: true});
  assert.equal(vm.top.objectValueWork.nodes.at(-1).phase, 'string');
  return vm;
}

test('Object string continuation uses captured storage after old operands are collected and portable rebinding', async () => {
  const vm = pending(), saved = vm.snapshot(), wire = await serializeSnapshot(vm);
  vm.stop();
  vm.heap.collect();
  vm.restore(saved);
  assert.equal(vm.top.objectValueWork.nodes[0].index, saved.frames.at(-1).objectValueWork.nodes[0].index);
  const fresh = new CilVirtualMachine(compiled.assembly);
  await restoreSerializedSnapshot(fresh, wire);
  assert.equal(fresh.heap.get(fresh.top.objectValueWork.nodes[0].left).data.length, 4096);
  vm.stop();
  fresh.stop();
});

test('Object continuation malformed cursors, frame ownership and result types reject atomically', () => {
  const vm = pending(), frames = vm.frames, records = vm.heap.records;
  for (const mutate of [
    state => { state.nodes[0].index = 4097; },
    state => { state.nodes[0].phase = 'waiting'; },
    state => { state.ownerFrameId++; },
    state => { state.remaining = 262145; },
    state => { state.nodes[0].hash = 2147483648; },
    state => { state.nodes[0].type = vm.heap.methodTables.get('int'); }
  ]) {
    const saved = vm.snapshot();
    mutate(saved.frames.at(-1).objectValueWork);
    assert.throws(() => vm.restore(saved), /Object/);
    assert.equal(vm.frames, frames);
    assert.equal(vm.heap.records, records);
  }
  const saved = vm.snapshot();
  saved.frames.at(-1).objectValueResult = 1.5;
  assert.throws(() => vm.restore(saved), /Object continuation result/);
  vm.stop();
});
