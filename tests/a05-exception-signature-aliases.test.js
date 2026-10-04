import test from 'node:test';
import assert from 'node:assert/strict';
import {intrinsicDefinition, normalizeCallType} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {controlFixture} from './support/control-fixture.js';

const descriptor = (owner, name, parameters, returnType) => ({
  kind: 'method', owner, name,
  signature: {parameters, returnType, isStatic: false, genericArity: 0, callingConvention: 0}
});

test('inherited Exception.GetType MemberRefs preserve exact signature and actual receiver type', () => {
  for (const owner of ['System.Exception', 'System.InvalidOperationException']) {
    const valid = descriptor(owner, 'GetType', [], 'System.Type');
    assert.equal(intrinsicDefinition(valid)?.implementation, 'objectGetType');
    assert.equal(intrinsicDefinition({...valid, signature: {...valid.signature, isStatic: true}}), null);
    assert.equal(intrinsicDefinition(descriptor(owner, 'GetType', ['object'], 'System.Type')), null);
    assert.equal(intrinsicDefinition(descriptor(owner, 'GetType', [], 'object')), null);
    const assembly = controlFixture([{name: 'Program', methods: [{name: 'Main', result: 'string', body(writer, context) {
      writer.op('newobj', context.member('System.InvalidOperationException', '.ctor', 'void', [], false))
        .op('callvirt', context.member(owner, 'GetType', 'System.Type', [], false))
        .op('callvirt', context.member('System.Type', 'get_Name', 'string', [], false)).op('ret');
    }}]}]);
    const vm = new CilVirtualMachine(assembly);
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, 'InvalidOperationException');
    } finally { vm.stop(); }
  }
  assert.equal(intrinsicDefinition(descriptor('Acme.Exception', 'GetType', [], 'System.Type')), null);
});

test('T04 exception signature aliases preserve exact constructor and result matching', () => {
  for (const exception of ['Exception', 'System.Exception']) {
    assert(intrinsicDefinition(descriptor('System.InvalidOperationException', '.ctor', ['string', exception], 'void')));
    assert(intrinsicDefinition(descriptor('System.Exception', 'get_InnerException', [], exception)));
    assert(intrinsicDefinition(descriptor('System.Exception', 'GetBaseException', [], exception)));
  }
  assert.equal(intrinsicDefinition(descriptor('System.InvalidOperationException', '.ctor', ['string', 'object'], 'void')), null);
  assert.equal(intrinsicDefinition(descriptor('System.Exception', 'GetBaseException', [], 'object')), null);
  assert.equal(normalizeCallType('Exception[]'), 'System.Exception[]');
  assert.equal(normalizeCallType('System.Collections.Generic.List`1<Exception>'),
    'System.Collections.Generic.List`1<System.Exception>');
});
