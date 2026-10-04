import test from 'node:test';
import assert from 'node:assert/strict';
import {FORMAT_VERSION, Op, Binary} from '@sharpforge/bytecode';
import {VirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';

function fixture() {
  const methods = ['Main', 'Value'].map((name, id) => ({id, name, qualifiedName: name, owner: null,
    isStatic: true, parameters: [], returnType: 'int', locals: [], handlers: [],
    code: Int32Array.from([Op.CONST, 0, 0, Op.RET, 0, 0])}));
  return {formatVersion: FORMAT_VERSION, entryPoint: 0, constants: [7, 2], methods,
    types: [], statics: [], sequencePoints: [], sources: []};
}

const step = vm => vm.runSlice({instructionBudget: 1, timeBudgetMs: Infinity});

function warm(vm) {
  let reused, previousId = 0;
  for (let index = 0; index < 3; index++) {
    vm.call(1, []);
    const frame = vm.top;
    if (reused) assert.equal(frame, reused, 'The same physical frame must be recycled');
    assert(frame.id > previousId);
    previousId = frame.id;
    reused = frame;
    step(vm);
    assert.equal(vm.top, frame);
    assert.equal(frame.pc, 1);
    step(vm);
    assert.equal(vm.frames.length, 1);
    assert.equal(vm.stack.pop(), 7);
  }
  vm.call(1, []);
  assert.equal(vm.top, reused);
  assert(vm.top.id > previousId);
  return reused;
}

function rejectBeforeInstruction(vm, expected) {
  const frame = vm.top, pc = frame.pc, instructions = vm.instructions, stack = [...vm.stack];
  step(vm);
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.fault.name, expected);
  assert.equal(frame.pc, pc);
  assert.equal(vm.instructions, instructions);
  assert.deepEqual(vm.stack, stack);
}

for (const sourceFusion of [false, true]) {
  test(`reused source admission retains new-frame stack-shape validation, fusion=${sourceFusion}`, () => {
    const vm = new VirtualMachine(fixture(), {sourceFusion, maxStackBytes: 64});
    try {
      warm(vm);
      vm.stack.push(1, 2);
      rejectBeforeInstruction(vm, 'InvalidProgramException');
    } finally { vm.stop(); }
  });

  test(`reused source admission retains live quota checks and recovery, fusion=${sourceFusion}`, () => {
    const vm = new VirtualMachine(fixture(), {sourceFusion, maxStackBytes: 48});
    try {
      const frame = warm(vm);
      step(vm);
      assert.equal(frame.pc, 1);
      vm.options.maxStackBytes = 47;
      rejectBeforeInstruction(vm, 'StackOverflowException');
      vm.options.maxStackBytes = 48;
      vm.fault = null;
      vm.state = 'running';
      step(vm);
      assert.equal(vm.stack.pop(), 7);
      vm.call(1, []);
      assert.equal(vm.top, frame);
      step(vm);
      step(vm);
      assert.equal(vm.stack.pop(), 7);
    } finally { vm.stop(); }
  });

  for (const inPlace of [false, true]) {
    test(`reused source admission rechecks changed code, fusion=${sourceFusion}, inPlace=${inPlace}`, () => {
      const image = fixture();
      const original = [Op.CONST, 0, 0, Op.POP, 0, 0, Op.CONST, 0, 0, Op.RET, 0, 0];
      const replacement = [Op.CONST, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], 0, Op.RET, 0, 0];
      const vm = new VirtualMachine(image, {sourceFusion, maxStackBytes: 48});
      try {
        warm(vm);
        image.methods[1].code = Int32Array.from(original);
        step(vm);
        assert.equal(vm.top.pc, 1);
        if (inPlace) {
          image.methods[1].code.set(replacement);
          invalidateExecutionCode(vm, 'changed-active-reused-source-frame');
        } else image.methods[1].code = Int32Array.from(replacement);
        rejectBeforeInstruction(vm, 'StackOverflowException');
      } finally { vm.stop(); }
    });
  }

  test(`reused source admission retains changed storage metadata, fusion=${sourceFusion}`, () => {
    const vm = new VirtualMachine(fixture(), {sourceFusion, maxStackBytes: 48});
    try {
      const frame = warm(vm);
      step(vm);
      vm.image.methods[1].locals.push({name: 'late', slot: 0, type: 'int'});
      frame.locals.length = 1;
      rejectBeforeInstruction(vm, 'StackOverflowException');
    } finally { vm.stop(); }
  });
}
