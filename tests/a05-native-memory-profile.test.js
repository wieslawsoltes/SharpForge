import test from 'node:test';
import assert from 'node:assert/strict';
import {arrayRuntimeDefinition, memoryMethodDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {fieldRvaData} from '../packages/runtime/src/execution/field-rva.js';
import {controlFixture} from './support/control-fixture.js';

const descriptor = (owner, name, parameters, returnType = 'void') => ({
  kind: 'method', owner, name, signature: {isStatic: true, parameters, returnType}
});

test('Roslyn Array aliases retain exact overload and return-type checks', () => {
  const copy = descriptor('System.Array', 'Copy', ['Array', 'int', 'Array', 'int', 'int']);
  assert.equal(arrayRuntimeDefinition(copy).operation, 'copy');
  assert.equal(arrayRuntimeDefinition({...copy, signature: {...copy.signature, returnType: 'int'}}), null);
  const initialize = descriptor('System.Runtime.CompilerServices.RuntimeHelpers', 'InitializeArray',
    ['Array', 'System.RuntimeFieldHandle']);
  assert.equal(arrayRuntimeDefinition(initialize).operation, 'initialize');
});

test('CreateSpan admits only the closed field-handle signature', () => {
  const method = {...descriptor('System.Runtime.CompilerServices.RuntimeHelpers', 'CreateSpan',
    ['System.RuntimeFieldHandle'], 'System.ReadOnlySpan`1<int>'), methodArguments: ['int']};
  assert.equal(memoryMethodDefinition(method).operation, 'fieldSpan');
  assert.equal(memoryMethodDefinition({...method, methodArguments: ['long']}), null);
  const vm = {snapshotOwner: Object.freeze({})};
  assert.throws(() => fieldRvaData(vm, Object.freeze({runtimeHandle: 'field', owner: {}, token: 0x04000001})),
    {name: 'ArgumentException'});
});

test('pinned local metadata uses the underlying array storage type throughout its lifetime', () => {
  const bytes = controlFixture([{name: 'Program', methods: [{name: 'Main', result: 'int',
    localBytes: new Uint8Array([0x07, 1, 0x45, 0x1d, 0x08]),
    body(writer, context) {
      writer.integer(3).op('newarr', context.resolve('System.Int32')).local('stloc', 0);
      writer.local('ldloc', 0).op('ldlen').op('conv.i4').op('ret');
    }
  }]}]);
  const vm = new CilVirtualMachine(bytes);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(result.exitCode, 3);
  assert.equal(vm.heap.handles.size, 0);
});
