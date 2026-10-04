import test from 'node:test';
import assert from 'node:assert/strict';
import {arrayMethodDefinition, arrayRuntimeDefinition, intrinsicDefinition, memoryMethodDefinition} from '@sharpforge/cil';

function method(owner, name, parameters, returnType, isStatic = false, extra = {}) {
  return {kind: 'method', owner, name,
    signature: {parameters, returnType, isStatic, genericArity: 0, callingConvention: 0, ...extra.signature},
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'signature'))};
}

function generic(name, parameters, result, arguments_) {
  return method('System.Array', name, parameters, result, true,
    {signature: {genericArity: arguments_.length}, genericArguments: arguments_});
}

test('rectangular array pseudo-methods retain rank, element type, aliases and address result', () => {
  for (const [owner, rank] of [['System.Int32[*]', 1], ['int[,]', 2], ['int[-2...2,4...]', 2], ['int[' + ','.repeat(31) + ']', 32]]) {
    const indices = Array(rank).fill('System.Int32');
    for (const [name, parameters, result, operation] of [
      ['.ctor', indices, 'void', 'construct'], ['.ctor', indices.concat(indices), 'void', 'construct'],
      ['Get', indices, 'int', 'get'], ['Set', indices.concat('int'), 'void', 'set'],
      ['Address', indices, 'System.Int32&', 'address']
    ]) {
      const descriptor = method(owner, name, parameters, result);
      const definition = arrayMethodDefinition(descriptor);
      assert.equal(definition?.operation, operation);
      assert.equal(definition.rank, rank);
      assert.equal(definition.elementType, 'int');
      assert.equal(intrinsicDefinition(descriptor).implementation, 'array');
    }
  }
  const aggregate = method('Cell`1<string>[,]', 'Address', ['int', 'int'], 'Cell`1<string>&');
  assert.equal(arrayMethodDefinition(aggregate)?.operation, 'address');
});

test('malformed or incompatible array members cannot be admitted by owner and name alone', () => {
  for (const descriptor of [
    method('int[]', '.ctor', ['int'], 'void'), method('int[,]', 'Get', ['int'], 'int'),
    method('int[,]', 'Get', ['int', 'int'], 'long'), method('int[,]', 'Address', ['int', 'int'], 'int'),
    method('int[,]', 'Set', ['int', 'int', 'long'], 'void'), method('int[,]', 'Get', ['int', 'int'], 'int', true),
    method('int[,]', '.ctor', ['int', 'long'], 'void'), method('int[,]', 'Get', ['int', 'int'], 'int', false,
      {signature: {callingConvention: 5}}),
    ...['int[*,]', 'int[,2...]', 'int[2...0]', 'int[foo]', 'int[' + ','.repeat(32) + ']'].map(owner =>
      method(owner, 'Get', ['int'], 'int'))
  ]) assert.equal(arrayMethodDefinition(descriptor), null, JSON.stringify(descriptor));
});

test('reflection array overloads retain exact length and index widths', () => {
  for (const parameters of [
    ['System.Type', 'int'], ['System.Type', 'int', 'int', 'int'],
    ['System.Type', 'int[]'], ['System.Type', 'long[]'], ['System.Type', 'int[]', 'int[]']
  ]) assert.equal(arrayMethodDefinition(method('System.Array', 'CreateInstance', parameters, 'System.Array', true))?.operation, 'create');
  for (const parameters of [['int'], ['long', 'long'], ['int[]'], ['long[]']]) {
    assert.equal(arrayMethodDefinition(method('System.Array', 'GetValue', parameters, 'object'))?.operation, 'getValue');
    assert.equal(arrayMethodDefinition(method('System.Array', 'SetValue', ['object', ...parameters], 'void'))?.operation, 'setValue');
  }
  for (const descriptor of [
    method('System.Array', 'CreateInstance', ['System.Type', 'long'], 'System.Array', true),
    method('System.Array', 'GetValue', ['int', 'long'], 'object'),
    method('System.Array', 'GetValue', ['int'], 'string'),
    method('System.Array', 'GetLongLength', ['long'], 'long')
  ]) assert.equal(arrayMethodDefinition(descriptor), null);
});

