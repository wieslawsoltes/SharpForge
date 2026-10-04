import {decimalPower, decimalFail, requireDecimal, roundedDivision} from './decimal-value.js';

/** Invariant G/F/N/E/P formatting; default G preserves Decimal scale. */
export function decimalFormat(value, format = 'G', context) {
  requireDecimal(value, context);
  format ??= 'G';
  const match = /^([gGfFnNeEpP])(\d{0,2})$/.exec(format || 'G');
  if (!match) decimalFail(context, 'FormatException', 'Unsupported Decimal format');
  const code = match[1].toUpperCase(), digits = match[2] === '' ? null : Number(match[2]);
  const generalDigits = digits === 0 ? Math.max(1, value.coefficient.toString().length) : digits;
  let coefficient = value.coefficient, scale = value.scale;
  // Numeric text uses midpoint-away rounding independently of Decimal.Round.
  const roundTo = places => {
    if (scale > places) {
      coefficient = roundedDivision(coefficient, decimalPower(scale - places), 1);
      scale = places;
    }
    if (scale < 0) {
      coefficient *= decimalPower(-scale);
      scale = 0;
    }
  };
  const trim = () => {
    while (scale > 0 && coefficient % 10n === 0n) {
      coefficient /= 10n;
      scale--;
    }
  };
  const exponent = () => coefficient === 0n ? 0 : coefficient.toString().length - scale - 1;
  const scientific = (precision, exponentDigits, trimZeros) => {
    roundTo(precision - exponent());
    const exp = exponent(), text = coefficient.toString().padEnd(precision + 1, '0').slice(0, precision + 1);
    let fraction = text.slice(1);
    if (trimZeros) fraction = fraction.replace(/0+$/, '');
    const marker = match[1] === match[1].toLowerCase() ? 'e' : 'E';
    return text[0] + (fraction ? '.' + fraction : '') + marker + (exp < 0 ? '-' : '+') +
      String(Math.abs(exp)).padStart(exponentDigits, '0');
  };
  let text;
  if (code === 'E') text = scientific(digits ?? 6, 3, false);
  else {
    if (code === 'P') {
      scale -= 2;
      if (scale < 0) {
        coefficient *= decimalPower(-scale);
        scale = 0;
      }
    }
    if (code === 'G' && generalDigits) {
      roundTo(generalDigits - 1 - exponent());
      trim();
    }
    if (code === 'G' && generalDigits && (exponent() < -4 || exponent() >= generalDigits)) text = scientific(generalDigits - 1, 2, true);
    else {
      const places = code === 'G' ? scale : digits ?? 2;
      roundTo(places);
      text = coefficient.toString() + '0'.repeat(Math.max(0, places - scale));
      if (places > 0) {
        text = text.padStart(places + 1, '0');
        text = text.slice(0, -places) + '.' + text.slice(-places);
      }
      if (code === 'N' || code === 'P') {
        const [whole, fraction] = text.split('.');
        text = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : '.' + fraction);
      }
      if (code === 'P') text += ' %';
    }
  }
  return (value.negative && coefficient !== 0n ? '-' : '') + text;
}
