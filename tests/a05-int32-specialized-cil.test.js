import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, invalidateExecutionCode} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {numericPlanTypes} from '../packages/runtime/src/execution/numeric-specialization.js';
import {floatSlots} from '../packages/runtime/src/execution/typed-stack.js';
import {managedFixture} from './managed-fixtures.js';

function loop() {
  return managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 2, locals: ['int', 'int'], body(writer) {
    writer.integer(0).op('stloc.0').integer(0).op('stloc.1').mark('loop');
    writer.op('ldloc.0').op('ldloc.1').op('add').op('stloc.0');
    writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
    writer.op('ldloc.1').integer(100).op('blt.s', 'loop').op('ldloc.0').op('ret');
  }}]});
}
const addition = () => managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 2,
  body: writer => writer.integer(2).integer(3).op('add').op('ret')} ]});

test('only the explicit option selects immutable Int32 ids in the existing decode plan', () => {
  for (const specializeNumericHandlers of [undefined, false, true]) {
    const vm = new CilVirtualMachine(loop(), {specializeNumericHandlers});
    const plan = getDecodePlan(vm, vm.top.method);
    if (specializeNumericHandlers) {
      assert(plan.numericHandlerIds.includes('add_i4'));
      assert(plan.numericHandlerIds.includes('blt_s_i4'));
      assert(Object.isFrozen(plan.numericHandlerIds));
      const states = numericPlanTypes(vm, vm.top.method, plan.offsets);
      assert.equal(numericPlanTypes(vm, vm.top.method, plan.offsets), states);
    } else assert.equal(plan.numericHandlerIds, null);
    assert.equal(vm.run().returnValue, 4950);
  }
});

test('option edits, copied reports and replaced bodies do not retain stale specializations', () => {
  for (const edit of ['off', 'report', 'body']) {
    const vm = new CilVirtualMachine(addition(), {specializeNumericHandlers: true});
    const before = getDecodePlan(vm, vm.top.method);
    if (edit === 'off') vm.options.specializeNumericHandlers = false;
    else if (edit === 'report') vm.report = {...vm.report};
    else vm.top.method.instructions = [...vm.top.method.instructions];
    const after = getDecodePlan(vm, vm.top.method);
    assert.notEqual(after, before);
    assert.equal(after.numericHandlerIds, null);
    assert.equal(vm.run().returnValue, 5);
  }
});

test('edited operand tags preserve fallback and snapshots replay through new epoch plans', () => {
  const vm = new CilVirtualMachine(addition(), {specializeNumericHandlers: true});
  vm.step();
  vm.step();
  vm.top.stack[0] = float(9);
  const saved = vm.snapshot();
  const before = getDecodePlan(vm, vm.top.method);
  assert.equal(vm.run().returnValue, 12);
  vm.restore(saved);
  assert.notEqual(getDecodePlan(vm, vm.top.method), before);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 12);
  vm.restore(saved);
  vm.stop();
  assert.equal(vm.frames.length, 0);
});

test('instruction budgets, byte budgets and write notifications keep their existing adapters', () => {
  for (const specializeNumericHandlers of [false, true]) {
    const vm = new CilVirtualMachine(loop(), {specializeNumericHandlers, maxInstructions: 30});
    const writes = [];
    vm.onWrite = write => writes.push(write);
    assert.equal(vm.run().fault.name, 'InstructionLimitException');
    assert(writes.length > 0);
    vm.stop();
    const limited = new CilVirtualMachine(addition(), {specializeNumericHandlers, maxStackBytes: 32});
    limited.step();
    limited.options.maxStackBytes = 31;
    assert.throws(() => limited.step(), {name: 'StackOverflowException'});
    assert.equal(limited.top.pc, 1);
  }
});

test('unproven in-place edits fall back while Int64 bodies use their own width', () => {
  const vm = new CilVirtualMachine(addition(), {specializeNumericHandlers: true});
  const original = getDecodePlan(vm, vm.top.method);
  vm.top.method.instructions.find(instruction => instruction.name === 'add').name = 'sub';
  invalidateExecutionCode(vm, 'committed-host-edit');
  const plan = getDecodePlan(vm, vm.top.method);
  assert.notEqual(plan, original);
  assert.equal(plan.numericHandlerIds, null);
  assert.equal(vm.run().returnValue, -1);
  const bytes = managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2,
    body: writer => writer.op('ldc.i8', 9007199254740993n).op('ldc.i8', 2n).op('add').op('ret')} ]});
  const wide = new CilVirtualMachine(bytes, {specializeNumericHandlers: true});
  assert(getDecodePlan(wide, wide.top.method).numericHandlerIds.includes('add_i8'));
  assert.equal(wide.run().returnValue, 9007199254740995n);
});

test('Int32 and typed-float contributions coexist and retain independent option invalidation', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'double', maxStack: 2, locals: ['double', 'int'], body(writer) {
    writer.op('ldc.r8', 0).op('stloc.0').integer(0).op('stloc.1').mark('loop');
    writer.op('ldloc.0').op('ldc.r8', 0.25).op('add').op('stloc.0');
    writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
    writer.op('ldloc.1').integer(100).op('blt.s', 'loop').op('ldloc.0').op('ret');
  }}]});
  for (const disabled of [null, 'specializeNumericHandlers', 'typedNumericStack']) {
    const vm = new CilVirtualMachine(bytes, {specializeNumericHandlers: true, typedNumericStack: true});
    const first = getDecodePlan(vm, vm.top.method);
    const states = numericPlanTypes(vm, vm.top.method, first.offsets);
    vm.step();
    if (disabled) vm.options[disabled] = false;
    const second = getDecodePlan(vm, vm.top.method);
    assert.equal(numericPlanTypes(vm, vm.top.method, second.offsets), states);
    if (disabled) assert.notEqual(second, first);
    if (disabled === 'specializeNumericHandlers') assert.equal(second.numericHandlerIds, null);
    else assert(second.numericHandlerIds.includes('add_i4'));
    const stack = vm.top.stack;
    let remaining = 10_000;
    while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
      assert(--remaining > 0);
      vm.step();
    }
    if (disabled !== 'typedNumericStack') assert.equal(floatSlots(stack).materializations, 0);
    assert.equal(vm.run().returnValue, 25);
  }
});
