import {decimalZero, isDecimal, decimal} from './decimal.js';
import {
  float, floatBinary, floatCompare, int64Binary, int64Compare, int64Unary,
  uint32Binary, uint32Compare, smallInteger, smallIntegerIndirect, convert, number, isNumber
} from '@sharpforge/bytecode';
import {isNativeInteger, nativeInteger, nativeIntegerBits, nativeBinary, nativeOperandBits, isNativeStorageType, isNativeNull} from './native-int.js';
export {float, convert, number, isNumber} from '@sharpforge/bytecode';

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
const smallStorageTypes = new Set(['sbyte', 'byte', 'short', 'ushort', 'char', 'bool']);
const smallIndirectSuffixes = new Set(['i1', 'u1', 'i2', 'u2']);

const numericAliases = {'System.SByte': 'sbyte', 'System.Byte': 'byte', 'System.Int16': 'short', 'System.UInt16': 'ushort', 'System.Char': 'char', 'System.Boolean': 'bool', 'System.Int32': 'int', 'System.UInt32': 'uint', 'System.Int64': 'long', 'System.UInt64': 'ulong', 'System.Single': 'float', 'System.Double': 'double', 'System.IntPtr':'nint', 'System.UIntPtr':'nuint', 'System.Decimal':'decimal'};
export const defaults = (input, context) => { const type=numericAliases[input]??input; return type === 'decimal' ? decimalZero : type === 'nint' || type === 'nuint' ? nativeInteger(0, nativeIntegerBits(context)) : type === 'long' || type === 'ulong' ? 0n : type === 'double' ? float(0) : type === 'float' ? float(0, 'r4') : ['int', 'uint', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool', 'nint', 'nuint'].includes(type) ? 0 : null; };

export function compare(a, b, op, unsigned = false, context = {}, branch = false) {
  const {fault: createFault = fault, isReference = reference} = context;
  if (isReference(a) || isReference(b) || a === null || b === null) {
    const equal = a === b || a === null && isNativeNull(b, context) || b === null && isNativeNull(a, context) ||
      isReference(a) && isReference(b) && a.h === b.h && a.g === b.g;
    if (op === 'eq') return equal;
    if (op === 'ne') return !equal;
    if (unsigned && op === 'gt' && b === null) return !equal;
    throw createFault('InvalidProgramException', 'Invalid reference comparison');
  }
  if (!isNumber(a) || !isNumber(b)) throw createFault('InvalidProgramException', 'Numeric comparison expected');
  if (isNativeInteger(a) || isNativeInteger(b)) {
    const bits = nativeOperandBits(a, b, context);
    // CoreCLR branches use unsigned widening; ceq/cgt/clt widen signed first.
    const unsignedWiden = branch && unsigned && bits === 64;
    a = unsignedWiden && !isNativeInteger(a) ? a >>> 0 : number(a);
    b = unsignedWiden && !isNativeInteger(b) ? b >>> 0 : number(b);
    if (bits === 64) { a = BigInt(a); b = BigInt(b); }
  }
  const floating = !!(a?.float || b?.float);
  if (floating) return floatCompare(a, b, op, unsigned);
  a = number(a); b = number(b);
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    a = int64Compare(a, b, unsigned);
    b = 0;
    unsigned = false;
  } else if (unsigned && !floating && typeof a === 'number' && typeof b === 'number') {
    a = uint32Compare(a, b);
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
  const shift = op === 'shl' || op === 'shr';
  if (shift && isNativeInteger(b) && !isNativeInteger(a)) {
    nativeOperandBits(b, 0, context);
    b = Number(BigInt(number(b)) & 63n);
  } else if (isNativeInteger(a) || isNativeInteger(b)) {
    const bits = nativeOperandBits(a, b, context, shift);
    const left = unsigned && bits === 64 && !isNativeInteger(a) ? a >>> 0 : number(a);
    const right = unsigned && bits === 64 && !isNativeInteger(b) ? b >>> 0 : number(b);
    return nativeBinary(name, left, right, context.nativeIntBits === bits ? context : {...context, nativeIntBits: bits});
  }
  if (floating) {
    if (!['add', 'sub', 'mul', 'div', 'rem'].includes(op) || checked || unsigned) throw createFault('InvalidProgramException', 'Invalid floating-point operation');
    return floatBinary(op, a, b, {fault: createFault});
  }
  a = number(a); b = number(b);
  const wide = typeof a === 'bigint';
  if (typeof b === 'bigint' !== wide && !['shl', 'shr'].includes(op)) throw createFault('InvalidProgramException', 'Mismatched integer widths');
  if (wide) return int64Binary(name, a, b, context);
  if (unsigned || !checked && (op === 'add' || op === 'sub' || op === 'mul')) {
    return uint32Binary(name, a, b, context);
  }
  if (checked) {
    let x = BigInt(a), y = BigInt(b), bits = 32;
    if (['div', 'rem'].includes(op) && y === 0n) throw createFault('DivideByZeroException', 'Attempted to divide by zero');
    if ((op === 'div' || op === 'rem') && !unsigned && x === -(1n << BigInt(bits - 1)) && y === -1n) {
      throw createFault('OverflowException', 'Integer division overflow');
    }
    const shift = y & BigInt(bits - 1);
    const value = {add: () => x + y, sub: () => x - y, mul: () => x * y, div: () => x / y, rem: () => x % y, and: () => x & y, or: () => x | y, xor: () => x ^ y, shl: () => x << shift, shr: () => x >> shift}[op]();
    if (checked && (value < (unsigned ? 0n : -(1n << BigInt(bits - 1))) || value > (unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n))) throw createFault('OverflowException', 'Checked arithmetic overflow');
    return Number(BigInt.asIntN(32, value));
  }
  if (['div', 'rem'].includes(op) && b === 0) throw createFault('DivideByZeroException', 'Attempted to divide by zero');
  if ((op === 'div' || op === 'rem') && !unsigned && a === -2147483648 && b === -1) {
    throw createFault('OverflowException', 'Integer division overflow');
  }
  switch (op) {
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
    if (name === 'neg') return float(-raw, value.float);
    throw createError('not requires integer');
  }
  if (isNativeInteger(value)) {
    nativeOperandBits(value, 0, context);
    return nativeInteger(name === 'neg' ? -BigInt(raw) : ~BigInt(raw), value.nativeInt);
  }
  if (typeof raw === 'bigint') return int64Unary(name, raw, context);
  return name === 'neg' ? (-raw) | 0 : ~raw;
}

/** CLI storage locations narrow integers and round single precision on write/load. */
export function storage(value, type, context) {
  type = numericAliases[type] ?? type;
  if (type === 'decimal') {
    if (!isDecimal(value)) throw (context?.fault ?? fault)('InvalidProgramException', 'Decimal storage requires a Decimal value');
    return Object.isFrozen(value) ? value : decimal(value.coefficient, value.scale, value.negative, context);
  }
  if (value?.methodPointer && isNativeStorageType(type)) return value;
  if (context === undefined && isNativeInteger(value)) context = {nativeIntBits: value.nativeInt};
  if (type === 'bool' && typeof value === 'boolean') return value ? 1 : 0;
  if (smallStorageTypes.has(type) &&
      (typeof value === 'bigint' || Number.isInteger(value))) return smallInteger(value, type, context);
  const conversion = {sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', bool: 'u1', int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', float: 'r4', double: 'r8', nint: 'i', nuint: 'u'}[type];
  return conversion ? convert('conv.' + conversion, value, context) : value;
}

export function indirect(value, name, context) {
  const suffix = name.split('.').at(-1);
  if (suffix === 'i' && value?.methodPointer) return value;
  if (smallIndirectSuffixes.has(suffix) &&
      (typeof value === 'bigint' || Number.isInteger(value))) return smallIntegerIndirect(value, suffix, context);
  return ['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'r4', 'r8', 'i'].includes(suffix) ? convert('conv.' + suffix, value, context) : value;
}
