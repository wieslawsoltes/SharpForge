/**
 * Native integers nint and nuint (SF-A02-T01.6; C# 9 feature "native-sized integers", C# 11 numeric IntPtr).
 *
 * In C# 9 and 10 nint/nuint are distinct views of System.IntPtr/System.UIntPtr: the keywords have the predefined
 * numeric conversions and operators, the plain structs do not, and an identity conversion links each pair.
 * From C# 11 (when the runtime supports numeric IntPtr) `nint` *is* System.IntPtr, so the structs get the operators
 * and conversions too. Constants: a native-integer constant expression is folded only when its value fits 32 bits
 * (the size every platform has); otherwise the expression is not constant.
 */
import {
  implicitNumericConversion,
  explicitNumericConversion,
  numericKind,
  integralRange,
  binaryNumericPromotion,
  unaryNumericPromotion,
} from './numeric.js';

export const nativeIntegerFeature = Object.freeze({ name: 'native-sized integers', version: 9 });
export const numericIntPtrVersion = 11;
/** True for the IntPtr/UIntPtr structs and for nint/nuint. */
export const isIntPtrFamily = type => type?.specialType === 'System_IntPtr' || type?.specialType === 'System_UIntPtr';
/**
 * The numeric kind a type has for conversion and operator purposes at a language version: nint/nuint always; plain
 * IntPtr/UIntPtr only from C# 11 (`numericIntPtr` true).
 */
export function nativeIntegerKind(type, { numericIntPtr = false } = {}) {
  if (!isIntPtrFamily(type)) return null;
  if (type.isNativeInteger || numericIntPtr) return type.specialType === 'System_UIntPtr' ? 'nuint' : 'nint';
  return null;
}
/** Identity between nint and IntPtr (nuint and UIntPtr): they are the same runtime type at every version. */
export function isNativeIdentity(a, b) {
  return isIntPtrFamily(a) && isIntPtrFamily(b) && a.specialType === b.specialType;
}
/**
 * Classifies a conversion that involves a native integer.
 * @returns {'identity'|'implicit'|'explicit'|null} null when neither side is a native integer at this version
 */
export function classifyNativeIntegerConversion(from, to, options = {}) {
  const a = nativeIntegerKind(from, options) ?? numericKind(from),
    b = nativeIntegerKind(to, options) ?? numericKind(to);
  if (!isIntPtrFamily(from) && !isIntPtrFamily(to)) return null;
  if (isNativeIdentity(from, to)) return 'identity';
  if (!a || !b) return null;
  if (a === b) return 'identity';
  return implicitNumericConversion(a, b) ? 'implicit' : explicitNumericConversion(a, b) ? 'explicit' : null;
}
/** True when an integral constant of a native type can be folded: the value fits in 32 bits (int for nint, uint for nuint). */
export function nativeConstantFits(kind, value) {
  const [lo, hi] = integralRange(kind === 'nuint' ? 'uint' : 'int'),
    v = BigInt(value);
  return v >= lo && v <= hi;
}
/** Implicit constant conversion into a native integer: an int constant converts to nuint when it is not negative (nint is always implicit). */
export function implicitNativeConstantConversion(from, value, to) {
  return from === 'int' && (to === 'nint' || (to === 'nuint' && BigInt(value) >= 0n));
}
/**
 * The predefined operators of nint/nuint: the same set as the other integral types.
 * `nativeBinaryOperatorType('+','nint','int')` is the operand/result kind, or null when no operator applies
 * (nuint with a signed operand; nint with ulong).
 */
export function nativeBinaryOperatorType(operator, left, right, constants) {
  if (['<<', '>>', '>>>'].includes(operator)) return left === 'nint' || left === 'nuint' ? left : null;
  return binaryNumericPromotion(left, right, constants);
}
export function nativeUnaryOperatorType(operator, kind) {
  return unaryNumericPromotion(operator, kind);
}
/** sizeof(nint) is not a compile-time constant (CS0233 outside unsafe code in C# before 11). */
export const nativeSizeIsConstant = false;