test('array copy, initialization, resize and search enforce their complete signatures', () => {
  for (const index of ['int', 'long']) {
    for (const parameters of [['System.Array', 'System.Array', index], ['System.Array', index, 'System.Array', index, index]]) {
      assert.equal(arrayRuntimeDefinition(method('System.Array', 'Copy', parameters, 'void', true))?.operation, 'copy');
    }
  }
  const initialize = method('System.Runtime.CompilerServices.RuntimeHelpers', 'InitializeArray',
    ['System.Array', 'System.RuntimeFieldHandle'], 'void', true);
  assert.equal(arrayRuntimeDefinition(initialize)?.operation, 'initialize');
  assert.equal(arrayRuntimeDefinition(method('System.Array', 'Clone', [], 'object'))?.operation, 'clone');
  for (const element of ['int', 'Cell`1<string>', '!!0']) {
    assert.equal(arrayRuntimeDefinition(generic('Resize', ['!!0[]&', 'int'], 'void', [element]))?.element, element);
    assert.equal(arrayRuntimeDefinition(generic('IndexOf', ['!!0[]', '!!0', 'int', 'int'], 'int', [element]))?.operation, 'indexOf');
  }
  for (const descriptor of [
    generic('Resize', ['int[]', 'int'], 'void', ['int']), generic('Resize', ['!!0[]&', 'int'], 'void', ['int', 'long']),
    generic('IndexOf', ['!!0[]', 'long'], 'int', ['int']),
    method('System.Array', 'Clear', ['int[]'], 'void', true),
    method('System.Array', 'Copy', ['System.Array', 'int', 'System.Array', 'long', 'int'], 'void', true),
    {...initialize, signature: {...initialize.signature, isStatic: false}},
    {...initialize, signature: {...initialize.signature, explicitThis: true}},
    {...initialize, signature: {...initialize.signature, sentinel: 0}}
  ]) assert.equal(arrayRuntimeDefinition(descriptor), null);
});

test('Span contracts preserve mutable and readonly ownership and exact element identity', () => {
  const span = 'System.Span`1<int>', readonly = 'System.ReadOnlySpan`1<int>';
  for (const owner of [span, readonly]) {
    for (const parameters of [['void*', 'int'], ['int[]'], ['int[]', 'int', 'int']]) {
      assert.equal(memoryMethodDefinition(method(owner, '.ctor', parameters, 'void'))?.operation, 'spanCtor');
    }
    assert.equal(memoryMethodDefinition(method(owner, 'get_Item', ['int'], '!0&'))?.operation, 'spanItem');
    assert.equal(memoryMethodDefinition(method(owner, 'Slice', ['int', 'int'], owner))?.operation, 'spanSlice');
    assert.equal(memoryMethodDefinition(method(owner, 'op_Implicit', ['int[]'], owner, true))?.owner, owner);
  }
  assert.equal(memoryMethodDefinition(method(readonly, 'get_Item', ['int'],
    'int& modreq(System.Runtime.InteropServices.InAttribute)'))?.operation, 'spanItem');
  assert.equal(memoryMethodDefinition(method(span, 'op_Implicit', [span], readonly, true))?.owner, readonly);
  for (const descriptor of [
    method(span, 'get_Item', ['int'], 'long&'), method(span, 'get_Item', ['int'], 'int'),
    method(span, 'get_Item', ['int'], 'int& modreq(System.Runtime.InteropServices.InAttribute)'),
    method(readonly, 'get_Item', ['int'], 'int& modreq(Unknown)'),
    method(readonly, 'op_Implicit', [readonly], span, true), method(span, '.ctor', ['int*', 'int'], 'void'),
    method('System.Span`1<int&>', 'get_Length', [], 'int')
  ]) assert.equal(memoryMethodDefinition(descriptor), null);
});

test('Unsafe reinterpretation and byte-array bit conversion do not steal established scalar contracts', () => {
  const reinterpret = method('System.Runtime.CompilerServices.Unsafe', 'As', ['!!0&'], '!!1&', true,
    {signature: {genericArity: 2}, genericArguments: ['int', 'float']});
  assert.equal(memoryMethodDefinition(reinterpret)?.operation, 'reinterpret');
  assert.equal(memoryMethodDefinition({...reinterpret, signature: {...reinterpret.signature, returnType: 'long&'}}), null);
  assert.equal(memoryMethodDefinition(method('System.BitConverter', 'GetBytes', ['System.Single'], 'byte[]', true))?.operation, 'bitBytes');
  assert.equal(memoryMethodDefinition(method('System.BitConverter', 'ToDouble', ['byte[]', 'int'], 'double', true))?.operation, 'bitValue');
  for (const [name, parameter, result] of [
    ['SingleToInt32Bits', 'float', 'int'], ['DoubleToInt64Bits', 'double', 'long'],
    ['Int32BitsToSingle', 'int', 'float'], ['Int64BitsToDouble', 'long', 'double']
  ]) {
    const descriptor = method('System.BitConverter', name, [parameter], result, true);
    assert.equal(memoryMethodDefinition(descriptor), null);
    assert.equal(intrinsicDefinition(descriptor)?.implementation, 'bitConverter');
  }
  const nullable = method('System.Nullable`1<int>', 'GetValueOrDefault', [], 'int');
  assert.equal(memoryMethodDefinition(nullable), null);
  assert.equal(intrinsicDefinition(nullable)?.implementation, 'nullable');
});
