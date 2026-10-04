/**
 * What a pattern says about null (SF-A02-T05.4): the nullable walker learns from a successful or failed match.
 */

/** Patterns that never match null. */
const valuePatterns = new Set(['TypePattern', 'DeclarationPattern', 'RecursivePattern', 'RelationalPattern', 'ListPattern']);

/** The expression under the implicit conversions the binder adds to an operand (lifting, boxing, to object). */
export function withoutConversions(node) {
  let current = node;
  while (current?.kind === 'Conversion' && current.operand && !current.conversion?.isUserDefined) current = current.operand;
  return current;
}

export const isNullLiteral = node => withoutConversions(node)?.literal === 'null';

/**
 * Whether a pattern matches null: 'never', 'only' (it matches nothing else) or 'maybe'.
 * A missing pattern is the type test of `e is T`, which never matches null.
 */
export function nullMatch(pattern) {
  if (!pattern) return 'never';
  switch (pattern.kind) {
    case 'ConstantPattern':
      return isNullLiteral(pattern.value ?? {}) || pattern.value?.constantValue?.isNull ? 'only' : 'never';
    case 'NotPattern':
      return nullMatch(pattern.pattern) === 'only' ? 'never' : 'maybe';
    case 'AndPattern': {
      const left = nullMatch(pattern.left),
        right = nullMatch(pattern.right);
      if (left === 'never' || right === 'never') return 'never';
      return left === 'only' || right === 'only' ? 'only' : 'maybe';
    }
    case 'OrPattern': {
      const left = nullMatch(pattern.left),
        right = nullMatch(pattern.right);
      return left === right && left !== 'maybe' ? left : 'maybe';
    }
    default:
      return valuePatterns.has(pattern.kind) ? 'never' : 'maybe';
  }
}
