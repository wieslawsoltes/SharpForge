import test from 'node:test';
import assert from 'node:assert/strict';
import {Op} from '@sharpforge/bytecode';
import {compileToIL} from '@sharpforge/compiler';
import {loadAssembly} from '@sharpforge/cil';
import {VirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {getSourceFusionPlan} from '../packages/runtime/src/execution/source-fusion.js';

const source = `class P {
  static int Fib(int n) { if(n < 2) return n; return Fib(n-1) + Fib(n-2); }
  static int Main() { return Fib(7); }
}`;

function state(vm) {
  return {state: vm.state, instructions: vm.instructions, frameId: vm.frameId, result: vm.returnValue,
    stack: [...vm.stack], fault: vm.fault?.name ?? null,
    frames: vm.frames.map(frame => ({id: frame.id, methodId: frame.methodId, pc: frame.pc,
      base: frame.base, locals: [...frame.locals], point: frame.point}))};
}

function compare(image, options, budget) {
  const pair = [false, true].map(sourceFusion => new VirtualMachine(image, {...options, sourceFusion}));
  try {
    while (pair[0].state === 'ready' || pair[0].state === 'running') {
      for (const vm of pair) vm.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
      assert.deepEqual(state(pair[1]), state(pair[0]));
    }
    return state(pair[1]);
  } finally { for (const vm of pair) vm.stop(); }
}

for (const reload of [false, true]) {
  test(`prepared recursive calls preserve frame identities at every slice, reload=${reload}`, () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const image = reload ? loadAssembly(artifact.assembly) : artifact.image;
    for (const budget of [1, 2, 3, 5, 7, 13, 32, 255, 256, 1000]) {
      assert.equal(compare(image, {}, budget).result, 13);
    }
    assert.equal(compare(image, {framePooling: false}, 31).result, 13);
  });

  test(`prepared calls preserve failed depth and stack-byte admission, reload=${reload}`, () => {
    const artifact = compileToIL(source);
    assert(artifact.success, JSON.stringify(artifact.diagnostics));
    const image = reload ? loadAssembly(artifact.assembly) : artifact.image;
    for (const options of [{maxFrames: 3}, {maxStackBytes: 160}, {maxInstructions: 27}]) {
      const result = compare(image, options, 1000);
      assert.equal(result.state, 'faulted');
      assert(result.fault);
    }
  });
}

test('prepared call descriptors invalidate when a callee storage shape is replaced', () => {
  const artifact = compileToIL(source);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  const vm = new VirtualMachine(artifact.image);
  const caller = artifact.image.methods.find(method => method.name === 'Main');
  const target = artifact.image.methods.find(method => method.name === 'Fib');
  const calls = plan => plan.groups.filter(Boolean).flatMap(group => group.instructions).filter(item => item.opcode === Op.CALL);
  const before = getSourceFusionPlan(vm, caller);
  assert(calls(before).some(instruction => instruction.call?.method === target));
  target.locals = target.locals.map(local => ({...local, type: 'object'}));
  invalidateExecutionCode(vm, 'callee-storage-replaced');
  const after = getSourceFusionPlan(vm, caller);
  assert.notEqual(after, before);
  assert(calls(after).every(instruction => instruction.call === null));
  vm.stop();
});

test('aggregate targets retain ordinary call preparation', () => {
  const artifact = compileToIL(`struct Value { public int Number; }
    class P { static int Read(Value value) { return value.Number; }
    static int Main() { Value value = new Value(); value.Number = 7; return Read(value); } }`);
  assert(artifact.success, JSON.stringify(artifact.diagnostics));
  const vm = new VirtualMachine(artifact.image);
  const caller = artifact.image.methods.find(method => method.name === 'Main');
  const target = artifact.image.methods.find(method => method.name === 'Read');
  const instructions = getSourceFusionPlan(vm, caller).groups.filter(Boolean).flatMap(group => group.instructions);
  assert(instructions.some(instruction => instruction.opcode === Op.CALL && instruction.first === target.id && instruction.call === null));
  assert.equal(compare(artifact.image, {}, 17).result, 7);
  vm.stop();
});
