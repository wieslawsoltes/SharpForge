import {
  Op, BinaryName, UnaryName, EnumConvertBase, decodeScalar, decimalBits,
  numericTypeName, integerType, decodeNumericMode, isNumericMode
} from '@sharpforge/bytecode';
import {enumTypes} from '@sharpforge/framework';
import {CilError} from './binary.js';

const cilNames = {
  sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', nint: 'i',
  nuint: 'u', float: 'r4', double: 'r8'
};
const arithmetic = {'+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'rem', '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'shr', '>>>': 'shr'};
const decimalOperators = {
  '+': 'Addition', '-': 'Subtraction', '*': 'Multiply', '/': 'Division', '%': 'Modulus', '==': 'Equality', '!=': 'Inequality',
  '<': 'LessThan', '<=': 'LessThanOrEqual', '>': 'GreaterThan', '>=': 'GreaterThanOrEqual'
};
export const scalarMetadataType = type => type === 'decimal' ? 'System.Decimal' : type;

function marker(writer, context, type, checked = false, from = null) {
  if (from !== null) writer.op('ldtoken', context.resolveType(scalarMetadataType(from))).op('pop');
  writer.op('ldtoken', context.resolveType(scalarMetadataType(type))).op('pop');
  if (checked) writer.op('nop');
}

function constant(writer, context, wire) {
  const type = numericTypeName(wire.scalar), value = decodeScalar(wire, {nativeIntBits: 64});
  if (type === 'decimal') {
    const bits = decimalBits(value);
    for (let index = 0; index < 3; index++) writer.integer(bits[index]);
    writer.integer(Number(value.negative)).integer(value.scale)
      .op('newobj', context.external('System.Decimal', '.ctor', 'void', ['int', 'int', 'int', 'bool', 'byte'], false));
  } else if (type === 'long' || type === 'ulong') writer.op('ldc.i8', value);
  else if (type === 'float' || type === 'double') writer.op(type === 'float' ? 'ldc.r4' : 'ldc.r8', value.value);
  else if (type === 'nint' || type === 'nuint') {
    // A literal must fit the executing ABI, just as decodeScalar requires; casts have their own policy.
    writer.op('ldc.i8', BigInt(wire.value)).op(type === 'nint' ? 'conv.ovf.i' : 'conv.ovf.u.un');
  }
  else writer.integer(value);
  marker(writer, context, type);
}

export function emitScalarConversion(writer, context, from, to, checked = false) {
  from = numericTypeName(from);
  to = numericTypeName(to);
  if (from === to) return;
  if (to === 'decimal') {
    if (from === 'nint' || from === 'nuint') {
      writer.op(from === 'nint' ? 'conv.i8' : 'conv.u8');
      from = from === 'nint' ? 'long' : 'ulong';
    }
    writer.op('call', context.external('System.Decimal', ['float', 'double'].includes(from) ? 'op_Explicit' : 'op_Implicit', 'System.Decimal', [from]));
    return;
  }
  if (from === 'decimal') {
    const native = to === 'nint' || to === 'nuint';
    writer.op('call', context.external('System.Decimal', 'op_Explicit', native ? to === 'nint' ? 'long' : 'ulong' : to, ['System.Decimal']));
    if (native) writer.op(to === 'nint' ? 'conv.ovf.i' : 'conv.ovf.u.un');
    return;
  }
  const suffix = cilNames[to];
  if (!suffix) throw new CilError('Invalid scalar conversion target');
  const source = integerType(from), target = integerType(to);
  if (!target) {
    if (source?.unsigned) writer.op('conv.r.un');
    writer.op('conv.' + suffix);
  } else if (checked) writer.op('conv.ovf.' + suffix + (source?.unsigned ? '.un' : ''));
  else if (target.native && source && !source.native && source.bits <= 32) {
    writer.op(source.unsigned ? 'conv.u' : 'conv.i');
    if (to === 'nuint' && !source.unsigned) writer.op('conv.u');
  } else {
    if (to === 'ulong' && source && !source.unsigned && source.bits < 64) writer.op('conv.i8');
    writer.op((to === 'long' || to === 'ulong') && source?.unsigned && source.bits <= 32 ? 'conv.u8' : 'conv.' + suffix);
  }
}

