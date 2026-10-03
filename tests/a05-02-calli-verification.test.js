import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {verifyCilAssembly} from '@sharpforge/cil';
import {controlFixture} from './support/control-fixture.js';

function build({mismatch = false, join = false, unmanaged = false} = {}) {
  return controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', locals: ['nint'], body(writer, context) {
      const signature = Uint8Array.from([unmanaged ? 1 : 0, 1, 8, 8]);
      const call = context.md.add(17, [context.md.blob(signature)]);
      if (join) writer.op('ldc.i4.0').op('brfalse', 'second');
      writer.op('ldftn', context.methods.get('Program.Int')).op('stloc.0');
      if (join) writer.op('br', 'invoke').label('second');
      if (join || mismatch) writer.op('ldftn', context.methods.get(mismatch ? 'Program.Long' : 'Program.Int')).op('stloc.0');
      if (join) writer.label('invoke');
      writer.op('ldc.i4', 41).op('ldloc.0').op('calli', call).op('ret');
    }},
    {name: 'Int', result: 'int', parameters: ['int'], body: writer => writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')},
    {name: 'Long', result: 'long', parameters: ['int'], body: writer => writer.op('ldarg.0').op('conv.i8').op('ret')}
  ]}]);
}

test('T02.6 signatures flow through native-int locals and compatible branch joins', () => {
  for (const join of [false, true]) {
    const result = new CilVirtualMachine(build({join})).run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 42);
  }
});

test('T02.6 incompatible function targets at a branch join fail before execution', () => {
  const report = verifyCilAssembly(build({mismatch: true, join: true}));
  assert.equal(report.success, false);
  assert(report.issues.some(issue => issue.code === 'IL_CALLI'));
  assert.throws(() => new CilVirtualMachine(build({mismatch: true})), /signature/);
});

test('T02.6 unmanaged calli reports a structured unsupported member', () => {
  assert.throws(() => new CilVirtualMachine(build({unmanaged: true})), error =>
    error.name === 'NotSupportedException' && error.member === 'Program::Main' && error.callingConvention === 1);
});
