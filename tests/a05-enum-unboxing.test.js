import test from 'node:test';
import assert from 'node:assert/strict';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {genericCallFixture} from './support/generic-call-fixture.js';

const scalarTypes = {
  sbyte: 'System.SByte', byte: 'System.Byte', short: 'System.Int16', ushort: 'System.UInt16',
  int: 'System.Int32', uint: 'System.UInt32', long: 'System.Int64', ulong: 'System.UInt64'
};
const limits = {sbyte: -128, byte: 255, short: -32768, ushort: 65535,
  int: -2147483648, uint: 4294967295, long: -9223372036854775808n, ulong: 18446744073709551615n};
const oppositeSign = {sbyte: 'byte', byte: 'sbyte', short: 'ushort', ushort: 'short',
  int: 'uint', uint: 'int', long: 'ulong', ulong: 'long'};

function enumType(name, underlying) {
  return {name, base: 'System.Enum', flags: 0x101, methods: [],
    fields: [{name: 'value__', flags: 0x606, type: underlying}]};
}

function fixture(body, {underlying = 'int', result = 'int', locals = [], otherUnderlying = underlying} = {}) {
  return genericCallFixture([
    enumType('Choice', underlying), enumType('Other', otherUnderlying),
    {name: 'Program', methods: [{name: 'Main', result, locals, body}]}
  ]);
}

function constant(writer, value) {
  if (typeof value === 'bigint') writer.op('ldc.i8', BigInt.asIntN(64, value));
  else writer.op('ldc.i4', value | 0);
  return writer;
}

function run(bytes, assertion, options) {
  const vm = new CilVirtualMachine(bytes, options);
  try { assertion(vm.run(), vm); }
  finally { vm.stop(); }
}

for (const [underlying, value] of Object.entries(limits)) {
  test(`CIL enum unboxing preserves ${underlying} boundary bits in both directions and between enums`, () => {
    for (const opcode of ['unbox', 'unbox.any']) {
      for (const [boxed, requested] of [['Choice', scalarTypes[underlying]], [scalarTypes[underlying], 'Choice'], ['Choice', 'Other']]) {
        const bytes = fixture((writer, context) => {
          constant(writer, value).op('box', context.resolve(boxed)).op(opcode, context.resolve(requested));
          if (opcode === 'unbox') writer.op('ldobj', context.resolve(requested));
          constant(writer, value).op('ceq').op('ret');
        }, {underlying});
        run(bytes, result => {
          assert.equal(result.state, 'terminated', `${boxed} → ${requested}: ${result.fault?.message}`);
          assert.equal(result.returnValue, 1);
        });
      }
      const incompatible = fixture((writer, context) => {
        constant(writer, value).op('box', context.resolve('Choice'));
        writer.op(opcode, context.resolve(scalarTypes[oppositeSign[underlying]])).op('pop').op('ret');
      }, {underlying, result: 'void'});
      run(incompatible, result => assert.equal(result.fault?.name, 'InvalidCastException'));
    }
  });
}

test('compatible unboxing mutates the existing box without changing casts, GetType or enum text', () => {
  const bytes = fixture((writer, context) => {
    const integer = context.resolve('System.Int32'), choice = context.resolve('Choice');
    const print = context.member('System.Console', 'WriteLine', 'void', ['int']);
    const boolean = context.member('System.Console', 'WriteLine', 'void', ['bool']);
    const text = context.member('System.Console', 'WriteLine', 'void', ['string']);
    writer.op('ldc.i4.7').op('box', choice).op('stloc.0');
    writer.op('ldloc.0').op('unbox', integer).op('ldc.i4.s', 29).op('stind.i4');
    writer.op('ldloc.0').op('unbox.any', context.resolve('Other')).op('call', print);
    writer.op('ldloc.0').op('callvirt', context.member('System.Object', 'GetType', 'System.Type', [], false));
    writer.op('callvirt', context.member('System.Type', 'get_Name', 'string', [], false)).op('call', text);
    writer.op('ldloc.0').op('callvirt', context.member('System.Object', 'ToString', 'string', [], false)).op('call', text);
    for (const type of ['Choice', 'System.Enum', 'System.Int32', 'Other']) {
      writer.op('ldloc.0').op('isinst', context.resolve(type)).op('ldnull').op('cgt.un').op('call', boolean);
    }
    writer.op('ldc.i4.5').op('box', integer).op('stloc.0');
    writer.op('ldloc.0').op('unbox', choice).op('ldc.i4.s', 31).op('stind.i4');
    writer.op('ldloc.0').op('unbox.any', integer).op('call', print);
    writer.op('ldloc.0').op('isinst', choice).op('ldnull').op('cgt.un').op('call', boolean).op('ret');
  }, {result: 'void', locals: ['object']});
  for (const nativeIntBits of [32, 64]) run(bytes, result => {
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.output, '29\nChoice\n29\nTrue\nTrue\nFalse\nFalse\n31\nFalse\n');
  }, {nativeIntBits});
});

