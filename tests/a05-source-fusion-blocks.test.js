import test from 'node:test';
import assert from 'node:assert/strict';
import {Op, Binary, numericMode, float, decimalParse} from '@sharpforge/bytecode';
import {VirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {getSourceFusionPlan} from '../packages/runtime/src/execution/source-fusion.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

function observe(image, locals, sourceFusion, budget = 15000) {
  const vm = new VirtualMachine(image, {sourceFusion});
  locals.forEach((value, index) => { vm.top.locals[index] = value; });
  const slices = [], faults = [], handleFault = vm.handleFault;
  vm.handleFault = fault => {
    faults.push({name: fault.name, pc: vm.top.pc, stack: [...vm.stack], instructions: vm.instructions});
    return handleFault.call(vm, fault);
  };
  while (vm.state === 'ready' || vm.state === 'running') {
    vm.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
    slices.push({state: vm.state, result: vm.returnValue, instructions: vm.instructions, writes: vm.writeRevision,
      stack: [...vm.stack], frames: vm.frames.map(frame => ({pc: frame.pc, locals: [...frame.locals], point: frame.point}))});
  }
  return {slices, faults, groups: executionCodeStatistics(vm).sourceFusionGroups};
}

function arithmetic(operator, mode) {
  const image = sourceFusionFixture({operator, mode});
  image.methods[0].code = Int32Array.from([
    Op.LDLOC, 0, 0, Op.LDLOC, 1, 0, Op.BINARY, Binary[operator], mode, Op.RET, 0, 0
  ]);
  return image;
}

test('decoded integer operations share unsigned, shift, overflow and division fault semantics', () => {
  const modes = [1, numericMode('int'), numericMode('uint'), numericMode('int', true)];
  const operators = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>=', '>>>'];
  const inputs = [[17, 3], [-2147483648, -1], [2147483647, 1], [-1, 0], [1, 33]];
  for (const mode of modes) for (const operator of operators) for (const locals of inputs) {
    if (mode === 1 && operator === '>>>') continue;
    const image = arithmetic(operator, mode);
    const ordinary = observe(image, locals, false), fused = observe(image, locals, true);
    assert.deepEqual(fused.slices, ordinary.slices, `${mode}/${operator}/${locals}`);
    assert.deepEqual(fused.faults, ordinary.faults, `${mode}/${operator}/${locals}`);
    assert.equal(fused.groups, 1);
  }
});

test('decoded integer specialization defers carrier and noncanonical values to ordinary arithmetic', () => {
  for (const [mode, locals] of [
    [numericMode('double'), [float(-0), float(-0)]],
    [numericMode('float'), [float(16777216, 'r4'), float(1, 'r4')]],
    [numericMode('decimal'), [decimalParse('1.10'), decimalParse('2.20')]],
    [numericMode('long'), [9007199254740993n, 3n]],
    [numericMode('int'), [-0, 1]],
    [numericMode('uint'), [4294967295, 1]]
  ]) {
    const image = arithmetic('+', mode);
    const ordinary = observe(image, locals, false), fused = observe(image, locals, true);
    assert.deepEqual(fused.slices, ordinary.slices);
    assert.deepEqual(fused.faults, ordinary.faults);
  }
});

test('a decoded block preserves every small slice and sequence location through a call and return', () => {
  const image = sourceFusionFixture();
  image.sequencePoints = [{methodId: 0, offset: 0}, {methodId: 1, offset: 0}];
  image.methods[0].code = Int32Array.from([
    Op.SEQ, 0, 0, Op.LDLOC, 0, 0, Op.CALL, 1, 1, Op.CONST, 1, 0,
    Op.BINARY, Binary['+'], numericMode('int'), Op.RET, 0, 0
  ]);
  image.methods.push({...image.methods[0], id: 1, name: 'Increment', qualifiedName: 'Increment',
    parameters: [{name: 'value', type: 'int', slot: 0}],
    code: Int32Array.from([
      Op.SEQ, 1, 0, Op.LDLOC, 0, 0, Op.CONST, 1, 0, Op.BINARY, Binary['+'], numericMode('int'), Op.RET, 0, 0
    ])});
  for (const budget of [1, 2, 3, 4, 5, 7, 255, 256]) {
    const ordinary = observe(image, [6], false, budget), fused = observe(image, [6], true, budget);
    assert.deepEqual(fused.slices, ordinary.slices, `budget ${budget}`);
    assert.deepEqual(fused.faults, ordinary.faults);
    assert.equal(fused.slices.at(-1).result, 8);
    if (budget > 1) assert(fused.groups > 0);
  }
  const vm = new VirtualMachine(image);
  const plan = getSourceFusionPlan(vm, image.methods[0]);
  assert.equal(plan.groups[0].instructions.at(-1).opcode, Op.CALL);
  assert.equal(plan.groups[3].instructions.at(-1).opcode, Op.RET);
});

test('source blocks preserve custom write transactions by declining fusion', () => {
  const image = sourceFusionFixture(), vm = new VirtualMachine(image);
  vm.top.locals[0] = 6;
  vm.top.locals[1] = 7;
  let writes = 0;
  vm.notifyWrite = () => { writes++; };
  vm.run();
  assert.equal(writes, 2);
  assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
});

test('source blocks preserve host arithmetic and transfer adapters by declining fusion', () => {
  for (const method of ['binary', 'transfer', 'constant']) {
    const vm = new VirtualMachine(sourceFusionFixture());
    vm.top.locals[0] = 6;
    vm.top.locals[1] = 7;
    const original = vm[method];
    let calls = 0;
    vm[method] = (...args) => { calls++; return original.apply(vm, args); };
    assert.equal(vm.run().state, 'terminated');
    assert(calls > 0, method);
    assert.equal(executionCodeStatistics(vm).sourceFusionGroups, 0);
  }
});
