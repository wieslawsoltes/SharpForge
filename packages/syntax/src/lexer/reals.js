/** Real literal scanning: float (rounded to single), double and exact System.Decimal (96-bit mantissa plus scale). */
export const decimalMaxMantissa = (1n << 96n) - 1n;
/**
 * Converts decimal digits to the System.Decimal representation { mantissa, scale }.
 * Excess fractional digits round half-to-even as System.Decimal parsing does; returns null when the value overflows.
 */
export function parseDecimal(integer, fraction = '', exponent = 0) {
  let mantissa = BigInt(integer + fraction || '0'),
    scale = fraction.length - exponent;
  if (scale < 0) {
    mantissa *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && (scale > 28 || mantissa > decimalMaxMantissa)) {
    let drop = Math.max(1, scale - 28),
      power = 10n ** BigInt(drop);
    while (drop < scale && mantissa / power > decimalMaxMantissa) {
      drop++;
      power *= 10n;
    }
    const quotient = mantissa / power,
      twice = (mantissa % power) * 2n;
    mantissa = quotient + (twice > power || (twice === power && quotient & 1n) ? 1n : 0n);
    scale -= drop;
  }
  if (mantissa > decimalMaxMantissa) return null;
  if (mantissa === 0n) scale = Math.min(scale, 28);
  return { mantissa, scale };
}
/** Formats a { mantissa, scale } decimal exactly, for diagnostics and tests. */
export function decimalToString({ mantissa, scale }) {
  const digits = mantissa.toString().padStart(scale + 1, '0');
  return scale ? digits.slice(0, -scale) + '.' + digits.slice(-scale) : digits;
}
/** Scans a real literal (`1.5`, `.5`, `1e10`, `1f`, `2m`) starting at a digit or at a dot followed by a digit. */
export function scanReal(text, start) {
  const errors = [],
    features = [],
    profile = [];
  let i = start;
  const run = () => {
    const from = i;
    while (/[\d_]/.test(text[i] ?? '')) i++;
    return text.slice(from, i);
  };
  const whole = run();
  let fraction = '',
    exponent = '';
  if (text[i] === '.' && /\d/.test(text[i + 1] ?? '')) {
    i++;
    fraction = run();
  }
  if (/[eE]/.test(text[i] ?? '') && (/\d/.test(text[i + 1] ?? '') || (/[+-]/.test(text[i + 1] ?? '') && /\d/.test(text[i + 2] ?? '')))) {
    i++;
    if (/[+-]/.test(text[i])) exponent = text[i++];
    exponent += run();
  }
  const body = text.slice(start, i),
    suffix = /[fFdDmM]/.test(text[i] ?? '') ? text[i++] : '';
  if (body.includes('_')) features.push('DigitSeparator');
  if (/_(?:$|[.eE])|[.eE+-]_/.test(body)) errors.push({ code: 'CS1013', message: 'Invalid number' });
  const clean = body.replaceAll('_', ''),
    type = /f/i.test(suffix) ? 'float' : /m/i.test(suffix) ? 'decimal' : 'double',
    double = Number(clean);
  let value;
  if (type === 'decimal') {
    value = parseDecimal(
      whole.replaceAll('_', ''),
      fraction.replaceAll('_', ''),
      Math.max(-10000, Math.min(10000, Number(exponent.replaceAll('_', '') || 0)))
    );
    if (!value) {
      errors.push({ code: 'CS0594', message: "Floating-point constant is outside the range of type 'decimal'" });
      value = { mantissa: 0n, scale: 0 };
    }
    profile.push({ code: 'SF1003', message: 'decimal, long and unsigned literals are not implemented' });
  } else {
    value = type === 'float' ? Math.fround(double) : double;
    if (!Number.isFinite(value)) errors.push({ code: 'CS0594', message: `Floating-point constant is outside the range of type '${type}'` });
    if (type === 'float') profile.push({ code: 'SF1005', message: 'Single-precision float literals are not implemented' });
  }
  return { end: i, kind: 'double', value: double, literal: { type, value }, suffix, errors, features, profile };
}
