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
  /**
   * Arguments up to `close`. After a `,` an argument is always parsed, so `F(a, )` reports the missing one. A list
   * that runs into `;` is left empty, and an element access always has at least one argument, as in Roslyn.
   */
  arguments(close) {
    const list = [],
      indexer = close === ']';
    if (this.at(';') || this.at('eof') || (this.at(close) && !indexer)) return list;
    for (;;) {
      const before = this.i;
      list.push(this.argument(indexer));
      const comma = this.separator(this.canStartArgument);
      if (!comma || before === this.i) break;
      list.push(comma);
    }
    return list;
  },
  canStartArgument() {
    return this.atAny(['ref', 'out', 'in']) || this.canStartExpression();
  },
  /** One argument or tuple element: optional `name:`, optional ref/out/in, then an expression or declaration expression. */
  argument(indexer = false) {
    let nameColon = null,
      refKind = null;
    if (this.isId() && this.peek().kind === ':') {
      this.feature('NamedArgument', this.current);
      nameColon = this.n('NameColon', this.n('IdentifierName', this.id()), this.take());
    }
    if (this.atAny(['ref', 'out', 'in'])) refKind = this.take();
    if (indexer && (this.at(',') || this.at(']'))) {
      this.error(this.errorAnchor(), 'CS0443', 'Syntax error; value expected');
      return this.n('Argument', nameColon, refKind, this.missingName());
    }
    if (this.at(',')) {
      this.error(this.errorAnchor(), 'CS0839', 'Argument missing');
      return this.n('Argument', nameColon, refKind, this.missingName());
    }
    const declares = refKind?.kind === 'OutKeyword' || (this.declarationContext ?? 0) > 0 || this.tupleContext;
    if (refKind?.kind === 'OutKeyword' && this.isDeclarationExpressionAhead()) this.feature('OutVar', this.current);
    return this.n('Argument', nameColon, refKind, declares && this.isDeclarationExpressionAhead() ? this.declarationExpression() : this.expression());
  }
};
