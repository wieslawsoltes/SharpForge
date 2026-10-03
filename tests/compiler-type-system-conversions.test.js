import test from 'node:test';
import assert from 'node:assert/strict';
import { coreTypes } from '../packages/compiler/src/symbols/core-types.js';
import { Conversions, ConversionKind } from '../packages/compiler/src/conversions/classify.js';
import {
  binaryNumericPromotion,
  unaryNumericPromotion,
  shiftPromotion,
  implicitNumericConversion,
  explicitNumericConversion,
  numericKinds,
  numericKind,
  integralRange,
} from '../packages/compiler/src/conversions/numeric.js';
import {
  evaluateReal,
  compareReal,
  convertReal,
  decimalOperatorMethod,
  roundToSingle,
  isNegativeZero,
} from '../packages/compiler/src/conversions/reals.js';
import { classifyConstantNarrowing, implicitConstantConversion } from '../packages/compiler/src/conversions/constant-narrowing.js';
import { classifyNativeIntegerConversion, nativeIntegerKind, nativeConstantFits } from '../packages/compiler/src/conversions/native-int.js';
import {
  arithmeticInstruction,
  conversionInstructions,
  evaluateArithmetic,
  evaluateConversion,
  evaluateNegate,
  irSupport,
} from '../packages/compiler/src/lowering/checked-arithmetic.js';
import {
  lowerLiftedBinary,
  evaluateLifted,
  evaluateLowered,
  lowerNullableCoalesce,
} from '../packages/compiler/src/lowering/nullable-operators.js';
import { ConstantValue } from '../packages/compiler/src/constants/constant-value.js';

const core = coreTypes();
const conversions = new Conversions(core, { numericIntPtr: false, firstClassSpans: true });
const kindOf = (from, to) => conversions.classifyImplicit(from, to).kind;
const castKind = (from, to) => conversions.classifyExplicit(from, to).kind;

test('A02-T01.1 binary numeric promotion matches the C# rules for every pair of widths', () => {
  const rows = [
    ['byte', 'byte', 'int'],
    ['short', 'ushort', 'int'],
    ['char', 'char', 'int'],
    ['uint', 'int', 'long'],
    ['uint', 'uint', 'uint'],
    ['uint', 'byte', 'uint'],
    ['long', 'uint', 'long'],
    ['ulong', 'uint', 'ulong'],
    ['ulong', 'int', null],
    ['ulong', 'long', null],
    ['ulong', 'sbyte', null],
    ['float', 'long', 'float'],
    ['double', 'float', 'double'],
    ['decimal', 'int', 'decimal'],
    ['decimal', 'double', null],
    ['decimal', 'float', null],
    ['nint', 'int', 'nint'],
    ['nint', 'uint', 'long'],
    ['nuint', 'int', null],
    ['nuint', 'uint', 'nuint'],
    ['nuint', 'ulong', 'ulong'],
    ['nint', 'ulong', null],
  ];
  for (const [left, right, expected] of rows) {
    assert.equal(binaryNumericPromotion(left, right), expected, `${left} op ${right}`);
    assert.equal(binaryNumericPromotion(right, left), expected, `${right} op ${left}`);
  }
  // A constant int that fits the unsigned operand converts to it instead of widening.
  assert.equal(binaryNumericPromotion('ulong', 'int', { rightConstant: 1n }), 'ulong');
  assert.equal(binaryNumericPromotion('uint', 'int', { rightConstant: 1n }), 'uint');
  assert.equal(binaryNumericPromotion('uint', 'int', { rightConstant: -1n }), 'long');
  assert.equal(binaryNumericPromotion('bool', 'int'), null);
});

