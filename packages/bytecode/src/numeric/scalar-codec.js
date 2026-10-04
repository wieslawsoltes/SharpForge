import {float} from './float.js';
import {number} from './numeric-values.js';
import {nativeInteger} from './native-int.js';
import {numericTypeName, integerType} from './numeric-types.js';
import {decimalBits, decimalFromBits} from './decimal-ops.js';
import {numericFault} from './checked.js';

/** JSON-compatible constants preserve widths, IEEE special values and Decimal scale. */
export function encodeScalar(value, type, context) {
  type = numericTypeName(type);
  if (type === 'decimal') return Object.freeze({scalar: type, value: Object.freeze(decimalBits(value, context))});
  const integer = integerType(type, context), raw = number(value);
  if (integer) {
    const normalized = integer.unsigned ? BigInt.asUintN(integer.bits, BigInt(raw)) : BigInt.asIntN(integer.bits, BigInt(raw));
    return Object.freeze({scalar: type, value: normalized.toString()});
  }
  if (type !== 'float' && type !== 'double') numericFault(context, 'InvalidProgramException', 'Unknown scalar constant type');
  return Object.freeze({scalar: type, value: Object.is(raw, -0) ? '-0' : String(raw)});
}

/** Decode once per source constant and ABI; the returned carriers are immutable. */
export function decodeScalar(constant, context = {}) {
  const invalid = () => numericFault(context, 'InvalidProgramException', 'Malformed scalar constant');
  if (!constant || typeof constant !== 'object' || typeof constant.scalar !== 'string') return invalid();
  const type = numericTypeName(constant.scalar), value = constant.value;
  if (type === 'decimal') return Array.isArray(value) ? decimalFromBits(value, context) : invalid();
  const integer = integerType(type, context);
  if (integer) {
    if (typeof value !== 'string' || value.length > 32 || !/^[-+]?\d+$/.test(value)) return invalid();
    const raw = BigInt(value), minimum = integer.unsigned ? 0n : -(1n << BigInt(integer.bits - 1));
    const maximum = (1n << BigInt(integer.unsigned ? integer.bits : integer.bits - 1)) - 1n;
    if (raw < minimum || raw > maximum) numericFault(context, 'OverflowException', 'Integer literal exceeds its declared width');
    return integer.native ? nativeInteger(raw, integer.bits) : integer.bits === 64 ? BigInt.asIntN(64, raw) : Number(raw) | 0;
  }
  if (!['float', 'double'].includes(type) || typeof value !== 'string' || value.length > 64 ||
      !/^(?:NaN|[-+]?Infinity|-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)$/.test(value)) return invalid();
  return float(Number(value), type === 'float' ? 'r4' : 'r8');
}
