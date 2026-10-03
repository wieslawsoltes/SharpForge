/**
 * The numeric type lattice (SF-A02-T01.1): every integral width, char, float, double, decimal and the native
 * integers, with the implicit and explicit numeric conversion tables and unary/binary numeric promotion (C# spec
 * 10.2.3, 10.3.2, 12.4.7). Types are named by their C# keyword ("numeric kind"); `numericKind(type)` maps a TypeSymbol.
 *
 *   byte + byte        -> int          uint + int   -> long          ulong + int  -> no operator (CS0034)
 *   -uint              -> long         -ulong       -> no operator (CS0023)
 */
import { specialTypeKeyword } from '../symbols/types.js';

/** Every numeric kind, in the order the promotion rules consider them. */
export const numericKinds = Object.freeze([
  'sbyte',
  'byte',
  'short',
  'ushort',
  'int',
  'uint',
  'long',
  'ulong',
  'nint',
  'nuint',
  'char',
  'float',
  'double',
  'decimal',
]);
const integral = new Set(['sbyte', 'byte', 'short', 'ushort', 'int', 'uint', 'long', 'ulong', 'nint', 'nuint', 'char']);
const signed = new Set(['sbyte', 'short', 'int', 'long', 'nint']);
const small = new Set(['sbyte', 'byte', 'short', 'ushort', 'char']);
/** Bit width of an integral kind (native integers are 64-bit on this profile's reference platform). */
export const integralBits = Object.freeze({
  sbyte: 8,
  byte: 8,
  short: 16,
  ushort: 16,
  char: 16,
  int: 32,
  uint: 32,
  long: 64,
  ulong: 64,
  nint: 64,
  nuint: 64,
});
export const isNumericKind = kind => numericKinds.includes(kind);
export const isIntegralKind = kind => integral.has(kind);
export const isSignedKind = kind => signed.has(kind);
export const isFloatingKind = kind => kind === 'float' || kind === 'double';
/** [min,max] of an integral kind as BigInt. */
export function integralRange(kind) {
  const bits = BigInt(integralBits[kind]);
  return signed.has(kind) ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n] : [0n, (1n << bits) - 1n];
}

const implicit = Object.freeze({
  sbyte: ['short', 'int', 'long', 'float', 'double', 'decimal', 'nint'],
  byte: ['short', 'ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal', 'nint', 'nuint'],
  short: ['int', 'long', 'float', 'double', 'decimal', 'nint'],
  ushort: ['int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal', 'nint', 'nuint'],
  int: ['long', 'float', 'double', 'decimal', 'nint'],
  uint: ['long', 'ulong', 'float', 'double', 'decimal', 'nuint'],
  long: ['float', 'double', 'decimal'],
  ulong: ['float', 'double', 'decimal'],
  nint: ['long', 'float', 'double', 'decimal'],
  nuint: ['ulong', 'float', 'double', 'decimal'],
  char: ['ushort', 'int', 'uint', 'long', 'ulong', 'float', 'double', 'decimal', 'nint', 'nuint'],
  float: ['double'],
  double: [],
  decimal: [],
});
/** The numeric kind of a type symbol ('int', 'nuint', ...), or null for non-numeric types (bool, enums, ...). */
export function numericKind(type) {
  if (!type) return null;
  if (type.isNativeInteger) return type.specialType === 'System_UIntPtr' ? 'nuint' : 'nint';
  const keyword = specialTypeKeyword(type.specialType);
  return keyword && isNumericKind(keyword) ? keyword : null;
}
/** True when an implicit numeric conversion exists from `from` to `to` (identity is not a numeric conversion). */
export const implicitNumericConversion = (from, to) => from !== to && !!implicit[from]?.includes(to);
/** True when only an explicit numeric conversion exists from `from` to `to`. */
export const explicitNumericConversion = (from, to) =>
  from !== to && isNumericKind(from) && isNumericKind(to) && !implicit[from].includes(to);
/** The implicit numeric conversion targets of a kind. */
export const implicitNumericTargets = kind => implicit[kind] ?? [];

const fits = (constant, kind) =>
  constant !== undefined &&
  constant !== null &&
  isIntegralKind(kind) &&
  (() => {
    try {
      const v = BigInt(constant),
        [lo, hi] = integralRange(kind);
      return v >= lo && v <= hi;
    } catch {
      return false;
    }
  })();
/**
 * Binary numeric promotion: the operand type of the predefined operator chosen for two numeric operands, or null when
 * no operator applies (decimal with float/double; ulong or nuint with a signed operand) - CS0034 for arithmetic, CS0019
 * otherwise. `leftConstant`/`rightConstant` are the integral values of constant operands: an int constant that fits
 * the other operand's unsigned type converts to it, so `ulong + 1` is ulong and `uint + 1` is uint.
 */
export function binaryNumericPromotion(left, right, { leftConstant, rightConstant } = {}) {
  if (!isNumericKind(left) || !isNumericKind(right)) return null;
  const either = k => left === k || right === k,
    other = k => (left === k ? right : left),
    otherConstant = k => (left === k ? rightConstant : leftConstant);
  if (either('decimal')) return either('float') || either('double') ? null : 'decimal';
  if (either('double')) return 'double';
  if (either('float')) return 'float';
  if (either('ulong')) {
    const o = other('ulong');
    return signed.has(o) && !fits(otherConstant('ulong'), 'ulong') ? null : 'ulong';
  }
  if (either('nuint')) {
    const o = other('nuint');
    if (o === 'nuint') return 'nuint';
    if (signed.has(o)) return fits(otherConstant('nuint'), 'uint') ? 'nuint' : null;
    return 'nuint';
  }
  if (either('long')) return 'long';
  if (either('uint')) {
    const o = other('uint');
    if (o === 'nint') return 'long';
    return signed.has(o) && !fits(otherConstant('uint'), 'uint') ? 'long' : 'uint';
  }
  if (either('nint')) return 'nint';
  return 'int';
}
/**
 * Unary numeric promotion for `+`, `-` and `~`: small types widen to int; `-` on uint gives long and has no operator
 * on ulong/nuint; `~` is integral only. Returns null when no predefined operator exists (CS0023).
 */
export function unaryNumericPromotion(operator, kind) {
  if (!isNumericKind(kind)) return null;
  if (operator === '~') return !isIntegralKind(kind) ? null : small.has(kind) ? 'int' : kind;
  if (small.has(kind)) return 'int';
  if (operator === '-') return kind === 'uint' ? 'long' : kind === 'ulong' || kind === 'nuint' ? null : kind;
  return kind;
}
/** The left operand type of a shift (`x << n`): int, uint, long, ulong, nint or nuint; the count is always int. */
export function shiftPromotion(kind) {
  return !isIntegralKind(kind) ? null : small.has(kind) ? 'int' : kind;
}
/** The type `++`/`--` computes in (the operand's own type for every numeric kind). */
export const incrementKind = kind => (isNumericKind(kind) ? kind : null);
/** Wraps a BigInt into the range of an integral kind (unchecked conversion). */
export function wrapIntegral(value, kind) {
  const bits = integralBits[kind];
  return signed.has(kind) ? BigInt.asIntN(bits, value) : BigInt.asUintN(bits, value);
}
