import { Precedence } from '../../lexer/operators.js';
/**
 * C# 7 throw expressions. They are allowed as a branch of the conditional operator, as the right operand of `??` and
 * as the body of a lambda or an expression-bodied member. Anywhere else the expression is still parsed, for recovery:
 * at a tighter precedence than `??` it reports CS1525 as Roslyn's parser does, and otherwise CS8115, which Roslyn
 * reports while binding but which depends only on the syntactic position.
 */
export const throwMethods = {
  /** An expression (or `ref` expression) in a position where a throw expression is allowed. */
  expressionOrThrow() {
    return this.at('throw') ? this.throwExpression(true) : this.expressionOrRef();
  },
  /** The right operand of `??`, which may be a throw expression. */
  coalesceOperand(precedence) {
    return this.at('throw') ? this.throwExpression(true) : this.expression(precedence);
  },
  /** `throw expression` at the cursor. `allowed` says whether the position admits one; `min` is the precedence being parsed. */
  throwExpression(allowed, min = Precedence.Expression) {
    const token = this.current;
    this.feature('ThrowExpression', token);
    const keyword = this.take(),
      node = this.n('ThrowExpression', keyword, this.expression(Precedence.Coalescing));
    // Roslyn attaches CS1525 to the throw expression node, so the span runs to the end of its operand.
    if (min > Precedence.Coalescing) {
      this.error({ start: token.start, end: this.tokens[this.i - 1].end }, 'CS1525', "Invalid expression term 'throw'");
    }
    else if (!allowed) this.error(token, 'CS8115', 'A throw expression is not allowed in this context.');
    return node;
  }
};
