import test from 'node:test';
import assert from 'node:assert/strict';
import { AssemblyInspector, verifyCilAssembly, verifiedStackBound } from '@sharpforge/cil';
import { CilVirtualMachine } from '@sharpforge/runtime';
import { invokeManagedMethod } from '../packages/runtime/src/execution/synchronous-call.js';
import { managedFixture } from './managed-fixtures.js';
import { flowFixture } from './fixtures/a03-eh-admission/input.js';
import { exceptionFixture } from './support/exception-encoding.js';

function finallyMethod(name = 'Main') {
  return {
    name,
    result: 'int',
    locals: ['int'],
    maxStack: 2,
    body(writer) {
      writer.mark('try').op('ldc.i4', 40).op('stloc.0').op('leave', 'done');
      writer.mark('handler').op('ldloc.0').op('ldc.i4.2').op('add').op('stloc.0').op('endfinally');
      writer.mark('done').op('ldloc.0').op('ret');
    },
    handlers(labels) {
      return [{ flags: 2, start: labels.get('try'), end: labels.get('handler'),
        target: labels.get('handler'), handlerEnd: labels.get('done') }];
    },
  };
}

const finallyAssembly = () => managedFixture({ methods: [finallyMethod()] });
const hasIssue = diagnostic => error => error.issues?.some(issue => issue.diagnostic === diagnostic) === true;

for (const maxInstructions of [1_000_001, 20_000_000]) {
  test(`CIL execution budget ${maxInstructions} admits and executes a real finally handler`, () => {
    const options = Object.freeze({ maxInstructions, virtualTime: true });
    const vm = new CilVirtualMachine(finallyAssembly(), options);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated');
      assert.equal(result.fault, null);
      assert.equal(result.returnValue, 42);
      assert.equal(vm.options.maxInstructions, maxInstructions);
      assert.equal(options.maxInstructions, maxInstructions);
      assert(verifiedStackBound(vm.inspector, vm.report, vm.inspector.getMethod(vm.report.entryPoint)));
    } finally { vm.stop(); }
  });
}

test('CIL admission preserves an existing inspector and selected nested fault/catch method', () => {
  const fixture = exceptionFixture({ kind: 'fault' });
  const inspector = new AssemblyInspector(fixture.assembly);
  const vm = new CilVirtualMachine(inspector, { methodToken: fixture.methodToken, maxInstructions: 20_000_000 });
  try {
    assert.equal(vm.inspector, inspector);
    assert.equal(vm.report.entryPoint, fixture.methodToken);
    const result = vm.run();
    assert.equal(result.state, 'terminated');
    assert.equal(result.fault, null);
    assert.equal(result.returnValue, fixture.expected);
  } finally { vm.stop(); }
});

test('a small CIL execution budget admits the whole method and expires during execution', () => {
  const vm = new CilVirtualMachine(finallyAssembly(), { maxInstructions: 3 });
  try {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'InstructionLimitException');
    assert.equal(vm.instructions, 4);
    assert.equal(vm.options.maxInstructions, 3);
  } finally { vm.stop(); }
});

test('direct CIL verification retains its static instruction ceiling and caller-supplied lower bound', () => {
  const inspector = new AssemblyInspector(finallyAssembly());
  assert.equal(verifyCilAssembly(inspector).success, true);
  const tooHigh = verifyCilAssembly(inspector, { maxInstructions: 1_000_001 });
  assert.equal(tooHigh.success, false);
  assert(tooHigh.issues.some(issue => issue.diagnostic === 'CILR0001'));
  const tooSmall = verifyCilAssembly(inspector, { maxInstructions: 0 });
  assert.equal(tooSmall.success, false);
  assert(tooSmall.issues.some(issue => issue.diagnostic === 'CILR0029'));
});

test('a large CIL execution budget still rejects malformed EH transfers before execution', () => {
  const { bytes } = flowFixture({ mode: 'branch-exit' });
  assert.throws(() => new CilVirtualMachine(bytes, { maxInstructions: 20_000_000 }), hasIssue('CILCF0008'));
});

test('CIL admission preserves explicit region limits and cancellation', () => {
  const inspector = new AssemblyInspector(finallyAssembly());
  assert.equal(verifyCilAssembly(inspector).success, true);
  for (const [options, diagnostic] of [
    [{ maxClauses: 0 }, 'CILR0002'],
    [{ maxCodeBytes: 0 }, 'CILR0002'],
    [{ signal: AbortSignal.abort() }, 'CILR0003'],
  ]) {
    assert.throws(() => new CilVirtualMachine(inspector, { maxInstructions: 20_000_000, ...options }), hasIssue(diagnostic));
  }
});

function callbackVM(options = {}) {
  const bytes = managedFixture({ methods: [{ name: 'Main', body: writer => writer.op('ret') }, finallyMethod('Callback')] });
  return new CilVirtualMachine(bytes, { maxInstructions: 20_000_000, ...options });
}

test('late CIL callback verification separates the execution budget and retains original stack proofs', () => {
  const vm = callbackVM();
  const callback = [...vm.inspector.methods.values()].find(method => method.name === 'Callback');
  const caller = vm.top;
  assert.equal(vm.report.methods.includes(callback.token), false);
  vm.state = 'paused';
  try {
    assert.equal(invokeManagedMethod(vm.platform, callback.token, null, []), 42);
    assert.equal(vm.report.methods.includes(callback.token), true);
    assert(verifiedStackBound(vm.inspector, vm.report, vm.inspector.getMethod(callback.token)));
    assert(verifiedStackBound(vm.inspector, vm.report, caller.method));
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.options.maxInstructions, 20_000_000);
    assert.equal(vm.scheduler.options.maxInstructions, 20_000_000);
    assert.equal(vm.scheduler.callbackScopes.length, 0);
  } finally { vm.stop(); }
});

test('late CIL callback verification retains region limits and preserves the prior report on rejection', () => {
  const vm = callbackVM({ maxClauses: 0 });
  const callback = [...vm.inspector.methods.values()].find(method => method.name === 'Callback');
  const report = vm.report;
  const caller = vm.top;
  vm.state = 'paused';
  try {
    assert.throws(() => invokeManagedMethod(vm.platform, callback.token, null, []), error =>
      error.name === 'InvalidProgramException' && error.message.includes('Exception region size limit exceeded'));
    assert.equal(vm.report, report);
    assert(verifiedStackBound(vm.inspector, report, caller.method));
    assert.equal(vm.top, caller);
    assert.equal(vm.state, 'paused');
    assert.equal(vm.options.maxInstructions, 20_000_000);
  } finally { vm.stop(); }
});
