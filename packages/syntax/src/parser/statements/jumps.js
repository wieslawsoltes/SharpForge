/**
 * C# 1 jump statements: `goto label`, `goto case`, `goto default`, labels in front of any statement, `break`, `continue`,
 * `return` and `throw`. A label after `break` or `continue` is the C# 15 preview labeled jump and is gated as such.
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
  breakOrContinueStatement(attributeLists) {
    const kind = this.current.kind === 'break' ? 'BreakStatement' : 'ContinueStatement';
    const keyword = this.take();
    const labelToken = this.current;
    const label = this.isId() ? this.take('IdentifierToken') : null;
    if (label) this.feature('LabeledBreakContinue', labelToken);
    return this.n(kind, attributeLists, keyword, label, this.expect(';'));
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
