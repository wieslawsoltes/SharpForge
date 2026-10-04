import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CilVirtualMachine, framePoolStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {float} from '@sharpforge/bytecode';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {numericPlanTypes} from '../packages/runtime/src/execution/numeric-specialization.js';
import {floatSlots} from '../packages/runtime/src/execution/typed-stack.js';
import {managedFixture} from './managed-fixtures.js';

const native = JSON.parse(readFileSync(new URL('./fixtures/a05/int64-arithmetic/native-boundaries.json', import.meta.url), 'utf8'));

function arithmetic(name = 'add', left = 9007199254740993n, right = 2n) {
  return managedFixture({methods: [{name: 'Main', result: name.startsWith('c') ? 'int' : 'long', maxStack: 2,
    body(writer) {
      writer.op('ldc.i8', left);
      if (name.startsWith('sh')) writer.integer(Number(BigInt.asIntN(32, right)));
      else writer.op('ldc.i8', right);
      writer.op(name).op('ret');
    }}]});
}

test('ordinary and predecoded Int64 CIL retain unchanged native boundary outcomes', () => {
  for (const entry of native.cases) {
    const bytes = arithmetic(entry.opcode, BigInt(entry.left), BigInt(entry.right));
    for (const specializeNumericHandlers of [false, true]) {
      const vm = new CilVirtualMachine(bytes, {specializeNumericHandlers});
      const plan = getDecodePlan(vm, vm.top.method);
      if (specializeNumericHandlers) assert(plan.numericHandlerIds.includes(entry.opcode.replaceAll('.', '_') + '_i8'));
      else assert.equal(plan.numericHandlerIds, null);
      const actual = vm.run();
      if (entry.expected.startsWith('!')) {
        assert.equal(actual.state, 'faulted', entry.opcode);
        assert.equal(actual.fault.name, entry.expected.slice(1), entry.opcode);
      } else {
        assert.equal(actual.state, 'terminated', actual.fault?.stack);
        assert.equal(String(actual.returnValue), entry.expected, entry.opcode);
      }
    }
  }
});

function loop() {
  return managedFixture({methods: [{name: 'Main', result: 'long', maxStack: 2, locals: ['long', 'int', 'double'],
    body(writer) {
      writer.op('ldc.i8', 9007199254740993n).op('stloc.0').integer(0).op('stloc.1');
      writer.op('ldc.r8', 0).op('stloc.2').mark('loop');
      writer.op('ldloc.0').op('ldloc.1').op('conv.i8').op('add').op('stloc.0');
      writer.op('ldloc.2').op('ldc.r8', 0.25).op('add').op('stloc.2');
      writer.op('ldloc.1').integer(1).op('add').op('stloc.1');
      writer.op('ldloc.1').integer(100).op('blt.s', 'loop').op('ldloc.0').op('ret');
    }}]});
}

test('Int64, Int32 and typed floats share one analysis and preserve pooled frame values', () => {
  for (const disabled of [null, 'specializeNumericHandlers', 'typedNumericStack']) {
    const vm = new CilVirtualMachine(loop(), {specializeNumericHandlers: true, typedNumericStack: true});
    const first = getDecodePlan(vm, vm.top.method);
    assert(first.numericHandlerIds.includes('add_i8'));
    assert(first.numericHandlerIds.includes('add_i4'));
    assert(first.numericHandlerIds.includes('blt_s_i4'));
    const states = numericPlanTypes(vm, vm.top.method, first.offsets);
    if (disabled) vm.options[disabled] = false;
    const second = getDecodePlan(vm, vm.top.method);
    assert.equal(numericPlanTypes(vm, vm.top.method, second.offsets), states);
    if (disabled) assert.notEqual(second, first);
    if (disabled === 'specializeNumericHandlers') assert.equal(second.numericHandlerIds, null);
    const stack = vm.top.stack;
    let remaining = 3000;
    while (vm.top.method.instructions[vm.top.pc].name !== 'ret') {
      assert(--remaining > 0);
      vm.step();
    }
    if (disabled !== 'typedNumericStack') assert.equal(floatSlots(stack).materializations, 0);
    assert.equal(vm.run().returnValue, 9007199254745943n);
    assert.equal(stack.length, 0);
    assert(framePoolStatistics(vm).released > 0);
    vm.call(vm.inspector.pe.entryPoint, []);
    vm.state = 'running';
    assert.equal(vm.run().returnValue, 9007199254745943n);
    vm.stop();
  }
});

test('host edits keep exact generic semantics and snapshots rebuild derived Int64 plans', () => {
  for (const [left, right, expected] of [[1n << 65n, 7n, 7n], [float(1.25), float(2.5), 3.75]]) {
    const vm = new CilVirtualMachine(arithmetic(), {specializeNumericHandlers: true});
    vm.step();
    vm.step();
    vm.top.stack[0] = left;
    vm.top.stack[1] = right;
    const saved = vm.snapshot();
    const before = getDecodePlan(vm, vm.top.method);
    // Stop before ret, which applies the declared Int64 return storage contract.
    vm.step();
    assert.equal(vm.top.stack[0]?.value ?? vm.top.stack[0], expected);
    vm.restore(saved);
    vm.state = 'running';
    assert.notEqual(getDecodePlan(vm, vm.top.method), before);
    vm.step();
    assert.equal(vm.top.stack[0]?.value ?? vm.top.stack[0], expected);
    vm.stop();
    assert.equal(vm.frames.length, 0);
  }
});

test('Int64 specialization respects proof invalidation, decode opt-out and instruction quotas', () => {
  for (const options of [{}, {specializeNumericHandlers: false}, {specializeNumericHandlers: true, decodePlans: false}]) {
    assert.equal(new CilVirtualMachine(arithmetic(), options).run().returnValue, 9007199254740995n);
  }
  const vm = new CilVirtualMachine(arithmetic(), {specializeNumericHandlers: true});
  const original = getDecodePlan(vm, vm.top.method);
  vm.top.method.instructions.find(instruction => instruction.name === 'add').name = 'sub';
  invalidateExecutionCode(vm, 'committed-host-edit');
  const changed = getDecodePlan(vm, vm.top.method);
  assert.notEqual(changed, original);
  assert.equal(changed.numericHandlerIds, null);
  assert.equal(vm.run().returnValue, 9007199254740991n);
  for (const specializeNumericHandlers of [false, true]) {
    const limited = new CilVirtualMachine(loop(), {specializeNumericHandlers, maxInstructions: 30});
    const writes = [];
    limited.onWrite = write => writes.push(write);
    assert.equal(limited.run().fault.name, 'InstructionLimitException');
    assert(writes.some(write => typeof write.value === 'bigint'));
    limited.stop();
  }
});

test('declared Int64 arguments specialize inside callees while unproven returned values remain generic', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'long', maxStack: 2, body(writer, context) {
      writer.op('ldc.i8', 9007199254740993n).op('ldc.i8', 2n).op('call', context.methods.Add);
      writer.op('ldc.i8', 3n).op('add').op('ret');
    }},
    {name: 'Add', result: 'long', parameters: ['long', 'long'], maxStack: 2,
      body: writer => writer.op('ldarg.0').op('ldarg.1').op('add').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes, {specializeNumericHandlers: true});
  assert(getDecodePlan(vm, vm.top.method).numericHandlerIds.every(id => id === null));
  vm.step();
  vm.step();
  vm.step();
  assert(getDecodePlan(vm, vm.top.method).numericHandlerIds.includes('add_i8'));
  assert.equal(vm.run().returnValue, 9007199254740998n);
});
