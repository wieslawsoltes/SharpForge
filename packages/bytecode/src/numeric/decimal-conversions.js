import {decimal, decimalZero, decimalPower, decimalFail, requireDecimal, fitDecimal} from './decimal-value.js';

/** Parse bounded invariant text; options enable Number-style grouping/trailing signs. */
export function decimalParse(input, context = {}) {
  if (typeof input !== 'string') decimalFail(context, input === null ? 'ArgumentNullException' : 'FormatException', 'Decimal text is required');
  if (input.length > 4096) decimalFail(context, 'FormatException', 'Decimal text is too long');
  let text = input.trim();
  if (context.allowTrailingSign && /[+-]$/.test(text)) text = text.at(-1) + text.slice(0, -1).trimEnd();
  if (context.allowThousands) {
    if (/^[+-]?,/.test(text)) decimalFail(context, 'FormatException', 'Invalid Decimal grouping');
    text = text.replace(/^([+-]?)(\d[\d,]*)(?=\.|$|[eE])/, (whole, sign, integer) => sign + integer.replaceAll(',', ''));
  }
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!match || context.allowExponent === false && match[5] !== undefined) decimalFail(context, 'FormatException', 'Invalid Decimal text');
  const fraction = match[3] ?? match[4] ?? '', digits = (match[2] ?? '0') + fraction, exponent = Number(match[5] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 4096) decimalFail(context, 'OverflowException', 'Decimal exponent is out of range');
  const coefficient = BigInt(digits), scale = fraction.length - exponent;
  if (coefficient === 0n) return decimal(0n, Math.max(0, Math.min(28, scale)), match[1] === '-', context);
  if (scale > digits.length + 28) return decimal(0n, 28, match[1] === '-', context);
  if (scale < -29) decimalFail(context, 'OverflowException', 'Decimal text overflows');
  return fitDecimal(coefficient, scale, match[1] === '-', context);
}
/** Convert an exact integer, interpreting unsigned CLI stack bits when requested. */
export function decimalFromInteger(input, unsigned = false, bits = 64, context) {
  let value = BigInt(input);
  if (unsigned) value = BigInt.asUintN(bits, value);
  return fitDecimal(value < 0n ? -value : value, 0, value < 0n, context);
}
/** .NET 10 floating constructors round R4/R8 inputs to 7/15 significant digits. */
export function decimalFromFloat(input, kind = 'r8', context) {
  let value = kind === 'r4' ? Math.fround(input) : Number(input);
  if (!Number.isFinite(value)) decimalFail(context, 'OverflowException', 'Non-finite Decimal conversion');
  if (value === 0) return decimalZero;
  const negative = value < 0;
  value = Math.abs(value);
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value, false);
  const exponent = ((bits.getUint32(0, false) >>> 20) & 2047) - 1022;
  if (exponent < -94) return decimalZero;
  if (exponent > 96) decimalFail(context, 'OverflowException', 'Decimal conversion overflow');
  const digits = kind === 'r4' ? 7 : 15;
  let scale = (digits - 1) - ((exponent * 19728) >> 16), scaled = value;
  if (scale >= 0) {
    scale = Math.min(scale, 28);
    scaled *= 10 ** scale;
  } else if (scale !== -1 || scaled >= 10 ** digits) scaled /= 10 ** (-scale);
  else scale = 0;
  if (scaled < 10 ** (digits - 1) && scale < 28) {
    scaled *= 10;
    scale++;
  }
  const floor = Math.floor(scaled), fraction = scaled - floor;
  let coefficient = BigInt(floor + (fraction > 0.5 || fraction === 0.5 && floor % 2 !== 0 ? 1 : 0));
  if (coefficient === 0n) return decimalZero;
  if (scale < 0) {
    coefficient *= decimalPower(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale--;
  }
  return fitDecimal(coefficient, scale, negative, context);
}
/** Truncate toward zero; Decimal conversions always check destination bounds. */
export function decimalToInteger(value, {bits = 64, unsigned = false, ...context} = {}) {
  requireDecimal(value, context);
  let integer = value.coefficient / decimalPower(value.scale);
  if (value.negative) integer = -integer;
  const minimum = unsigned ? 0n : -(1n << BigInt(bits - 1)), maximum = (1n << BigInt(unsigned ? bits : bits - 1)) - 1n;
  if (integer < minimum || integer > maximum) decimalFail(context, 'OverflowException', 'Decimal integer conversion overflow');
  return bits <= 32 ? Number(integer) : integer;
}
/** Match CoreLib's two-limb conversion, including negative zero. */
export function decimalToFloat(value, kind = 'r8', context) {
  requireDecimal(value, context);
  const coefficient = value.coefficient;
  const number = (Number(BigInt.asUintN(64, coefficient)) + Number(coefficient >> 64n) * 2 ** 64) / (10 ** value.scale);
  const signed = value.negative ? -number : number;
  return kind === 'r4' ? Math.fround(signed) : signed;
}
