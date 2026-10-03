import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {CilOpcodes, AssemblyInspector} from '@sharpforge/cil';
import {CilVirtualMachine, executionCodeStatistics, invalidateExecutionCode,
  serializeSnapshot, restoreSerializedSnapshot} from '@sharpforge/runtime';
import {DebugSession, CilDebugSession} from '@sharpforge/debugger';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {methodOffsetAllocations} from '../packages/runtime/src/execution/method-offsets.js';
import {controlFixture} from './support/control-fixture.js';

function literalFixture(value = 42) {
  return controlFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', body: writer => {
    writer.op('ldc.i8', 9223372036854775807n).op('pop').op('ldc.r8', -0).op('pop');
    writer.op('ldc.i4.0').op('switch', ['answer']).op('ldc.i4.m1').op('ret');
    writer.mark('answer').op('ldc.i4', value).op('br.s', 'done');
    writer.mark('done').op('ret');
  }}]}]);
}
function compilation(source) {
  const result = compileToIL(source);
  assert(result.success, JSON.stringify(result.diagnostics));
  return result;
}

test('T07 numeric decode buffers retain wide operands, switch PCs and original debugger objects', () => {
  const vm = new CilVirtualMachine(literalFixture()), method = vm.top.method;
  const plan = getDecodePlan(vm, method);
  assert(plan.opcodeIds instanceof Int32Array);
  assert(plan.operands instanceof Int32Array);
  assert(plan.branchTargets instanceof Int32Array);
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.handlers));
  assert.equal(plan.offsets, vm.top.offsets);
  for (const [index, instruction] of method.instructions.entries()) {
    assert.equal(plan.instructions[index], instruction);
    assert.equal(plan.opcodeIds[index], CilOpcodes[instruction.name].value);
    if (instruction.operand !== undefined) {
      assert.deepEqual(plan.operandValues[plan.operands[index]], instruction.operand);
    }
    if (instruction.operandKind.startsWith('br')) assert.equal(plan.branchTargets[index], plan.offsets.get(instruction.operand));
    if (instruction.name === 'switch') {
      assert.deepEqual([...plan.switchTargets[index]], instruction.operand.map(offset => plan.offsets.get(offset)));
    }
  }
  plan.opcodeIds.fill(-1);
  plan.branchTargets.fill(-1);
  const switchIndex = method.instructions.findIndex(instruction => instruction.name === 'switch');
  plan.switchTargets[switchIndex].fill(-1);
  assert.equal(vm.run().returnValue, 42);
  assert.equal(plan.opcodeIds[0], CilOpcodes['ldc.i8'].value);
});

test('T07 warm execution and repeated method entries allocate no new offset maps or decode plans', () => {
  const vm = new CilVirtualMachine(literalFixture()), method = vm.top.method;
  const plan = getDecodePlan(vm, method), allocations = methodOffsetAllocations(method);
  const cold = executionCodeStatistics(vm);
  for (let index = 0; index < 20; index++) {
    if (index) { vm.state = 'running'; vm.call(method.token, []); }
    assert.equal(vm.run().returnValue, 42);
    assert.equal(getDecodePlan(vm, method), plan);
  }
  assert.equal(methodOffsetAllocations(method), allocations);
  assert.equal(executionCodeStatistics(vm).decodePlans, cold.decodePlans);
  assert.equal(executionCodeStatistics(vm).offsetMapAllocations, cold.offsetMapAllocations);
});

test('T07 an invalid opcode or branch target cannot install a decoded plan', () => {
  const vm = new CilVirtualMachine(literalFixture()), method = vm.top.method;
  const before = executionCodeStatistics(vm).decodePlans;
  for (const instruction of [{offset: 0, name: 'host.execute', operandKind: ''},
    {offset: 0, name: 'br', operandKind: 'br32', operand: 999}]) {
    assert.throws(() => getDecodePlan(vm, {...method, instructions: [instruction]}), {name: 'InvalidProgramException'});
  }
  assert.equal(executionCodeStatistics(vm).decodePlans, before);
  assert.equal(vm.run().returnValue, 42);
});

test('T07 changing numeric execution options rebuilds handlers before the next instruction', () => {
  const vm = new CilVirtualMachine(literalFixture()), method = vm.top.method;
  const baseline = getDecodePlan(vm, method);
  vm.options.typedNumericStack = true;
  const typed = getDecodePlan(vm, method);
  assert.notEqual(typed, baseline);
  vm.options.specializeNumericHandlers = false;
  const generic = getDecodePlan(vm, method);
  assert.notEqual(generic, typed);
  assert.equal(generic.typedNumericSlots, undefined);
  assert.equal(vm.run().returnValue, 42);
});

test('T07 owner replacement and explicit disposal drop decoded bodies even when tokens are reused', () => {
  const vm = new CilVirtualMachine(literalFixture()), oldMethod = vm.top.method;
  const first = getDecodePlan(vm, oldMethod), epoch = executionCodeStatistics(vm).epoch;
  vm.inspector = new AssemblyInspector(literalFixture(77));
  const nextMethod = vm.inspector.getMethod(oldMethod.token), next = getDecodePlan(vm, nextMethod);
  assert(executionCodeStatistics(vm).epoch > epoch);
  assert.notEqual(next, first);
  assert.equal(executionCodeStatistics(vm).decodePlans, 1);
  const changed = nextMethod.instructions.find(instruction => instruction.name === 'ldc.i4');
  assert.equal(next.operandValues[next.operands[nextMethod.instructions.indexOf(changed)]], 77);
  vm.stop();
  assert.equal(executionCodeStatistics(vm).decodePlans, 0);
  vm.call(nextMethod.token, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 77);
  invalidateExecutionCode(vm, 'test-unload');
  assert.equal(executionCodeStatistics(vm).decodePlans, 0);
});

test('T07 portable snapshots rebuild private plans without serializing handler functions', async () => {
  const bytes = literalFixture(), vm = new CilVirtualMachine(bytes);
  const first = getDecodePlan(vm, vm.top.method);
  const wire = await serializeSnapshot(vm, vm.snapshot(), {json: true});
  const fresh = new CilVirtualMachine(bytes);
  await restoreSerializedSnapshot(fresh, wire);
  assert.equal(executionCodeStatistics(fresh).decodePlans, 0);
  assert.notEqual(getDecodePlan(fresh, fresh.top.method), first);
  assert.equal(fresh.run().returnValue, 42);
});

for (const cil of [false, true]) {
  test(`T07 ${cil ? 'CIL' : 'source'} Hot Reload invalidates only after a committed update`, () => {
    const source = 'class P {static int Value(){return 1;} static void Main(){\nConsole.WriteLine(Value());\n}}';
    const before = compilation(source), after = compilation(source.replace('return 1;', 'return 9;'));
    const session = cil ? new CilDebugSession(before.assembly) : new DebugSession(before.image);
    session.setBreakpoints('Program.cs', [{line: 2}]);
    session.start(false);
    session.runUntilStop();
    const epoch = executionCodeStatistics(session.vm).epoch;
    assert.throws(() => session.applyChanges(cil ? after.assembly : after.image, {expectedVersion: -1}), /version/i);
    assert.equal(executionCodeStatistics(session.vm).epoch, epoch);
    session.applyChanges(cil ? after.assembly : after.image);
    assert(executionCodeStatistics(session.vm).epoch > epoch);
    assert.equal(executionCodeStatistics(session.vm).decodePlans, 0);
    session.resume();
    assert.equal(session.runUntilStop().output, '9\n');
  });
}