test('A02-T01.1 unary and shift promotion; implicit and explicit numeric conversion tables', () => {
  assert.deepEqual(
    ['byte', 'uint', 'ulong', 'long', 'nuint', 'float'].map(kind => unaryNumericPromotion('-', kind)),
    ['int', 'long', null, 'long', null, 'float'],
  );
  assert.deepEqual(
    ['sbyte', 'uint', 'double'].map(kind => unaryNumericPromotion('~', kind)),
    ['int', 'uint', null],
  );
  assert.deepEqual(['byte', 'long', 'ulong', 'double'].map(shiftPromotion), ['int', 'long', 'ulong', null]);
  assert.equal(implicitNumericConversion('int', 'long'), true);
  assert.equal(implicitNumericConversion('long', 'int'), false);
  assert.equal(implicitNumericConversion('long', 'float'), true);
  assert.equal(implicitNumericConversion('char', 'ushort'), true);
  assert.equal(implicitNumericConversion('ushort', 'char'), false);
  assert.equal(implicitNumericConversion('float', 'decimal'), false);
  assert.equal(implicitNumericConversion('int', 'nint'), true);
  assert.equal(implicitNumericConversion('nint', 'int'), false);
  // Every ordered pair of distinct numeric kinds converts one way or the other, never both.
  for (const from of numericKinds) {
    for (const to of numericKinds) {
      if (from === to) continue;
      assert.notEqual(implicitNumericConversion(from, to), explicitNumericConversion(from, to), `${from} -> ${to}`);
    }
  }
  assert.deepEqual(integralRange('sbyte'), [-128n, 127n]);
  assert.deepEqual(integralRange('ulong'), [0n, 18446744073709551615n]);
  assert.equal(numericKind(core.nint), 'nint');
  assert.equal(numericKind(core.bool), null);
});

test('A02-T01.2 float and decimal semantics: rounding, signed zero, NaN, decimal operators and exceptions', () => {
  assert.equal(evaluateReal('+', 'float', 0.1, 0.2).value, Math.fround(Math.fround(0.1) + Math.fround(0.2)));
  assert.notEqual(evaluateReal('+', 'float', 0.1, 0.2).value, 0.1 + 0.2);
  assert.equal(roundToSingle(16777217), 16777216);
  assert.equal(isNegativeZero(evaluateReal('*', 'double', -1, 0).value), true);
  assert.equal(compareReal('==', -0, 0), true);
  for (const operator of ['==', '<', '>', '<=', '>=']) assert.equal(compareReal(operator, NaN, NaN), false, operator);
  assert.equal(compareReal('!=', NaN, NaN), true);
  assert.equal(evaluateReal('/', 'double', 1, 0).value, Infinity);
  assert.equal(String(evaluateReal('+', 'decimal', '0.1', '0.2').value), '0.3');
  assert.deepEqual(evaluateReal('/', 'decimal', '1', '0'), { exception: 'System.DivideByZeroException' });
  assert.deepEqual(evaluateReal('*', 'decimal', '79228162514264337593543950335', '2'), { exception: 'System.OverflowException' });
  assert.equal(decimalOperatorMethod('+'), 'op_Addition');
  assert.equal(decimalOperatorMethod('-', true), 'op_UnaryNegation');
  assert.equal(decimalOperatorMethod('<<'), null);
  assert.deepEqual(convertReal(3.99, 'double', 'int'), { value: 3n });
  assert.deepEqual(convertReal(-3.99, 'double', 'int'), { value: -3n });
  assert.deepEqual(convertReal(1e20, 'double', 'int', { checked: true }), { exception: 'System.OverflowException' });
  assert.deepEqual(convertReal(NaN, 'double', 'long', { checked: true }), { exception: 'System.OverflowException' });
  assert.deepEqual(convertReal(1e40, 'double', 'decimal'), { exception: 'System.OverflowException' });
});

