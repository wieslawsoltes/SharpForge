import { managedFixture } from '../../managed-fixtures.js';

const nativeArithmetic = 'ILVerify 10.0.5 accepts mixed int64/native-int arithmetic; ECMA III.1.5 table III.2 forbids it.';
const nativeAssignment = 'ILVerify 10.0.5 rejects int32/native-int assignment permitted by ECMA I.8.7.3 rule 4.';
const nativeComparison = 'ILVerify 10.0.5 accepts this comparison outside ECMA III.1.5 table III.4.';
const nativeJoin = 'ILVerify 10.0.5 requires identical incoming kinds before its join; ECMA verifier assignment admits int32/native-int.';

function binary(name, left, right, opcode, accepted, options = {}) {
  return { name, parameters: [left, right], accepted, ...options,
    body: writer => writer.op('ldarg.0').op('ldarg.1').op(opcode).op('pop').op('ret') };
}
function unary(name, type, opcode, accepted, options = {}) {
  return { name, parameters: [type], accepted, ...options,
    body: writer => writer.op('ldarg.0').op(opcode).op('pop').op('ret') };
}

// Authored independently from the product tables: rows/columns I4, I8, native, float, object.
const addition = ['10100', '01000', '10100', '00010', '00000'];
const types = ['int', 'long', 'nint', 'double', 'object'];
export const numericCases = [];
for (let left = 0; left < types.length; left++) {
  for (let right = 0; right < types.length; right++) {
    const nativeDifference = left === 1 && right === 2 || left === 2 && right === 1;
    numericCases.push(binary(`Add_${left}_${right}`, types[left], types[right], 'add', addition[left][right] === '1',
      nativeDifference ? { nativeAccepted: true, difference: nativeArithmetic } : {}));
  }
}
numericCases.push(
  binary('SubtractLong', 'long', 'long', 'sub', true),
  binary('MultiplyFloat', 'float', 'double', 'mul', true),
  binary('DivideNative', 'nint', 'nint', 'div', true),
  binary('RemainderFloat', 'double', 'float', 'rem', true),
  binary('UnsignedDivideFloat', 'double', 'double', 'div.un', false),
  binary('CheckedMultiplyFloat', 'double', 'double', 'mul.ovf', false),
  binary('CheckedAddIntegerNative', 'int', 'nint', 'add.ovf.un', true),
  binary('BitwiseFloat', 'double', 'double', 'xor', false),
  binary('BitwiseNative', 'nint', 'nint', 'and', true),
  binary('CheckedSubtractLong', 'long', 'long', 'sub.ovf', true),
  unary('NegateInteger', 'int', 'neg', true),
  unary('NegateFloat', 'double', 'neg', true),
  unary('NegateObject', 'object', 'neg', false),
  unary('NotNative', 'nint', 'not', true),
  unary('NotFloat', 'double', 'not', false),
  unary('CheckFiniteFloat', 'float', 'ckfinite', true),
  unary('CheckFiniteInteger', 'int', 'ckfinite', false),
  unary('ConvertIntegerLong', 'int', 'conv.i8', true),
  unary('ConvertLongInteger', 'long', 'conv.i4', true),
  unary('ConvertNativeFloat', 'nint', 'conv.r.un', true),
  unary('ConvertFloatNative', 'double', 'conv.i', true),
  unary('ConvertCheckedFloat', 'double', 'conv.ovf.i1', true),
  unary('ConvertCheckedUnsigned', 'long', 'conv.ovf.u8.un', true),
  unary('ConvertObject', 'object', 'conv.i4', false),
  unary('ConvertSmall', 'int', 'conv.u2', true),
  binary('ShiftLongInteger', 'long', 'int', 'shl', true),
  binary('ShiftNativeNative', 'nint', 'nint', 'shr.un', true),
  binary('ShiftIntegerLong', 'int', 'long', 'shl', false),
  binary('ShiftFloatInteger', 'double', 'int', 'shr', false),
  binary('ShiftIntegerFloat', 'int', 'double', 'shr', false),
  binary('CompareIntegerNative', 'int', 'nint', 'ceq', true),
  binary('CompareIntegerLong', 'int', 'long', 'ceq', false),
  binary('CompareLongInteger', 'long', 'int', 'ceq', false, { nativeAccepted: true, difference: nativeComparison }),
  binary('CompareFloat', 'double', 'float', 'clt.un', true),
  binary('CompareObjectEquality', 'object', 'object', 'ceq', true),
  binary('CompareObjectOrdering', 'object', 'object', 'clt', false, { nativeAccepted: true, difference: nativeComparison }),
  { name: 'ArgumentRoundtrip', parameters: ['byte'], result: 'int', accepted: true,
    body: writer => writer.op('ldarg.0').op('ret') },
  { name: 'ArgumentStoreNative', parameters: ['nint'], accepted: true, nativeAccepted: false, difference: nativeAssignment,
    body: writer => writer.op('ldc.i4.1').op('starg.s', 0).op('ret') },
  { name: 'LocalRoundtrip', locals: ['short'], result: 'int', accepted: true,
    body: writer => writer.op('ldc.i4.1').op('stloc.0').op('ldloc.0').op('ret') },
  { name: 'LocalNativeStoreInteger', parameters: ['nint'], locals: ['int'], accepted: true,
    nativeAccepted: false, difference: nativeAssignment,
    body: writer => writer.op('ldarg.0').op('stloc.0').op('ret') },
  { name: 'LocalWrongStore', locals: ['int'], accepted: false,
    body: writer => writer.op('ldc.r8', 1).op('stloc.0').op('ret') },
  { name: 'LocalUninitialized', locals: ['int'], initLocals: false, accepted: false,
    body: writer => writer.op('ldloc.0').op('pop').op('ret') },
  { name: 'ArgumentAddress', parameters: ['byte'], accepted: true,
    body: writer => writer.op('ldarga.s', 0).op('pop').op('ret') },
  { name: 'LocalAddress', locals: ['long'], accepted: true,
    body: writer => writer.op('ldloca.s', 0).op('pop').op('ret') },
  { name: 'WrongReturn', result: 'long', accepted: false,
    body: writer => writer.op('ldc.i4.1').op('ret') },
  { name: 'NativeReturn', result: 'nint', accepted: true, nativeAccepted: false, difference: nativeAssignment,
    body: writer => writer.op('ldc.i4.1').op('ret') },
  { name: 'Constants', accepted: true, body(writer) {
    writer.op('ldc.i4.m1').op('pop').op('ldc.i4.s', 127).op('pop').op('ldc.i8', 42n).op('pop');
    writer.op('ldc.r4', 1.5).op('pop').op('ldc.r8', 2.5).op('pop').op('ldnull').op('pop').op('ret');
  } },
  { name: 'Diamond', result: 'int', accepted: true, body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldc.i4.1').op('br.s', 'join');
    writer.mark('right').op('ldc.i4.2').mark('join').op('ret');
  } },
  { name: 'MixedJoin', accepted: false, body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldc.i4.1').op('br.s', 'join');
    writer.mark('right').op('ldc.r4', 2).mark('join').op('pop').op('ret');
  } },
  { name: 'NativeJoin', accepted: true, nativeAccepted: false, difference: nativeJoin, body(writer) {
    writer.op('ldc.i4.0').op('brtrue.s', 'right').op('ldc.i4.1').op('br.s', 'join');
    writer.mark('right').op('ldc.i4.2').op('conv.i').mark('join').op('pop').op('ret');
  } },
  { name: 'Loop', accepted: true, body(writer) {
    writer.mark('again').op('ldc.i4.0').op('brtrue.s', 'again').op('ret');
  } },
  { name: 'Switch', accepted: true, body(writer) {
    writer.op('ldc.i4.0').op('switch', ['done', 'done']).mark('done').op('ret');
  } },
);

export function numericFixture(fixture) {
  return managedFixture({ name: fixture.name, entry: null, methods: [{ maxStack: 8, ...fixture }] });
}
