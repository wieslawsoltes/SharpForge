/**
 * C# 1 jump statements: `goto label`, `goto case`, `goto default`, labels in front of any statement, `return` and
 * `throw`. `break` and `continue`, with their C# 15 preview label, are parsed in labeled-jumps.js.
 */
export const jumpStatementMethods = {
  gotoStatement(attributeLists) {
    const keyword = this.take();
    if (this.at('case')) {
      return this.n('GotoCaseStatement', attributeLists, keyword, this.take(), this.expression(), this.expect(';'));
    }
    if (this.at('default')) {
      return this.n('GotoDefaultStatement', attributeLists, keyword, this.take(), null, this.expect(';'));
    }
    return this.n('GotoStatement', attributeLists, keyword, null, this.n('IdentifierName', this.id()), this.expect(';'));
  },
  /** `label: statement` for any statement; null when the cursor is not at an identifier followed by a colon. */
  labeledStatement(attributeLists) {
    const token = this.current;
    if (!this.isId(token) || this.peek().kind !== ':' || token.kind === 'await') return null;
    return this.n('LabeledStatement', attributeLists, this.take('IdentifierToken'), this.take(), this.statement());
  },
  returnStatement(attributeLists) {
    const keyword = this.take();
    const expression = this.at(';') ? null : this.expressionOrRef();
    return this.n('ReturnStatement', attributeLists, keyword, expression, this.expect(';'));
  },
  throwStatement(attributeLists) {
    const keyword = this.take();
    const expression = this.at(';') ? null : this.expression();
    return this.n('ThrowStatement', attributeLists, keyword, expression, this.expect(';'));
  }
};
