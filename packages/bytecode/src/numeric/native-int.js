import {integerArithmetic} from './integer-arithmetic.js';

const defaultContext = Object.freeze({});

/** The portable/browser ABI defaults to 32 bits; host word size never selects it. */
export function nativeIntegerBits(context = defaultContext) {
  const bits = context.nativeIntBits ?? 32;
  if (bits !== 32 && bits !== 64) throw new TypeError('nativeIntBits must be 32 or 64');
  return bits;
}

export const isNativeInteger = value => value?.nativeInt === 32 || value?.nativeInt === 64;

/** Native stack values retain their category and signed bit pattern through storage. */
export function nativeInteger(value, bits = 32) {
  if (bits !== 32 && bits !== 64) throw new TypeError('nativeIntBits must be 32 or 64');
  const narrowed = BigInt.asIntN(bits, BigInt(value));
  return Object.freeze({nativeInt: bits, value: bits === 64 ? narrowed : Number(narrowed)});
}

/** Native arithmetic uses exact integers, masked shifts and injected managed faults. */
export function nativeBinary(name, left, right, context = defaultContext) {
  const bits = nativeIntegerBits(context);
  return nativeInteger(integerArithmetic(name, left, right, bits, context), bits);
}

export function nativeSize(context) { return nativeIntegerBits(context) / 8; }
