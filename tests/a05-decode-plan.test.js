import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, CilOpcodes} from '@sharpforge/cil';
import {compileToIL} from '@sharpforge/compiler';
import {CilDebugSession} from '@sharpforge/debugger';
import {CilVirtualMachine, executionCodeStatistics, invalidateExecutionCode} from '@sharpforge/runtime';
import {getDecodePlan} from '../packages/runtime/src/execution/decode-plan.js';
import {methodOffsetAllocations} from '../packages/runtime/src/execution/method-offsets.js';
import {managedFixture} from './managed-fixtures.js';

function literalFixture(value = 42, leadingNop = false) {
  return managedFixture({methods: [{name: 'Main', result: 'int', body: writer => {
    if (leadingNop) writer.op('nop');
    writer.op('ldc.i8', 9223372036854775807n).op('pop').op('ldc.r8', -0).op('pop');
    writer.op('ldc.i4.0').op('switch', ['answer']).op('ldc.i4.m1').op('ret');
    writer.mark('answer').op('ldc.i4', value).op('br.s', 'done');
    writer.mark('done').op('ret');
  }}]});
}

function loopFixture() {
  return managedFixture({methods: [
    {name: 'Main', result: 'int', locals: ['int', 'int'], body: (writer, context) => {
      writer.op('ldc.i4.1').op('stloc.1').mark('loop');
      writer.op('ldloc.0').op('ldloc.1').op('call', context.methods.Double).op('add').op('stloc.0');
      writer.op('ldloc.1').op('ldc.i4.1').op('add').op('stloc.1');
      writer.op('ldloc.1').op('ldc.i4.6').op('ble.s', 'loop');
      writer.op('ldloc.0').op('dup').op('call', context.member('System.Console', 'WriteLine', 'void', ['int'])).op('ret');
    }},
    {name: 'Double', result: 'int', parameters: ['int'], body: writer => {
      writer.op('ldarg.0').op('ldc.i4.2').op('mul').op('ret');
    }}
  ]});
}

test('decode plans preserve wide operands, original debugger objects and the existing offset map', () => {
  const vm = new CilVirtualMachine(literalFixture());
  const method = vm.top.method;
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
    if (instruction.operandKind.startsWith('br')) {
      assert.equal(plan.branchTargets[index], plan.offsets.get(instruction.operand));
    }
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

test('warm method entries reuse their handler plan and offset map while preserving results', () => {
  const vm = new CilVirtualMachine(literalFixture());
  const method = vm.top.method;
  const plan = getDecodePlan(vm, method);
  const allocations = methodOffsetAllocations(method);
  for (let index = 0; index < 20; index++) {
    if (index) {
      vm.state = 'running';
      vm.call(method.token, []);
    }
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 42);
    assert.equal(getDecodePlan(vm, method), plan);
  }
  assert.equal(methodOffsetAllocations(method), allocations);
  assert.equal(executionCodeStatistics(vm).decodePlans, 1);
});

test('decoded and original dispatch preserve one-instruction budgets, calls, branches and debugger pauses', () => {
  const bytes = loopFixture();
  const traces = [];
  const results = [];
  for (const decodePlans of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {decodePlans});
    const trace = [];
    vm.runSlice({onInstruction(instruction, frame) {
      assert.equal(instruction, frame.method.instructions[frame.pc]);
      return true;
    }});
    assert.equal(vm.state, 'paused');
    assert.equal(vm.instructions, 0);
    assert.equal(executionCodeStatistics(vm).decodePlans, 0);
    vm.state = 'running';
    while (vm.state === 'running') {
      const before = vm.instructions;
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000, onInstruction(instruction, frame) {
        trace.push([frame.method.name, instruction.offset, frame.stack.length]);
        return false;
      }});
      assert.equal(vm.instructions - before, 1);
    }
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '42\n');
    assert.equal(result.returnValue, 42);
    assert.equal(executionCodeStatistics(vm).decodePlans, decodePlans ? 2 : 0);
    traces.push(trace);
    results.push(vm.instructions);
  }
  assert.deepEqual(traces[0], traces[1]);
  assert.equal(results[0], results[1]);
});

test('instruction-limit faults retain the same stopped frame with either dispatch mode', () => {
  // Stay below the verifier's static instruction cap while exceeding the runtime budget.
  const bytes = managedFixture({methods: [{name: 'Main',
    body: writer => writer.mark('again').op('br.s', 'again')}]});
  const frames = [];
  for (const decodePlans of [false, true]) {
    const vm = new CilVirtualMachine(bytes, {decodePlans, maxInstructions: 5});
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'InstructionLimitException');
    assert.equal(vm.instructions, 6);
    frames.push({method: vm.top.method.name, pc: vm.top.pc, stack: [...vm.top.stack], instructions: vm.instructions});
  }
  assert.deepEqual(frames[0], frames[1]);
});

test('decoded dispatch preserves nested catch/finally continuations across snapshot replay', () => {
  const source = 'int F(){try{return 42;}finally{try{throw new Exception("inside");}' +
    'catch(Exception e){GC.Collect();Console.WriteLine(e.Message);}}}Console.WriteLine(F());';
  const compiled = compileToIL(source, {includeDebug: false});
  assert(compiled.success, JSON.stringify(compiled.diagnostics));
  for (const decodePlans of [false, true]) {
    const vm = new CilVirtualMachine(compiled.assembly, {decodePlans});
    let saved;
    while (vm.state === 'ready' || vm.state === 'running') {
      if (!saved && vm.top?.pending) saved = vm.snapshot();
      vm.runSlice({instructionBudget: 1, timeBudgetMs: 1000});
    }
    assert.equal(vm.state, 'terminated', vm.fault?.message);
    assert.equal(vm.output.join(''), 'inside\n42\n');
    assert(saved, 'The fixture must pause with an active finally continuation');
    vm.restore(saved);
    vm.heap.collect();
    const replay = vm.run();
    assert.equal(replay.state, 'terminated', replay.fault?.message);
    assert.equal(replay.output, 'inside\n42\n');
  }
});

