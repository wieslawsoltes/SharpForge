import {
  numericTypeName, integerType, nativeInteger, isDecimal, decimalFromInteger, decimalFromFloat,
  decimalToInteger, decimalToFloat, decimalBinary, decimalNegate
} from '@sharpforge/bytecode';
import {float, number, binary, compare, unary, convert, storage} from './numeric-ops.js';
import {ManagedFault} from '../heap.js';

const operations = {'+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'rem', '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'shr', '>>>': 'shr'};
const comparisons = {'==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge'};
const conversions = {
  sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', nint: 'i',
  nuint: 'u', float: 'r4', double: 'r8'
};
const unwrap = value => value?.enumType ? value.value : number(value);
const invalid = message => { throw new ManagedFault('InvalidProgramException', message); };
const contexts = new WeakMap();

export function sourceNumericContext(vm) {
  let context = contexts.get(vm);
  if (!context) {
    context = Object.freeze({nativeIntBits: vm.options?.nativeIntBits ?? 32, fault: (name, message) => new ManagedFault(name, message)});
    contexts.set(vm, context);
  }
  return context;
}

/** Declared source signedness controls widening, even when the stack carries signed bit patterns. */
export function scalarConvert(value, from, to, checked = false, context = {}) {
  from = numericTypeName(from);
  to = numericTypeName(to);
  const source = integerType(from, context), target = integerType(to, context);
  if (to === 'decimal') {
    if (isDecimal(value)) return value;
    if (source) return decimalFromInteger(unwrap(value), source.unsigned, source.bits, context);
    if (from === 'float' || from === 'double') return decimalFromFloat(unwrap(value), from === 'float' ? 'r4' : 'r8', context);
    return invalid('Invalid Decimal conversion');
  }
  if (isDecimal(value)) {
    if (target) {
      const integer = decimalToInteger(value, {...context, bits: target.bits, unsigned: target.unsigned});
      return storage(integer, to, context);
    }
    if (to === 'float' || to === 'double') return float(decimalToFloat(value, to === 'float' ? 'r4' : 'r8', context), to === 'float' ? 'r4' : 'r8');
    return invalid('Invalid Decimal conversion');
  }
  if (!conversions[to] || !source && from !== 'float' && from !== 'double') return invalid('Unknown scalar conversion');
  let input;
  if (source) {
    const raw = unwrap(value);
    if (typeof raw !== 'bigint' && !Number.isInteger(raw)) return invalid('Integer scalar required');
    input = source.unsigned ? BigInt.asUintN(source.bits, BigInt(raw)) : BigInt.asIntN(source.bits, BigInt(raw));
  } else input = float(unwrap(value), from === 'float' ? 'r4' : 'r8');
  if (target) return convert('conv.' + (checked ? 'ovf.' : '') + conversions[to], input, context);
  return float(Number(number(input)), to === 'float' ? 'r4' : 'r8');
}

function normalize(value, type, context) {
  if (type === 'float' || type === 'double') {
    const kind = type === 'float' ? 'r4' : 'r8';
    return value?.float === kind ? value : float(unwrap(value), kind);
  }
  const raw = unwrap(value);
  if ((type === 'int' || type === 'uint') && typeof raw === 'number' && Number.isInteger(raw)) return raw | 0;
  if ((type === 'long' || type === 'ulong') && typeof raw === 'bigint') return BigInt.asIntN(64, raw);
  return storage(value, type, context);
}

/** Promoted source operators reuse the direct-CIL arithmetic and conversion helpers. */
export function scalarBinary(operator, left, right, type, checked = false, context = {}) {
  type = numericTypeName(type);
  if (type === 'decimal') return decimalBinary(operator, left, right, context);
  const integer = integerType(type, context), floating = type === 'float' || type === 'double';
  if (!integer && !floating) return invalid('Unknown scalar arithmetic type');
  left = normalize(left, type, context);
  right = ['<<', '>>', '>>>'].includes(operator) ? Number(unwrap(right)) | 0 : normalize(right, type, context);
  if (comparisons[operator]) return compare(left, right, comparisons[operator], !!integer?.unsigned, context);
  const operation = operations[operator];
  if (!operation || floating && ['&', '|', '^', '<<', '>>', '>>>'].includes(operator)) return invalid('Invalid scalar binary operator');
  const overflow = integer && checked && ['+', '-', '*'].includes(operator);
  const unsigned = integer && (integer.unsigned && ['/', '%', '>>'].includes(operator) || operator === '>>>' || overflow && integer.unsigned);
  return binary(operation + (overflow ? '.ovf' : '') + (unsigned ? '.un' : ''), left, right, context);
}

export function scalarUnary(operator, value, type, checked = false, context = {}) {
  type = numericTypeName(type);
  if (type === 'decimal') return operator === '-' ? decimalNegate(value, context) : operator === '+' ? value : invalid('Invalid Decimal unary operator');
  const integer = integerType(type, context), prepared = storage(value, type, context);
  if (operator === '+') return prepared;
  if (operator === '~') return integer ? unary('not', prepared, context) : invalid('Bitwise complement requires an integer');
  if (operator !== '-') return invalid('Invalid scalar unary operator');
  if (checked && integer) {
    const zero = integer.native ? nativeInteger(0, integer.bits) : integer.bits === 64 ? 0n : 0;
    return binary(integer.unsigned ? 'sub.ovf.un' : 'sub.ovf', zero, prepared, context);
  }
  return unary('neg', prepared, context);
}
