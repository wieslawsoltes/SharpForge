/**
 * Lifted operators and null-coalescing on nullable values (SF-A02-T05.2, C# spec 12.4.8, 12.15).
 *
 * A lifted operator is lowered to tests of `HasValue` and reads of `GetValueOrDefault()`:
 *
 *   a + b    ->  (a.HasValue & b.HasValue) ? new T?(a.GetValueOrDefault() + b.GetValueOrDefault()) : default(T?)
 *   a < b    ->  (a.GetValueOrDefault() < b.GetValueOrDefault()) & (a.HasValue & b.HasValue)
 *   a == b   ->  (a.GetValueOrDefault() == b.GetValueOrDefault()) & (a.HasValue == b.HasValue)
 *   a != b   ->  !(a == b)
 *   a ?? b   ->  a.HasValue ? a.GetValueOrDefault() : b
 *   a ??= b  ->  a.HasValue ? a.GetValueOrDefault() : (a = b)
 *   bool? & and | use three-valued logic.
 *
 * `lowerLiftedBinary` produces that tree from a bound lifted operator; `evaluateLifted` is the reference semantics
 * the truth-table tests check the lowered shape against. Operands are captured in temporaries by the caller, so each
 * is evaluated exactly once.
 */
import { isNullableType, stripNullable } from '../conversions/nullable.js';

const comparisonOperators = new Set(['<', '>', '<=', '>=']);
const equalityOperators = new Set(['==', '!=']);

const lowered = (kind, type, properties) => ({ kind, type, constantValue: null, isLowered: true, ...properties });
const hasValue = (operand, core) => lowered('NullableHasValue', core.bool, { operand });
const valueOrDefault = operand => lowered('NullableGetValueOrDefault', stripNullable(operand.type), { operand });
const wrap = (value, nullableType) => lowered('NullableCreate', nullableType, { operand: value });
const noValue = nullableType => lowered('Default', nullableType, {});
const binary = (operator, left, right, type) => lowered('Binary', type, { operator, left, right, isLifted: false });
const conditional = (condition, whenTrue, whenFalse, type) => lowered('Conditional', type, { condition, whenTrue, whenFalse });

/** The value an operand contributes to the underlying operator: unwrapped when nullable, unchanged otherwise. */
function underlyingValue(operand) {
  return isNullableType(operand.type) ? valueOrDefault(operand) : operand;
}

/** `a.HasValue & b.HasValue`, leaving out operands that are not nullable; null when neither is. */
function bothHaveValues(left, right, core) {
  const tests = [left, right].filter(operand => isNullableType(operand.type)).map(operand => hasValue(operand, core));
  if (tests.length === 0) return null;
  return tests.length === 1 ? tests[0] : binary('&', tests[0], tests[1], core.bool);
}

/**
 * Lowers a lifted binary operator.
 * @param node a bound `Binary` with `isLifted`; its operands must be side-effect free (locals or temporaries)
 * @param core CoreTypes
 * @returns the lowered tree, or the node itself when the operator is not lifted
 */
export function lowerLiftedBinary(node, core) {
  if (!node.isLifted) return node;
  const { operator, left, right } = node;
  if (node.family === 'bool' && (operator === '&' || operator === '|')) return lowerThreeValuedLogic(node, core);

  const present = bothHaveValues(left, right, core);
  const operation = binary(operator, underlyingValue(left), underlyingValue(right), comparisonType(node, core));
  if (comparisonOperators.has(operator)) return binary('&', operation, present, core.bool);
  if (equalityOperators.has(operator)) return lowerLiftedEquality(node, core);
  return conditional(present, wrap(operation, node.type), noValue(node.type), node.type);
}

function comparisonType(node, core) {
  const { operator } = node;
  if (comparisonOperators.has(operator) || equalityOperators.has(operator)) return core.bool;
  return stripNullable(node.type);
}

function lowerLiftedEquality(node, core) {
  const { operator, left, right } = node;
  const sameValue = binary('==', underlyingValue(left), underlyingValue(right), core.bool);
  const leftPresent = isNullableType(left.type) ? hasValue(left, core) : null;
  const rightPresent = isNullableType(right.type) ? hasValue(right, core) : null;
  // A non-nullable operand always has a value, so only the nullable side needs its HasValue test.
  const samePresence = leftPresent && rightPresent ? binary('==', leftPresent, rightPresent, core.bool) : (leftPresent ?? rightPresent);
  const equal = binary('&', sameValue, samePresence, core.bool);
  return operator === '==' ? equal : lowered('Unary', core.bool, { operator: '!', operand: equal });
}

/**
 * bool? & bool? and bool? | bool? (spec 12.13.5): false dominates `&`, true dominates `|`, otherwise null wins.
 *   a & b  ->  (a.GetValueOrDefault() || !a.HasValue) ? b : a      (when a is true or null the result is b, or a if b
 *   a | b  ->  a.GetValueOrDefault() ? a : (b.GetValueOrDefault() ? b : (a.HasValue ? b : a))        is not false)
 */
