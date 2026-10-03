import {numericFault} from './checked.js';

/** Frozen CLI F value with a declared Single/Double storage precision. */
export function float(value, kind = 'r8') {
  if (kind !== 'r4' && kind !== 'r8') throw new TypeError('Invalid floating-point kind');
  return Object.freeze({float: kind, value: kind === 'r4' ? Math.fround(value) : Number(value)});
}

const raw = value => value?.float ? value.value : value;

/** Arithmetic preserves r4 when both operands are Single, including signed zero. */
export function floatBinary(name, left, right, context = {}) {
  const kind = context.kind ?? (left?.float === 'r4' && right?.float === 'r4' ? 'r4' : 'r8');
  const first = raw(left);
  const second = raw(right);
  let result;
  switch (name) {
    case 'add': result = first + second; break;
    case 'sub': result = first - second; break;
    case 'mul': result = first * second; break;
    case 'div': result = first / second; break;
    // CLI rem uses truncated quotient (fmod), not IEEE nearest-even remainder.
    case 'rem': result = first % second; break;
    default: numericFault(context, 'InvalidProgramException', 'Invalid floating-point operation');
  }
  return float(result, kind);
}

/** Unordered CLI comparisons select true for .un; ordinary comparisons select false. */
export function floatCompare(left, right, operation, unsigned = false) {
  const first = raw(left);
  const second = raw(right);
  if (Number.isNaN(first) || Number.isNaN(second)) return operation === 'ne' || unsigned;
  switch (operation) {
    case 'eq': return first === second;
    case 'ne': return first !== second;
    case 'lt': return first < second;
    case 'le': return first <= second;
    case 'gt': return first > second;
    case 'ge': return first >= second;
    default: throw new TypeError('Invalid floating comparison');
  }
}

/** ckfinite returns its original width-tagged value or a managed arithmetic fault. */
export function finiteFloat(value, context) {
  if (!value?.float || !Number.isFinite(value.value)) {
    numericFault(context, 'ArithmeticException', 'Non-finite floating-point value');
  }
  return value;
}

/** System.Math.IEEERemainder uses the nearest integer quotient, with ties to even. */
export function ieeeRemainder(left, right) {
  const first = raw(left);
  const second = raw(right);
  if (Number.isNaN(first)) return first;
  if (Number.isNaN(second)) return second;
  const remainder = first % second;
  if (Number.isNaN(remainder)) return NaN;
  if (remainder === 0) return first < 0 || Object.is(first, -0) ? -0 : 0;
  const alternative = remainder - Math.abs(second) * Math.sign(first);
  const distance = Math.abs(alternative) - Math.abs(remainder);
  if (distance < 0) return alternative;
  if (distance > 0) return remainder;
  const quotient = first / second;
  const lower = Math.floor(quotient);
  const nearest = quotient - lower === 0.5 ? (lower % 2 === 0 ? lower : lower + 1) : Math.round(quotient);
  return Math.abs(nearest) > Math.abs(quotient) ? alternative : remainder;
}
