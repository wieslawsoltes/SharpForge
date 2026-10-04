import test from 'node:test';
import assert from 'node:assert/strict';
import {float, singleToInt32Bits, doubleToInt64Bits, int32BitsToSingle, int64BitsToDouble} from '@sharpforge/bytecode';
import {intrinsicDefinition} from '@sharpforge/cil';
import {CilVirtualMachine} from '@sharpforge/runtime';
import {floatingMathExtremum} from '../packages/runtime/src/execution/float-extrema.js';
import {managedFixture} from './managed-fixtures.js';

const formats = [
  {type: 'float', kind: 'r4', integer: 'int', decode: int32BitsToSingle, encode: singleToInt32Bits,
    decodeName: 'Int32BitsToSingle', encodeName: 'SingleToInt32Bits',
    zero: 0, negativeZero: -2147483648, tiny: 1, negativeTiny: -2147483647,
    one: 0x3f800000, negativeOne: -1082130432, maximum: 0x7f7fffff,
    infinity: 0x7f800000, negativeInfinity: -8388608,
    nan: 0x7fc12345, otherNan: 0xffc54321 | 0},
  {type: 'double', kind: 'r8', integer: 'long', decode: int64BitsToDouble, encode: doubleToInt64Bits,
    decodeName: 'Int64BitsToDouble', encodeName: 'DoubleToInt64Bits',
    zero: 0n, negativeZero: -(1n << 63n), tiny: 1n, negativeTiny: -(1n << 63n) + 1n,
    one: 0x3ff0000000000000n, negativeOne: -0x4010000000000000n, maximum: 0x7fefffffffffffffn,
    infinity: 0x7ff0000000000000n, negativeInfinity: -0x10000000000000n,
    nan: 0x7ff8000000012345n, otherNan: BigInt.asIntN(64, 0xfff8000000054321n)}
];

function cases(f) {
  return [
    [f.zero, f.negativeZero, f.negativeZero, f.zero], [f.negativeZero, f.zero, f.negativeZero, f.zero],
    [f.zero, f.zero, f.zero, f.zero], [f.negativeZero, f.negativeZero, f.negativeZero, f.negativeZero],
    [f.nan, f.one, f.nan, f.nan], [f.one, f.nan, f.nan, f.nan],
    [f.nan, f.otherNan, f.nan, f.nan], [f.otherNan, f.nan, f.otherNan, f.otherNan],
    [f.tiny, f.zero, f.zero, f.tiny], [f.negativeTiny, f.zero, f.negativeTiny, f.zero],
    [f.negativeOne, f.one, f.negativeOne, f.one], [f.one, f.one, f.one, f.one],
    [f.negativeOne, f.negativeOne, f.negativeOne, f.negativeOne],
    [f.maximum, f.infinity, f.maximum, f.infinity], [f.negativeInfinity, f.maximum, f.negativeInfinity, f.maximum],
    [f.infinity, f.negativeInfinity, f.negativeInfinity, f.infinity]
  ];
}

function assembly(format, name) {
  return managedFixture({methods: [{name: 'Main', parameters: [format.integer, format.integer], result: format.integer,
    body(writer, context) {
      const decode = context.member('System.BitConverter', format.decodeName, format.type, [format.integer]);
      writer.op('ldarg.0').op('call', decode).op('ldarg.1').op('call', decode)
        .op('call', context.member('System.Math', name, format.type, [format.type, format.type]))
        .op('call', context.member('System.BitConverter', format.encodeName, format.integer, [format.type])).op('ret');
    }}]});
}

for (const format of formats) {
  test(`${format.type} extrema retain selected quiet-NaN payloads and zero signs in the shared selector`, () => {
    for (const [a, b, minimum, maximum] of cases(format)) {
      const first = format.decode(a), second = format.decode(b);
      for (const [name, expected] of [['Min', minimum], ['Max', maximum]]) {
        const result = floatingMathExtremum(name, format.type, first, second);
        assert.equal(result.float, format.kind);
        assert(Object.isFrozen(result));
        assert(result === first || result === second, 'retain the selected canonical carrier');
        assert.equal(format.encode(result), expected, `${name}(${a},${b})`);
      }
    }
  });

  for (const name of ['Min', 'Max']) {
    test(`independent CIL Math.${name}(${format.type}) observes exact operand bits through BitConverter`, () => {
      const bytes = assembly(format, name);
      for (const [left, right, minimum, maximum] of cases(format)) {
        const result = new CilVirtualMachine(bytes, {arguments: [left, right]}).run();
        assert.equal(result.state, 'terminated', result.fault?.stack);
        assert.equal(result.returnValue, name === 'Min' ? minimum : maximum, `${name}(${left},${right})`);
      }
    });
  }
}

test('declared Single calls narrow wider F inputs and preserve the return category', () => {
  for (const name of ['Min', 'Max']) {
    const selected = floatingMathExtremum(name, 'float', float(16777217), float(16777216));
    assert.equal(selected.float, 'r4');
    assert.equal(selected.value, 16777216);
    const bytes = managedFixture({methods: [{name: 'Main', result: 'int', body(writer, context) {
      writer.op('ldc.r8', 16777217).op('ldc.r8', 16777216)
        .op('call', context.member('System.Math', name, 'float', ['float', 'float']))
        .op('call', context.member('System.BitConverter', 'SingleToInt32Bits', 'int', ['float'])).op('ret');
    }}]});
    const result = new CilVirtualMachine(bytes).run();
    assert.equal(result.state, 'terminated', result.fault?.stack);
    assert.equal(result.returnValue, 0x4b800000);
  }
  const edited = Object.freeze({float: 'r4', value: 16777217});
  const normalized = floatingMathExtremum('Max', 'float', edited, float(16777216, 'r4'));
  assert.equal(normalized.value, 16777216);
});

test('floating selection does not admit mixed signatures or unrelated Math methods', () => {
  const descriptor = {kind: 'method', owner: 'System.Math', name: 'Min',
    signature: {isStatic: true, parameters: ['float', 'float'], returnType: 'float', genericArity: 0, callingConvention: 0}};
  assert(intrinsicDefinition(descriptor));
  for (const replacement of [{parameters: ['float', 'double']}, {parameters: ['float']}, {returnType: 'double'},
    {isStatic: false}, {genericArity: 1}, {callingConvention: 5}]) {
    assert.equal(intrinsicDefinition({...descriptor, signature: {...descriptor.signature, ...replacement}}), null);
  }
  assert.throws(() => floatingMathExtremum('Abs', 'float', float(1), float(2)), TypeError);
  assert.throws(() => floatingMathExtremum('Min', 'int', 1, 2), TypeError);
});
