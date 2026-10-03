import { Precedence } from '../../lexer/operators.js';
/**
 * C# 8 index and range expressions: the prefix `^` (index from end) and `..`, which is binary (`a..b`), prefix
 * (`..b`), postfix (`a..`) or stands alone (`..`). A range binds tighter than `switch` and every binary operator and
 * looser than unary operators, so `a + 1..b - 1` is `a + (1..b) - 1` and `^1..^2` is `(^1)..(^2)`.
 */
export const rangeMethods = {
  /** `^operand`; the cursor is at `^`. */
  indexExpression() {
    this.feature('IndexOperator', this.current);
    const operator = this.take();
    return this.n('IndexExpression', operator, this.expression(Precedence.Unary));
  },
  /** `..` with an optional right operand, after the optional `left` operand; the cursor is at `..`. */
  rangeExpression(left) {
    this.feature('RangeOperator', this.current);
    const operator = this.take();
    return this.n('RangeExpression', left, operator, this.canStartExpression() ? this.expression(Precedence.Unary) : null);
  }
};
