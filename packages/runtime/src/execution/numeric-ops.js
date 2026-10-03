import {int64Binary, int64Compare, int64Unary} from '@sharpforge/bytecode';

/** Pure operations on CIL evaluation-stack values.
 *
 * The optional context supplies fault(type, message), error(message), and
 * isReference(value) adapters. The VM supplies its managed error constructors;
 * standalone callers receive ordinary Errors without loading a heap or VM.
 * No operation reads or changes execution state, and operands are never mutated.
 */
const fault = (type, message) => Object.assign(new Error(message), {name: type});
const error = message => Object.assign(new Error(message), {name: 'CilError'});
const reference = value => value !== null && typeof value === 'object' && Number.isInteger(value.h) && Number.isInteger(value.g);

export const float = (value, kind = 'r8') => Object.freeze({float: kind, value: kind === 'r4' ? Math.fround(value) : Number(value)});
export const number = value => value?.float ? value.value : value;
export const isNumber = value => typeof value === 'number' || typeof value === 'bigint' || !!value?.float;
const numericAliases = {'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort', 'System.Char': 'char', 'System.Boolean': 'bool', 'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong', 'System.Single': 'float', 'System.Double': 'double', 'System.IntPtr':'nint', 'System.UIntPtr':'nuint'};
export const defaults = input => { const type=numericAliases[input]??input; return type === 'long' || type === 'ulong' ? 0n : type === 'double' ? float(0) : type === 'float' ? float(0, 'r4') : ['int', 'uint', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool', 'nint', 'nuint'].includes(type) ? 0 : null; };

export function compare(a, b, op, unsigned = false, {fault: createFault = fault, isReference = reference} = {}) {
  if (isReference(a) || isReference(b) || a === null || b === null) {
    const equal = a === b || isReference(a) && isReference(b) && a.h === b.h && a.g === b.g;
    if (op === 'eq') return equal;
    if (op === 'ne') return !equal;
    if (unsigned && op === 'gt' && b === null) return a !== null;
    throw createFault('InvalidProgramException', 'Invalid reference comparison');
  }
  if (!isNumber(a) || !isNumber(b)) throw createFault('InvalidProgramException', 'Numeric comparison expected');
  const floating = !!(a?.float || b?.float);
  a = number(a); b = number(b);
  if (floating && (Number.isNaN(a) || Number.isNaN(b))) return op === 'ne' || unsigned;
  if (!floating && typeof a === 'bigint' && typeof b === 'bigint') {
    a = int64Compare(a, b, unsigned);
    b = 0;
    unsigned = false;
  }
  if (unsigned && !floating) {
    a = typeof a === 'bigint' ? BigInt.asUintN(64, a) : a >>> 0;
    b = typeof b === 'bigint' ? BigInt.asUintN(64, b) : b >>> 0;
  }
  return {eq: () => a === b, ne: () => a !== b, gt: () => a > b, ge: () => a >= b, lt: () => a < b, le: () => a <= b}[op]();
}

export function binary(name, a, b, context = {}) {
  const {fault: createFault = fault, error: createError = error} = context;
  if (!isNumber(a) || !isNumber(b)) throw createFault('InvalidProgramException', 'Arithmetic requires numeric operands');
  const floating = !!(a?.float || b?.float), checked = name.includes('.ovf'), unsigned = name.endsWith('.un'), op = name.split('.')[0];
  a = number(a); b = number(b);
  if (floating) {
    if (!['add', 'sub', 'mul', 'div', 'rem'].includes(op) || checked || unsigned) throw createFault('InvalidProgramException', 'Invalid floating-point operation');
    return float({add: () => a + b, sub: () => a - b, mul: () => a * b, div: () => a / b, rem: () => a % b}[op]());
  }
  const wide = typeof a === 'bigint';
  if (typeof b === 'bigint' !== wide && !['shl', 'shr'].includes(op)) throw createFault('InvalidProgramException', 'Mismatched integer widths');
  if (wide) return int64Binary(name, a, b, context);
  if (checked) {
    let x = BigInt(a), y = BigInt(b), bits = 32;
    if (unsigned) { x = BigInt.asUintN(bits, x); y = BigInt.asUintN(bits, y); }
    if (['div', 'rem'].includes(op) && y === 0n) throw createFault('DivideByZeroException', 'Attempted to divide by zero');
    if (op === 'div' && !unsigned && x === -(1n << BigInt(bits - 1)) && y === -1n) throw createFault('OverflowException', 'Integer division overflow');
    const shift = y & BigInt(bits - 1);
    const value = {add: () => x + y, sub: () => x - y, mul: () => x * y, div: () => x / y, rem: () => x % y, and: () => x & y, or: () => x | y, xor: () => x ^ y, shl: () => x << shift, shr: () => x >> shift}[op]();
    if (checked && (value < (unsigned ? 0n : -(1n << BigInt(bits - 1))) || value > (unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n))) throw createFault('OverflowException', 'Checked arithmetic overflow');
    return Number(BigInt.asIntN(32, value));
  }
  if (unsigned) { a >>>= 0; b >>>= 0; }
  if (['div', 'rem'].includes(op) && b === 0) throw createFault('DivideByZeroException', 'Attempted to divide by zero');
  if (op === 'div' && !unsigned && a === -2147483648 && b === -1) throw createFault('OverflowException', 'Integer division overflow');
  switch (op) {
    case 'add': return (a + b) | 0;
    case 'sub': return (a - b) | 0;
    case 'mul': return Math.imul(a, b);
    case 'div': return (a / b) | 0;
    case 'rem': return (a % b) | 0;
    case 'and': return a & b;
    case 'or': return a | b;
    case 'xor': return a ^ b;
    case 'shl': return a << (b & 31);
    case 'shr': return unsigned ? (a >>> (b & 31)) | 0 : a >> (b & 31);
    default: throw createError('Unknown arithmetic opcode');
  }
}

export function unary(name, value, context = {}) {
  const {fault: createFault = fault, error: createError = error} = context;
  if (!isNumber(value)) throw createFault('InvalidProgramException', 'Numeric operand required');
  const raw = number(value);
  if (value?.float) {
    if (name === 'neg') return float(-raw);
    throw createError('not requires integer');
  }
  if (typeof raw === 'bigint') return int64Unary(name, raw, context);
  return name === 'neg' ? (-raw) | 0 : ~raw;
}

export function convert(name, value, {fault: createFault = fault, error: createError = error} = {}) {
  if (!isNumber(value)) throw createFault('InvalidProgramException', 'Numeric conversion required');
  const checked = name.includes('.ovf.'), unsignedSource = name.endsWith('.un'), target = name.replace(/^conv\.(ovf\.)?/, '').replace(/\.un$/, ''), raw = number(value);
  if (['r', 'r4', 'r8'].includes(target)) {
    const n = unsignedSource && !value?.float ? (typeof raw === 'bigint' ? BigInt.asUintN(64, raw) : raw >>> 0) : raw;
    return float(Number(n), target === 'r4' ? 'r4' : 'r8');
  }
  const bits = {i1: 8, u1: 8, i2: 16, u2: 16, i4: 32, u4: 32, i8: 64, u8: 64, i: 32, u: 32}[target], signed = target.startsWith('i');
  if (!bits) throw createError('Invalid conversion');
  // CIL F values are tagged. Direct callers can also supply bare host Numbers;
  // only values outside the signed/unsigned Int32 domain are treated as floats.
  // In particular, -1 and 0xffffffff remain integer bit patterns, never F values.
  const floating = !!value?.float || typeof raw === 'number' && (!Number.isInteger(raw) || raw < -2147483648 || raw > 4294967295);
  let n;
  if (floating) {
    if (checked) {
      if (!Number.isFinite(raw)) throw createFault('OverflowException', 'Non-finite integer conversion');
      n = BigInt(Math.trunc(raw));
    } else {
      // Pin unspecified ECMA overflow/NaN results to .NET 10: saturate 32/64-bit
      // targets; small targets first saturate to Int32 and then narrow below.
      // See docs/cil-numeric-conversions.md for the complete compatibility table.
      const saturationBits = Math.max(bits, 32), saturationSigned = bits < 32 || signed;
      const min = saturationSigned ? -(1n << BigInt(saturationBits - 1)) : 0n;
      const max = (1n << BigInt(saturationSigned ? saturationBits - 1 : saturationBits)) - 1n;
      n = Number.isNaN(raw) ? 0n : raw <= Number(min) ? min : raw >= Number(max) ? max : BigInt(Math.trunc(raw));
    }
  } else if (typeof raw === 'bigint') n = unsignedSource ? BigInt.asUintN(64, raw) : raw;
  else {
    // conv.u8 zero-extends an Int32 source. Checked conversions use the signed
    // source unless .un is explicit; an Int64 source already supplies 64 bits.
    n = BigInt(unsignedSource || !checked && target === 'u8' ? raw >>> 0 : raw);
  }
  if (checked && (n < (signed ? -(1n << BigInt(bits - 1)) : 0n) || n > (signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n))) throw createFault('OverflowException', 'Checked conversion overflow');
  n = signed ? BigInt.asIntN(bits, n) : BigInt.asUintN(bits, n);
  return bits === 64 ? BigInt.asIntN(64, n) : Number(n) | 0;
}

/** CLI storage locations narrow integers and round single precision on write/load. */
export function storage(value, type, context) {
  type = numericAliases[type] ?? type;
  const conversion = {sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', bool: 'u1', int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', float: 'r4', double: 'r8'}[type];
  return conversion ? convert('conv.' + conversion, value, context) : value;
}

export function indirect(value, name, context) {
  const suffix = name.split('.').at(-1);
  return ['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'r4', 'r8', 'i'].includes(suffix) ? convert('conv.' + suffix, value, context) : value;
}
