import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';
import {exceptionMatches} from '../packages/runtime/src/execution/exception-types.js';

function divideFixture(catchType) {
  return managedFixture({methods: [{name: 'Main', result: 'int', locals: ['int'],
    body: writer => writer.mark('try').op('ldc.i4.1').op('ldc.i4.0').op('div').op('stloc.0').op('leave', 'done')
      .mark('catch').op('pop').op('ldc.i4', 42).op('stloc.0').op('leave', 'done').mark('done').op('ldloc.0').op('ret'),
    handlers: (labels, context) => [{flags: 0, start: labels.get('try'), end: labels.get('catch'), target: labels.get('catch'), handlerEnd: labels.get('done'), catchType: context.resolve(catchType)}]
  }]});
}
for (const catchType of ['System.DivideByZeroException', 'System.ArithmeticException', 'System.SystemException', 'System.Exception']) {
  test(`runtime division fault matches ${catchType}`, () => {
    const result = new CilVirtualMachine(divideFixture(catchType)).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 42);
  });
}
for (const catchType of ['System.OverflowException', 'System.ArgumentException', 'User.DivideByZeroException']) {
  test(`runtime division fault does not match ${catchType}`, () => {
    const result = new CilVirtualMachine(divideFixture(catchType)).run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'DivideByZeroException');
  });
}
test('fault type normalization preserves namespaces and derived CLR exception classes', () => {
  assert(exceptionMatches('ArgumentNullException', 'System.ArgumentException'));
  assert(exceptionMatches('ObjectDisposedException', 'System.InvalidOperationException'));
  assert(exceptionMatches('TaskCanceledException', 'System.OperationCanceledException'));
  assert(exceptionMatches('System.OverflowException', 'ArithmeticException'));
  assert(!exceptionMatches('User.OverflowException', 'ArithmeticException'));
  assert(!exceptionMatches('NullReferenceException', 'System.ArithmeticException'));
});
test('Roslyn compiled typed catches execute in the CIL engine', () => {
  const assembly = readFileSync(new URL('./fixtures/a05/runtime-faults/RuntimeFaults.dll', import.meta.url));
  const result = new CilVirtualMachine(assembly).run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.output, 'ok\narithmetic\nsystem\nexception\n');
});
