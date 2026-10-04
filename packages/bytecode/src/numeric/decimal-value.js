/** Immutable Decimal: unsigned 96-bit coefficient, decimal scale and independent sign. */
export const decimalMaxCoefficient = (1n << 96n) - 1n;
const powers = Array.from({length: 113}, (_, exponent) => 10n ** BigInt(exponent));
export const decimalPower = exponent => powers[exponent] ?? 10n ** BigInt(exponent);
const fault = (name, message) => Object.assign(new Error(message), {name});
export function decimalFail(context, name, message) {
  throw (context?.fault ?? fault)(name, message);
}
export function isDecimal(value) {
  return value?.decimal === true && typeof value.coefficient === 'bigint' &&
    value.coefficient >= 0n && value.coefficient <= decimalMaxCoefficient &&
    Number.isInteger(value.scale) && value.scale >= 0 && value.scale <= 28 &&
    typeof value.negative === 'boolean';
}
/** Construct a value without rounding; malformed representation raises ArgumentException. */
export function decimal(coefficient = 0n, scale = 0, negative = false, context) {
  const value = {decimal: true, coefficient, scale, negative};
  if (!isDecimal(value)) decimalFail(context, 'ArgumentException', 'Invalid Decimal coefficient, scale or sign');
  return Object.freeze(value);
}
export const decimalZero = decimal();
export function requireDecimal(value, context) {
  if (!isDecimal(value)) decimalFail(context, 'InvalidProgramException', 'Decimal value required');
  return value;
}
export function roundedDivision(numerator, denominator, mode = 0, negative = false) {
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const increment = mode === 0 ? remainder * 2n > denominator || remainder * 2n === denominator && (quotient & 1n) !== 0n :
    mode === 1 ? remainder * 2n >= denominator : mode === 3 ? negative : mode === 4 ? !negative : false;
  if (increment) quotient++;
  return quotient;
}
export function fitDecimal(coefficient, scale, negative, context) {
  if (scale < 0) {
    coefficient *= decimalPower(-scale);
    scale = 0;
  }
  for (let drop = Math.max(0, scale - 28); drop <= scale; drop++) {
    const result = roundedDivision(coefficient, decimalPower(drop));
    if (result <= decimalMaxCoefficient) return decimal(result, scale - drop, negative, context);
  }
  decimalFail(context, 'OverflowException', 'Decimal arithmetic overflow');
}
/** Decode Decimal.GetBits words; reserved flag bits and scales above 28 are rejected. */
export function decimalFromBits(bits, context) {
  if (!Array.isArray(bits) || bits.length !== 4 ||
      bits.some(value => !Number.isInteger(value) || value < -2147483648 || value > 4294967295)) {
    decimalFail(context, 'ArgumentException', 'Decimal bits require four Int32 words');
  }
  const [lo, mid, hi, rawFlags] = bits;
  const flags = rawFlags >>> 0, scale = (flags >>> 16) & 255;
  if ((flags & 0x7f00ffff) !== 0 || scale > 28) decimalFail(context, 'ArgumentException', 'Invalid Decimal flags');
  return decimal(BigInt(lo >>> 0) | (BigInt(mid >>> 0) << 32n) | (BigInt(hi >>> 0) << 64n), scale, !!(flags & 0x80000000), context);
}
/** Return four signed Int32 words, preserving the sign and scale of zero. */
export function decimalBits(value, context) {
  const coefficient = requireDecimal(value, context).coefficient;
  return [Number(BigInt.asIntN(32, coefficient)), Number(BigInt.asIntN(32, coefficient >> 32n)),
    Number(BigInt.asIntN(32, coefficient >> 64n)), (value.scale << 16) | (value.negative ? 0x80000000 : 0)];
}