function lowerThreeValuedLogic(node, core) {
  const { operator, left, right, type } = node;
  const leftValue = underlyingValue(left);
  const rightValue = underlyingValue(right);
  const leftIsNull = lowered('Unary', core.bool, { operator: '!', operand: hasValue(left, core) });
  const rightIsNull = lowered('Unary', core.bool, { operator: '!', operand: hasValue(right, core) });
  const asNullable = operand => (isNullableType(operand.type) ? operand : wrap(operand, type));
  if (operator === '&') {
    // false if either is false; else null if either is null; else true.
    const leftFalse = lowered('Unary', core.bool, { operator: '!', operand: binary('|', leftValue, leftIsNull, core.bool) });
    const rightFalse = lowered('Unary', core.bool, { operator: '!', operand: binary('|', rightValue, rightIsNull, core.bool) });
    const whenNoFalse = conditional(leftIsNull, asNullable(left), asNullable(right), type);
    return conditional(leftFalse, asNullable(left), conditional(rightFalse, asNullable(right), whenNoFalse, type), type);
  }
  // true if either is true; else null if either is null; else false.
  const whenNoTrue = conditional(leftIsNull, asNullable(left), asNullable(right), type);
  return conditional(leftValue, asNullable(left), conditional(rightValue, asNullable(right), whenNoTrue, type), type);
}

/** Lowers a lifted unary operator: `-a` -> `a.HasValue ? new T?(-a.GetValueOrDefault()) : default(T?)`. */
export function lowerLiftedUnary(node, core) {
  if (!node.isLifted) return node;
  const operation = lowered('Unary', stripNullable(node.type), { operator: node.operator, operand: valueOrDefault(node.operand) });
  return conditional(hasValue(node.operand, core), wrap(operation, node.type), noValue(node.type), node.type);
}

/**
 * Lowers `left ?? right` when `left` is a nullable value type.
 * The result type decides the shape: T (unwrap) or T? (keep the nullable when `right` is nullable too).
 */
export function lowerNullableCoalesce(node, core) {
  const { left, right, type } = node;
  if (!isNullableType(left.type)) return node;
  const whenPresent = isNullableType(type) ? left : valueOrDefault(left);
  return conditional(hasValue(left, core), whenPresent, right, type);
}

/** Lowers `left ??= right` on a nullable value: assigns only when `left` has no value. */
export function lowerNullableCoalesceAssignment(node, core) {
  const { left, right, type } = node;
  if (!isNullableType(left.type)) return node;
  const assigned = lowered('Assignment', left.type, { left, right: isNullableType(right.type) ? right : wrap(right, left.type) });
  const whenMissing = isNullableType(type) ? assigned : lowered('Sequence', type, { sideEffects: [assigned], value: right });
  const whenPresent = isNullableType(type) ? left : valueOrDefault(left);
  return conditional(hasValue(left, core), whenPresent, whenMissing, type);
}

/** Lowers a nullable conversion from its `steps` (see conversions/nullable.js): wrap, unwrap or lift. */
export function lowerNullableConversion(node, core) {
  const steps = node.conversion?.steps;
  if (!steps) return node;
  const { operand, type } = node;
  if (steps[0] === 'wrap') return wrap(lowered('Conversion', stripNullable(type), { operand, conversion: node.conversion.underlying }), type);
  if (steps[0] === 'unwrap') {
    // An explicit unwrap reads `.Value`, which throws InvalidOperationException when there is no value.
    const value = lowered('NullableValue', stripNullable(operand.type), { operand, throwsWhenNull: true });
    return lowered('Conversion', type, { operand: value, conversion: node.conversion.underlying });
  }
  const converted = lowered('Conversion', stripNullable(type), { operand: valueOrDefault(operand), conversion: node.conversion.underlying });
  return conditional(hasValue(operand, core), wrap(converted, type), noValue(type), type);
}

/**
 * Reference semantics of a lifted binary operator over JavaScript values, `null` standing for "no value".
 * @param {(operator:string, a:any, b:any) => any} evaluateUnderlying the non-nullable operator
 */
export function evaluateLifted(operator, left, right, evaluateUnderlying, { isBool = false } = {}) {
  if (isBool && (operator === '&' || operator === '|')) return evaluateThreeValued(operator, left, right);
  if (equalityOperators.has(operator)) {
    const equal = left === null || right === null ? left === right : evaluateUnderlying('==', left, right);
    return operator === '==' ? equal : !equal;
  }
  if (left === null || right === null) return comparisonOperators.has(operator) ? false : null;
  return evaluateUnderlying(operator, left, right);
}

function evaluateThreeValued(operator, left, right) {
  if (operator === '&') {
    if (left === false || right === false) return false;
    return left === null || right === null ? null : true;
  }
  if (left === true || right === true) return true;
  return left === null || right === null ? null : false;
}

/**
 * Interprets a lowered tree over an environment of operand values (used by tests to prove the lowered shape has the
 * reference semantics). Nullable values are `null` or the underlying JavaScript value.
 */
export function evaluateLowered(node, environment, evaluateUnderlying) {
  const evaluate = child => evaluateLowered(child, environment, evaluateUnderlying);
  switch (node.kind) {
    case 'NullableHasValue':
      return evaluate(node.operand) !== null;
    case 'NullableGetValueOrDefault': {
      const value = evaluate(node.operand);
      return value === null ? environment.defaultValue : value;
    }
    case 'NullableValue': {
      const value = evaluate(node.operand);
      if (value === null) throw new Error('System.InvalidOperationException');
      return value;
    }
    case 'NullableCreate':
      return evaluate(node.operand);
    case 'Default':
      return null;
    case 'Conditional':
      return evaluate(node.condition) ? evaluate(node.whenTrue) : evaluate(node.whenFalse);
    case 'Unary':
      return node.operator === '!' ? !evaluate(node.operand) : evaluateUnderlying(node.operator, evaluate(node.operand));
    case 'Binary':
      return evaluateUnderlying(node.operator, evaluate(node.left), evaluate(node.right));
    case 'Conversion':
      return evaluate(node.operand);
    default:
      return environment.valueOf(node);
  }
}
