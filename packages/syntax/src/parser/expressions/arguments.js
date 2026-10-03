/**
 * Argument lists of invocations, element accesses, object creations and tuples: positional and C# 4 named arguments,
 * `ref` / `out` / `in` modifiers and C# 7 declaration expressions (`out var x`).
 */
export const argumentMethods = {
  argumentList() {
    const open = this.expect('('),
      args = this.nested(() => this.arguments(')'));
    return this.n('ArgumentList', open, args, this.expect(')'));
  },
  bracketedArgumentList() {
    const open = this.expect('['),
      args = this.nested(() => this.arguments(']'));
    return this.n('BracketedArgumentList', open, args, this.expect(']'));
  },
  arguments(close) {
    const list = [];
    while (!this.at(close) && !this.at('eof')) {
      const before = this.i;
      list.push(this.argument());
      if (this.at(',')) list.push(this.take());
      else break;
      if (before === this.i) break;
    }
    return list;
  },
  /** One argument or tuple element: optional `name:`, optional ref/out/in, then an expression or declaration expression. */
  argument() {
    let nameColon = null,
      refKind = null;
    if (this.isId() && this.peek().kind === ':') {
      this.feature('NamedArgument', this.current);
      nameColon = this.n('NameColon', this.n('IdentifierName', this.id()), this.take());
    }
    if (this.atAny(['ref', 'out', 'in'])) refKind = this.take();
    const declares = refKind?.kind === 'OutKeyword' || (this.declarationContext ?? 0) > 0 || this.tupleContext;
    if (refKind?.kind === 'OutKeyword' && this.isDeclarationExpressionAhead()) this.feature('OutVar', this.current);
    return this.n('Argument', nameColon, refKind, declares && this.isDeclarationExpressionAhead() ? this.declarationExpression() : this.expression());
  }
};
