import { Precedence } from '../../lexer/operators.js';
/**
 * C# 8 switch expressions: `value switch { pattern when guard => result, ... }`. `switch` binds tighter than every
 * binary operator and looser than a range, so `a + b switch { ... }` switches on `b` and `a..b switch { ... }` on
 * the range. Its arms take the full pattern grammar and may end in a throw expression.
 */
const lowerPrecedenceOperands = new Set(['AsExpression', 'IsExpression', 'IsPatternExpression']);
export const switchExpressionMethods = {
  /** `governing switch { arms }`; the cursor is at `switch`. */
  switchExpression(governing) {
    const start = this.current;
    this.feature('SwitchExpression', start);
    this.precedenceInversion(governing, start);
    const keyword = this.take(),
      open = this.expect('{'),
      arms = [];
    this.nested(() => {
      while (!this.at('}') && !this.at('eof')) {
        const before = this.i;
        arms.push(this.switchExpressionArm());
        if (before === this.i && !this.at(',')) break;
        // Every arm but the last is followed by a comma; a missing one is reported and the next arm is parsed.
        if (!this.at('}')) arms.push(this.expect(','));
      }
    });
    return this.n('SwitchExpression', governing, keyword, open, arms, this.expect('}'));
  },
  /** `pattern [when guard] => result`. An arm that starts at `=>` reports CS8504 and gets a missing constant pattern. */
  switchExpressionArm() {
    let pattern;
    if (this.at('=>')) {
      this.error(this.errorAnchor(), 'CS8504', 'Pattern missing');
      pattern = this.n('ConstantPattern', this.missingName());
    } else pattern = this.pattern(true, Precedence.Coalescing);
    const when = this.atWord('when') ? this.n('WhenClause', this.takeWord('when'), this.expression()) : null,
      arrow = this.expect('=>');
    return this.n('SwitchExpressionArm', pattern, when, arrow, this.coalesceOperand(Precedence.Expression));
  },
  /**
   * `x as T switch { ... }` and `x is T with { ... }` apply the operator to an operand of lower precedence, which
   * only happens after `is` and `as` because their right operand is a type. Roslyn warns with CS8848 at the operator.
   */
  precedenceInversion(left, operator) {
    if (lowerPrecedenceOperands.has(left.kind))
      this.error(operator, 'CS8848', `Operator '${operator.text}' cannot be used here due to precedence. Use parentheses to disambiguate.`, 'warning');
  }
};
