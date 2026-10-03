import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';
import {unhandledExceptionExitCode} from '../packages/runtime/src/execution/unhandled.js';

function exception(writer, context) {
  writer.op('ldstr', 0x70000000 + context.md.userString('failure'));
  writer.op('newobj', context.member('System.Exception', '.ctor', 'void', ['string'], false)).op('throw');
}
function unhandled() {
  return controlFixture([{name: 'Program', fields: [{name: 'Cleanup'}], methods: [
    {
      name: 'Main', body(writer, context) {
        writer.label('try').op('call', context.methods.get('Program.Thrower')).op('leave', 'done');
        writer.label('tryEnd').label('finally').op('ldc.i4.1').op('stsfld', context.fields.get('Program.Cleanup'));
        writer.op('endfinally').label('finallyEnd').label('done').op('ret');
      },
      handlers: labels => [{flags: 2, start: labels.get('try'), end: labels.get('tryEnd'),
        target: labels.get('finally'), handlerEnd: labels.get('finallyEnd')}]
    },
    {name: 'Thrower', locals: ['int'], body(writer, context) {
      writer.op('ldc.i4', 42).op('stloc.0');
      exception(writer, context);
    }}
  ]}]);
}

test('T04.1 unhandled first pass retains throwing frames and does not run cleanup', () => {
  const vm = new CilVirtualMachine(unhandled());
  const firstChance = [];
  vm.onException = fault => { firstChance.push(fault.phase); return false; };
  const result = vm.run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.exitCode, unhandledExceptionExitCode);
  assert.equal(result.fault.unhandled, true);
  assert.equal(result.fault.phase, 'unhandled');
  assert.deepEqual(firstChance, ['first-chance']);
  assert.equal(vm.frames.length, 2);
  assert.equal(vm.top.method.name, 'Thrower');
  assert.equal(vm.top.locals[0], 42);
  assert.equal(vm.statics.get(0x04000001), 0);
  vm.heap.collect();
  assert.equal(vm.heap.get(result.fault.reference).kind, 'exception');
  assert.equal(vm.frameIndex.get(vm.top.id), vm.top);
});

test('T04.1 retained unhandled state survives snapshot restoration for inspection', () => {
  const vm = new CilVirtualMachine(unhandled());
  vm.run();
  const snapshot = vm.snapshot();
  vm.top.locals[0] = 1;
  vm.restore(snapshot);
  assert.equal(vm.state, 'faulted');
  assert.equal(vm.top.locals[0], 42);
  assert.equal(vm.fault.phase, 'unhandled');
  assert.equal(vm.run().exitCode, unhandledExceptionExitCode);
  vm.stop();
  assert.equal(vm.frames.length, 0);
});

test('T04.1 two-pass search and unwind cross ten thousand frames without host recursion', () => {
  const bytes = controlFixture([{name: 'Program', methods: [
    {
      name: 'Main', result: 'int', locals: ['int'], maxStack: 1,
      body(writer, context) {
        writer.label('try').op('ldc.i4', 10000).op('call', context.methods.get('Program.Recurse')).op('leave', 'done');
        writer.label('tryEnd').label('catch').op('pop').op('ldc.i4', 42).op('stloc.0').op('leave', 'done');
        writer.label('catchEnd').label('done').op('ldloc.0').op('ret');
      },
      handlers: (labels, context) => [{start: labels.get('try'), end: labels.get('tryEnd'), target: labels.get('catch'),
        handlerEnd: labels.get('catchEnd'), catchType: context.resolve('System.Exception')}]
    },
    {
      name: 'Recurse', parameters: ['int'], maxStack: 2,
      body(writer, context) {
        writer.op('ldarg.0').op('brfalse', 'throw').op('ldarg.0').op('ldc.i4.1').op('sub');
        writer.op('call', context.methods.get('Program.Recurse')).op('ret').label('throw');
        exception(writer, context);
      }
    }
  ]}]);
  const vm = new CilVirtualMachine(bytes);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
  assert.equal(vm.frames.length, 0);
  assert.equal(vm.frameIndex.size, 0);
  assert.equal(vm.stackBudget.frames.size, 0);
});
