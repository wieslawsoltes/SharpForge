import {bclScalar, bounded, fail, integer, text, typeOf} from '../host.js';
import {formatDoubleGeneral, roundDoubleToDecimal} from './double-format.js';

// Round the exact binary64 value to decimal with midpoint-to-even semantics.
function fixedEven(value, digits) {
  if (!Number.isFinite(value)) return String(value);
  const negative = value < 0 || Object.is(value, -0);
  const quotient = roundDoubleToDecimal(Math.abs(value), digits);
  let result = quotient.toString().padStart(digits + 1, '0');
  if (digits) result = result.slice(0, -digits) + '.' + result.slice(-digits);
  return (negative ? '-' : '') + result;
}

function integerFormat(platform, value, code, precision, type) {
  if (!Number.isInteger(value) || ['double', 'System.Double'].includes(type)) {
    fail(platform, 'FormatException', 'Integer format requires an integer type');
  }
  const digits = /[xX]/.test(code)
    ? (value < 0 ? value >>> 0 : value).toString(16)
    : String(Math.abs(value));
  let result = digits.padStart(precision ?? 1, '0');
  if (code === 'X') result = result.toUpperCase();
  if (/[dD]/.test(code) && value < 0) result = '-' + result;
  return result;
}

function decimalFormat(value, code, precision) {
  const number = /[pP]/.test(code) ? value * 100 : value;
  let result = fixedEven(number, precision ?? 2);
  if (/[nNpP]/.test(code)) {
    const parts = result.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    result = parts.join('.');
  }
  if (/[pP]/.test(code)) result += ' %';
  return result;
}

/** Format a managed value using the released numeric subset and bounded character alignment. */
export function formatBclValue(platform, value, format = '', alignment = 0, type = null) {
  integer(platform, alignment, -100000, 100000);
  const scalar = bclScalar(platform, value);
  const valueType = type ?? typeOf(platform, value);
  let result = platform.bclHost.formatDecimal?.(scalar, format) ?? text(platform, value, valueType);
  if (scalar !== null && typeof scalar === 'number' && format) {
    const match = /^([dDxXfFnNeEgGpPrR])(\d{0,2})$/.exec(format);
    if (!match) fail(platform, 'FormatException', 'Unsupported numeric format ' + format);
    const code = match[1];
    const precision = match[2] ? Number(match[2]) : null;
    if (precision !== null && precision > 99) fail(platform, 'FormatException', 'Numeric precision limit');
    if (/[dDxX]/.test(code)) result = integerFormat(platform, scalar, code, precision, valueType);
    if (/[fFnNpP]/.test(code)) result = decimalFormat(scalar, code, precision);
    if (/[eE]/.test(code)) {
      result = scalar.toExponential(precision ?? 6).replace(/e([+-])(\d+)$/, (_, sign, digits) =>
        (code === 'E' ? 'E' : 'e') + sign + digits.padStart(3, '0'));
    }
    if (/[gG]/.test(code)) result = formatDoubleGeneral(scalar, precision || null, code === 'g');
    if (/[rR]/.test(code)) {
      if (!['double', 'System.Double', 'float', 'System.Single'].includes(valueType)) {
        fail(platform, 'FormatException', 'Round-trip format requires a floating-point type');
      }
      result = formatDoubleGeneral(scalar, null, code === 'r');
    }
  }
  if (alignment > 0) result = result.padStart(alignment);
  else if (alignment < 0) result = result.padEnd(-alignment);
  return bounded(platform, result);
}
