/**
 * Literal expressions: numeric, character, string (regular, verbatim, raw and UTF-8), `true`, `false`, `null`,
 * `__arglist`, and `default`, which is the C# 2 `default(T)` operator or the C# 7.1 `default` literal.
 */
const literalKinds = {
  NumericLiteralToken: 'NumericLiteralExpression',
  CharacterLiteralToken: 'CharacterLiteralExpression',
  TrueKeyword: 'TrueLiteralExpression',
  FalseKeyword: 'FalseLiteralExpression',
  NullKeyword: 'NullLiteralExpression',
  ArgListKeyword: 'ArgListExpression'
};
export const literalMethods = {
  /** The literal expression at the cursor, or null when the token is not a literal. */
  literalExpression() {
    const token = this.current,
      kind = token.syntaxKind;
    if (Object.hasOwn(literalKinds, kind)) return this.n(literalKinds[kind], this.take());
    if (kind.endsWith('StringLiteralToken')) return this.n(token.flags?.utf8 ? 'Utf8StringLiteralExpression' : 'StringLiteralExpression', this.take());
    return null;
  },
  /** `default(T)` or the target-typed `default` literal; the cursor is at `default`. */
  defaultExpression() {
    const token = this.current;
    if (this.peek().kind === '(') {
      this.feature('Default', token);
      return this.n('DefaultExpression', this.take(), this.take(), this.type(), this.expect(')'));
    }
    this.feature('DefaultLiteral', token);
    return this.n('DefaultLiteralExpression', this.take());
  }
};
