import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {codedIndex, Writer} from '@sharpforge/cil';
import {controlFixture, genericInstance} from './support/control-fixture.js';
import {
  instantiatedMethod, captureGenericInstantiations, restoreGenericInstantiations, validateGenericInstantiations
} from '../packages/runtime/src/execution/generics.js';

function identityFixture() {
  return controlFixture([{name: 'Program', methods: [
    {
      name: 'Main', result: 'int', maxStack: 1,
      body(writer, context) {
        writer.op('ldc.i4', 42).op('call', context.methodSpec(context.methods.get('Program.Identity'), [[8]])).op('ret');
      }
    },
    {
      name: 'Identity', parameters: ['object'], result: 'object', genericParameters: [{}],
      signature: Uint8Array.from([0x10, 1, 1, 0x1e, 0, 0x1e, 0]),
      body: writer => writer.op('ldarg.0').op('ret')
    }
  ]}]);
}

test('T02.3 cache keys use canonical type handles and code bodies are shared', () => {
  const vm = new CilVirtualMachine(identityFixture());
  const int = instantiatedMethod(vm, 0x06000002, null, ['int']);
  const equivalent = instantiatedMethod(vm, 0x06000002, null, ['System.Int32']);
  const text = instantiatedMethod(vm, 0x06000002, null, ['string']);
  const object = instantiatedMethod(vm, 0x06000002, null, ['object']);
  assert.equal(int, equivalent);
  assert.notEqual(text, object);
  assert.equal(text.instructions, object.instructions);
  assert.equal(text.instructions, int.instructions);
  assert.equal(int.instructions, vm.inspector.getMethod(0x06000002).instructions);
  assert.equal(int.signature.returnType, 'int');
  assert.equal(text.signature.returnType, 'string');
  const another = new CilVirtualMachine(identityFixture());
  assert.notEqual(vm.genericInstantiations, another.genericInstantiations);
});

test('T02.3 capture contains only portable tuple data and restore preserves canonical bodies', () => {
  const vm = new CilVirtualMachine(identityFixture());
  instantiatedMethod(vm, 0x06000002, null, ['string']);
  const captured = captureGenericInstantiations(vm);
  const portable = JSON.parse(JSON.stringify(captured));
  const original = vm.genericInstantiations;
  validateGenericInstantiations(vm, portable);
  assert.equal(vm.genericInstantiations, original);
  restoreGenericInstantiations(vm, portable);
  assert.notEqual(vm.genericInstantiations, original);
  assert.deepEqual(captureGenericInstantiations(vm), captured);
  assert.equal(instantiatedMethod(vm, 0x06000002, null, ['string']).instructions,
    vm.inspector.getMethod(0x06000002).instructions);
});

for (const malformed of [
  null, [[0x06000002, null]], [[0x06000002, null, []]], [[0x06000002, null, ['!!0']]],
  [[0x06000002, null, [8]]], [[0x0600ffff, null, ['int']]],
  [[0x06000002, 'System.String', ['int']]],
  [[0x06000002, null, ['int']], [0x06000002, null, ['System.Int32']]]
]) {
  test(`T02.3 malformed cache is rejected atomically: ${JSON.stringify(malformed)}`, () => {
    const vm = new CilVirtualMachine(identityFixture());
    const before = vm.genericInstantiations;
    assert.throws(() => restoreGenericInstantiations(vm, malformed));
    assert.equal(vm.genericInstantiations, before);
  });
}

test('T02.3 the instantiation limit is enforced before adding a cache entry', () => {
  const vm = new CilVirtualMachine(identityFixture(), {maxGenericInstantiations: 2});
  instantiatedMethod(vm, 0x06000002, null, ['int']);
  const before = captureGenericInstantiations(vm);
  assert.throws(() => instantiatedMethod(vm, 0x06000002, null, ['string']), /cache limit/);
  assert.deepEqual(captureGenericInstantiations(vm), before);
});

test('T02.3 closed user generic fields and nested owner contexts stay independent', () => {
  const bytes = controlFixture([
    {
      name: 'Cell`1', genericParameters: [{}],
      fields: [{name: 'Value', flags: 6, signature: Uint8Array.from([6, 0x13, 0])}],
      methods: [
        {
          name: '.ctor', static: false, flags: 0x1886, parameters: ['object'],
          signature: Uint8Array.from([0x20, 1, 1, 0x13, 0]),
          body(writer, context) {
            writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false));
            writer.op('ldarg.0').op('ldarg.1').op('stfld', context.fields.get('Cell`1.Value')).op('ret');
          }
        },
        {
          name: 'Read', static: false, result: 'object', signature: Uint8Array.from([0x20, 0, 0x13, 0]),
          body: (writer, context) => writer.op('ldarg.0').op('ldfld', context.fields.get('Cell`1.Value')).op('ret')
        }
      ]
    },
    {
      name: 'Program', methods: [{
        name: 'Main', result: 'int',
        body(writer, context) {
          const cell = context.types.get('Cell`1');
          const inner = genericInstance(cell, [[8]]);
          const outer = context.typeSpec(genericInstance(cell, [[...inner]]));
          const intCell = context.typeSpec(inner);
          writer.op('ldc.i4', 42).op('newobj', context.member(intCell, '.ctor', 'void', ['int'], false));
          writer.op('newobj', context.member(outer, '.ctor', 'void', ['Cell`1<int>'], false));
          writer.op('callvirt', context.member(outer, 'Read', 'Cell`1<int>', [], false));
          writer.op('callvirt', context.member(intCell, 'Read', 'int', [], false)).op('ret');
        }
      }]
    }
  ]);
  const vm = new CilVirtualMachine(bytes);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 42);
  const owners = captureGenericInstantiations(vm).map(tuple => tuple[1]);
  assert(owners.includes('Cell`1<System.Int32>'));
  assert(owners.includes('Cell`1<Cell`1<System.Int32>>'));
});

test('T02.3 default(T) and typeof(T) use the current method instantiation', () => {
  const bytes = controlFixture([{name: 'Program', methods: [
    {
      name: 'Main', result: 'int',
      body(writer, context) {
        writer.op('call', context.methodSpec(context.methods.get('Program.Default'), [[8]]));
        writer.op('call', context.methodSpec(context.methods.get('Program.Default'), [[14]])).op('ldnull').op('ceq');
        writer.op('add').op('call', context.methodSpec(context.methods.get('Program.Type'), [[14]]));
        writer.op('ldtoken', context.resolve('System.String'));
        writer.op('call', context.member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle']));
        writer.op('ceq').op('add').op('ret');
      }
    },
    {
      name: 'Default', genericParameters: [{}], signature: Uint8Array.from([0x10, 1, 0, 0x1e, 0]),
      localBytes: Uint8Array.from([7, 1, 0x1e, 0]), body: writer => writer.op('ldloc.0').op('ret')
    },
    {
      name: 'Type', genericParameters: [{}],
      signature: context => new Writer().u8(0x10).u8(1).u8(0).u8(0x12)
        .compressed(codedIndex('TypeDefOrRef', context.resolve('System.Type'))).finish(),
      body(writer, context) {
        writer.op('ldtoken', context.typeSpec(Uint8Array.from([0x1e, 0])));
        writer.op('call', context.member('System.Type', 'GetTypeFromHandle', 'System.Type', ['System.RuntimeTypeHandle'])).op('ret');
      }
    }
  ]}]);
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'terminated', result.fault?.message);
  assert.equal(result.returnValue, 2);
});
