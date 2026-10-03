import {convert} from './conversions.js';
import {number, isNumber} from './numeric-values.js';
import {float, floatBinary, floatCompare} from './float.js';
import {nativeInteger, isNativeInteger, nativeBinary} from './native-int.js';
import {uint32Binary, uint32Compare} from './uint32.js';
import {int64Binary, int64Compare, int64Unary} from './int64.js';
import {numericAliases, nativeIntegerBits} from './numeric-types.js';
import {isDecimal, decimalZero} from './decimal-ops.js';
import {numericFault} from './checked.js';

export {convert} from './conversions.js';
export {number, isNumber} from './numeric-values.js';
export {float} from './float.js';
export {nativeInteger, isNativeInteger} from './native-int.js';

const reference = value => value !== null && typeof value === 'object' &&
  Number.isInteger(value.h) && Number.isInteger(value.g);
const integerDefaults = new Set(['int', 'uint', 'short', 'ushort', 'byte', 'sbyte', 'char', 'bool']);
const comparisons = new Set(['eq', 'ne', 'gt', 'ge', 'lt', 'le']);
const indirectTargets = new Set(['i1', 'u1', 'i2', 'u2', 'i4', 'u4', 'i8', 'r4', 'r8', 'i']);
const storageTargets = Object.freeze({
  sbyte: 'i1', byte: 'u1', short: 'i2', ushort: 'u2', char: 'u2', bool: 'u1',
  int: 'i4', uint: 'u4', long: 'i8', ulong: 'u8', nint: 'i', nuint: 'u', float: 'r4', double: 'r8',
});

/** Defaults are stack values; native values retain ABI identity and Decimal retains scale. */
export function defaults(input, context) {
  const type = numericAliases[input] ?? input;
  if (type === 'decimal') return decimalZero;
  if (type === 'nint' || type === 'nuint') return nativeInteger(0, nativeIntegerBits(context));
  if (type === 'long' || type === 'ulong') return 0n;
  if (type === 'double') return float(0);
  if (type === 'float') return float(0, 'r4');
  return integerDefaults.has(type) ? 0 : null;
}

function nativeWidth(left, right, context) {
  if (isNativeInteger(left) && isNativeInteger(right) && left.nativeInt !== right.nativeInt) {
    numericFault(context, 'InvalidProgramException', 'Mismatched native integer ABIs');
  }
  return isNativeInteger(left) ? left.nativeInt : isNativeInteger(right) ? right.nativeInt : 0;
}

function compareReferences(left, right, operation, unsigned, context) {
  const isReference = context.isReference ?? reference;
  const sameOwner = left?.heapOwner === undefined || right?.heapOwner === undefined || left.heapOwner === right.heapOwner;
  const equal = left === right || isReference(left) && isReference(right) &&
    left.h === right.h && left.g === right.g && sameOwner;
  if (operation === 'eq') return equal;
  if (operation === 'ne') return !equal;
  if (unsigned && operation === 'gt' && right === null) return left !== null;
  numericFault(context, 'InvalidProgramException', 'Invalid reference comparison');
}

function compareOrder(order, operation) {
  switch (operation) {
    case 'eq': return order === 0;
    case 'ne': return order !== 0;
    case 'gt': return order > 0;
    case 'ge': return order >= 0;
    case 'lt': return order < 0;
    case 'le': return order <= 0;
    default: throw new TypeError('Unknown comparison');
  }
}

