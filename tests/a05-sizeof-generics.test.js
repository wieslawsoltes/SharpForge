import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {compileToIL} from '@sharpforge/compiler';
import {codedIndex, Writer, verifyCilAssembly, loadAssembly} from '@sharpforge/cil';
import {controlFixture} from './support/control-fixture.js';
import {sizeOfType, valueLayout} from '../packages/runtime/src/execution/value-layout.js';

function instance(context, name, arguments_, valueType = true) {
  return new Writer().u8(0x15).u8(valueType ? 0x11 : 0x12)
    .compressed(codedIndex('TypeDefOrRef', context.resolve(name))).compressed(arguments_.length)
    .bytes(arguments_.flat()).finish();
}

const cell = {
  name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
  fields: [{name: 'Tag', type: 'byte', flags: 6}, {name: 'Value', flags: 6, signature: Uint8Array.from([6, 0x13, 0])}],
  methods: [{
    name: 'ElementSize', result: 'int',
    body: (writer, context) => writer.op('sizeof', context.typeSpec(Uint8Array.from([0x13, 0]))).op('ret')
  }]
};

function operandFixture(operand, extraTypes = [], options = {}) {
  return controlFixture([...extraTypes, {name: 'Program', methods: [{
    name: 'Main', result: 'int', body: (writer, context) => writer.op('sizeof', operand(context)).op('ret')
  }]}], options);
}

function execute(bytes, options = {}) {
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes, options);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return {vm, result};
}

for (const nativeIntBits of [32, 64]) {
  test(`sizeof TypeSpec layouts and reference storage use ABI${nativeIntBits}`, () => {
    const cases = [
      [context => context.typeSpec(instance(context, 'Cell`1', [[8]])), 8],
      [context => context.typeSpec(instance(context, 'Cell`1', [[10]])), 16],
      [context => context.typeSpec(instance(context, 'Cell`1', [[14]])), nativeIntBits / 4],
      [context => context.typeSpec(instance(context, 'Cell`1', [[...instance(context, 'Cell`1', [[8]])]])), 12],
      [context => context.typeSpec(instance(context, 'System.Nullable`1', [[5]])), 2],
      [context => context.typeSpec(instance(context, 'System.Nullable`1', [[8]])), 8],
      [context => context.typeSpec(instance(context, 'System.Nullable`1', [[10]])), 16],
      [context => context.resolve('Program'), nativeIntBits / 8],
      [context => context.resolve('IValue'), nativeIntBits / 8],
      [context => context.typeSpec(instance(context, 'Reference`1', [[8]], false)), nativeIntBits / 8],
      [context => context.resolve('System.String'), nativeIntBits / 8],
      [context => context.typeSpec(Uint8Array.from([0x1d, 8])), nativeIntBits / 8],
      [context => context.resolve('System.IntPtr'), nativeIntBits / 8]
    ];
    for (const [operand, expected] of cases) {
      const types = [cell, {name: 'IValue', interface: true, flags: 0xa1, methods: []},
        {name: 'Reference`1', genericParameters: [{}], methods: []}];
      const {result} = execute(operandFixture(operand, types), {nativeIntBits});
      assert.equal(result.returnValue, expected);
    }
  });

  test(`sizeof resolves method and owner parameters independently on ABI${nativeIntBits}`, () => {
    const bytes = controlFixture([cell, {name: 'Program', methods: [
      {
        name: 'Main', body(writer, context) {
          const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
          const method = context.methods.get('Program.Size');
          for (const argument of [[8], [14], [...instance(context, 'Cell`1', [[8]])], [8]]) {
            writer.op('call', context.methodSpec(method, [argument])).op('call', print);
          }
          for (const argument of [[10], [14], [8]]) {
            const owner = context.typeSpec(instance(context, 'Cell`1', [argument]));
            writer.op('call', context.member(owner, 'ElementSize', 'int')).op('call', print);
          }
          for (const argument of [[8], [14]]) {
            writer.op('call', context.methodSpec(context.methods.get('Program.WrapperSize'), [argument])).op('call', print);
          }
          writer.op('call', context.methodSpec(context.methods.get('Program.NullableSize'), [[5]])).op('call', print);
          writer.op('ret');
        }
      },
      {
        name: 'Size', genericParameters: [{}], signature: Uint8Array.from([0x10, 1, 0, 8]),
        body: (writer, context) => writer.op('sizeof', context.typeSpec(Uint8Array.from([0x1e, 0]))).op('ret')
      },
      {
        name: 'WrapperSize', genericParameters: [{}], signature: Uint8Array.from([0x10, 1, 0, 8]),
        body: (writer, context) => writer.op('sizeof',
          context.typeSpec(instance(context, 'Cell`1', [[0x1e, 0]]))).op('ret')
      },
      {
        name: 'NullableSize', genericParameters: [{flags: 8}], signature: Uint8Array.from([0x10, 1, 0, 8]),
        body: (writer, context) => writer.op('sizeof',
          context.typeSpec(instance(context, 'System.Nullable`1', [[0x1e, 0]]))).op('ret')
      }
    ]}]);
    const {result} = execute(bytes, {nativeIntBits});
    assert.equal(result.output, `4\n${nativeIntBits / 8}\n8\n4\n8\n${nativeIntBits / 8}\n4\n8\n${nativeIntBits / 4}\n2\n`);
  });
}

