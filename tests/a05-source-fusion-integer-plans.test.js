import test from 'node:test';
import assert from 'node:assert/strict';
import {Binary, Op, float, nativeInteger, numericMode} from '@sharpforge/bytecode';
import {VirtualMachine, executionCodeStatistics} from '@sharpforge/runtime';
import {prepareSourceInteger, executeSourceInteger, sourceIntegerFallback}
  from '../packages/runtime/src/execution/source-fusion-numerics.js';
import {sourceFusionFixture} from './support/source-fusion-fixture.js';

const arithmetic = ['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>'];
const comparisons = ['==', '!=', '<', '<=', '>', '>='];
const operands = [[0, 0], [-2147483648, -1], [-1, 31], [2147483647, 1], [1073741825, 33]];

function machine(operator, type, left, right, sourceFusion) {
  const mode = numericMode(type);
  const image = sourceFusionFixture({operator, mode});
  const method = image.methods[0];
  method.locals = method.locals.map(local => ({...local, type}));
  method.returnType = comparisons.includes(operator) ? 'bool' : type;
  method.code = Int32Array.of(Op.LDLOC, 0, 0, Op.LDLOC, 1, 0,
    Op.BINARY, Binary[operator], mode, Op.RET, 0, 0);
  const vm = new VirtualMachine(image, {sourceFusion});
  vm.top.locals[0] = left;
  vm.top.locals[1] = right;
  return vm;
}

function visible(vm) {
  return {state: vm.state, instructions: vm.instructions, value: vm.returnValue,
    stack: [...vm.stack], frames: vm.frames.map(frame => ({pc: frame.pc, locals: [...frame.locals]})),
    fault: vm.fault && {name: vm.fault.name, message: vm.fault.message, frames: vm.fault.frames}};
}

test('prepared source integer predicates and arithmetic retain every operation, signedness and fault boundary', () => {
  for (const type of ['int', 'uint']) {
    for (const operator of [...arithmetic, ...comparisons]) {
      for (const [left, right] of operands) {
        const ordinary = machine(operator, type, left, right, false);
        const fused = machine(operator, type, left, right, true);
        try {
          ordinary.run();
          fused.run();
          assert.deepEqual(visible(fused), visible(ordinary), `${type} ${left} ${operator} ${right}`);
          assert(executionCodeStatistics(fused).sourceFusionGroups > 0);
        } finally {
          ordinary.stop();
          fused.stop();
        }
      }
    }
  }
});

test('integer plan guards preserve carrier fallback and exclude checked or wider numeric modes', () => {
  const vm = {options: {nativeIntBits: 64}};
  const plan = prepareSourceInteger(Binary['+'], numericMode('int'));
  assert(plan);
  for (const value of [-0, 0.5, NaN, Infinity, 2147483648, 1n, float(1), nativeInteger(1, 64), null, true]) {
    assert.equal(executeSourceInteger(vm, plan, value, 1), sourceIntegerFallback);
    assert.equal(executeSourceInteger(vm, plan, 1, value), sourceIntegerFallback);
  }
  for (const mode of [numericMode('int', true), numericMode('uint', true), numericMode('long'), numericMode('float')]) {
    assert.equal(prepareSourceInteger(Binary['+'], mode), null);
  }
  assert.equal(prepareSourceInteger(Binary['>>>'], 1), null, 'Legacy unsigned shift retains its ordinary meaning');
  assert.equal(executeSourceInteger(vm, plan, 2147483647, 1), -2147483648);
});

test('integer plans retain original PCs and stack values at every bounded slice boundary', () => {
  for (const budget of [1, 2, 3, 4]) {
    const ordinary = machine('/', 'int', -2147483648, -1, false);
    const fused = machine('/', 'int', -2147483648, -1, true);
    try {
      while (['ready', 'running'].includes(ordinary.state)) {
        ordinary.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
        fused.runSlice({instructionBudget: budget, timeBudgetMs: Infinity});
        assert.deepEqual(visible(fused), visible(ordinary), `budget ${budget}`);
      }
      assert.equal(fused.fault.name, 'OverflowException');
      assert.equal(fused.instructions, 3);
    } finally {
      ordinary.stop();
      fused.stop();
    }
  }
});