/** Category dispatcher for ordered/unordered numeric comparisons and managed reference identity. */
export function compare(left, right, operation, unsigned = false, context = {}) {
  if (!comparisons.has(operation)) numericFault(context, 'InvalidProgramException', 'Invalid comparison operation');
  const isReference = context.isReference ?? reference;
  if (isReference(left) || isReference(right) || left === null || right === null) {
    return compareReferences(left, right, operation, unsigned, context);
  }
  if (!isNumber(left) || !isNumber(right)) numericFault(context, 'InvalidProgramException', 'Numeric comparison expected');
  const floating = !!(left?.float || right?.float);
  const bits = nativeWidth(left, right, context);
  if (bits && (floating || typeof left === 'bigint' || typeof right === 'bigint')) {
    numericFault(context, 'InvalidProgramException', 'Mismatched numeric comparison categories');
  }
  let first = number(left);
  let second = number(right);
  if (bits === 64) {
    first = BigInt(first);
    second = BigInt(second);
  }
  if (typeof first !== typeof second) {
    numericFault(context, 'InvalidProgramException', 'Mismatched numeric comparison categories');
  }
  if (floating) return floatCompare(first, second, operation, unsigned);
  if (!unsigned && (Number.isNaN(first) || Number.isNaN(second))) return operation === 'ne';
  const order = typeof first === 'bigint' ? int64Compare(first, second, unsigned) :
    unsigned ? uint32Compare(first, second) : first < second ? -1 : first > second ? 1 : 0;
  return compareOrder(order, operation);
}

/** Dispatch arithmetic by stack category without allocating per-operation closures or maps. */
export function binary(name, left, right, context = {}) {
  if (!isNumber(left) || !isNumber(right)) {
    numericFault(context, 'InvalidProgramException', 'Arithmetic requires numeric operands');
  }
  const floating = !!(left?.float || right?.float);
  const bits = nativeWidth(left, right, context);
  const shifting = name.startsWith('shl') || name.startsWith('shr');
  if (bits && (typeof left === 'bigint' || typeof right === 'bigint') && !shifting) {
    numericFault(context, 'InvalidProgramException', 'Native int and Int64 require an explicit conversion');
  }
  const first = number(left);
  const second = number(right);
  if (floating) {
    if (typeof first !== 'number' || typeof second !== 'number' || bits) {
      numericFault(context, 'InvalidProgramException', 'Mismatched floating-point operands');
    }
    return floatBinary(name, left, right, context);
  }
  const wide = typeof first === 'bigint';
  if (!bits && (typeof second === 'bigint') !== wide && !shifting) {
    numericFault(context, 'InvalidProgramException', 'Mismatched integer widths');
  }
  if (bits) {
    const selected = context.nativeIntBits === bits ? context : {...context, nativeIntBits: bits};
    return nativeBinary(name, first, second, selected);
  }
  return wide ? int64Binary(name, first, second, context) : uint32Binary(name, first, second, context);
}

/** Integer unary operations wrap; floating negation preserves Single/Double and signed zero. */
export function unary(name, value, context = {}) {
  if (!isNumber(value)) numericFault(context, 'InvalidProgramException', 'Numeric operand required');
  if (name !== 'neg' && name !== 'not') {
    if (context.error) throw context.error('Unknown unary opcode');
    numericFault(context, 'CilError', 'Unknown unary opcode');
  }
  const raw = number(value);
  if (value?.float) {
    if (name === 'neg') return float(-raw, value.float);
    if (context.error) throw context.error('not requires integer');
    numericFault(context, 'CilError', 'not requires integer');
  }
  const result = typeof raw === 'bigint' ? int64Unary(name, raw, context) : name === 'neg' ? (-raw) | 0 : ~raw;
  return isNativeInteger(value) ? nativeInteger(result, value.nativeInt) : result;
}

/** Storage narrows integers and rounds Single; nonnumeric values pass to their owning adapter. */
export function storage(value, input, context) {
  const type = numericAliases[input] ?? input;
  if (typeof value === 'boolean' && type === 'bool') return value ? 1 : 0;
  if ((type === 'nint' || type === 'nuint') && isNativeInteger(value) && context?.nativeIntBits === undefined) {
    context = {...context, nativeIntBits: value.nativeInt};
  }
  if (type === 'decimal') {
    if (!isDecimal(value)) numericFault(context, 'InvalidProgramException', 'Decimal storage requires a Decimal value');
    return value;
  }
  const conversion = storageTargets[type];
  return conversion ? convert('conv.' + conversion, value, context) : value;
}

/** Indirect opcode suffixes specify the load signedness, including native-width storage. */
export function indirect(value, name, context) {
  const suffix = name.split('.').at(-1);
  return indirectTargets.has(suffix) ? convert('conv.' + suffix, value, context) : value;
}
