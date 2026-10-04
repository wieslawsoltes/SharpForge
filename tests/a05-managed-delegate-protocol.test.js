import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedDelegateFixture} from './support/managed-delegate-fixture.js';

function run(body, options) {
  const vm = new CilVirtualMachine(managedDelegateFixture(body), options);
  try { return vm.run(); } finally { vm.stop(); }
}

for (const inlineCaches of [false, true]) test(`ldvirtftn binds the override and original receiver, PIC ${inlineCaches}`, () => {
  const result = run((writer, context, api) => {
    writer.op('ldc.i4', 42).op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    api.bind(); writer.op('stloc.1');
    writer.op('ldc.i4.7').op('newobj', context.methods.get('Derived..ctor')).op('stloc.0')
      .op('ldloc.1').op('callvirt', api.invoke).op('ret');
  }, {inlineCaches});
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 142, 'the captured receiver survives replacement and GC inside the override');
});

for (const phase of ['capture', 'invoke']) test(`managed delegate null ${phase} throws NullReferenceException`, () => {
  const result = run((writer, context, api) => {
    if (phase === 'capture') { api.bind(); writer.op('pop').op('ldc.i4.0'); }
    else writer.op('ldnull').op('callvirt', api.invoke);
    writer.op('ret');
  });
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'NullReferenceException');
});

test('virtual delegate equality includes the selected body and receiver identity', () => {
  const result = run((writer, context, api) => {
    writer.op('ldc.i4', 42).op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    api.bind(); writer.op('stloc.1');
    api.bind(); writer.op('stloc.2');
    writer.op('ldc.i4', 42).op('newobj', context.methods.get('Derived..ctor')).op('stloc.0');
    api.bind(); writer.op('stloc.3');
    writer.op('ldloc.1').op('ldloc.2').op('call', api.equals)
      .op('ldloc.1').op('ldloc.3').op('call', api.equals).op('ldc.i4.2').op('mul').op('add').op('ret');
  });
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 1);
});

test('managed Combine invokes ordered targets and returns the final result', () => {
  const result = run((writer, context, api) => {
    api.target('A'); api.target('B'); api.combined(); api.target('A'); api.combined();
    writer.op('callvirt', api.invoke); api.traceResult();
  });
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 1211);
});

test('managed Remove removes the last matching subsequence', () => {
  const result = run((writer, context, api) => {
    api.target('A'); api.target('B'); api.combined(); writer.op('stloc.1');
    writer.op('ldloc.1'); api.target('C'); api.combined(); writer.op('ldloc.1'); api.combined();
    writer.op('ldloc.1'); api.removed(); writer.op('callvirt', api.invoke); api.traceResult();
  });
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 1233, 'removing the first subsequence would produce 3122');
});

test('managed Remove retains order after removing a final scalar occurrence and yields null for the full list', () => {
  const result = run((writer, context, api) => {
    api.target('A'); api.target('B'); api.combined(); writer.op('dup'); api.combined();
    api.target('A'); api.removed(); writer.op('stloc.1');
    writer.op('ldloc.1').op('callvirt', api.invoke).op('pop');
    writer.op('ldloc.1').op('ldloc.1'); api.removed();
    writer.op('ldnull').op('ceq').op('ldsfld', context.fields.get('Program.Trace')).op('add').op('ret');
  });
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 123, 'trace 122 plus a null result from complete removal');
});

test('GetInvocationList returns an independent ordered array of equal single-target delegates', () => {
  const result = run((writer, context, api) => {
    api.target('A'); writer.op('stloc.1'); api.target('B'); writer.op('stloc.2');
    writer.op('ldloc.1').op('ldloc.2'); api.combined(); writer.op('stloc.3');
    writer.op('ldloc.3').op('callvirt', api.list).op('stloc.s', 5)
      .op('ldloc.3').op('callvirt', api.list).op('stloc.s', 6)
      .op('ldloc.s', 5).op('ldloc.s', 6).op('ceq').op('brtrue', 'bad')
      .op('ldloc.s', 5).op('ldlen').op('conv.i4').op('ldc.i4.2').op('bne.un', 'bad')
      .op('ldloc.s', 5).op('ldc.i4.0').op('ldelem.ref').op('ldloc.1').op('call', api.equals).op('brfalse', 'bad')
      .op('ldloc.s', 5).op('ldc.i4.1').op('ldelem.ref').op('ldloc.2').op('call', api.equals).op('brfalse', 'bad')
      .op('ldloc.s', 5).op('ldc.i4.0').op('ldnull').op('stelem.ref')
      .op('ldloc.s', 6).op('ldc.i4.0').op('ldelem.ref').op('ldloc.1').op('call', api.equals).op('brfalse', 'bad')
      .op('ldloc.3').op('callvirt', api.invoke); api.traceResult();
    writer.mark('bad').op('ldc.i4.m1').op('ret');
  });
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.returnValue, 122, 'mutating the returned array cannot alter the captured invocation list');
});