test('sizeof retains TypeDef enum, empty and explicit-layout sizes', () => {
  const types = [
    {name: 'Empty', base: 'System.ValueType', methods: []},
    {name: 'Small', base: 'System.Enum', fields: [{name: 'value__', type: 'short', flags: 6}], methods: []},
    {name: 'Packed', base: 'System.ValueType', flags: 0x100111,
      fields: [{name: 'First', type: 'byte', flags: 6}, {name: 'Second', type: 'int', flags: 6}], methods: []}
  ];
  const decorate = ({md, types, fields}) => {
    md.add(15, [1, 7, types.get('Packed') & 0xffffff]);
    md.add(16, [0, fields.get('Packed.First') & 0xffffff]);
    md.add(16, [1, fields.get('Packed.Second') & 0xffffff]);
  };
  for (const [name, expected] of [['Empty', 1], ['Small', 2], ['Packed', 7]]) {
    assert.equal(execute(operandFixture(context => context.resolve(name), types, {decorate})).result.returnValue, expected);
  }
});

for (const [name, operand, code] of [
  ['undeclared type variable', context => context.typeSpec(Uint8Array.from([0x13, 0])), 'IL_TYPE'],
  ['undeclared method variable', context => context.typeSpec(Uint8Array.from([0x1e, 0])), 'IL_TYPE'],
  ['open definition', context => context.resolve('Cell`1'), 'IL_TYPE'],
  ['wrong generic arity', context => context.typeSpec(instance(context, 'Cell`1', [[8], [8]])), 'IL_TYPE'],
  ['Nullable reference', context => context.typeSpec(instance(context, 'System.Nullable`1', [[14]])), 'IL_TYPE'],
  ['managed byref', context => context.typeSpec(Uint8Array.from([0x10, 8])), 'IL_TYPE'],
  ['raw pointer profile', context => context.typeSpec(Uint8Array.from([0x0f, 8])), 'IL_TYPE'],
  ['void', context => context.resolve('System.Void'), 'IL_TYPE'],
  ['typedref layout profile', context => context.typeSpec(Uint8Array.from([0x16])), 'IL_TYPE'],
  ['unknown external layout', context => context.resolve('External.Unavailable'), 'IL_TYPE'],
  ['method token', context => context.methods.get('Program.Main'), 'IL_TOKEN']
]) {
  test(`sizeof rejects ${name} before execution`, () => {
    const report = verifyCilAssembly(operandFixture(operand, [cell]));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === code && issue.message.includes('sizeof')));
  });
}

test('sizeof generic indices must exist in the declaring method', () => {
  const bytes = controlFixture([{name: 'Program', methods: [{
    name: 'Main', genericParameters: [{}], signature: Uint8Array.from([0x10, 1, 0, 8]),
    body: (writer, context) => writer.op('sizeof', context.typeSpec(Uint8Array.from([0x1e, 1]))).op('ret')
  }]}]);
  const report = verifyCilAssembly(bytes);
  assert(report.issues.some(issue => issue.code === 'IL_TYPE' && /declaring scope/.test(issue.message)));
});

test('layout rejects unresolved contexts and malformed Nullable even when called directly', () => {
  const {vm} = execute(operandFixture(context => context.resolve('System.Int32'), [cell]));
  for (const type of ['Cell`1', 'Cell`1<!0>', '!0', '!!0', 'System.Int32&', 'System.Void']) {
    assert.throws(() => sizeOfType(vm, type), {name: 'TypeLoadException'});
  }
  assert.throws(() => valueLayout(vm, 'System.Nullable`1<string>'), {name: 'TypeLoadException'});
  assert.throws(() => sizeOfType(vm, 'External.Unavailable'), {name: 'NotSupportedException'});
});

test('invalid packing remains a managed layout fault', () => {
  const bytes = operandFixture(context => context.typeSpec(instance(context, 'Cell`1', [[8]])), [cell], {
    decorate: ({md, types}) => md.add(15, [3, 0, types.get('Cell`1') & 0xffffff])
  });
  assert.equal(verifyCilAssembly(bytes).success, true);
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'TypeLoadException');
});

test('recursive value fields cannot produce a fabricated sizeof result', () => {
  const recursive = {name: 'Recursive', base: 'System.ValueType',
    fields: [{name: 'Self', signature: Uint8Array.from([6, 0x11, 8]), flags: 6}], methods: []};
  const bytes = operandFixture(context => context.resolve('Recursive'), [recursive]);
  assert.equal(verifyCilAssembly(bytes).success, true);
  const result = new CilVirtualMachine(bytes).run();
  assert.equal(result.state, 'faulted');
  assert.equal(result.fault.name, 'TypeLoadException');
  assert.match(result.fault.message, /Recursive value layout/);
});

test('existing primitive source sizeof constants agree on source, reload and direct CIL', () => {
  const compiled = compileToIL('Console.WriteLine(sizeof(byte)); Console.WriteLine(sizeof(long)); Console.WriteLine(sizeof(decimal));');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(loadAssembly(compiled.assembly)),
    new CilVirtualMachine(compiled.assembly)]) {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.output, '1\n8\n16\n');
  }
});
