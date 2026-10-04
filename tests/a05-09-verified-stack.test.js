import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly, verifiedStackBound} from '@sharpforge/cil';
import {CilVirtualMachine, framePoolStatistics} from '@sharpforge/runtime';
import {invalidateExecutionCode} from '../packages/runtime/src/execution/code-version.js';
import {managedFixture} from './managed-fixtures.js';

const literal = (maxStack = 8) => managedFixture({methods: [
  {name: 'Main', result: 'int', maxStack, body: writer => writer.op('ldc.i4', 42).op('ret')}
]});
const empty = () => managedFixture({methods: [{name: 'Main', maxStack: 0, body: writer => writer.op('ret')}]});

for (const declared of [1, 8, 65535]) {
  test(`verified peak fits a host limit below an inflated maxstack header (${declared})`, () => {
    const vm = new CilVirtualMachine(literal(declared), {maxStackValues: 1});
    assert.deepEqual(verifiedStackBound(vm.inspector, vm.report, vm.top.method), {capacity: declared, peak: 1});
    assert.equal(vm.run().returnValue, 42);
    assert.equal(framePoolStatistics(vm).retainedBytes, 136, 'only one evaluation slot is retained');
  });
}

test('zero host budget admits an actual zero-peak body, but rejects reachable pushes before execution', () => {
  assert.equal(new CilVirtualMachine(empty(), {maxStackValues: 0}).run().state, 'terminated');
  assert.throws(() => new CilVirtualMachine(literal(), {maxStackValues: 0}), {name: 'ExecutionLimitException'});
});

for (const limit of [-1, 1.5, NaN, Infinity, '1']) {
  test(`invalid host stack limit ${String(limit)} is rejected deliberately`, () => {
    assert.throws(() => new CilVirtualMachine(empty(), {maxStackValues: limit}), /nonnegative safe integer/);
  });
}

test('verification rejects a header smaller than its outgoing evaluation height', () => {
  const report = verifyCilAssembly(literal(0));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_STACK' && /exceeds maxstack/.test(issue.message)));
});

for (const maxStack of [-1, NaN, 1.5, 65536]) {
  test(`mutated invalid maxstack ${String(maxStack)} cannot produce a stack proof`, () => {
    const inspector = new AssemblyInspector(literal());
    const method = inspector.getMethod(inspector.pe.entryPoint);
    method.maxStack = maxStack;
    const report = verifyCilAssembly(inspector);
    assert(report.issues.some(issue => issue.message === 'Invalid maxstack header'));
    assert.equal(verifiedStackBound(inspector, report, method), null);
  });
}

test('catch entry height is checked even when its first instruction immediately pops the exception', () => {
  const bytes = managedFixture({methods: [{name: 'Main', maxStack: 0, body(writer) {
    writer.mark('try').op('nop').op('leave.s', 'done').mark('catch').op('pop').op('leave.s', 'done');
    writer.mark('done').op('ret');
  }, handlers(labels, context) {
    return [{start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'),
      handlerEnd: labels.get('done'), catchType: context.resolve('System.Exception')}];
  }}]});
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, false);
  assert(report.issues.some(issue => /Incoming evaluation stack exceeds maxstack/.test(issue.message)));
});

test('proofs belong to the canonical body and inspector, while concrete signatures can share a body', () => {
  const inspector = new AssemblyInspector(literal()), report = verifyCilAssembly(inspector);
  const method = inspector.getMethod(inspector.pe.entryPoint);
  const bound = verifiedStackBound(inspector, report, method);
  assert(Object.isFrozen(bound));
  assert.equal(verifiedStackBound(inspector, report, {...method, methodArguments: ['int']}), bound);
  assert.equal(verifiedStackBound(inspector, {...report}, method), null);
  assert.equal(verifiedStackBound(new AssemblyInspector(literal()), report, method), null);
  assert.equal(verifiedStackBound(inspector, report, {...method, instructions: [...method.instructions]}), null);
  method.instructions[0].operand = 7;
  assert.equal(verifiedStackBound(inspector, report, method), null, 'in-place edits are not old proof');
});

test('lowering a live host limit re-admits the method before another instruction executes', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'int', maxStack: 2, body(writer) {
    writer.op('ldc.i4', 40).op('ldc.i4.2').op('add').op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes, {maxStackValues: 2});
  vm.step();
  vm.options.maxStackValues = 1;
  assert.throws(() => vm.step(), {name: 'ExecutionLimitException'});
  assert.equal(vm.top.pc, 1, 'quota rejection occurs before dispatch');
  assert.deepEqual(vm.top.stack, [40]);
  vm.options.maxStackValues = 2;
  assert.equal(vm.run().returnValue, 42);
});

