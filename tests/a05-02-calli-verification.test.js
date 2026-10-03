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

test('T02.6 a calli result can itself carry a verified managed function pointer', () => {
  const bytes = controlFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      const factory = context.md.add(17, [context.md.blob(context.signature('method int *(int)'))]);
      const apply = context.md.add(17, [context.md.blob(context.signature('int', ['int']))]);
      writer.op('ldc.i4', 41).op('ldftn', context.methods.get('Program.Factory'))
        .op('calli', factory).op('calli', apply).op('ret');
    }},
    {name: 'Factory', result: 'method int *(int)', body: (writer, context) =>
      writer.op('ldftn', context.methods.get('Program.Increment')).op('ret')},
    {name: 'Increment', result: 'int', parameters: ['int'], body: writer =>
      writer.op('ldarg.0').op('ldc.i4.1').op('add').op('ret')}
  ]}]);
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
});

test('T02.6 declared function-pointer fields reject incompatible stores before execution', () => {
  for (const mismatch of [false, true]) {
    const bytes = controlFixture([{name: 'Program', fields: [{name: 'Target', type: 'method int *(int)'}], methods: [
      {name: 'Main', result: 'int', body(writer, context) {
        const apply = context.md.add(17, [context.md.blob(context.signature('int', ['int']))]);
        writer.op('ldftn', context.methods.get('Program.Target')).op('stsfld', context.fields.get('Program.Target'))
          .op('ldc.i4', 41).op('ldsfld', context.fields.get('Program.Target')).op('calli', apply).op('ret');
      }},
      {name: 'Target', result: mismatch ? 'long' : 'int', parameters: ['int'], body(writer) {
        writer.op('ldarg.0').op('ldc.i4.1').op('add');
        if (mismatch) writer.op('conv.i8');
        writer.op('ret');
      }}
    ]}]);
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, !mismatch, JSON.stringify(report.issues));
    if (mismatch) assert(report.issues.some(issue => issue.code === 'IL_CALLI' && /signature/.test(issue.message)));
    else assert.equal(new CilVirtualMachine(bytes).run().returnValue, 42);
  }
});
