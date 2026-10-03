import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagedHeap} from '@sharpforge/runtime';
import {visitFrameRoots, visitFrames} from '../packages/runtime/src/execution/frame-roots.js';
import {typedNumericSlots, numericSlots} from '../packages/runtime/src/execution/typed-stack.js';
import {slotLiveness, liveSlot} from '../packages/runtime/src/execution/slot-liveness.js';

function fixture(address = false) {
  const names = address ? ['ldloca.s', 'pop', 'nop', 'ret'] : ['ldloc.0', 'pop', 'nop', 'ret'];
  const method = {token: 0x06000001, signature: {isStatic: true, parameters: [], returnType: 'void'},
    locals: ['object', 'double'], maxStack: 1, handlers: [],
    instructions: names.map((name, offset) => ({name, offset, size: 1, operandKind: 'none',
      ...(name === 'ldloca.s' ? {operand: 0} : {})}))};
  const vm = {options: {}, inspector: {}, heap: new ManagedHeap(), frames: []};
  const frame = {id: 1, method, pc: 2, args: [], locals: [], stack: [], caught: [], unwinds: []};
  vm.frames.push(frame);
  return {vm, frame, method};
}

test('T09 precise roots clear the last-used object while numeric slots never materialize', () => {
  const {vm, frame} = fixture();
  const dead = vm.heap.object('System.Object', []);
  frame.locals = typedNumericSlots([dead, {float: 'r8', value: 1.25}]).array;
  const slots = numericSlots(frame.locals), count = slots.materializations;
  vm.heap.rootProvider = visit => visitFrameRoots(vm, frame, visit);
  vm.heap.collect();
  assert.equal(vm.heap.stats.liveObjects, 0);
  assert.equal(frame.locals[0], undefined);
  assert.equal(slots.materializations, count);
});

test('T09 addresses, parked frames, and finally return values retain managed objects', () => {
  const {vm, frame} = fixture(true);
  const addressed = vm.heap.object('System.Object', []), returned = vm.heap.object('System.Object', []);
  frame.locals = [addressed, 0];
  frame.unwinds.push({value: returned});
  vm.heap.rootProvider = visit => visitFrames(vm, [frame], [], visit);
  vm.heap.collect();
  assert.equal(vm.heap.stats.liveObjects, 2);
  frame.locals[0] = null;
  frame.unwinds.length = 0;
  vm.heap.collect();
  assert.equal(vm.heap.stats.liveObjects, 0);
});

test('T09 liveness follows loop backedges and preserves exception-handler locals', () => {
  const {method} = fixture();
  method.instructions = [
    {name: 'ldloc.0', offset: 0, operandKind: 'none'},
    {name: 'pop', offset: 1, operandKind: 'none'},
    {name: 'br.s', offset: 2, operandKind: 'br8', operand: 0}
  ];
  assert(liveSlot(slotLiveness(method), 2, 0));
  method.handlers.push({start: 0, end: 2, target: 2, flags: 0});
  assert.equal(slotLiveness(method).live, null);
});

test('T09 legacy iterable heap providers remain compatible with visitor root collection', () => {
  const heap = new ManagedHeap(), value = heap.object('System.Object', []);
  heap.rootProvider = () => [value];
  heap.collect();
  assert.equal(heap.stats.liveObjects, 1);
  heap.rootProvider = visit => visit(value);
  heap.collect();
  assert.equal(heap.stats.liveObjects, 1);
});
