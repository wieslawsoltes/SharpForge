import { Precedence } from '../../lexer/operators.js';
/**
 * C# 8 index and range expressions: the prefix `^` (index from end) and `..`, which is binary (`a..b`), prefix
 * (`..b`), postfix (`a..`) or stands alone (`..`). A range binds tighter than `switch` and every binary operator and
 * looser than unary operators, so `a + 1..b - 1` is `a + (1..b) - 1` and `^1..^2` is `(^1)..(^2)`.
 */
export const rangeMethods = {
  /** `^operand`; the cursor is at `^`. */
  indexExpression() {
    const start = this.current,
      operator = this.take(),
      operand = this.expression(Precedence.Unary);
    this.feature('IndexOperator', start, this.tokens[this.i - 1]);
    return this.n('IndexExpression', operator, operand);
  },
  /** `..` with an optional right operand, after the optional `left` operand whose tokens start at index `start`; the cursor is at `..`. */
  rangeExpression(left, start = this.i) {
    const operator = this.take(),
      right = this.canStartExpression() ? this.expression(Precedence.Unary) : null;
    this.feature('RangeOperator', this.tokens[start], this.tokens[this.i - 1]);
    return this.n('RangeExpression', left, operator, right);
  }
};
