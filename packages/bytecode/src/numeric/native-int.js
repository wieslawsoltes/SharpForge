import {nativeIntegerBits} from './numeric-types.js';
import {integerArithmetic} from './integer-arithmetic.js';

export const isNativeInteger = value => value?.nativeInt === 32 || value?.nativeInt === 64;

/** Native stack values carry their ABI; the browser default is explicitly 32 bits. */
export function nativeInteger(value, bits = 32) {
  nativeIntegerBits({nativeIntBits: bits});
  const narrowed = BigInt.asIntN(bits, BigInt(value));
  return Object.freeze({nativeInt: bits, value: bits === 64 ? narrowed : Number(narrowed)});
}

/** Arithmetic wraps/checks at the selected ABI and preserves the immutable width tag. */
export function nativeBinary(name, left, right, context = {}) {
  const bits = nativeIntegerBits(context);
  return nativeInteger(integerArithmetic(name, left, right, bits, context), bits);
}

/** System.IntPtr.Size, System.UIntPtr.Size and sizeof(native int) share this value. */
export function nativeSize(context) {
  return nativeIntegerBits(context) / 8;
}
