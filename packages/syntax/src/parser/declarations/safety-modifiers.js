/**
 * C# 15 preview (provisional): memory-safety syntax from the pinned unsafe-evolution proposal (see preview-revisions.js).
 *
 *  - `safe`, a contextual modifier allowed wherever `unsafe` is: it marks a declaration as not requires-unsafe
 *    (required on extern members under the new rules). It is a modifier only when a declaration can follow it;
 *    `safe` as a field, local, parameter, method or type name keeps parsing as a name at every LangVersion.
 *  - `unsafe(expression)`, an expression that opens an unsafe context for one operand.
 *
 * Both forms were syntax errors before, so recognising them changes no valid program; below preview they report CS8652.
 *
 * The existing `unsafe` modifier marks a member requires-unsafe under the new rules and needs no new syntax, and
 * the requires-unsafe marker on metadata is an attribute, not grammar.
 */
export const safetyModifierMethods = {
  isSafeModifier(index) {
    if (!this.isWord(this.tokens[index], 'safe')) return false;
    return this.canFollowContextualModifier(this.tokens[Math.min(index + 1, this.tokens.length - 1)], index + 1);
  },
  safeModifier(token) {
    this.feature('SafeModifier', token);
  },
  isUnsafeExpression(i = this.i) {
    return this.kindAt(i) === 'unsafe' && this.kindAt(i + 1) === '(';
  },
  unsafeExpression() {
    const start = this.current,
      keyword = this.take(),
      open = this.take(),
      expression = this.nested(() => this.expression());
    this.feature('UnsafeExpressions', start);
    return this.n('UnsafeExpression', keyword, open, expression, this.expect(')'));
  }
};