test('invalid opcode and branch plans are rejected without replacing an executable cached plan', () => {
  const vm = new CilVirtualMachine(literalFixture());
  const method = vm.top.method;
  const plan = getDecodePlan(vm, method);
  for (const instruction of [{offset: 0, name: 'host.execute', operandKind: ''},
    {offset: 0, name: 'br', operandKind: 'br32', operand: 999}]) {
    assert.throws(() => getDecodePlan(vm, {...method, instructions: [instruction]}), {name: 'InvalidProgramException'});
  }
  assert.equal(executionCodeStatistics(vm).decodePlans, 1);
  assert.equal(getDecodePlan(vm, method), plan);
  assert.equal(vm.run().returnValue, 42);
});

test('body replacement refreshes both handler slots and branch offsets on the next instruction', () => {
  const vm = new CilVirtualMachine(literalFixture());
  const method = vm.top.method;
  const plan = getDecodePlan(vm, method);
  const next = new AssemblyInspector(literalFixture(77, true)).getMethod(method.token);
  method.instructions = next.instructions;
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 77);
  assert.notEqual(getDecodePlan(vm, method), plan);
  assert.notEqual(getDecodePlan(vm, method).offsets, plan.offsets);
});

test('explicit invalidation refreshes an in-place opcode edit before executing its new semantics', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body: writer => {
    writer.op('ldc.i4', 40).op('ldc.i4.2').op('add').op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes);
  const method = vm.top.method;
  const first = getDecodePlan(vm, method);
  const epoch = executionCodeStatistics(vm).epoch;
  method.instructions.find(instruction => instruction.name === 'add').name = 'sub';
  assert.equal(invalidateExecutionCode(vm, 'opcode-edit'), epoch + 1);
  assert.notEqual(getDecodePlan(vm, method), first);
  assert.equal(vm.run().returnValue, 38);
});

test('owner replacement and stop drop code caches even when metadata tokens are reused', () => {
  const vm = new CilVirtualMachine(literalFixture());
  const oldMethod = vm.top.method;
  const first = getDecodePlan(vm, oldMethod);
  const epoch = executionCodeStatistics(vm).epoch;
  vm.inspector = new AssemblyInspector(literalFixture(77));
  const nextMethod = vm.inspector.getMethod(oldMethod.token);
  const next = getDecodePlan(vm, nextMethod);
  assert(executionCodeStatistics(vm).epoch > epoch);
  assert.notEqual(next, first);
  assert.equal(executionCodeStatistics(vm).decodePlans, 1);
  vm.stop();
  assert.equal(executionCodeStatistics(vm).decodePlans, 0);
  vm.call(nextMethod.token, []);
  vm.state = 'running';
  assert.equal(vm.run().returnValue, 77);
});

test('snapshots contain execution state only and successful restore rebuilds plans for identical replay', () => {
  const vm = new CilVirtualMachine(loopFixture());
  vm.runSlice({instructionBudget: 5, timeBudgetMs: 1000});
  const method = vm.top.method;
  const plan = getDecodePlan(vm, method);
  const saved = vm.snapshot();
  assert.equal(Object.hasOwn(saved, 'decode'), false);
  for (const frame of saved.frames) {
    assert.equal(Object.hasOwn(frame, 'plan'), false);
    assert.equal(Object.hasOwn(frame, 'handlers'), false);
  }
  assert.throws(() => vm.restore({...saved, schemaVersion: 999}), /schema version/);
  assert.equal(getDecodePlan(vm, method), plan);
  const expected = vm.run();
  for (let replay = 0; replay < 2; replay++) {
    vm.restore(saved);
    assert.equal(executionCodeStatistics(vm).decodePlans, 0);
    assert.notEqual(getDecodePlan(vm, vm.top.method), plan);
    const actual = vm.run();
    assert.equal(actual.state, 'terminated', actual.fault?.message);
    assert.equal(actual.output, expected.output);
    assert.equal(actual.returnValue, expected.returnValue);
    assert.equal(actual.stats.instructions, expected.stats.instructions);
  }
});

test('CIL Hot Reload refreshes derived plans only after a committed update', () => {
  const source = 'class P {static int Value(){return 1;} static void Main(){\nConsole.WriteLine(Value());\n}}';
  const before = compileToIL(source);
  const after = compileToIL(source.replace('return 1;', 'return 9;'));
  assert(before.success, JSON.stringify(before.diagnostics));
  assert(after.success, JSON.stringify(after.diagnostics));
  const session = new CilDebugSession(before.assembly);
  session.setBreakpoints('Program.cs', [{line: 2}]);
  session.start(false);
  session.runUntilStop();
  const plan = getDecodePlan(session.vm, session.vm.top.method);
  const epoch = executionCodeStatistics(session.vm).epoch;
  assert.throws(() => session.applyChanges(after.assembly, {expectedVersion: -1}), /version/i);
  assert.equal(executionCodeStatistics(session.vm).epoch, epoch);
  assert.equal(getDecodePlan(session.vm, session.vm.top.method), plan);
  session.applyChanges(after.assembly);
  assert(executionCodeStatistics(session.vm).epoch > epoch);
  assert.equal(executionCodeStatistics(session.vm).decodePlans, 0);
  session.resume();
  assert.equal(session.runUntilStop().output, '9\n');
});
