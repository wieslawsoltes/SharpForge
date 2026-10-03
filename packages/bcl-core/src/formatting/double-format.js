function specialValue(value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (value === 0) return Object.is(value, -0) ? '-0' : '0';
  return null;
}

function shortestDigits(value) {
  const scientific = value.toExponential();
  const marker = scientific.indexOf('e');
  return {
    digits: scientific.slice(0, marker).replace('.', ''),
    exponent: Number(scientific.slice(marker + 1))
  };
}

function binary64Ratio(value) {
  const bytes = new DataView(new ArrayBuffer(8));
  bytes.setFloat64(0, value);
  const bits = bytes.getBigUint64(0);
  const storedExponent = Number((bits >> 52n) & 2047n);
  const fraction = bits & ((1n << 52n) - 1n);
  let numerator = storedExponent ? fraction + (1n << 52n) : fraction;
  let denominator = 1n;
  const binaryPower = (storedExponent ? storedExponent - 1023 : -1022) - 52;
  if (binaryPower >= 0) numerator <<= BigInt(binaryPower);
  else denominator <<= BigInt(-binaryPower);
  return {numerator, denominator};
}

function roundedInteger(numerator, denominator, decimalPower) {
  if (decimalPower >= 0) numerator *= 10n ** BigInt(decimalPower);
  else denominator *= 10n ** BigInt(-decimalPower);
  let rounded = numerator / denominator;
  const twiceRemainder = (numerator % denominator) * 2n;
  if (twiceRemainder > denominator || twiceRemainder === denominator && (rounded & 1n) !== 0n) rounded++;
  return rounded;
}

/** Round a finite, nonnegative binary64 times 10^decimalPower to the nearest even integer. */
export function roundDoubleToDecimal(value, decimalPower) {
  const {numerator, denominator} = binary64Ratio(value);
  return roundedInteger(numerator, denominator, decimalPower);
}

function significantDigits(value, precision, exponent) {
  const {numerator, denominator} = binary64Ratio(value);
  // A shortest representation can round up to a power of ten (for example 1e23).
  // Explicit precision must start from the exact value's exponent before rounding.
  const powerOfTen = 10n ** BigInt(Math.abs(exponent));
  const belowExponent = exponent >= 0
    ? numerator < denominator * powerOfTen : numerator * powerOfTen < denominator;
  if (belowExponent) exponent--;
  const rounded = roundedInteger(numerator, denominator, precision - 1 - exponent);
  let digits = rounded.toString();
  if (digits.length > precision) {
    exponent++;
    digits = digits.slice(0, -1);
  }
  let end = digits.length;
  while (end > 1 && digits[end - 1] === '0') end--;
  return {digits: digits.slice(0, end), exponent};
}

function notation(digits, exponent, precision, lowercase) {
  if (exponent < -4 || exponent >= precision) {
    const fraction = digits.length > 1 ? '.' + digits.slice(1) : '';
    const sign = exponent < 0 ? '-' : '+';
    return digits[0] + fraction + (lowercase ? 'e' : 'E') + sign + String(Math.abs(exponent)).padStart(2, '0');
  }
  const position = exponent + 1;
  if (position <= 0) return '0.' + '0'.repeat(-position) + digits;
  if (position >= digits.length) return digits + '0'.repeat(position - digits.length);
  return digits.slice(0, position) + '.' + digits.slice(position);
}

/**
 * Format binary64 using invariant .NET general notation; precision is null or 1..99.
 * Explicit precision rounds the exact binary value to even; null uses shortest round-trip digits.
 * Runtime callers validate the format/precision before reaching this pure formatter.
 */
export function formatDoubleGeneral(value, precision = null, lowercase = false) {
  const special = specialValue(value);
  if (special !== null) return special;
  const magnitude = Math.abs(value);
  // Both hosts use the same shortest fixed notation in this range; keep common
  // integer/default formatting free of digit records and scientific string parsing.
  if (precision === null && magnitude >= 1e-4 && magnitude < 1e17) return String(value);
  const shortest = shortestDigits(magnitude);
  const decimal = precision === null ? shortest : significantDigits(magnitude, precision, shortest.exponent);
  return (value < 0 ? '-' : '') + notation(decimal.digits, decimal.exponent, precision ?? 17, lowercase);
}

/** Format binary64 default text with invariant .NET exponent case, width and signed zero. */
export function formatDoubleDefault(value) {
  return formatDoubleGeneral(value);
}