test('A02-T01.3 implicit constant expression conversions and their diagnostics', () => {
  assert.equal(implicitConstantConversion('int', 200n, 'byte'), true);
  assert.equal(implicitConstantConversion('int', 300n, 'byte'), false);
  assert.equal(implicitConstantConversion('int', -1n, 'uint'), false);
  assert.equal(implicitConstantConversion('long', 5n, 'ulong'), true);
  assert.equal(implicitConstantConversion('long', -5n, 'ulong'), false);
  assert.equal(implicitConstantConversion('long', 5n, 'int'), false);
  assert.equal(classifyConstantNarrowing('int', 200n, 'byte'), 'implicitConstant');
  assert.deepEqual(classifyConstantNarrowing('int', 300n, 'byte'), { code: 'CS0031', args: ['300', 'byte'] });
  assert.deepEqual(classifyConstantNarrowing('uint', 3000000000n, 'int'), { code: 'CS0266' });
  assert.deepEqual(classifyConstantNarrowing('double', null, 'float', { isRealLiteral: true }), { code: 'CS0664', args: ['F', 'float'] });
  const fits = { type: core.int, constantValue: ConstantValue.int(200) };
  const tooBig = { type: core.int, constantValue: ConstantValue.int(300) };
  assert.equal(conversions.classifyFromExpression(fits, core.byte).kind, ConversionKind.ImplicitConstant);
  assert.equal(conversions.classifyFromExpression(tooBig, core.byte).exists, false);
  assert.equal(conversions.classifyFromExpression(fits, core.nullableOf(core.byte)).kind, ConversionKind.ImplicitNullable);
});

test('A02-T01.4 checked and unchecked arithmetic and conversions select instructions and wrap or throw', () => {
  assert.deepEqual(arithmeticInstruction('+', 'int', { checked: true }), { opcode: 'add.ovf' });
  assert.deepEqual(arithmeticInstruction('+', 'uint', { checked: true }), { opcode: 'add.ovf.un' });
  assert.deepEqual(arithmeticInstruction('*', 'long'), { opcode: 'mul' });
  assert.deepEqual(arithmeticInstruction('/', 'ulong'), { opcode: 'div.un' });
  assert.deepEqual(arithmeticInstruction('>>', 'uint'), { opcode: 'shr.un' });
  assert.deepEqual(arithmeticInstruction('+', 'double', { checked: true }), { opcode: 'add' });
  assert.deepEqual(arithmeticInstruction('+', 'decimal'), { call: 'System.Decimal::op_Addition' });
  assert.deepEqual(conversionInstructions('int', 'byte', { checked: true }), [{ opcode: 'conv.ovf.u1' }]);
  assert.deepEqual(conversionInstructions('uint', 'int', { checked: true }), [{ opcode: 'conv.ovf.i4.un' }]);
  assert.deepEqual(conversionInstructions('int', 'byte'), [{ opcode: 'conv.u1' }]);
  assert.deepEqual(conversionInstructions('byte', 'int'), []);
  assert.deepEqual(conversionInstructions('int', 'long'), [{ opcode: 'conv.i8' }]);
  assert.deepEqual(conversionInstructions('uint', 'long'), [{ opcode: 'conv.u8' }]);
  assert.deepEqual(conversionInstructions('ulong', 'double'), [{ opcode: 'conv.r.un' }, { opcode: 'conv.r8' }]);
  const overflow = { exception: 'System.OverflowException' };
  for (const [kind, max] of [
    ['sbyte', 127n],
    ['int', 2147483647n],
    ['long', 9223372036854775807n],
    ['uint', 4294967295n],
    ['ulong', 18446744073709551615n],
  ]) {
    assert.deepEqual(evaluateArithmetic('+', kind, max, 1n, { checked: true }), overflow, kind);
    assert.deepEqual(evaluateArithmetic('+', kind, max, 1n), { value: integralRange(kind)[0] }, kind);
  }
  assert.deepEqual(evaluateArithmetic('/', 'int', 1n, 0n), { exception: 'System.DivideByZeroException' });
  assert.deepEqual(evaluateArithmetic('/', 'int', -2147483648n, -1n), overflow);
  assert.deepEqual(evaluateNegate('int', -2147483648n, { checked: true }), overflow);
  assert.deepEqual(evaluateNegate('int', -2147483648n), { value: -2147483648n });
  assert.deepEqual(evaluateConversion(300n, 'int', 'byte'), { value: 44n });
  assert.deepEqual(evaluateConversion(300n, 'int', 'byte', { checked: true }), overflow);
  assert.deepEqual(evaluateConversion(-1n, 'int', 'uint'), { value: 4294967295n });
  assert.equal(irSupport('int'), true);
  assert.equal(irSupport('long'), false);
});

