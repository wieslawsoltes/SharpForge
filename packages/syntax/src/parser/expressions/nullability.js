import { Precedence, assignmentOperators } from '../../lexer/operators.js';
/**
 * Nullable syntax in expressions: `?.` / `?[` conditional access versus the conditional operator, and postfix `!`.
 * The `T?` versus `c ? a : b` rule for types lives in types.js (mode 'afterIs').
 */
const terminators = new Set([';', ',', ')', ']', '}', 'eof']);
export const nullabilityMethods = {
  /** A postfix `!` suppresses nullable warnings; `!=` is already a single token, so any `!` after an operand qualifies. */
  isSuppression() {
    return true;
  },
  /**
   * At `?`: `?.` is conditional access. `?[` is conditional access unless reading `[...]` as a collection expression
   * yields more `:` tokens than the enclosing conditional operators are still waiting for (`c ? [1] : [2]`).
   */
  isConditionalAccess(i = this.i) {
    const next = this.kindAt(i + 1);
    if (next === '.') return true;
    if (next !== '[') return false;
    const close = this.matchingBracket(i + 1);
    if (close < 0) return true;
    let depth = 0,
      colons = 0,
      questions = 0;
    for (let j = close + 1, guard = 0; guard < 4096; j++, guard++) {
      const kind = this.kindAt(j);
      if (depth === 0) {
        if (terminators.has(kind)) break;
        if (kind === ':') {
          if (questions > 0) questions--;
          else colons++;
        } else if (kind === '?' && this.kindAt(j + 1) !== '.' && this.kindAt(j + 1) !== '[') questions++;
      }
      if (kind === '(' || kind === '[' || kind === '{') depth++;
      else if (kind === ')' || kind === ']' || kind === '}') depth--;
      if (kind === 'eof') break;
    }
    return colons <= (this.colonDepth ?? 0);
  },
  /** The `whenNotNull` operand after `?`: a member or element binding with its postfix chain and, in C# 14, a trailing assignment. */
  conditionalAccessTail(min) {
    let binding = this.at('.')
      ? this.n('MemberBindingExpression', this.take(), this.simpleName(false))
      : this.n('ElementBindingExpression', this.bracketedArgumentList());
    binding = this.postfix(binding, min, true);
    const operator = this.operatorAt();
    if (assignmentOperators[operator.text] && min <= Precedence.Assignment && binding.kind !== 'ConditionalAccessExpression') {
      this.feature('NullConditionalAssignment', this.current);
      const token = this.takeOperator(operator);
      binding = this.n(assignmentOperators[operator.text], binding, token, this.expression(Precedence.Assignment));
    }
    return binding;
  }
};
