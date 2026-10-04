import test from 'node:test';
import assert from 'node:assert/strict';
import {compileToIL} from '@sharpforge/compiler';
import {AssemblyInspector, verifyCilAssembly} from '@sharpforge/cil';
import {CilVirtualMachine, VirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';
import {valueLayout, sizeOfType} from '../packages/runtime/src/execution/value-layout.js';
import {invalidateExecutionCode} from '../packages/runtime/src/execution/code-version.js';

const cell = {name: 'Cell`1', base: 'System.ValueType', flags: 0x100109, genericParameters: [{}],
  fields: [{name: 'Tag', type: 'byte'}, {name: 'Value', type: '!0'}], methods: []};
const plain = {name: 'Plain', base: 'System.ValueType', flags: 0x100109,
  fields: [{name: 'Tag', type: 'byte'}, {name: 'Value', type: 'int'}], methods: []};
const operand = (context, name) => name.includes('<') || /[!\[&*]/.test(name)
  ? context.typeSpec(name) : context.resolve(name);

function fixture(name, types = [cell, plain], options = {}) {
  return genericCallFixture([...types, {name: 'Program', methods: [{name: 'Main', result: 'int',
    body(writer, context) { writer.op('sizeof', operand(context, name)).op('ret'); }
  }]}], options);
}

function run(bytes, nativeIntBits = 32) {
  const report = verifyCilAssembly(bytes);
  assert.equal(report.success, true, JSON.stringify(report.issues));
  const vm = new CilVirtualMachine(bytes, {nativeIntBits});
  try {
    const result = vm.run();
    assert.equal(result.state, 'terminated', result.fault?.message);
    return result.returnValue;
  } finally { vm.stop(); }
}

for (const nativeIntBits of [32, 64]) {
  test(`sizeof supported TypeDef/TypeSpec and reference slots use ABI${nativeIntBits}`, () => {
    for (const [name, expected] of [
      ['Plain', 8], ['valuetype Cell`1<int>', 8], ['valuetype Cell`1<long>', 16],
      ['valuetype Cell`1<string>', nativeIntBits / 4], ['valuetype Cell`1<valuetype Cell`1<int>>', 12],
      ['System.Nullable`1<byte>', 2], ['System.Nullable`1<int>', 8], ['System.Nullable`1<long>', 16],
      ['System.Decimal', 16], ['Program', nativeIntBits / 8], ['System.String', nativeIntBits / 8],
      ['int[]', nativeIntBits / 8], ['int[,]', nativeIntBits / 8], ['System.IntPtr', nativeIntBits / 8]
    ]) assert.equal(run(fixture(name), nativeIntBits), expected, name);
  });

  test(`sizeof resolves owner !0 and method !!0 at actual call sites on ABI${nativeIntBits}`, () => {
    const owner = {name: 'Owner`1', genericParameters: [{}], methods: [{name: 'ElementSize', result: 'int',
      body: (writer, context) => writer.op('sizeof', context.typeSpec('!0')).op('ret')}]};
    const bytes = genericCallFixture([cell, owner, {name: 'Program', methods: [
      {name: 'Main', body(writer, context) {
        const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
        for (const argument of ['int', 'string', 'long', 'int']) {
          writer.op('call', context.methodSpec(context.methods.get('Program.Size'), [argument])).op('call', print);
        }
        for (const argument of ['long', 'string']) {
          writer.op('call', context.member(context.typeSpec('Owner`1<' + argument + '>'), 'ElementSize', 'int'))
            .op('call', print);
        }
        writer.op('call', context.methodSpec(context.methods.get('Program.WrapperSize'), ['int'])).op('call', print);
        writer.op('ret');
      }},
      {name: 'Size', genericParameters: [{}], result: 'int',
        body: (writer, context) => writer.op('sizeof', context.typeSpec('!!0')).op('ret')},
      {name: 'WrapperSize', genericParameters: [{}], result: 'int',
        body: (writer, context) => writer.op('sizeof', context.typeSpec('valuetype Cell`1<!!0>')).op('ret')}
    ]}]);
    const vm = new CilVirtualMachine(bytes, {nativeIntBits});
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, `4\n${nativeIntBits / 8}\n8\n4\n8\n${nativeIntBits / 8}\n8\n`);
    } finally { vm.stop(); }
  });
}

test('packing, empty/enum values, nested alignment, explicit overlap and declared tail sizes', () => {
  const types = [plain,
    {name: 'Empty', base: 'System.ValueType', flags: 0x100109, methods: []},
    {name: 'Small', base: 'System.Enum', fields: [{name: 'value__', type: 'short'}], methods: []},
    {name: 'Nested', base: 'System.ValueType', flags: 0x100109,
      fields: [{name: 'Prefix', type: 'byte'}, {name: 'Inner', type: 'valuetype Plain'}], methods: []},
    {name: 'Union', base: 'System.ValueType', flags: 0x100111,
      fields: [{name: 'Bits', type: 'int'}, {name: 'Real', type: 'float'}, {name: 'Byte', type: 'byte'}], methods: []}
  ];
  const decorate = ({md, types, fields}) => {
    md.add(15, [1, 0, types.get('Plain') & 0xffffff]);
    md.add(15, [1, 7, types.get('Union') & 0xffffff]);
    for (const [name, offset] of [['Bits', 0], ['Real', 0], ['Byte', 1]]) {
      md.add(16, [offset, fields.get('Union.' + name) & 0xffffff]);
    }
  };
  for (const [name, expected] of [['Empty', 1], ['Small', 2], ['Plain', 5], ['Nested', 6], ['Union', 7]]) {
    assert.equal(run(fixture(name, types, {decorate})), expected);
  }
});