test('A02-T01.6 native integers: conversions per language version and constant folding limits', () => {
  assert.equal(classifyNativeIntegerConversion(core.int, core.nint), 'implicit');
  assert.equal(classifyNativeIntegerConversion(core.nint, core.int), 'explicit');
  assert.equal(classifyNativeIntegerConversion(core.nint, core.long), 'implicit');
  assert.equal(classifyNativeIntegerConversion(core.nint, core.intPtr), 'identity');
  assert.equal(classifyNativeIntegerConversion(core.int, core.intPtr), null);
  assert.equal(classifyNativeIntegerConversion(core.int, core.intPtr, { numericIntPtr: true }), 'implicit');
  assert.equal(nativeIntegerKind(core.intPtr), null);
  assert.equal(nativeIntegerKind(core.intPtr, { numericIntPtr: true }), 'nint');
  assert.equal(nativeConstantFits('nint', 2147483647n), true);
  assert.equal(nativeConstantFits('nint', 2147483648n), false);
  assert.equal(kindOf(core.int, core.nint), ConversionKind.ImplicitNumeric);
  assert.equal(kindOf(core.intPtr, core.nint), ConversionKind.Identity);
  assert.equal(core.nint.toDisplayString(), 'nint');
});

test('A02-T06.1 conversion classification across the standard conversions', () => {
  const object = core.object;
  const strings = core.arrayOf(core.string);
  const rows = [
    [core.int, core.int, 'Identity', 'Identity'],
    [core.int, core.long, 'ImplicitNumeric', 'ImplicitNumeric'],
    [core.long, core.int, 'NoConversion', 'ExplicitNumeric'],
    [core.int, object, 'Boxing', 'Boxing'],
    [object, core.int, 'NoConversion', 'Unboxing'],
    [core.string, object, 'ImplicitReference', 'ImplicitReference'],
    [object, core.string, 'NoConversion', 'ExplicitReference'],
    [core.int, core.nullableOf(core.int), 'ImplicitNullable', 'ImplicitNullable'],
    [core.int, core.nullableOf(core.long), 'ImplicitNullable', 'ImplicitNullable'],
    [core.nullableOf(core.int), core.int, 'NoConversion', 'ExplicitNullable'],
    [core.nullableOf(core.long), core.nullableOf(core.int), 'NoConversion', 'ExplicitNullable'],
    [core.nullableOf(core.int), object, 'Boxing', 'Boxing'],
    [strings, core.arrayOf(object), 'ImplicitReference', 'ImplicitReference'],
    [core.arrayOf(core.int), core.arrayOf(object), 'NoConversion', 'NoConversion'],
    [strings, core.ienumerableT.construct(object), 'ImplicitReference', 'ImplicitReference'],
    [core.arrayOf(core.int), core.ienumerableT.construct(core.int), 'ImplicitReference', 'ImplicitReference'],
    [core.arrayOf(core.int), core.array, 'ImplicitReference', 'ImplicitReference'],
    [core.ienumerableT.construct(core.string), core.ienumerableT.construct(object), 'ImplicitReference', 'ImplicitReference'],
    [core.ienumerableT.construct(core.int), core.ienumerableT.construct(object), 'NoConversion', 'ExplicitReference'],
    [core.string, core.int, 'NoConversion', 'NoConversion'],
    [core.bool, core.int, 'NoConversion', 'NoConversion'],
    [core.char, core.int, 'ImplicitNumeric', 'ImplicitNumeric'],
    [core.int, core.char, 'NoConversion', 'ExplicitNumeric'],
    [core.decimal, core.double, 'NoConversion', 'ExplicitNumeric'],
  ];
  for (const [from, to, implicit, explicit] of rows) {
    const label = `${from.toDisplayString()} -> ${to.toDisplayString()}`;
    assert.equal(kindOf(from, to), implicit, label);
    assert.equal(castKind(from, to), explicit, label + ' (cast)');
  }
  assert.equal(conversions.classifyFromExpression({ literal: 'null' }, core.string).kind, ConversionKind.NullLiteral);
  assert.equal(conversions.classifyFromExpression({ literal: 'null' }, core.nullableOf(core.int)).kind, ConversionKind.NullLiteral);
  assert.equal(conversions.classifyFromExpression({ literal: 'null' }, core.int).exists, false);
  assert.equal(conversions.classifyFromExpression({ literal: 'default' }, core.int).kind, ConversionKind.DefaultLiteral);
  assert.equal(conversions.classifyFromExpression({ form: 'throw' }, core.int).kind, ConversionKind.ImplicitThrow);
});