test('unboxing rejects different widths, signedness and primitive kinds in either direction', () => {
  const incompatible = ['System.UInt32', 'System.Int64', 'System.IntPtr', 'System.Single', 'System.Boolean', 'System.Char'];
  for (const opcode of ['unbox', 'unbox.any']) {
    for (const requested of incompatible) {
      run(fixture((writer, context) => writer.op('ldc.i4.1').op('box', context.resolve('Choice'))
        .op(opcode, context.resolve(requested)).op('pop').op('ret'), {result: 'void'}), result => {
        assert.equal(result.state, 'faulted', `${opcode} ${requested}`);
        assert.equal(result.fault.name, 'InvalidCastException');
      });
    }
    for (const boxed of ['System.UInt32', 'Other']) {
      run(fixture((writer, context) => writer.op('ldc.i4.1').op('box', context.resolve(boxed))
        .op(opcode, context.resolve('Choice')).op('pop').op('ret'), {result: 'void', otherUnderlying: 'uint'}), result => {
        assert.equal(result.state, 'faulted');
        assert.equal(result.fault.name, 'InvalidCastException');
      });
    }
    run(fixture((writer, context) => writer.op('ldnull').op(opcode, context.resolve('Choice')).op('pop').op('ret'),
      {result: 'void'}), result => assert.equal(result.fault.name, 'NullReferenceException'));
  }
  run(fixture((writer, context) => writer.op('ldc.i4.1').op('box', context.resolve('Choice'))
    .op('unbox.any', context.resolve('System.Char')).op('pop').op('ret'), {underlying: 'ushort', result: 'void'}),
  result => assert.equal(result.fault?.name, 'InvalidCastException'));
});

test('a compatible enum interior stays rooted across GC and ordinary snapshot restore', () => {
  const bytes = fixture((writer, context) => {
    const integer = context.resolve('System.Int32');
    writer.op('ldc.i4.7').op('box', context.resolve('Choice')).op('unbox', integer).op('stloc.0');
    writer.op('call', context.member('System.GC', 'Collect', 'void'));
    writer.op('ldloc.0').op('dup').op('ldind.i4').op('ldc.i4.1').op('add').op('stind.i4');
    writer.op('ldloc.0').op('ldind.i4').op('ret');
  }, {locals: ['int&']});
  const vm = new CilVirtualMachine(bytes);
  try {
    for (let index = 0; index < 4; index++) vm.step();
    const address = vm.top.locals[0], snapshot = vm.snapshot();
    assert.equal(vm.run().returnValue, 8);
    assert(vm.heap.stats.collections > 0);
    vm.restore(snapshot);
    vm.heap.collect();
    assert.equal(vm.dereference(address), 7);
    assert.equal(vm.heap.get(address.owner).methodTable.name, 'Choice');
    assert.equal(vm.run().returnValue, 8);
    vm.stop();
    vm.heap.collect();
    assert.throws(() => vm.dereference(address), {name: 'InvalidReferenceException'});
  } finally { vm.stop(); }
});

test('Nullable enum unboxing accepts its exact enum box and null', () => {
  run(fixture((writer, context) => {
    const type = context.typeSpec('valuetype System.Nullable`1<valuetype Choice>');
    writer.op('ldc.i4.7').op('box', context.resolve('Choice')).op('unbox.any', type);
    writer.op('box', type).op('unbox.any', context.resolve('Choice'));
    writer.op('ldnull').op('unbox.any', type).op('box', type).op('ldnull').op('ceq').op('add').op('ret');
  }), result => {
    assert.equal(result.state, 'terminated', result.fault?.message);
    assert.equal(result.returnValue, 8);
  });
});

for (const [boxed, element] of [['System.Int32', 'valuetype Choice'], ['Other', 'valuetype Choice'], ['Choice', 'int']]) {
  test(`Nullable<${element}> rejects compatible but inexact ${boxed} boxes`, () => {
    run(fixture((writer, context) => writer.op('ldc.i4.7').op('box', context.resolve(boxed))
      .op('unbox.any', context.typeSpec(`valuetype System.Nullable\`1<${element}>`)).op('pop').op('ret'),
    {result: 'void'}), result => {
      assert.equal(result.state, 'faulted');
      assert.equal(result.fault.name, 'InvalidCastException');
    });
  });
}
