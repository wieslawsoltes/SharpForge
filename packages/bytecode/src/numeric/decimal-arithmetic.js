import {
  decimal, decimalZero, decimalMaxCoefficient, decimalPower, decimalFail, requireDecimal, roundedDivision, fitDecimal
} from './decimal-value.js';

/** Numeric comparison ignores representational scale and the sign of zero. */
export function decimalCompare(left, right, context) {
  requireDecimal(left, context);
  requireDecimal(right, context);
  const scale = Math.max(left.scale, right.scale);
  let first = left.coefficient * decimalPower(scale - left.scale);
  let second = right.coefficient * decimalPower(scale - right.scale);
  if (left.negative) first = -first;
  if (right.negative) second = -second;
  return first < second ? -1 : first > second ? 1 : 0;
}
export function decimalNegate(value, context) {
  requireDecimal(value, context);
  return decimal(value.coefficient, value.scale, !value.negative, context);
}
export function decimalAbs(value, context) {
  requireDecimal(value, context);
  return value.negative ? decimal(value.coefficient, value.scale, false, context) : value;
}
export function decimalAdd(left, right, subtract = false, context) {
  requireDecimal(left, context);
  requireDecimal(right, context);
  const scale = Math.max(left.scale, right.scale), rightNegative = right.negative !== subtract;
  let first = left.coefficient * decimalPower(scale - left.scale);
  let second = right.coefficient * decimalPower(scale - right.scale);
  if (left.negative) first = -first;
  if (rightNegative) second = -second;
  const sum = first + second;
  const zeroNegative = left.scale <= right.scale ? left.negative : rightNegative;
  return fitDecimal(sum < 0n ? -sum : sum, scale, sum < 0n || sum === 0n && zeroNegative, context);
}
export function decimalMultiply(left, right, context) {
  requireDecimal(left, context);
  requireDecimal(right, context);
  // CoreLib's short-limb multiplication returns canonical zero on these underflows.
  if (left.coefficient <= 0xffffffffn && right.coefficient <= 0xffffffffn && left.scale + right.scale > 47) return decimalZero;
  if ((left.coefficient === 0n || right.coefficient === 0n) &&
      (left.coefficient > 0xffffffffn || right.coefficient > 0xffffffffn)) return decimalZero;
  return fitDecimal(left.coefficient * right.coefficient, left.scale + right.scale, left.negative !== right.negative, context);
}
export function decimalDivide(left, right, context) {
  requireDecimal(left, context);
  requireDecimal(right, context);
  if (right.coefficient === 0n) decimalFail(context, 'DivideByZeroException', 'Attempted to divide by zero');
  const negative = left.negative !== right.negative;
  const numerator = left.coefficient * decimalPower(right.scale), denominator = right.coefficient * decimalPower(left.scale);
  const start = Math.max(0, left.scale - right.scale);
  const unscale = left.coefficient % right.coefficient !== 0n;
  let scale = start, quotient = 0n, remainder = 0n;
  for (; scale <= 28; scale++) {
    const scaled = numerator * decimalPower(scale), next = scaled / denominator, rest = scaled % denominator;
    if (next > decimalMaxCoefficient) {
      scale--;
      break;
    }
    quotient = next;
    remainder = rest;
    if (rest === 0n || scale === 28) break;
  }
  if (scale < start) decimalFail(context, 'OverflowException', 'Decimal division overflow');
  if (remainder !== 0n) quotient = roundedDivision(numerator * decimalPower(scale), denominator);
  if (quotient > decimalMaxCoefficient) {
    if (scale === 0) decimalFail(context, 'OverflowException', 'Decimal division overflow');
    quotient = roundedDivision(numerator * decimalPower(--scale), denominator);
  }
  if (unscale) {
    while (scale > 0 && quotient % 10n === 0n) {
      quotient /= 10n;
      scale--;
    }
  }
  return decimal(quotient, scale, negative, context);
}
export function decimalRemainder(left, right, context) {
  requireDecimal(left, context);
  requireDecimal(right, context);
  if (right.coefficient === 0n) decimalFail(context, 'DivideByZeroException', 'Attempted to divide by zero');
  if (left.coefficient === 0n || decimalCompare(decimalAbs(left), decimalAbs(right)) < 0) return left;
  const scale = Math.max(left.scale, right.scale);
  const first = left.coefficient * decimalPower(scale - left.scale), second = right.coefficient * decimalPower(scale - right.scale);
  return fitDecimal(first % second, scale, left.negative, context);
}
/** MidpointRounding: ToEven=0, AwayFromZero=1, ToZero=2, -Infinity=3, +Infinity=4. */
export function decimalRound(value, digits = 0, mode = 0, context) {
  requireDecimal(value, context);
  if (!Number.isInteger(digits) || digits < 0 || digits > 28) {
    decimalFail(context, 'ArgumentOutOfRangeException', 'Decimal digits must be between zero and 28');
  }
  if (!Number.isInteger(mode) || mode < 0 || mode > 4) decimalFail(context, 'ArgumentException', 'Invalid midpoint rounding mode');
  if (digits >= value.scale) return value;
  return decimal(roundedDivision(value.coefficient, decimalPower(value.scale - digits), mode, value.negative), digits, value.negative, context);
}
const comparisons = Object.freeze({
  '==': order => order === 0, '!=': order => order !== 0, '<': order => order < 0,
  '<=': order => order <= 0, '>': order => order > 0, '>=': order => order >= 0
});
const operations = Object.freeze({
  '+': decimalAdd, add: decimalAdd,
  '-': (left, right, context) => decimalAdd(left, right, true, context),
  sub: (left, right, context) => decimalAdd(left, right, true, context),
  '*': decimalMultiply, mul: decimalMultiply, '/': decimalDivide, div: decimalDivide, '%': decimalRemainder, rem: decimalRemainder
});
export function decimalBinary(operator, left, right, context) {
  if (Object.hasOwn(comparisons, operator)) return comparisons[operator](decimalCompare(left, right, context));
  if (operator === '+' || operator === 'add') return decimalAdd(left, right, false, context);
  if (Object.hasOwn(operations, operator)) return operations[operator](left, right, context);
  decimalFail(context, 'InvalidProgramException', 'Invalid Decimal operation');
}