test('A02-T05.2 lifted operators lower to HasValue / GetValueOrDefault with the .NET truth tables', () => {
  const nullableInt = core.nullableOf(core.int);
  const nullableBool = core.nullableOf(core.bool);
  const operand = (name, type) => ({ kind: 'Local', name, type });
  const underlying = (operator, a, b) => {
    switch (operator) {
      case '+':
        return a + b;
      case '<':
        return a < b;
      case '==':
        return a === b;
      case '&':
        return a && b;
      case '|':
        return a || b;
      default:
        throw new Error(operator);
    }
  };
  const check = (operator, type, resultType, family, values, defaultValue, isBool) => {
    const node = {
      kind: 'Binary',
      operator,
      left: operand('a', type),
      right: operand('b', type),
      type: resultType,
      isLifted: true,
      family,
    };
    const lowered = lowerLiftedBinary(node, core);
    assert.notEqual(lowered, node);
    for (const a of values) {
      for (const b of values) {
        const environment = { defaultValue, valueOf: n => (n.name === 'a' ? a : b) };
        const expected = evaluateLifted(operator, a, b, underlying, { isBool });
        assert.equal(evaluateLowered(lowered, environment, underlying), expected, `${a} ${operator} ${b}`);
      }
    }
  };
  check('+', nullableInt, nullableInt, 'numeric', [null, 0, 1, 5], 0, false);
  check('<', nullableInt, core.bool, 'numeric', [null, 0, 1, 5], 0, false);
  check('==', nullableInt, core.bool, 'numeric', [null, 0, 1], 0, false);
  check('&', nullableBool, nullableBool, 'bool', [null, true, false], false, true);
  check('|', nullableBool, nullableBool, 'bool', [null, true, false], false, true);
  assert.equal(evaluateLifted('+', null, 1, underlying), null);
  assert.equal(evaluateLifted('<', null, 1, underlying), false);
  assert.equal(evaluateLifted('==', null, null, underlying), true);
  assert.equal(evaluateLifted('!=', null, 1, underlying), true);
  assert.equal(evaluateLifted('&', null, false, underlying, { isBool: true }), false);
  assert.equal(evaluateLifted('|', null, true, underlying, { isBool: true }), true);
  const coalesce = lowerNullableCoalesce(
    { kind: 'Coalesce', left: operand('a', nullableInt), right: operand('b', core.int), type: core.int },
    core,
  );
  assert.equal(evaluateLowered(coalesce, { defaultValue: 0, valueOf: n => (n.name === 'a' ? null : 7) }, underlying), 7);
  assert.equal(evaluateLowered(coalesce, { defaultValue: 0, valueOf: n => (n.name === 'a' ? 3 : 7) }, underlying), 3);
});