test('a direct push observes a lowered limit even between admitted instructions', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackValues: 2});
  vm.step();
  vm.options.maxStackValues = 1;
  assert.throws(() => vm.push(7), {name: 'ExecutionLimitException'});
  assert.deepEqual(vm.top.stack, [42]);
  assert.equal(vm.run().returnValue, 42, 'the method still fits the lowered quota');
});

test('invalid live limits are rejected at instruction admission and direct push', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackValues: 1});
  vm.step();
  vm.options.maxStackValues = NaN;
  assert.throws(() => vm.step(), /nonnegative safe integer/);
  assert.throws(() => vm.push(7), /nonnegative safe integer/);
  assert.equal(vm.top.pc, 1);
  assert.deepEqual(vm.top.stack, [42]);
});

test('a replaced body keeps the checked fallback until it is explicitly reverified', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackValues: 1});
  const replacement = new AssemblyInspector(managedFixture({methods: [{name: 'Main', result: 'int', body: writer =>
    writer.op('ldc.i4', 40).op('ldc.i4.2').op('add').op('ret')}]}));
  vm.top.method.instructions = replacement.getMethod(replacement.pe.entryPoint).instructions;
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'ExecutionLimitException');
  assert.equal(vm.top.stack.length, 1);
});

test('explicit invalidation sends an in-place edit through checked fallback, and fresh verification restores proof', () => {
  const vm = new CilVirtualMachine(literal());
  const method = vm.top.method;
  method.instructions[0].operand = 7;
  invalidateExecutionCode(vm, 'opcode-edit');
  assert.equal(vm.run().returnValue, 7);
  vm.report = verifyCilAssembly(vm.inspector);
  vm.call(method.token, []);
  vm.state = 'running';
  assert(verifiedStackBound(vm.inspector, vm.report, vm.top.method));
  assert.equal(vm.run().returnValue, 7);
});

test('active snapshot bounds are preflighted before live execution or heap mutation', () => {
  const vm = new CilVirtualMachine(literal(), {maxStackValues: 1});
  const snapshot = vm.snapshot(), frames = vm.frames, revision = vm.heap.mutationRevision;
  snapshot.frames[0].stack.push(1, 2);
  assert.throws(() => vm.restore(snapshot), /verified evaluation-stack bound/);
  assert.equal(vm.frames, frames);
  assert.equal(vm.heap.mutationRevision, revision);
  assert.equal(vm.run().returnValue, 42);
});

function scheduledWorker() {
  return managedFixture({methods: [
    {name: 'Main', maxStack: 2, body(writer, context) {
      writer.op('ldnull').op('ldftn', context.methods.Worker);
      writer.op('newobj', context.member('System.Action', '.ctor', 'void', ['object', 'nint'], false));
      writer.op('call', context.member('System.Threading.Tasks.Task', 'Run', 'System.Threading.Tasks.Task', ['System.Action']));
      writer.op('pop').op('ret');
    }},
    {name: 'Worker', maxStack: 1, body: (writer, context) => writer.op('ldc.i4', 60000)
      .op('call', context.member('System.Threading.Thread', 'Sleep', 'void', ['int'])).op('ret')}
  ]});
}

test('parked stacks retain valid bounds across restore and cancellation; forged parked stacks are rejected', () => {
  const vm = new CilVirtualMachine(scheduledWorker(), {virtualTime: true, maxStackValues: 2});
  assert.equal(vm.run().state, 'waiting');
  const valid = vm.snapshot(), invalid = vm.snapshot();
  const child = invalid.scheduler.contexts.find(([, context]) => context.kind === 'task')[1];
  child.frames[0].stack.push(1, 2);
  const contexts = vm.scheduler.contexts;
  assert.throws(() => vm.restore(invalid), /verified evaluation-stack bound/);
  assert.equal(vm.scheduler.contexts, contexts);
  vm.restore(valid);
  vm.scheduler.advance(60000);
  assert.equal(vm.run().state, 'terminated');
  vm.restore(valid);
  vm.stop();
  assert.equal(vm.frames.length, 0);
  assert.equal(framePoolStatistics(vm).retainedBytes, 0);
});
