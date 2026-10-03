import test from 'node:test';
import assert from 'node:assert/strict';
import {managedExceptionTypes, exceptionTypeName, exceptionMatches} from '@sharpforge/bytecode';
import {VirtualMachine} from '@sharpforge/runtime';
import {image} from './helpers.js';
import {ManagedFault} from '../packages/runtime/src/heap.js';

for (const [actual, expected, result] of [
  ['DivideByZeroException', 'ArithmeticException', true],
  ['NullReferenceException', 'System.SystemException', true],
  ['IndexOutOfRangeException', 'System.InvalidCastException', false],
  ['ArgumentNullException', 'System.ArgumentException', true],
  ['TaskCanceledException', 'System.OperationCanceledException', true],
  ['InvalidReferenceException', 'System.InvalidProgramException', true],
  ['Acme.OverflowException', 'System.ArithmeticException', false],
  ['Acme.OverflowException', 'System.Exception', true],
  ['AmbiguousImplementationException', 'System.SystemException', false]
]) {
  test(`T04.3 hierarchy: ${actual} versus ${expected}`, () => {
    assert.equal(exceptionMatches(actual, expected), result);
    assert.equal(exceptionMatches(exceptionTypeName(actual), expected), result);
  });
}

test('T04.3 every managed framework exception has a complete canonical base chain', () => {
  const names = new Set(managedExceptionTypes.map(type => type.name));
  for (const definition of managedExceptionTypes) {
    assert(definition.base === 'System.Object' || names.has(definition.base), definition.name);
    assert.equal(exceptionMatches(definition.name, 'Exception'), true);
    assert.equal(definition.hresult | 0, definition.hresult);
  }
});

for (const [catchType, faultName, catches] of [
  ['ArithmeticException', 'DivideByZeroException', true],
  ['SystemException', 'NullReferenceException', true],
  ['InvalidCastException', 'IndexOutOfRangeException', false]
]) {
  test(`T04.3 source handler metadata uses ancestry: ${catchType}`, () => {
    const compiled = image('class Program { static void Main() { try { Console.WriteLine(1); } catch (Exception ex) { Console.WriteLine(2); } } }');
    const method = compiled.methods.find(method => method.handlers.length);
    const handler = method.handlers[0];
    handler.type = catchType;
    const vm = new VirtualMachine(compiled);
    if (vm.top.methodId !== method.id) vm.call(method.id, []);
    vm.top.pc = handler.start + 1;
    vm.handleFault(new ManagedFault(faultName, 'injected runtime fault'));
    assert.equal(vm.state === 'faulted', !catches);
    if (catches) assert.equal(vm.top.pc, handler.target);
  });
}
