import {nativeInteger, isNativeInteger, nativeBinary} from './native-int.js';
export {nativeInteger, isNativeInteger} from './native-int.js';
import {uint32Binary} from './uint32.js';
import {smallIntegerIndirect} from './small-int.js';
import {int64Binary, int64Unary} from './int64.js';
import {numericAliases,nativeIntegerBits} from './numeric-types.js';
import {isDecimal,decimalZero,decimalToInteger,decimalToFloat} from './decimal-ops.js';

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

export const float = (value, kind = 'r8') => {if(kind!=='r4'&&kind!=='r8')throw new TypeError('Invalid floating-point kind');return Object.freeze({float: kind, value: kind === 'r4' ? Math.fround(value) : Number(value)});};
export const number = value => value?.float||isNativeInteger(value) ? value.value : value;
export const isNumber = value => typeof value === 'number' || typeof value === 'bigint' || !!value?.float || isNativeInteger(value);
export const defaults = (input,context) => { const type=numericAliases[input]??input; return type==='decimal'?decimalZero:type==='nint'||type==='nuint'?nativeInteger(0,nativeIntegerBits(context)):type === 'long' || type === 'ulong' ? 0n : type === 'double' ? float(0) : type === 'float' ? float(0, 'r4') : ['int', 'uint', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool'].includes(type) ? 0 : null; };

export function compare(a, b, op, unsigned = false, {fault: createFault = fault, isReference = reference} = {}) {
  if(!['eq','ne','gt','ge','lt','le'].includes(op))throw createFault('InvalidProgramException','Invalid comparison operation');
  if (isReference(a) || isReference(b) || a === null || b === null) {
    const equal = a === b || isReference(a) && isReference(b) && a.h === b.h && a.g === b.g && (a.heapOwner===undefined||b.heapOwner===undefined||a.heapOwner===b.heapOwner);
    if (op === 'eq') return equal;
    if (op === 'ne') return !equal;
    if (unsigned && op === 'gt' && b === null) return a !== null;
    throw createFault('InvalidProgramException', 'Invalid reference comparison');
  }
  if (!isNumber(a) || !isNumber(b)) throw createFault('InvalidProgramException', 'Numeric comparison expected');
  const floating = !!(a?.float || b?.float),nativeBits=isNativeInteger(a)?a.nativeInt:isNativeInteger(b)?b.nativeInt:0;
  if(isNativeInteger(a)&&isNativeInteger(b)&&a.nativeInt!==b.nativeInt)throw createFault('InvalidProgramException','Mismatched native integer ABIs');
  if(nativeBits&&(floating||typeof a==='bigint'||typeof b==='bigint'))throw createFault('InvalidProgramException','Mismatched numeric comparison categories');
  a = number(a); b = number(b);
  if(nativeBits===64){a=BigInt(a);b=BigInt(b);}
  if(typeof a!==typeof b)throw createFault('InvalidProgramException','Mismatched numeric comparison categories');
  if (floating && (Number.isNaN(a) || Number.isNaN(b))) return op === 'ne' || unsigned;
  if (unsigned && !floating) {
    a = typeof a === 'bigint' ? BigInt.asUintN(64, a) : a >>> 0;
    b = typeof b === 'bigint' ? BigInt.asUintN(64, b) : b >>> 0;
  }
  return {eq: () => a === b, ne: () => a !== b, gt: () => a > b, ge: () => a >= b, lt: () => a < b, le: () => a <= b}[op]();
}

export function binary(name, a, b, {fault: createFault = fault, error: createError = error} = {}) {
  if (!isNumber(a) || !isNumber(b)) throw createFault('InvalidProgramException', 'Arithmetic requires numeric operands');
  const floating = !!(a?.float || b?.float),floatKind=a?.float==='r4'&&b?.float==='r4'?'r4':'r8',nativeBits=isNativeInteger(a)?a.nativeInt:isNativeInteger(b)?b.nativeInt:0,checked = name.includes('.ovf'), unsigned = name.endsWith('.un'), op = name.split('.')[0];
  if(isNativeInteger(a)&&isNativeInteger(b)&&a.nativeInt!==b.nativeInt)throw createFault('InvalidProgramException','Mismatched native integer ABIs');
  if(nativeBits&&(typeof a==='bigint'||typeof b==='bigint')&&!['shl','shr'].includes(op))throw createFault('InvalidProgramException','Native int and Int64 require an explicit conversion');
  a = number(a); b = number(b);
  if (floating) {
    if (!['add', 'sub', 'mul', 'div', 'rem'].includes(op) || checked || unsigned) throw createFault('InvalidProgramException', 'Invalid floating-point operation');
    if(typeof a!=='number'||typeof b!=='number'||nativeBits)throw createFault('InvalidProgramException','Mismatched floating-point operands');
    return float({add: () => a + b, sub: () => a - b, mul: () => a * b, div: () => a / b, rem: () => a % b}[op](),floatKind);
  }
  const wide = typeof a === 'bigint';
  if (!nativeBits&&typeof b === 'bigint' !== wide && !['shl', 'shr'].includes(op)) throw createFault('InvalidProgramException', 'Mismatched integer widths');
  if (wide && !nativeBits) return int64Binary(name, a, b, {fault: createFault, error: createError});
  if (nativeBits) return nativeBinary(name, a, b, {nativeIntBits: nativeBits, fault: createFault, error: createError});
  return uint32Binary(name, a, b, {fault: createFault, error: createError});
}

export function unary(name, value, {fault: createFault = fault, error: createError = error} = {}) {
  if (!isNumber(value)) throw createFault('InvalidProgramException', 'Numeric operand required');
  if(name!=='neg'&&name!=='not')throw createError('Unknown unary opcode');
  const raw = number(value);
  if (value?.float) {
    if (name === 'neg') return float(-raw,value.float);
    throw createError('not requires integer');
  }
  const result=typeof raw === 'bigint' ? int64Unary(name, raw) : name === 'neg' ? (-raw) | 0 : ~raw;
  return isNativeInteger(value)?nativeInteger(result,value.nativeInt):result;
}

export function convert(name, value, context = {}) {
  const {fault: createFault = fault, error: createError = error}=context;
  if (!isNumber(value)&&!isDecimal(value)) throw createFault('InvalidProgramException', 'Numeric conversion required');
  const checked = name.includes('.ovf.'), unsignedSource = name.endsWith('.un'), target = name.replace(/^conv\.(ovf\.)?/, '').replace(/\.un$/, ''), raw = number(value);
  if (['r', 'r4', 'r8'].includes(target)) {
    if(isDecimal(value))return float(decimalToFloat(value,target==='r4'?'r4':'r8',context),target==='r4'?'r4':'r8');
    const n = unsignedSource && !value?.float ? (typeof raw === 'bigint' ? BigInt.asUintN(64, raw) : raw >>> 0) : raw;
    return float(Number(n), target === 'r4' ? 'r4' : 'r8');
  }
  const nativeTarget=target==='i'||target==='u',bits = {i1: 8, u1: 8, i2: 16, u2: 16, i4: 32, u4: 32, i8: 64, u8: 64, i: nativeIntegerBits(context), u: nativeIntegerBits(context)}[target], signed = target.startsWith('i');
  if (!bits) throw createError('Invalid conversion');
  if(isDecimal(value)) {
    const n=decimalToInteger(value,{...context,bits,unsigned:!signed});
    return nativeTarget?nativeInteger(n,bits):bits===64?BigInt.asIntN(64,BigInt(n)):Number(n)|0;
  }
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
    n = BigInt(unsignedSource || !checked && (target === 'u8'||target==='u'&&bits===64) ? raw >>> 0 : raw);
  }
  if (checked && (n < (signed ? -(1n << BigInt(bits - 1)) : 0n) || n > (signed ? (1n << BigInt(bits - 1)) - 1n : (1n << BigInt(bits)) - 1n))) throw createFault('OverflowException', 'Checked conversion overflow');
  if (bits < 32) return smallIntegerIndirect(n, target, context);
  n = signed ? BigInt.asIntN(bits, n) : BigInt.asUintN(bits, n);
  return nativeTarget?nativeInteger(n,bits):bits === 64 ? BigInt.asIntN(64, n) : Number(n) | 0;
}

/** CLI storage locations narrow integers and round single precision on write/load. */
export function storage(value, type, context) {
  if(typeof value==='boolean'&&(type==='bool'||type==='System.Boolean'))return value?1:0;
  type = numericAliases[type] ?? type;
  if((type==='nint'||type==='nuint')&&isNativeInteger(value)&&context?.nativeIntBits===undefined)context={...context,nativeIntBits:value.nativeInt};
  if(type==='decimal'){if(!isDecimal(value))throw (context?.fault??fault)('InvalidProgramException','Decimal storage requires a Decimal value');return value;}
  const conversion = {sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', bool: 'u1', int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', nint:'i',nuint:'u',float: 'r4', double: 'r8'}[type];
  return conversion ? convert('conv.' + conversion, value, context) : value;
}

export function indirect(value, name, context) {
  const suffix = name.split('.').at(-1);
  return ['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'r4', 'r8', 'i'].includes(suffix) ? convert('conv.' + suffix, value, context) : value;
}
