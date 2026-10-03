/**
 * float, double and decimal semantics (SF-A02-T01.2).
 *
 * float arithmetic is double arithmetic rounded to single after every operation; signed zero and NaN follow IEEE 754
 * (every ordered comparison with NaN is false, `!=` is true); integer-valued operations never throw. decimal is not an
 * IEEE type: its operators are methods of System.Decimal (`decimalOperatorMethod`), they throw OverflowException when
 * the result does not fit 96 bits and DivideByZeroException on division by zero, and there is no NaN or infinity.
 * `evaluateReal` returns `{value}` or `{exception:'System.OverflowException'|'System.DivideByZeroException'}`.
 */
import { ConstantValue, Decimal } from '../constants/constant-value.js';
import { foldBinary, foldUnary, foldConversion } from '../constants/fold.js';
import { integralRange, isIntegralKind } from './numeric.js';

/** Rounds a double to the nearest single (ties to even), as storing into a float does. */
export const roundToSingle = value => Math.fround(value);
export const isNegativeZero = value => Object.is(value, -0);
const decimalMethods = Object.freeze({
  '+': 'op_Addition',
  '-': 'op_Subtraction',
  '*': 'op_Multiply',
  '/': 'op_Division',
  '%': 'op_Modulus',
  '==': 'op_Equality',
  '!=': 'op_Inequality',
  '<': 'op_LessThan',
  '>': 'op_GreaterThan',
  '<=': 'op_LessThanOrEqual',
  '>=': 'op_GreaterThanOrEqual',
});
const decimalUnary = Object.freeze({ '-': 'op_UnaryNegation', '+': 'op_UnaryPlus', '++': 'op_Increment', '--': 'op_Decrement' });
/** The System.Decimal operator method a binary (or, with `unary`, a unary) decimal operator binds to; null when decimal has none (`&`, `<<`, `~`). */
export function decimalOperatorMethod(operator, unary = false) {
  return (unary ? decimalUnary : decimalMethods)[operator] ?? null;
}
/** The System.Decimal conversion method between decimal and another numeric kind: implicit into decimal from integral types, explicit otherwise. */
export function decimalConversionMethod(from, to) {
  if (to === 'decimal' && from !== 'decimal') return { name: isIntegralKind(from) ? 'op_Implicit' : 'op_Explicit', from, to };
  if (from === 'decimal' && to !== 'decimal') return { name: 'op_Explicit', from, to };
  return null;
}
/** IEEE comparison: false for every ordered comparison involving NaN; `-0 == +0`. */
export function compareReal(operator, a, b) {
  switch (operator) {
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return a < b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '>=':
      return a >= b;
  }
  throw new RangeError(`'${operator}' is not a comparison`);
}
const constant = (kind, value) =>
  kind === 'decimal' ? ConstantValue.decimal(value) : kind === 'float' ? ConstantValue.float(value) : ConstantValue.double(value);
/**
 * Evaluates `a op b` in float, double or decimal. Operands are numbers (or, for decimal, Decimal / digit strings).
 * @returns {{value:any}|{exception:string}}
 */
export function evaluateReal(operator, kind, a, b) {
  if (kind === 'float' || kind === 'double') {
    const x = kind === 'float' ? Math.fround(a) : a,
      y = kind === 'float' ? Math.fround(b) : b;
    if (decimalMethods[operator] && !['+', '-', '*', '/', '%'].includes(operator)) return { value: compareReal(operator, x, y) };
    let r;
    switch (operator) {
      case '+':
        r = x + y;
        break;
      case '-':
        r = x - y;
        break;
      case '*':
        r = x * y;
        break;
      case '/':
        r = x / y;
        break;
      case '%':
        r = x % y;
        break;
      default:
        throw new RangeError(`No ${kind} operator '${operator}'`);
    }
    return { value: kind === 'float' ? Math.fround(r) : r };
  }
  if (kind !== 'decimal') throw new RangeError(`'${kind}' is not a real type`);
  if (!decimalMethods[operator]) throw new RangeError(`No decimal operator '${operator}'`);
  const left = constant('decimal', a),
    right = constant('decimal', b);
  if ((operator === '/' || operator === '%') && right.value.mantissa === 0n) return { exception: 'System.DivideByZeroException' };
  const result = foldBinary(operator, left, right);
  if (!result || result.error) return { exception: 'System.OverflowException' };
  return { value: result.value };
}
/** Unary minus/plus on a real value; `-0.0` keeps its sign for float and double. */
export function negateReal(kind, value) {
  if (kind === 'decimal') {
    const r = foldUnary('-', constant('decimal', value));
    return { value: r.value };
  }
  return { value: kind === 'float' ? Math.fround(-value) : -value };
}
/**
 * Converts a real value to another numeric kind. Real to integral truncates toward zero; out of range (or NaN) is an
 * OverflowException in a checked context and an unspecified value - 0 on this profile, as the constant folder does -
 * in an unchecked one. To decimal, a float/double outside decimal's range always throws.
 */
export function convertReal(value, from, to, { checked = false } = {}) {
  if (to === 'float') return { value: from === 'decimal' ? Math.fround(Number(String(value))) : Math.fround(value) };
  if (to === 'double') return { value: from === 'decimal' ? Number(String(value)) : value };
  if (to === 'decimal') {
    if (from === 'decimal') return { value };
    if (!Number.isFinite(value) || Math.abs(value) > 7.9228162514264337593543950335e28) return { exception: 'System.OverflowException' };
    const r = foldConversion(constant(from, value), 'decimal', { checked: true });
    return !r || r.error ? { exception: 'System.OverflowException' } : { value: r.value };
  }
  if (!isIntegralKind(to)) throw new RangeError(`'${to}' is not a numeric type`);
  const number = from === 'decimal' ? Number(String(value)) : value,
    [lo, hi] = integralRange(to);
  if (Number.isNaN(number) || !Number.isFinite(number)) return checked ? { exception: 'System.OverflowException' } : { value: 0n };
  const truncated =
    from === 'decimal'
      ? BigInt(
          String(value instanceof Decimal ? value.toString() : value)
            .split('.')[0]
            .replace(/^-0$/, '0'),
        )
      : BigInt(Math.trunc(number));
  // System.Decimal's explicit operators always range-check, whatever the context.
  if (truncated < lo || truncated > hi) return checked || from === 'decimal' ? { exception: 'System.OverflowException' } : { value: 0n };
  return { value: truncated };
}
/** Shortest text that round-trips, as `float.ToString()` / `double.ToString()` print on .NET Core 3.0+. */
export function formatReal(kind, value) {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  if (Object.is(value, -0)) return '-0';
  if (kind !== 'float') return formatShortest(String(value));
  for (let digits = 1; digits <= 9; digits++) {
    const text = value.toPrecision(digits);
    if (Math.fround(Number(text)) === value) return formatShortest(String(Number(text)));
  }
  return formatShortest(String(value));
}
function formatShortest(text) {
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!m) return text;
  return `${m[1]}${m[2]}${m[3] ? '.' + m[3] : ''}E${m[4][0]}${m[4].slice(1).padStart(2, '0')}`;
}
