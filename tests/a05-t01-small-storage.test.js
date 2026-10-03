import test from 'node:test';
import assert from 'node:assert/strict';
import {smallInteger, smallIntegerIndirect} from '@sharpforge/bytecode';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {storage, indirect} from '../packages/runtime/src/execution/numeric-ops.js';
import {managedFixture} from './managed-fixtures.js';

const types = [
  {name: 'sbyte', metadata: 'System.SByte', suffix: 'i1', rows: [[-129, 127], [128, -128], [255, -1]]},
  {name: 'byte', metadata: 'System.Byte', suffix: 'u1', rows: [[-1, 255], [256, 0], [300, 44]]},
  {name: 'short', metadata: 'System.Int16', suffix: 'i2', rows: [[-32769, 32767], [32768, -32768], [65535, -1]]},
  {name: 'ushort', metadata: 'System.UInt16', suffix: 'u2', rows: [[-1, 65535], [65536, 0], [0x12345, 0x2345]]},
  {name: 'char', metadata: 'System.Char', suffix: 'u2', rows: [[-1, 65535], [65536, 0], [0x12345, 0x2345]]},
  {name: 'bool', metadata: 'System.Boolean', suffix: 'u1', rows: [[-1, 255], [256, 0], [258, 2]]}
];
const locations = ['local', 'arg', 'field', 'static', 'array', 'byref'];

function fixture(type, location, input) {
  return managedFixture({
    fields: [{name: 'Value', type: type.name, static: location === 'static'}],
    methods: [{name: 'Main', result: 'int', parameters: location === 'arg' ? [type.name] : [],
      locals: [type.name, 'Fixture.Program', type.name + '[]'], body(writer, context) {
        const field = context.fields.Value;
        switch (location) {
          case 'local': writer.op('ldc.i4', input).op('stloc.0').op('ldloc.0'); break;
          case 'arg': writer.op('ldc.i4', input).op('starg.s', 0).op('ldarg.0'); break;
          case 'field':
            writer.op('newobj', context.methods['.ctor']).op('stloc.1');
            writer.op('ldloc.1').op('ldc.i4', input).op('stfld', field).op('ldloc.1').op('ldfld', field);
            break;
          case 'static': writer.op('ldc.i4', input).op('stsfld', field).op('ldsfld', field); break;
          case 'array':
            writer.op('ldc.i4.1').op('newarr', context.resolve(type.metadata)).op('stloc.2');
            writer.op('ldloc.2').op('ldc.i4.0').op('ldc.i4', input).op('stelem.' + type.suffix.replace('u', 'i'));
            writer.op('ldloc.2').op('ldc.i4.0').op('ldelem.' + type.suffix);
            break;
          case 'byref':
            writer.op('ldloca.s', 0).op('ldc.i4', input).op('stind.' + type.suffix.replace('u', 'i'));
            writer.op('ldloca.s', 0).op('ldind.' + type.suffix);
            break;
        }
        writer.op('ret');
      }},
      {name: '.ctor', static: false, flags: 0x1886, body(writer, context) {
        writer.op('ldarg.0').op('call', context.member('System.Object', '.ctor', 'void', [], false)).op('ret');
      }}]
  });
}

for (const type of types) for (const [input, expected] of type.rows) {
  test(`T01 small storage ${type.name} ${input} across six location kinds`, () => {
    for (const value of [input, BigInt(input)]) {
      assert.equal(smallInteger(value, type.name), expected);
      assert.equal(smallInteger(value, type.metadata), expected);
      assert.equal(storage(value, type.metadata), expected);
      assert.equal(indirect(value, 'ldind.' + type.suffix), expected);
    }
    for (const location of locations) {
      const vm = new CilVirtualMachine(fixture(type, location, input), {
        arguments: location === 'arg' ? [type.name === 'bool' ? false : 0] : []
      });
      try {
        const result = vm.run();
        assert.equal(result.state, 'terminated', location + ': ' + result.fault?.message);
        assert.equal(result.returnValue, expected, location);
      } finally { vm.stop(); }
    }
  });
}

test('T01 indirect stores normalize physical slots and retain signed load interpretation across restore', () => {
  const vm = new CilVirtualMachine(fixture(types[1], 'byref', -1));
  try {
    for (let count = 0; count < 12 && vm.top.method.instructions[vm.top.pc]?.name !== 'stind.i1'; count++) vm.step();
    assert.equal(vm.top.method.instructions[vm.top.pc]?.name, 'stind.i1');
    vm.step();
    assert.equal(vm.top.locals[0], 255, 'The byte slot must retain its declared zero-extended value');
    assert.equal(smallIntegerIndirect(vm.top.locals[0], 'i1'), -1);
    const snapshot = vm.snapshot(), pointer = vm.address('local', 0);
    vm.dereference(pointer, true, 300);
    assert.equal(vm.top.locals[0], 44);
    vm.restore(snapshot);
    assert.equal(vm.run().returnValue, 255);
    vm.stop();
    assert.throws(() => vm.dereference(pointer, true, 1), {name: 'InvalidProgramException'});
  } finally { vm.stop(); }
});

test('T01 arguments are normalized before the callee starts executing', () => {
  const bytes = managedFixture({methods: [
    {name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.i4', 300).op('call', context.methods.Read).op('ret');
    }},
    {name: 'Read', result: 'int', parameters: ['byte'], body: writer => writer.op('ldarg.0').op('ret')}
  ]});
  const vm = new CilVirtualMachine(bytes);
  try {
    for (let count = 0; count < 12 && vm.top.method.name !== 'Read'; count++) vm.step();
    assert.equal(vm.top.method.name, 'Read');
    assert.equal(vm.top.args[0], 44);
    assert.equal(vm.run().returnValue, 44);
  } finally { vm.stop(); }
});

test('T01 UInt32 stack patterns marshal, store, box, format and return without losing unsigned meaning', () => {
  const bytes = managedFixture({methods: [{name: 'Main', result: 'uint', parameters: ['uint'], locals: ['uint'],
    body(writer, context) {
      writer.op('ldarg.0').op('stloc.0').op('ldloc.0');
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['uint']));
      writer.op('ldloc.0').op('box', context.resolve('System.UInt32'));
      writer.op('call', context.member('System.Console', 'WriteLine', 'void', ['object']));
      writer.op('ldloc.0').op('ret');
    }}]});
  for (const input of [0, 2147483648, 4294967295]) {
    const vm = new CilVirtualMachine(bytes, {arguments: [input]});
    try {
      assert.equal(vm.top.args[0], input | 0);
      const result = vm.run();
      assert.equal(result.state, 'terminated', result.fault?.message);
      assert.equal(result.output, `${input}\n${input}\n`);
      assert.equal(result.returnValue, input);
    } finally { vm.stop(); }
  }
  for (const input of [-1, 4294967296, 1.5]) assert.throws(() => new CilVirtualMachine(bytes, {arguments: [input]}));
});

test('T01 small storage rejects malformed helper inputs without host coercion', () => {
  for (const value of [null, undefined, '1', {}, 1.5, NaN, Infinity]) {
    assert.throws(() => smallInteger(value, 'byte'), {name: 'InvalidProgramException'});
  }
  for (const type of ['double', 'constructor', '__proto__']) {
    assert.throws(() => smallInteger(1, type), {name: 'InvalidProgramException'});
  }
  assert.throws(() => smallIntegerIndirect(1, 'r4'), {name: 'InvalidProgramException'});
  assert.equal(storage(true, 'System.Boolean'), 1);
  assert.equal(storage(false, 'bool'), 0);
});