function binary(writer, context, operator, mode) {
  const {type, checked} = decodeNumericMode(mode), integer = integerType(type);
  const comparison = ['==', '!=', '<', '<=', '>', '>='].includes(operator);
  if (type === 'decimal') {
    writer.op('call', context.external('System.Decimal', 'op_' + decimalOperators[operator],
      comparison ? 'bool' : 'System.Decimal', ['System.Decimal', 'System.Decimal']));
  } else if (operator in arithmetic) {
    const overflow = integer && checked && ['+', '-', '*'].includes(operator);
    const unsigned = operator === '>>>' || integer?.unsigned && (overflow || ['/', '%', '>>'].includes(operator));
    writer.op(arithmetic[operator] + (overflow ? '.ovf' : '') + (unsigned ? '.un' : ''));
    if (type === 'float' || type === 'double') writer.op('conv.' + cilNames[type]);
  } else if (operator === '==') writer.op('ceq');
  else if (operator === '!=') writer.op('ceq').integer(0).op('ceq');
  else if (operator === '<') writer.op(integer?.unsigned ? 'clt.un' : 'clt');
  else if (operator === '>') writer.op(integer?.unsigned ? 'cgt.un' : 'cgt');
  else if (operator === '<=') writer.op(integer?.unsigned || !integer ? 'cgt.un' : 'cgt').integer(0).op('ceq');
  else if (operator === '>=') writer.op(integer?.unsigned || !integer ? 'clt.un' : 'clt').integer(0).op('ceq');
  if (operator === '>>>') writer.integer(3).op('pop');
  marker(writer, context, type, checked);
}

function unary(writer, context, operator, mode) {
  const {type, checked} = decodeNumericMode(mode);
  if (type === 'decimal') {
    writer.op('call', context.external('System.Decimal', operator === '-' ? 'op_UnaryNegation' : 'op_UnaryPlus', 'System.Decimal', ['System.Decimal']));
  } else if (operator === '-' && checked && integerType(type)) {
    if (type === 'long') writer.op('ldc.i8', -1n);
    else {
      writer.integer(-1);
      if (type === 'nint') writer.op('conv.i');
    }
    writer.op('mul.ovf');
  } else if (operator === '-') writer.op('neg');
  else if (operator === '~') writer.op('not');
  if (type !== 'decimal') writer.op('conv.' + cilNames[type]);
  marker(writer, context, type, checked);
  writer.op('ldnull').op('pop');
}

/** Emit executable scalar IL; no-op type markers make source reloading lossless. */
export function emitScalarInstruction(writer, context, instruction) {
  const {op, a, b} = instruction;
  if (op === Op.CONST && context.image.constants[a]?.scalar) constant(writer, context, context.image.constants[a]);
  else if (op === Op.BINARY && isNumericMode(b)) binary(writer, context, BinaryName[a], b);
  else if (op === Op.UNARY && isNumericMode(b)) unary(writer, context, UnaryName[a], b);
  else if (op === Op.CONVERT && isNumericMode(b)) {
    const source = decodeNumericMode(b), type = a >= EnumConvertBase ? enumTypes[a - EnumConvertBase] : numericTypeName(a);
    emitScalarConversion(writer, context, source.type, a >= EnumConvertBase ? 'int' : type, source.checked);
    if (a >= EnumConvertBase) writer.op('box', context.resolveType(type)).op('unbox.any', context.resolveType(type));
    marker(writer, context, type, source.checked, source.type);
  } else return false;
  return true;
}

/** Additional standard CLI instructions emitted by typed scalar spans. */
export function registerScalarOpcodes(opcodes) {
  for (const name of ['ldtoken', 'ldc.i8', 'ldc.r4', 'div.un', 'rem.un', 'shr.un', 'add.ovf.un', 'sub.ovf.un', 'mul.ovf.un', 'conv.r.un']) opcodes.add(name);
  for (const suffix of Object.values(cilNames)) {
    opcodes.add('conv.' + suffix);
    if (suffix.startsWith('r')) continue;
    opcodes.add('conv.ovf.' + suffix);
    opcodes.add('conv.ovf.' + suffix + '.un');
  }
}
