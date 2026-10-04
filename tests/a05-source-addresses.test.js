import test from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '@sharpforge/compiler';
import {VirtualMachine} from '@sharpforge/runtime';
import {Op} from '@sharpforge/bytecode';
import {sourceAddressHandlers} from '../packages/runtime/src/execution/source-ops/addresses.js';
import {controlStackEffect} from '../packages/bytecode/src/control-stack-effect.js';
import {createArray} from '../packages/runtime/src/execution/arrays.js';

function machine() {
  const result = compile('class P { static void Main() { int value = 1; } }');
  assert(result.success, JSON.stringify(result.diagnostics));
  const vm = new VirtualMachine(result.image);
  const method = result.image.methods.find(candidate => candidate.locals.some(local => local.name === 'value'));
  if (vm.top.methodId !== method.id) vm.call(method.id, []);
  return vm;
}

test('T04 source indirect instructions alias storage and retain readonly views', () => {
  const vm = machine();
  try {
    const frame = vm.top;
    const slot = vm.image.methods[frame.methodId].locals.findIndex(local => local.name === 'value');
    frame.locals[slot] = 1;
    const type = vm.image.constants.push('int') - 1;
    sourceAddressHandlers[Op.ADDRESS](vm, frame, 1, slot);
    const pointer = vm.stack.pop();
    vm.stack.push(pointer, 17);
    sourceAddressHandlers[Op.STIND](vm, frame, type);
    assert.equal(vm.stack.pop(), 17);
    assert.equal(frame.locals[slot], 17);
    vm.stack.push(pointer);
    sourceAddressHandlers[Op.ADDRESS](vm, frame, 261, 0);
    const readonly = vm.stack.pop();
    assert.equal(readonly.frameId, pointer.frameId);
    assert.equal(readonly.index, pointer.index);
    assert.equal(vm.dereference(readonly), 17);
    assert.throws(() => vm.dereference(readonly, true, 3), {name: 'InvalidProgramException'});
    vm.stack.push(pointer);
    sourceAddressHandlers[Op.LDIND](vm, frame, type);
    assert.equal(vm.stack.pop(), 17);
    vm.stop();
    assert.throws(() => vm.dereference(pointer), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('T04 source address verifier rejects invalid flags, slots, readonly views and indirect type operands', () => {
  const context = {image: {constants: ['int'], statics: []}, method: {locals: [{}]}};
  assert.deepEqual(controlStackEffect(Op.ADDRESS, 1, 0, context), {need: 0, delta: 1, error: null});
  assert.deepEqual(controlStackEffect(Op.ADDRESS, 261, 0, context), {need: 1, delta: 0, error: null});
  for (const [op, a, b] of [[Op.ADDRESS, 512, 0], [Op.ADDRESS, 1, 1], [Op.ADDRESS, 5, 0],
    [Op.ADDRESS, 261, 1], [Op.LDIND, 2, 0], [Op.STIND, 0, 1]]) {
    assert(controlStackEffect(op, a, b, context).error);
  }
});

test('source array address bounds use catchable array faults while malformed locations remain invalid', () => {
  const vm = machine();
  try {
    const array = createArray(vm, 'int', [1]);
    for (const index of [-1, 1, 2]) {
      assert.throws(() => vm.address('array', index, array), {name: 'IndexOutOfRangeException'});
    }
    assert.throws(() => vm.address('array', 0.5, array), {name: 'InvalidProgramException'});
    assert.throws(() => vm.address('local', -1), {name: 'InvalidProgramException'});
    assert.equal(vm.dereference(vm.address('array', 0, array)), 0);
  } finally { vm.stop(); }
});
