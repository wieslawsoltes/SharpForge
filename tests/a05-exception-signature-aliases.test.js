import test from 'node:test';
import assert from 'node:assert/strict';
import {intrinsicDefinition, normalizeCallType} from '@sharpforge/cil';

const descriptor = (owner, name, parameters, returnType) => ({
  kind: 'method', owner, name,
  signature: {parameters, returnType, isStatic: false, genericArity: 0, callingConvention: 0}
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
