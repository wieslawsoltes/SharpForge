import test from 'node:test';
import assert from 'node:assert/strict';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

function fixture(method) {
  return genericCallFixture([
    {name: 'Box`1', genericParameters: [{}], methods: []},
    {name: 'Program', methods: [{name: 'Main', result: 'void', ...method}]},
  ]);
}

test('ldtoken admits open TypeDef and TypeRef identities without instantiating storage', () => {
  for (const name of ['Box`1', 'System.Collections.Generic.List`1']) {
    const bytes = fixture({result: 'bool', body(writer, context) {
      writer.op('ldtoken', context.resolve(name));
      writer.op('call', context.member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
      writer.op('callvirt', context.member('System.Type', 'get_IsGenericTypeDefinition', 'bool', [], false)).op('ret');
    }});
    const inspector = new AssemblyInspector(bytes);
    const report = verifyCilAssembly(inspector);
    assert.equal(report.success, true, JSON.stringify(report.issues));
    const result = new CilVirtualMachine(inspector).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, true);
  }
});

test('ldtoken still validates constructed TypeSpec arity and declaring variable bounds', () => {
  const closed = fixture({body(writer, context) {
    writer.op('ldtoken', context.typeSpec('Box`1<int>')).op('pop').op('ret');
  }});
  assert.equal(verifyCilAssembly(closed).success, true);
  for (const [type, message] of [
    ['Box`1<int,string>', /argument count mismatch/],
    ['Box`1<!!0>', /outside its declaring context/],
    ['!0', /outside its declaring context/],
  ]) {
    const bytes = fixture({body(writer, context) {
      writer.op('ldtoken', context.typeSpec(type)).op('pop').op('ret');
    }});
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_TOKEN' && message.test(issue.message)), JSON.stringify(report.issues));
  }
});

test('open generic local and allocation storage remain rejected after type-handle admission', () => {
  const local = fixture({locals: ['Box`1'], body: writer => writer.op('ret')});
  const allocation = fixture({body(writer, context) {
    writer.op('ldc.i4.0').op('newarr', context.resolve('Box`1')).op('pop').op('ret');
  }});
  for (const [bytes, code] of [[local, 'IL_SIGNATURE'], [allocation, 'IL_TYPE']]) {
    const report = verifyCilAssembly(bytes);
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === code && /Open generic storage/.test(issue.message)), JSON.stringify(report.issues));
  }
});
