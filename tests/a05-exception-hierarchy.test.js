import test from 'node:test';
import assert from 'node:assert/strict';
import {
  managedExceptionTypes, exceptionTypeName, exceptionBaseType, exceptionHResult, exceptionMatches
} from '@sharpforge/bytecode';
import {ManagedFault, ManagedHeap, VirtualMachine, CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const cases = [
  ['DivideByZeroException', 'ArithmeticException', true],
  ['NullReferenceException', 'System.SystemException', true],
  ['IndexOutOfRangeException', 'System.InvalidCastException', false],
  ['ArgumentNullException', 'System.ArgumentException', true],
  ['TaskCanceledException', 'System.OperationCanceledException', true],
  ['MissingFieldException', 'System.MemberAccessException', true],
  ['TypeAccessException', 'System.TypeLoadException', true],
  ['PlatformNotSupportedException', 'System.NotSupportedException', true],
  ['RankException', 'System.SystemException', true],
  ['InvalidReferenceException', 'System.InvalidProgramException', true],
  ['Acme.OverflowException', 'System.ArithmeticException', false],
  ['Acme.OverflowException', 'System.Exception', true],
  ['AmbiguousImplementationException', 'System.SystemException', false],
  ['AmbiguousImplementationException', 'System.Exception', true]
];

for (const [actual, expected, result] of cases) {
  test(`shared exception hierarchy: ${actual} versus ${expected}`, () => {
    assert.equal(exceptionMatches(actual, expected), result);
    assert.equal(exceptionMatches(exceptionTypeName(actual), expected), result);
  });
}

test('framework definitions are frozen and materialize complete canonical MethodTable chains', () => {
  const heap = new ManagedHeap();
  const names = new Set(managedExceptionTypes.map(type => type.name));
  assert(Object.isFrozen(managedExceptionTypes));
  for (const definition of managedExceptionTypes) {
    assert(Object.isFrozen(definition));
    assert(definition.base === 'System.Object' || names.has(definition.base), definition.name);
    assert.equal(exceptionBaseType(definition.name), definition.base);
    assert.equal(heap.methodTables.get(definition.name).base.name, definition.base);
    assert.equal(exceptionMatches(definition.name, 'Exception'), true);
    assert.equal(definition.hresult | 0, definition.hresult);
  }
  assert.equal(exceptionHResult('DivideByZeroException'), 0x80020012 | 0);
  assert.equal(exceptionHResult('ArgumentNullException'), 0x80004003 | 0);
  assert.equal(exceptionHResult('Acme.OverflowException'), 0x80131500 | 0);
  assert.equal(exceptionBaseType('Acme.OverflowException'), null);
});

test('internal fault aliases change managed identity without renaming diagnostic faults', () => {
  const heap = new ManagedHeap();
  for (const [diagnostic, identity] of [
    ['InvalidReferenceException', 'System.InvalidProgramException'],
    ['RuntimeException', 'System.Exception'], ['AssertionException', 'System.Exception'],
    ['InstructionLimitException', 'System.ExecutionEngineException'],
    ['OutputLimitException', 'System.ExecutionEngineException'],
    ['ExecutionLimitException', 'System.ExecutionEngineException']
  ]) {
    const fault = new ManagedFault(diagnostic, 'original message');
    assert.equal(heap.methodTables.get(fault.name).name, identity);
    assert.equal(fault.name, diagnostic);
    assert.equal(exceptionTypeName('Acme.' + diagnostic), 'Acme.' + diagnostic);
  }
});

function sourceContext(types) {
  const handlers = types.map((type, index) => ({start: 0, end: 10, target: 20 + index * 3, slot: index, type}));
  const code = new Int32Array(150);
  code[31] = 40;
  const frame = {id: 1, methodId: 0, pc: 6, base: 0, locals: [], caught: [], unwinds: []};
  return Object.assign(Object.create(VirtualMachine.prototype), {
    heap: new ManagedHeap(), image: {methods: [{qualifiedName: 'Test.Main', code, handlers}]},
    frames: [frame], stack: [], state: 'running', fault: null, pendingFault: null,
    platform: {singletons: new Map()}, scheduler: {current: null}, options: {}
  });
}

for (const [actual, expected, catches] of cases) {
  test(`source catches use hierarchy: ${actual} versus ${expected}`, () => {
    const vm = sourceContext([expected]);
    vm.handleFault(new ManagedFault(actual, 'injected runtime fault'));
    assert.equal(vm.state === 'faulted', !catches);
    if (catches) assert.equal(vm.top.pc, 20);
  });
}

test('source skips unrelated sibling catch and retains catch-all compatibility', () => {
  const vm = sourceContext(['InvalidCastException', 'ArithmeticException']);
  vm.handleFault(new ManagedFault('DivideByZeroException', 'division'));
  assert.equal(vm.top.pc, 23);
  const untyped = sourceContext([undefined]);
  untyped.handleFault(new ManagedFault('Acme.Failure', 'custom'));
  assert.equal(untyped.top.pc, 20);
});

test('source checks user exception ancestry by MethodTable identity', () => {
  const vm = sourceContext(['Acme.BaseException']);
  vm.heap.methodTables.define({name: 'Acme.BaseException', base: 'System.Exception'});
  vm.heap.methodTables.define({name: 'Acme.DerivedException', base: 'Acme.BaseException'});
  const reference = vm.heap.allocate('exception', 'Acme.DerivedException', [null]);
  vm.handleFault(new ManagedFault('Acme.DerivedException', 'custom', reference));
  assert.equal(vm.top.pc, 20);
});

function catchFixture(catchType) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.mark('try').op('nop').op('leave', 'done')
      .mark('catch').op('pop').op('ldc.i4', 42).op('stloc.0').op('leave', 'done')
      .mark('done').op('ldloc.0').op('ret'),
    handlers: (labels, context) => [{flags: 0, start: labels.get('try'), end: labels.get('catch'),
      target: labels.get('catch'), handlerEnd: labels.get('done'), catchType: context.resolve(catchType)}]
  }]});
}

for (const [actual, expected, catches] of [
  ['MissingFieldException', 'System.MemberAccessException', true],
  ['RankException', 'System.SystemException', true],
  ['InvalidReferenceException', 'System.InvalidProgramException', true],
  ['AmbiguousImplementationException', 'System.SystemException', false],
  ['Acme.RankException', 'System.SystemException', false]
]) {
  test(`CIL catches use shared hierarchy: ${actual} versus ${expected}`, () => {
    const vm = new CilVirtualMachine(catchFixture(expected));
    vm.step(); // Enter the method's protected region through its normal initialization gate.
    vm.raise(new ManagedFault(actual, 'injected runtime fault'));
    const result = vm.run();
    assert.equal(result.state, catches ? 'terminated' : 'faulted');
    if (catches) assert.equal(result.returnValue, 42);
    else assert.equal(result.fault.name, actual);
  });
}
