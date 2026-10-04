import test from 'node:test';
import assert from 'node:assert/strict';
import {intrinsicDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {smallMathExtremum} from '../packages/runtime/src/execution/math-extrema.js';
import {managedFixture} from './managed-fixtures.js';

const widths = [
  {type: 'sbyte', cli: 'System.SByte', low: -128, high: 127, store: 'stelem.i1', load: 'ldelem.i1',
    narrowed: [[255, 1, -1, 1], [128, 127, -128, 127], [-129, 0, 0, 127]]},
  {type: 'byte', cli: 'System.Byte', low: 0, high: 255, store: 'stelem.i1', load: 'ldelem.u1',
    narrowed: [[-1, 1, 1, 255], [256, 255, 0, 255], [128, -128, 128, 128]]},
  {type: 'short', cli: 'System.Int16', low: -32768, high: 32767, store: 'stelem.i2', load: 'ldelem.i2',
    narrowed: [[65535, 1, -1, 1], [32768, 32767, -32768, 32767], [-32769, 0, 0, 32767]]},
  {type: 'ushort', cli: 'System.UInt16', low: 0, high: 65535, store: 'stelem.i2', load: 'ldelem.u2',
    narrowed: [[-1, 1, 1, 65535], [65536, 65535, 0, 65535], [32768, -32768, 32768, 32768]]}
];

function invoke(type, name, left, right) {
  const bytes = managedFixture({methods: [{name: 'Main', result: type, body(writer, context) {
    writer.op('ldc.i4', left).op('ldc.i4', right);
    writer.op('call', context.member('System.Math', name, type, [type, type])).op('ret');
  }}]});
  const vm = new CilVirtualMachine(bytes), result = vm.run();
  assert.equal(result.state, 'terminated', result.fault?.stack);
  assert.equal(typeof vm.returnValue, 'number');
  assert.equal(vm.returnValue, result.returnValue, 'small typed host results retain the canonical I4 value');
  return vm.returnValue;
}

for (const width of widths) {
  const {type, low, high} = width;
  for (const name of ['Min', 'Max']) {
    test(`direct CIL ${type} ${name} covers limits, equality, zero and both operand orders`, () => {
      const pairs = [[low, high], [low, 0], [0, high], [low, low], [high, high], [0, 0], [1, high]];
      for (const [lower, upper] of pairs) {
        const expected = name === 'Min' ? lower : upper;
        assert.equal(invoke(type, name, lower, upper), expected);
        assert.equal(invoke(type, name, upper, lower), expected);
      }
    });

    test(`${type} ${name} normalizes both declared parameters before comparing their I4 carriers`, () => {
      for (const [left, right, minimum, maximum] of width.narrowed) {
        const expected = name === 'Min' ? minimum : maximum;
        assert.equal(invoke(type, name, left, right), expected, `${left}, ${right}`);
        assert.equal(invoke(type, name, right, left), expected, `${right}, ${left}`);
      }
    });

    test(`${type} ${name} keeps its declared result through fields, arrays, boxing and GC`, () => {
      const bytes = managedFixture({fields: [{name: 'Selected', type}], methods: [
        {name: 'Main', result: type, locals: [type + '[]', 'object'], body(writer, context) {
          writer.op('ldc.i4', low).op('ldc.i4', high);
          writer.op('call', context.member('System.Math', name, type, [type, type]));
          writer.op('stsfld', context.fields.Selected);
          writer.op('ldc.i4.1').op('newarr', context.resolve(width.cli)).op('stloc.0');
          writer.op('ldloc.0').op('ldc.i4.0').op('ldsfld', context.fields.Selected).op(width.store);
          writer.op('ldloc.0').op('ldc.i4.0').op(width.load).op('box', context.resolve(width.cli)).op('stloc.1');
          writer.op('call', context.member('System.GC', 'Collect', 'void'));
          writer.op('ldloc.1').op('call', context.member('System.Console', 'WriteLine', 'void', ['object']));
          writer.op('ldloc.1').op('unbox.any', context.resolve(width.cli)).op('ret');
        }}
      ]});
      const result = new CilVirtualMachine(bytes).run(), expected = name === 'Min' ? low : high;
      assert.equal(result.state, 'terminated', result.fault?.stack);
      assert.equal(result.returnValue, expected);
      assert.equal(result.output, expected + '\n');
    });
  }
}

test('small extrema require exact same-width static parameter/result signatures', () => {
  for (const {type} of widths) {
    for (const name of ['Min', 'Max']) {
      const descriptor = {kind: 'method', owner: 'System.Math', name,
        signature: {isStatic: true, parameters: [type, type], returnType: type, genericArity: 0, callingConvention: 0}};
      assert.equal(intrinsicDefinition(descriptor)?.implementation, 'smallMathExtremum');
      for (const owner of ['System.MathF', 'Other.Math']) assert.equal(intrinsicDefinition({...descriptor, owner}), null);
      for (const replacement of [{returnType: 'int'}, {returnType: 'double'}, {isStatic: false},
        {parameters: [type]}, {parameters: [type, 'int']}, {parameters: [type + '&', type]},
        {genericArity: 1}, {callingConvention: 5}]) {
        assert.equal(intrinsicDefinition({...descriptor, signature: {...descriptor.signature, ...replacement}}), null);
      }
    }
  }
  for (const type of ['char', 'bool', 'nint', 'nuint']) {
    for (const name of ['Min', 'Max']) {
      assert.equal(intrinsicDefinition({kind: 'method', owner: 'System.Math', name,
        signature: {isStatic: true, parameters: [type, type], returnType: type}}), null);
      assert.throws(() => smallMathExtremum(name, type, 0, 1), TypeError);
    }
  }
});

test('false small Math signatures fail guest verification before execution', () => {
  for (const [owner, parameters, result, isStatic] of [
    ['System.Math', ['sbyte', 'sbyte'], 'int', true],
    ['System.Math', ['short', 'ushort'], 'short', true],
    ['System.Math', ['byte', 'byte'], 'byte', false],
    ['Other.Math', ['ushort', 'ushort'], 'ushort', true],
    ['System.Math', ['char', 'char'], 'char', true],
    ['System.Math', ['bool', 'bool'], 'bool', true]
  ]) {
    const bytes = managedFixture({methods: [{name: 'Main', result, body(writer, context) {
      if (!isStatic) writer.op('ldnull');
      writer.op('ldc.i4.0').op('ldc.i4.1');
      writer.op('call', context.member(owner, 'Min', result, parameters, isStatic)).op('ret');
    }}]});
    assert.throws(() => new CilVirtualMachine(bytes), /verification failed/);
  }
});
