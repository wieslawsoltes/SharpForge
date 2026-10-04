import { Precedence } from '../../lexer/operators.js';
/**
 * C# 9 pattern combinators: relational patterns, `and` / `or` / `not`, parenthesised patterns and bare type patterns. `not` binds tighter than `and`,
 * which binds tighter than `or`.
 */
const patternStarts = new Set(['<', '<=', '>', '>=', '==', '!=', '{', '[', '(']);
export const combinatorPatternMethods = {
  /**
   * Parses a pattern. `whenIsKeyword` is true in case labels and switch arms, where `when` introduces a guard.
   * `precedence` is the loosest operator a constant in the pattern may contain: after `is` the constant ends before a
   * relational operator (`x is A | B` is `(x is A) | B`), in a subpattern, a list element or a case label it runs up
   * to the conditional operator (`{ Flags: A | B }`), and in a switch expression arm up to `??`.
   */
  pattern(whenIsKeyword = this.patternWhen ?? false, precedence = Precedence.Shift) {
    const saved = this.patternWhen,
      savedPrecedence = this.patternPrecedence;
    this.patternWhen = whenIsKeyword;
    this.patternPrecedence = precedence;
    if (!this.enter()) {
      this.leave();
      this.patternWhen = saved;
      this.patternPrecedence = savedPrecedence;
      return this.n('ConstantPattern', this.missingName());
    }
    let left = this.andPattern();
    while (this.atWord('or') && this.canStartPattern(this.peek())) {
      this.feature('OrPattern', this.current);
      left = this.n('OrPattern', left, this.takeWord('or'), this.andPattern());
    }
    this.leave();
    this.patternWhen = saved;
    this.patternPrecedence = savedPrecedence;
    return left;
  },
  canStartPattern(token) {
    return patternStarts.has(token.kind) || this.canStartExpression(token) || this.isPredefined(token);
  },
  andPattern() {
    let left = this.notPattern();
    while (this.atWord('and') && this.canStartPattern(this.peek())) {
      this.feature('AndPattern', this.current);
      left = this.n('AndPattern', left, this.takeWord('and'), this.notPattern());
    }
    return left;
  },
  notPattern() {
    if (this.atWord('not') && this.canStartPattern(this.peek())) {
      this.feature('NotPattern', this.current);
      return this.n('NotPattern', this.takeWord('not'), this.notPattern());
    }
    return this.primaryPattern();
  },
  relationalPattern() {
    const start = this.current;
    this.feature('RelationalPattern', start);
    if (start.kind === '==' || start.kind === '!=') this.error(start, 'CS1525', `Invalid expression term '${start.text}'`);
    return this.n('RelationalPattern', this.take(), this.expression(Precedence.Shift));
  },
  /**
   * At `(`: a parenthesised pattern, a positional pattern, or a parenthesised constant expression that continues
   * as an expression (`(1) + 2`, `(int)x`), which is re-parsed as a ConstantPattern.
   */
  parenthesizedPattern() {
    const mark = this.mark(),
      start = this.current,
      open = this.take(),
      list = this.subpatterns(')'),
      close = this.expect(')');
    if (list.length === 1 && !list[0].children[0] && !this.at('{') && !this.isDesignationAhead()) {
      const inner = list[0].children[1],
        next = this.current,
        operand =
          (this.isId(next) && !this.isWord(next, 'and') && !this.isWord(next, 'or') && !this.isWord(next, 'when')) ||
          ['integer', 'double', 'char', 'interpolated', '('].includes(next.kind) ||
          next.kind === 'string';
      if (inner.kind === 'ConstantPattern' || (inner.kind === 'TypePattern' && operand)) {
        this.reset(mark);
        return this.n('ConstantPattern', this.expression(this.patternPrecedence ?? Precedence.Shift));
      }
      this.feature('ParenthesizedPattern', start);
      return this.n('ParenthesizedPattern', open, inner, close);
    }
    return this.recursivePattern(null, this.n('PositionalPatternClause', open, list, close));
  }
};
