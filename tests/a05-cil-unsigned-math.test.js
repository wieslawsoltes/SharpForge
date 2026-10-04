import test from 'node:test';
import assert from 'node:assert/strict';
import {intrinsicDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {managedFixture} from './managed-fixtures.js';

const widths = [
  {type: 'uint', cli: 'System.UInt32', opcode: 'ldc.i4', bits: 32,
    zero: 0, one: 1, signedMax: 2147483647, high: 2147483648, max: 4294967295,
    stack: value => value | 0},
  {type: 'ulong', cli: 'System.UInt64', opcode: 'ldc.i8', bits: 64,
    zero: 0n, one: 1n, signedMax: 9223372036854775807n, high: 9223372036854775808n, max: 18446744073709551615n,
    stack: value => BigInt.asIntN(64, value)}
];

function run(bytes) {
  const vm = new CilVirtualMachine(bytes);
  const result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  return {vm, result};
}

for (const width of widths) {
  const {type, opcode, stack, zero, one, signedMax, high, max} = width;
  const orderedPairs = [
    [zero, zero], [zero, max], [one, high], [signedMax, high],
    [high, max], [high, high], [max, max]
  ];
  for (const name of ['Min', 'Max']) {
    test(`direct CIL Math.${name} UInt${width.bits} uses unsigned ordering and canonical stack storage`, () => {
      for (const [lower, upper] of orderedPairs) {
        for (const [left, right] of [[lower, upper], [upper, lower]]) {
          const bytes = managedFixture({methods: [{name: 'Main', result: type, locals: [type], body(writer, context) {
            writer.op(opcode, stack(left)).op(opcode, stack(right));
            writer.op('call', context.member('System.Math', name, type, [type, type]));
            writer.op('stloc.0').op('ldloc.0').op('ret');
          }}]});
          const expected = name === 'Min' ? lower : upper;
          const {vm, result} = run(bytes);
          assert.equal(vm.returnValue, stack(expected), `${name}(${left}, ${right}) raw stack result`);
          assert.equal(result.returnValue, expected, `${name}(${left}, ${right}) host result`);
        }
      }
    });
  }

  test(`UInt${width.bits} extrema retain declared field, array, boxing and formatting behavior`, () => {
    const bytes = managedFixture({fields: [{name: 'Selected', type}], methods: [
      {name: 'Main', result: type, locals: [type + '[]', 'object'], body(writer, context) {
        writer.op(opcode, stack(max)).op(opcode, stack(zero));
        writer.op('call', context.member('System.Math', 'Max', type, [type, type]));
        writer.op('stsfld', context.fields.Selected);
        writer.op('ldc.i4.1').op('newarr', context.resolve(width.cli)).op('stloc.0');
        writer.op('ldloc.0').op('ldc.i4.0').op('ldsfld', context.fields.Selected);
        writer.op(type === 'uint' ? 'stelem.i4' : 'stelem.i8');
        writer.op('ldloc.0').op('ldc.i4.0').op(type === 'uint' ? 'ldelem.u4' : 'ldelem.i8');
        writer.op('box', context.resolve(width.cli)).op('stloc.1');
        writer.op('call', context.member('System.GC', 'Collect', 'void'));
        writer.op('ldloc.1').op('call', context.member('System.Console', 'WriteLine', 'void', ['object']));
        writer.op('ldloc.1').op('unbox.any', context.resolve(width.cli)).op('ret');
      }}
    ]});
    const {vm, result} = run(bytes);
    assert.equal(vm.returnValue, stack(max));
    assert.equal(result.returnValue, max);
    assert.equal(result.output, String(max) + '\n');
  });

  test(`UInt${width.bits} Min/Max require exact declaring owner, staticness, widths and return type`, () => {
    for (const name of ['Min', 'Max']) {
      const descriptor = {kind: 'method', owner: 'System.Math', name,
        signature: {isStatic: true, parameters: [type, type], returnType: type, genericArity: 0, callingConvention: 0}};
      assert.equal(intrinsicDefinition(descriptor)?.implementation, 'unsignedMathExtremum');
      for (const owner of ['System.MathF', 'Other.Math']) {
        assert.equal(intrinsicDefinition({...descriptor, owner}), null);
      }
      const signed = type === 'uint' ? 'int' : 'long';
      for (const replacement of [
        {returnType: signed}, {returnType: 'double'}, {isStatic: false},
        {parameters: [type]}, {parameters: [type, signed]}, {parameters: [type + '&', type]},
        {genericArity: 1}, {callingConvention: 5}
      ]) {
        assert.equal(intrinsicDefinition({...descriptor, signature: {...descriptor.signature, ...replacement}}), null);
      }
      for (const [owner, result, parameters, isStatic] of [
        ['System.Math', signed, [type, type], true],
        ['System.Math', type, [type, signed], true],
        ['System.Math', type, [type, type], false],
        ['Other.Math', type, [type, type], true]
      ]) {
        const bytes = managedFixture({methods: [{name: 'Main', result, body(writer, context) {
          if (!isStatic) writer.op('ldnull');
          writer.op(opcode, stack(one)).op(opcode, stack(zero));
          writer.op('call', context.member(owner, name, result, parameters, isStatic)).op('ret');
        }}]});
        assert.throws(() => new CilVirtualMachine(bytes), /verification failed/);
      }
    }
  });
}

test('existing signed and floating extrema retain their original intrinsic implementation', () => {
  for (const type of ['int', 'long', 'float', 'double']) {
    for (const name of ['Min', 'Max']) {
      assert.equal(intrinsicDefinition({kind: 'method', owner: 'System.Math', name,
        signature: {isStatic: true, parameters: [type, type], returnType: type}})?.implementation, 'math');
    }
  }
});
