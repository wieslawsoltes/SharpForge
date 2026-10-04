import {registerScalarOpcodes} from './scalar-emission.js';
import {
  Op, Binary, Unary, EnumConvertBase, NumericType, numericTypeName, numericMode,
  encodeScalar, decodeScalar, decimalFromBits, integerType
} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {CilError} from './binary.js';

export const profileOpcodes = new Set([
  'ldftn', 'unbox.any', 'ldloca', 'ldloca.s', 'add.ovf', 'sub.ovf', 'mul.ovf', 'conv.ovf.i4', 'nop', 'ldarg.0', 'ldarg.1', 'ldarg.2',
  'ldarg.3', 'ldloc.0', 'ldloc.1', 'ldloc.2', 'ldloc.3', 'stloc.0', 'stloc.1', 'stloc.2', 'stloc.3', 'ldarg.s', 'starg.s', 'ldloc.s',
  'stloc.s', 'ldnull', 'ldc.i4.m1', 'ldc.i4.0', 'ldc.i4.1', 'ldc.i4.2', 'ldc.i4.3', 'ldc.i4.4', 'ldc.i4.5', 'ldc.i4.6', 'ldc.i4.7',
  'ldc.i4.8', 'ldc.i4.s', 'ldc.i4', 'ldc.r8', 'dup', 'pop', 'call', 'ret', 'br.s', 'brfalse.s', 'brtrue.s', 'br', 'brfalse', 'brtrue',
  'add', 'sub', 'mul', 'div', 'rem', 'and', 'or', 'xor', 'shl', 'shr', 'neg', 'not', 'conv.i4', 'conv.r8', 'callvirt', 'ldstr',
  'newobj', 'castclass', 'throw', 'ldfld', 'stfld', 'ldsfld', 'stsfld', 'box', 'newarr', 'ldlen', 'ldelem', 'stelem', 'conv.u1',
  'leave', 'leave.s', 'ceq', 'cgt', 'cgt.un', 'clt', 'clt.un', 'ldarg', 'starg', 'ldloc', 'stloc', 'rethrow', 'endfinally',
]);
registerScalarOpcodes(profileOpcodes);

const arithmetic = {add: '+', sub: '-', mul: '*', div: '/', rem: '%', and: '&', or: '|', xor: '^', shl: '<<', shr: '>>'};
const decimalOperators = {
  Addition: '+', Subtraction: '-', Multiply: '*', Division: '/', Modulus: '%', Equality: '==', Inequality: '!=', LessThan: '<',
  LessThanOrEqual: '<=', GreaterThan: '>', GreaterThanOrEqual: '>='
};
const literal = instruction => instruction?.name === 'ldc.i4.m1' ? -1
  : ['ldc.i4', 'ldc.i4.s', 'ldc.i8', 'ldc.r4', 'ldc.r8'].includes(instruction?.name) ? instruction.operand
    : /^ldc\.i4\.[0-8]$/.test(instruction?.name) ? Number(instruction.name.at(-1)) : undefined;

function constant(body, type, target) {
  if (type === 'decimal') {
    const words = body.slice(0, 5).map(literal);
    if (words.length !== 5 || words.some(value => value === undefined) || target?.owner !== 'System.Decimal' || target.name !== '.ctor') {
      throw new CilError('Invalid Decimal constant span');
    }
    return encodeScalar(decimalFromBits([words[0], words[1], words[2], words[4] << 16 | (words[3] ? 0x80000000 : 0)]), type);
  }
  const value = literal(body[0]), integer = integerType(type, {nativeIntBits: 64});
  const text = integer?.unsigned ? BigInt.asUintN(integer.bits, BigInt(value)).toString()
    : typeof value === 'number' && Object.is(value, -0) ? '-0' : String(value);
  return encodeScalar(decodeScalar({scalar: type, value: text}, {nativeIntBits: 64}), type, {nativeIntBits: 64});
}

/** Decode typed spans; the loader's canonical re-emission still verifies every executable byte. */
export function decodeScalarSpan(span, context) {
  let end = span.length, unary = false;
  if (span[end - 2]?.name === 'ldnull' && span[end - 1]?.name === 'pop') {
    unary = true;
    end -= 2;
  }
  const checked = span[end - 1]?.name === 'nop';
  if (checked) end--;
  const marker = () => {
    if (span[end - 2]?.name !== 'ldtoken' || span[end - 1]?.name !== 'pop') return null;
    const type = context.metadata.typeName(span[end - 2].operand);
    end -= 2;
    return numericTypeName(type);
  };
  const type = marker();
  if (type === null) return null;
  if (NumericType[type] === undefined && !enumTypes.includes(type)) throw new CilError('Invalid scalar type marker');
  const from = marker(), body = span.slice(0, end);
  if (from !== null) return [Op.CONVERT, NumericType[type] ?? EnumConvertBase + enumTypes.indexOf(type), numericMode(from, checked)];
  const call = body.filter(instruction => instruction.name === 'call' || instruction.name === 'newobj').at(-1);
  const target = call ? context.resolveCall(call.operand) : null;
  if (unary) {
    const operator = target?.name === 'op_UnaryNegation' || body.some(instruction => instruction.name === 'neg' || instruction.name === 'mul.ovf')
      ? '-' : body.some(instruction => instruction.name === 'not') ? '~' : '+';
    return [Op.UNARY, Unary[operator], numericMode(type, checked)];
  }
  if (literal(body[0]) !== undefined) return [Op.CONST, context.intern(constant(body, type, target)), type === 'double' ? 1 : 0];
  let operator = body.at(-1)?.name === 'pop' && literal(body.at(-2)) === 3 ? '>>>' : null;
  if (target?.owner === 'System.Decimal') operator = decimalOperators[target.name?.replace(/^op_/, '')];
  if (!operator) {
    const operation = body.find(instruction => arithmetic[instruction.name.split('.')[0]]);
    if (operation) operator = arithmetic[operation.name.split('.')[0]];
  }
  if (!operator) {
    const comparisons = body.filter(instruction => ['ceq', 'clt', 'clt.un', 'cgt', 'cgt.un'].includes(instruction.name));
    const first = comparisons[0]?.name;
    if (first === 'ceq') operator = comparisons.length === 1 ? '==' : '!=';
    else if (first?.startsWith('clt')) operator = comparisons.length === 1 ? '<' : '>=';
    else if (first?.startsWith('cgt')) operator = comparisons.length === 1 ? '>' : '<=';
  }
  if (!operator) throw new CilError('Invalid scalar operation span');
  return [Op.BINARY, Binary[operator], numericMode(type, checked)];
}
