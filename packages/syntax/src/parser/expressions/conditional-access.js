import { Precedence, assignmentOperators } from '../../lexer/operators.js';
/**
 * C# 6 null-conditional access. `a?.b.c?[i].d()` is ConditionalAccess(a, ConditionalAccess(.b.c, [i].d())): the
 * operand after each `?` is a chain that starts with a MemberBinding or ElementBinding and extends over the member
 * accesses, element accesses and invocations that follow, so everything after a `?` is skipped when its receiver is null.
 */
const terminators = new Set([';', ',', ')', ']', '}', 'eof']);
export const conditionalAccessMethods = {
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
    return this.colonsAfter(close + 1) <= (this.colonDepth ?? 0);
  },
  /** Counts the `:` tokens from `index` to the end of the expression that no `?` between them accounts for. */
  colonsAfter(index) {
    let depth = 0,
      colons = 0,
      questions = 0;
    for (let j = index, guard = 0; guard < 4096; j++, guard++) {
      const kind = this.kindAt(j);
      if (kind === 'eof' || (depth === 0 && terminators.has(kind))) break;
      if (depth === 0 && kind === ':') {
        if (questions > 0) questions--;
        else colons++;
      } else if (depth === 0 && kind === '?' && this.kindAt(j + 1) !== '.' && this.kindAt(j + 1) !== '[') questions++;
      if (kind === '(' || kind === '[' || kind === '{') depth++;
      else if (kind === ')' || kind === ']' || kind === '}') depth--;
    }
    return colons;
  },
  /** `expression ?` followed by its when-not-null chain; the cursor is at the `?`. */
  conditionalAccess(expression, min) {
    this.feature('NullPropagatingOperator', this.current);
    const question = this.take();
    return this.n('ConditionalAccessExpression', expression, question, this.conditionalAccessTail(min));
  },
  /** The operand after `?`: a member or element binding with its postfix chain and, in C# 14, a trailing assignment. */
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