test('layout caches are immutable, per VM/ABI, snapshot-neutral and invalidated with execution code', () => {
  const bytes = fixture('Plain');
  const vm = new CilVirtualMachine(bytes), other = new CilVirtualMachine(bytes, {nativeIntBits: 64});
  try {
    const first = valueLayout(vm, 'Plain');
    assert.deepEqual(first, {size: 8, alignment: 4, containsReferences: false, offsets: [0, 4]});
    assert(Object.isFrozen(first));
    assert(Object.isFrozen(first.offsets));
    assert.equal(valueLayout(vm, 'Plain'), first);
    assert.notEqual(valueLayout(other, 'Plain'), first);
    assert.equal(sizeOfType(vm, 'nint'), 4);
    assert.equal(sizeOfType(other, 'nint'), 8);
    const snapshot = vm.snapshot();
    assert.equal(Object.hasOwn(snapshot, 'valueLayouts'), false);
    assert.equal(vm.run().returnValue, 8);
    vm.restore(snapshot);
    const restored = valueLayout(vm, 'Plain');
    assert.notEqual(restored, first);
    assert.deepEqual(restored, first);
    invalidateExecutionCode(vm, 'committed-layout-edit');
    assert.notEqual(valueLayout(vm, 'Plain'), restored);
    vm.inspector = new AssemblyInspector(fixture('Plain', [{...plain,
      fields: [{name: 'Tag', type: 'byte'}, {name: 'Value', type: 'long'}]}]));
    assert.equal(sizeOfType(vm, 'Plain'), 16);
    assert.equal(sizeOfType(other, 'Plain'), 8);
  } finally { vm.stop(); other.stop(); }
});

for (const name of ['!0', '!!0', 'Cell`1', 'Cell`1<int,long>', 'System.Nullable`1<string>',
  'System.Nullable`1<System.Nullable`1<int>>', 'int&', 'int*', 'System.Void', 'System.TypedReference', 'External.Unknown']) {
  test(`sizeof rejects unsupported operand ${name} before dispatch`, () => {
    const report = verifyCilAssembly(fixture(name));
    assert.equal(report.success, false);
    assert(report.issues.some(issue => issue.code === 'IL_TYPE' && issue.message.includes('sizeof')));
  });
}

test('sizeof requires a type token and rejects out-of-scope generic indices', () => {
  const bytes = genericCallFixture([{name: 'Program', methods: [{name: 'Main', result: 'int', body(writer, context) {
    writer.op('sizeof', context.methods.get('Program.Main')).op('ret');
  }}]}]);
  assert(verifyCilAssembly(bytes).issues.some(issue => issue.code === 'IL_TOKEN'));
  const outOfScope = genericCallFixture([{name: 'Program', methods: [
    {name: 'Main', result: 'int', body: (writer, context) => writer
      .op('call', context.methodSpec(context.methods.get('Program.Bad'), ['int'])).op('ret')},
    {name: 'Bad', result: 'int', genericParameters: [{}],
      body: (writer, context) => writer.op('sizeof', context.typeSpec('!!1')).op('ret')}
  ]}]);
  assert(verifyCilAssembly(outOfScope).issues.some(issue => issue.code === 'IL_TYPE' && /sizeof/.test(issue.message)));
});

test('missing explicit offsets, recursive values and oversized layout fail with managed layout faults', () => {
  for (const [type, decorate] of [
    [{...plain, flags: 0x100111}, undefined],
    [{...plain, fields: [{name: 'Self', type: 'valuetype Plain'}]}, undefined],
    [plain, ({md, types}) => md.add(15, [0, 0xffffffff, types.get('Plain') & 0xffffff])]
  ]) {
    const vm = new CilVirtualMachine(fixture('Plain', [type], {decorate}));
    try {
      const result = vm.run();
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'TypeLoadException');
    } finally { vm.stop(); }
  }
});

test('reference slots have pointer width while auto-layout value storage stays explicit', () => {
  const referenceUnion = {...plain, flags: 0x100111, fields: [{name: 'Value', type: 'object'}]};
  const bytes = fixture('Plain', [referenceUnion], {decorate: ({md, fields}) =>
    md.add(16, [0, fields.get('Plain.Value') & 0xffffff])});
  const vm = new CilVirtualMachine(bytes);
  try {
    assert.equal(vm.run().returnValue, 4);
    assert.equal(sizeOfType(vm, 'External.Unknown'), 4);
  } finally { vm.stop(); }
  const auto = new CilVirtualMachine(fixture('Plain', [{...plain, flags: 0x100101}]));
  try { assert.equal(auto.run().fault.name, 'NotSupportedException'); }
  finally { auto.stop(); }
});

test('large metadata values stop at the cold layout field-work budget', () => {
  const fields = Array.from({length: 65_537}, (_, index) => ({name: 'F' + index, type: 'byte'}));
  const vm = new CilVirtualMachine(fixture('Plain', [{...plain, fields}]));
  try {
    const result = vm.run();
    assert.equal(result.state, 'faulted');
    assert.equal(result.fault.name, 'NotSupportedException');
    assert.match(result.fault.message, /field budget/);
  } finally { vm.stop(); }
});

test('existing primitive source sizeof remains consistent across source, reload and direct CIL', () => {
  const compiled = compileToIL('Console.WriteLine(sizeof(byte)); Console.WriteLine(sizeof(long)); Console.WriteLine(sizeof(decimal));');
  assert.equal(compiled.success, true, JSON.stringify(compiled.diagnostics));
  for (const vm of [new VirtualMachine(compiled.image), new VirtualMachine(compiled.assembly), new CilVirtualMachine(compiled.assembly)]) {
    try {
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, '1\n8\n16\n');
    } finally { vm.stop(); }
  }
});
